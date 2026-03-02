/**
 * Task approval logic.
 *
 * Determines whether a run needs approval and handles
 * the approve/reject flow.
 */

import type { BackgroundTask, TaskRun } from "../types.js";
import { TaskManager } from "../manager.js";

/**
 * Determine if a task run requires user approval before recording as complete.
 *
 * Approval modes:
 *   - "always"  → every run needs approval
 *   - "first_n" → first N runs need approval, then auto-approve (graduation)
 *   - "never"   → auto-approve all runs
 */
export function shouldRequireApproval(task: BackgroundTask): boolean {
    switch (task.approval.mode) {
        case "always":
            return true;
        case "never":
            return false;
        case "first_n":
            return task.approval.approvedRuns < task.approval.firstN;
        default:
            return true;
    }
}

/**
 * Approve or reject a pending task run.
 * Updates approval stats, records feedback, and resumes the task.
 */
export function approveRun(
    taskId: string,
    runId: string,
    approved: boolean,
    notes?: string,
): boolean {
    const tm = TaskManager.getInstance();
    const task = tm.getTask(taskId);
    if (!task) return false;

    // Update the run status
    const runs = tm.getRuns(taskId, 100);
    const run = runs.find(r => r.id === runId);
    if (run) {
        run.status = approved ? "completed" : "rejected";
        run.completedAt = Date.now();
        tm.saveRun(run);
    }

    // Record feedback in task memory
    task.memory.feedback.push({ runId, approved, notes });

    // Update approval stats
    if (approved) {
        task.approval.approvedRuns++;
        task.successfulRuns++;
    }

    // Store notes as a decision (corrections for future runs)
    if (notes) {
        task.memory.decisions.push(notes);
    }

    task.updatedAt = Date.now();

    // Resume the task based on type and approval
    if (approved) {
        if (task.taskType === "recurring" && task.schedule) {
            task.schedule.runCount++;

            if (task.schedule.maxRuns && task.schedule.runCount >= task.schedule.maxRuns) {
                tm.updateTask(taskId, { memory: task.memory, approval: task.approval, schedule: task.schedule });
                tm.transitionTo(taskId, "completed");
                console.log(`[runner] Task ${taskId.slice(0, 8)} completed — max runs reached`);
            } else {
                task.schedule.nextRunAt = Date.now() + task.schedule.intervalMs;
                tm.updateTask(taskId, { memory: task.memory, approval: task.approval, schedule: task.schedule });
                tm.transitionTo(taskId, "scheduled");
            }
        } else {
            tm.updateTask(taskId, { memory: task.memory, approval: task.approval });
            tm.transitionTo(taskId, "completed");
        }
    } else {
        // Rejected — keep paused
        tm.updateTask(taskId, { memory: task.memory, approval: task.approval });
    }

    console.log(`[runner] Run ${runId.slice(0, 8)} ${approved ? "approved" : "rejected"} for task ${taskId.slice(0, 8)}`);
    return true;
}
