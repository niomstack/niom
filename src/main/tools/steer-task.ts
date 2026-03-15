/**
 * steerTask Tool — Let the main conversation agent interact with running tasks.
 *
 * Actions:
 *   - "guide"   → Send guidance to a running task (appended to its goal context)
 *   - "pause"   → Pause a running task
 *   - "resume"  → Resume a paused task
 *   - "cancel"  → Cancel a running task
 *   - "status"  → Get detailed status of a task (read-only)
 *
 * Pack: personal (always available)
 * Approval: auto (guidance is additive, not destructive)
 */

import { tool } from "ai";
import { z } from "zod";
import type { SkillResult } from "@/shared/skill-types";
import { success, error, timed } from "./helpers";
import { getTask, listTasks } from "../tasks/task-store";

// Lazy import to avoid circular dependency: steer-task → task-runner → agent → registry → steer-task
function getActiveRunner(taskId: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getActiveRunner: _getActiveRunner } = require("../tasks/task-runner");
  return _getActiveRunner(taskId);
}

interface TaskStatusData {
  taskId: string;
  goal: string;
  status: string;
  toolCallCount: number;
  recentActivity: string[];
  checkpoint?: string;
  deliverable?: string;
}

export const steerTaskTool = tool({
  description:
    "Interact with a background task agent (minion). " +
    "Use 'status' to check progress, 'guide' to send guidance or adjust approach, " +
    "'pause' to pause, 'resume' to resume, or 'cancel' to stop a task. " +
    "If you don't know the task ID, use action 'list' to see all active tasks.",
  inputSchema: z.object({
    action: z.enum(["status", "guide", "pause", "resume", "cancel", "list"]).describe(
      "What to do: 'list' shows active tasks, 'status' shows detail, " +
      "'guide' sends guidance, 'pause/resume/cancel' controls lifecycle.",
    ),
    taskId: z.string().optional().describe(
      "The task ID to interact with. Required for status/guide/pause/resume/cancel. " +
      "Not needed for 'list'.",
    ),
    guidance: z.string().optional().describe(
      "Guidance message to send to the task (for 'guide' action). " +
      "This adjusts the task's approach without stopping it.",
    ),
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: async (input): Promise<SkillResult<any>> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return timed<any>(async () => {
      const { action, taskId, guidance } = input;

      // ── List action ──
      if (action === "list") {
        const activeTasks = listTasks({ status: ["running", "checkpoint", "paused"] });

        if (activeTasks.length === 0) {
          return success<TaskStatusData[]>(
            [],
            "No active tasks running right now.",
            { domain: "personal" },
          );
        }

        const taskStatuses: TaskStatusData[] = activeTasks.map((meta) => ({
          taskId: meta.id,
          goal: meta.goal,
          status: meta.status,
          toolCallCount: meta.toolCallCount,
          recentActivity: [],
        }));

        return success<TaskStatusData[]>(
          taskStatuses,
          `${activeTasks.length} active task${activeTasks.length === 1 ? "" : "s"}: ${activeTasks.map((t) => `"${t.goal.slice(0, 50)}…" (${t.status})`).join(", ")}`,
          { domain: "personal" },
        );
      }

      // All other actions require a taskId
      if (!taskId) {
        return error(
          "taskId is required for this action. Use action 'list' to see active tasks.",
          { domain: "personal" },
        );
      }

      const task = getTask(taskId);
      if (!task) {
        return error(`Task not found: ${taskId}`, { domain: "personal" });
      }

      // ── Status action ──
      if (action === "status") {
        const recentActivity = task.activity
          .filter((a) => a.status === "completed")
          .slice(-8)
          .map((a) => `${a.toolName}${a.summary ? `: ${a.summary}` : ""}`);

        const statusData: TaskStatusData = {
          taskId: task.id,
          goal: task.goal,
          status: task.status,
          toolCallCount: task.toolCallCount,
          recentActivity,
          checkpoint: task.activeCheckpoint?.summary,
          deliverable: task.deliverable?.slice(0, 500),
        };

        return success<TaskStatusData>(
          statusData,
          `Task "${task.goal.slice(0, 50)}…" is ${task.status} with ${task.toolCallCount} tool calls. ${task.activeCheckpoint ? `Checkpoint: ${task.activeCheckpoint.summary}` : ""}`,
          { domain: "personal" },
        );
      }

      // ── Guide action ──
      if (action === "guide") {
        if (!guidance) {
          return error(
            "The 'guidance' parameter is required for the 'guide' action.",
            { domain: "personal" },
          );
        }

        const runner = getActiveRunner(taskId);
        if (!runner) {
          return error(
            `Task ${taskId} is not currently running (status: ${task.status}). Can only guide running tasks.`,
            { domain: "personal" },
          );
        }

        // If the task is at a checkpoint, respond with the guidance
        if (task.status === "checkpoint" && task.activeCheckpoint) {
          runner.respondToCheckpoint({
            taskId: task.id,
            checkpointId: task.activeCheckpoint.id,
            action: "modify",
            guidance,
          });
          return success<TaskStatusData>(
            { taskId: task.id, goal: task.goal, status: "running", toolCallCount: task.toolCallCount, recentActivity: [] },
            `Sent guidance to task and resumed: "${guidance.slice(0, 100)}"`,
            { domain: "personal" },
          );
        }

        // If task is actively running, we append guidance to the goal
        // The next checkpoint/segment will pick it up
        task.goal = `${task.goal}\n\nAgent guidance: ${guidance}`;
        return success<TaskStatusData>(
          { taskId: task.id, goal: task.goal, status: task.status, toolCallCount: task.toolCallCount, recentActivity: [] },
          `Guidance queued for next checkpoint: "${guidance.slice(0, 100)}". The task will incorporate this in its next segment.`,
          { domain: "personal" },
        );
      }

      // ── Pause action ──
      if (action === "pause") {
        const runner = getActiveRunner(taskId);
        if (runner) {
          runner.pause();
          return success<TaskStatusData>(
            { taskId: task.id, goal: task.goal, status: "paused", toolCallCount: task.toolCallCount, recentActivity: [] },
            `Paused task: "${task.goal.slice(0, 50)}…"`,
            { domain: "personal" },
          );
        }
        return error(`Task ${taskId} is not actively running.`, { domain: "personal" });
      }

      // ── Resume action ──
      if (action === "resume") {
        if (task.status !== "paused" && task.status !== "checkpoint") {
          return error(`Task is ${task.status}, not paused or at checkpoint.`, { domain: "personal" });
        }
        // Resume via checkpoint response
        const runner = getActiveRunner(taskId);
        if (runner && task.activeCheckpoint) {
          runner.respondToCheckpoint({
            taskId: task.id,
            checkpointId: task.activeCheckpoint.id,
            action: "continue",
          });
          return success<TaskStatusData>(
            { taskId: task.id, goal: task.goal, status: "running", toolCallCount: task.toolCallCount, recentActivity: [] },
            `Resumed task: "${task.goal.slice(0, 50)}…"`,
            { domain: "personal" },
          );
        }
        return error(`No active runner for task ${taskId}. It may need to be restarted.`, { domain: "personal" });
      }

      // ── Cancel action ──
      if (action === "cancel") {
        const runner = getActiveRunner(taskId);
        if (runner) {
          runner.cancel();
          return success<TaskStatusData>(
            { taskId: task.id, goal: task.goal, status: "cancelled", toolCallCount: task.toolCallCount, recentActivity: [] },
            `Cancelled task: "${task.goal.slice(0, 50)}…"`,
            { domain: "personal" },
          );
        }
        return error(`No active runner for task ${taskId}.`, { domain: "personal" });
      }

      return error(`Unknown action: ${action}`, { domain: "personal" });
    });
  },
});
