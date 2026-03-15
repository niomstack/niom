/**
 * Task Runner — ToolLoopAgent-based background task execution.
 *
 * Instead of a rigid Plan → Execute Steps → Synthesize pipeline,
 * tasks are now powered by the same ToolLoopAgent as interactive chat.
 * The agent decides its own approach, uses tools dynamically, and
 * produces a deliverable naturally.
 *
 * Checkpoint continuation:
 *   Agent works in "segments" of N tool calls (configurable via checkpointEvery).
 *   After each segment, the user is asked to continue/modify/stop.
 *   On continue, a new agent segment starts with accumulated context.
 *   This gives human oversight without limiting the agent's depth.
 *
 * Pipeline: Goal → Segment 1 → Checkpoint → Continue → Segment 2 → ... → Deliverable
 */

import { EventEmitter } from "events";
import type { LanguageModel } from "ai";
import { createNiomAgent } from "../agent";
import { saveTask } from "./task-store";
import { writeTaskDigest } from "./task-digest";
import type {
  Task,
  TaskToolCall,
  TaskStatus,
  CheckpointData,
  CheckpointResponse,
  TaskProgressPayload,
  TaskCheckpointPayload,
  TaskCompletePayload,
  TaskErrorPayload,
  TaskActivityPayload,
} from "@/shared/task-types";

// ─── Error Classification ────────────────────────────────────────────

const RETRYABLE_ERROR_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /429/,
  /quota.?exceeded/i,
  /capacity/i,
  /overloaded/i,
  /503/,
  /502/,
  /timeout/i,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /network.?error/i,
  /fetch failed/i,
  /socket hang up/i,
];

function isRetryableError(error: string): boolean {
  return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(error));
}

function getRetryDelay(attempt: number): number {
  return Math.min(2000 * Math.pow(2, attempt), 16000);
}

const MAX_AUTO_RETRIES = 3;
const DEFAULT_CHECKPOINT_EVERY = 10;
const DEFAULT_MAX_STEPS = 30;

// ─── Task Runner ─────────────────────────────────────────────────────

export class TaskRunner extends EventEmitter {
  private task: Task;
  private model: LanguageModel;
  private abortController: AbortController;
  private recallEnabled: boolean;
  private checkpointEvery: number;
  private maxSteps: number;
  private customSystemPrompt?: string;

  private checkpointResolver: ((response: CheckpointResponse) => void) | null = null;
  private retryCount = 0;

  constructor(
    task: Task,
    model: LanguageModel,
    options?: {
      recallEnabled?: boolean;
      checkpointEvery?: number;
      maxSteps?: number;
      systemPrompt?: string;
    },
  ) {
    super();
    this.task = task;
    this.model = model;
    this.recallEnabled = options?.recallEnabled ?? false;
    this.checkpointEvery = options?.checkpointEvery ?? DEFAULT_CHECKPOINT_EVERY;
    this.maxSteps = options?.maxSteps ?? DEFAULT_MAX_STEPS;
    this.customSystemPrompt = options?.systemPrompt;
    this.abortController = new AbortController();
  }

  get currentTask(): Task { return this.task; }

  cancel(): void {
    this.abortController.abort();
    this.updateStatus("cancelled");
    this.persist();
  }

  pause(): void {
    if (this.task.status === "running") {
      this.updateStatus("paused");
      this.persist();
    }
  }

  respondToCheckpoint(response: CheckpointResponse): void {
    if (this.checkpointResolver) {
      this.checkpointResolver(response);
      this.checkpointResolver = null;
    }
  }

  async run(): Promise<void> {
    try {
      this.updateStatus("running");
      this.emitProgress();

      console.log(`[task] Running task ${this.task.id}: "${this.task.goal}"`);

      await this.executeAgent();

    } catch (error: unknown) {
      if (this.abortController.signal.aborted) return;

      const errorMessage = error instanceof Error ? error.message : String(error);

      if (isRetryableError(errorMessage) && this.retryCount < MAX_AUTO_RETRIES) {
        this.retryCount++;
        const delay = getRetryDelay(this.retryCount - 1);
        console.log(
          `[task] Retryable error (attempt ${this.retryCount}/${MAX_AUTO_RETRIES}), ` +
          `retrying in ${delay}ms: ${errorMessage.slice(0, 100)}`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (this.isTerminated()) return;
        return this.run();
      }

      console.error(`[task] Task ${this.task.id} failed:`, errorMessage);

      const errorCheckpoint: CheckpointData = {
        id: crypto.randomUUID(),
        type: "error",
        summary: `Task failed${
          isRetryableError(errorMessage)
            ? ` after ${MAX_AUTO_RETRIES} auto-retries`
            : ""
        }`,
        error: errorMessage,
        actions: [
          { type: "retry", label: "Retry" },
          { type: "stop", label: "Stop Task" },
        ],
        createdAt: Date.now(),
      };

      this.updateStatus("checkpoint");
      this.task.activeCheckpoint = errorCheckpoint;
      this.persist();

      this.emit("task:error", {
        taskId: this.task.id,
        threadId: this.task.threadId,
        error: errorMessage,
        checkpoint: errorCheckpoint,
      } satisfies TaskErrorPayload);

      const response = await this.awaitCheckpoint();
      if (this.isTerminated()) return;

      if (response.action === "retry") {
        this.task.activeCheckpoint = undefined;
        this.retryCount = 0;
        return this.run();
      } else {
        this.updateStatus("cancelled");
        this.persist();
      }
    }
  }

  async resume(): Promise<void> {
    console.log(`[task] Resuming task ${this.task.id} from status: ${this.task.status}`);

    try {
      this.task.activeCheckpoint = undefined;
      this.updateStatus("running");
      this.persist();
      this.emitProgress();

      await this.executeAgent();

    } catch (error: unknown) {
      if (this.abortController.signal.aborted) return;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[task] Resume failed for ${this.task.id}:`, errorMessage);
      this.updateStatus("failed");
      this.persist();
      this.emit("task:error", {
        taskId: this.task.id,
        threadId: this.task.threadId,
        error: errorMessage,
      } satisfies TaskErrorPayload);
    }
  }

  // ─── Agent Execution with Checkpoint Continuation ──────────────────

  /**
   * Execute the task agent with automatic checkpointing.
   *
   * Uses AI SDK v6's stopWhen (via maxSteps on createNiomAgent) to run
   * the agent in segments of `checkpointEvery` tool calls. Between segments,
   * the user is asked to continue, modify their approach, or stop.
   *
   * This enables long-running tasks (50+ tool calls) with human oversight.
   */
  private async executeAgent(): Promise<void> {
    /** Accumulated text from completed agent segments */
    const segmentResults: string[] = [];
    /** Track tool calls within the current segment for checkpoint detection */
    let segmentToolCallCount = 0;

    while (true) {
      if (this.isTerminated()) return;

      segmentToolCallCount = 0;

      const agent = createNiomAgent(this.model, {
        threadId: this.task.threadId,
        recallEnabled: this.recallEnabled,
        // Each segment is limited to checkpointEvery steps
        maxSteps: this.checkpointEvery,
      });

      const result = await agent.generate({
        prompt: this.buildPrompt(segmentResults),
        abortSignal: this.abortController.signal,

        experimental_onToolCallStart: (event) => {
          const toolCall: TaskToolCall = {
            id: event.toolCall.toolCallId,
            toolName: event.toolCall.toolName,
            status: "running",
            startedAt: Date.now(),
          };
          this.task.activity.push(toolCall);
          this.task.toolCallCount++;
          segmentToolCallCount++;

          this.emit("task:activity", {
            taskId: this.task.id,
            threadId: this.task.threadId,
            toolCall,
          } satisfies TaskActivityPayload);
        },

        experimental_onToolCallFinish: (event) => {
          const tc = this.task.activity.find((t) => t.id === event.toolCall.toolCallId);
          if (tc) {
            tc.status = event.success ? "completed" : "error";
            tc.completedAt = Date.now();

            if (event.success && event.output != null) {
              try {
                const output = typeof event.output === "string"
                  ? JSON.parse(event.output)
                  : event.output;
                if (output && typeof output === "object" && "summary" in output) {
                  tc.summary = String((output as Record<string, unknown>).summary).slice(0, 200);
                }
              } catch {
                // Not a SkillResult JSON
              }
            }

            this.emit("task:activity", {
              taskId: this.task.id,
              threadId: this.task.threadId,
              toolCall: tc,
            } satisfies TaskActivityPayload);
          }

          if (this.task.toolCallCount % 3 === 0) {
            this.persist();
            this.emitProgress();
          }
        },
      });

      // Accumulate usage from this segment
      const usage = result.usage;
      if (usage) {
        this.task.totalUsage.inputTokens += usage.inputTokens ?? 0;
        this.task.totalUsage.outputTokens += usage.outputTokens ?? 0;
        this.task.totalUsage.totalTokens += usage.totalTokens ?? 0;
      }

      const segmentText = result.text;
      if (segmentText) {
        segmentResults.push(segmentText);
      }

      this.persist();
      this.emitProgress();

      // If the agent used fewer tool calls than the checkpoint limit,
      // it finished naturally — no more work needed
      const hitCheckpointLimit = segmentToolCallCount >= this.checkpointEvery;

      if (!hitCheckpointLimit) {
        break; // Agent finished naturally
      }

      // Agent hit the checkpoint limit — ask user to continue
      console.log(`[task] Checkpoint at ${this.task.toolCallCount} tool calls for task ${this.task.id}`);

      const recentTools = this.task.activity
        .filter((a) => a.status === "completed")
        .slice(-5)
        .map((a) => `${a.toolName}${a.summary ? `: ${a.summary}` : ""}`)
        .join(", ");

      const checkpoint: CheckpointData = {
        id: crypto.randomUUID(),
        type: "progress",
        summary: `Completed ${this.task.toolCallCount} tool calls so far`,
        findings: [
          segmentText
            ? `**Latest progress:** ${segmentText.slice(0, 300)}${segmentText.length > 300 ? "…" : ""}`
            : `**Recent activity:** ${recentTools || "Processing..."}`,
        ],
        actions: [
          { type: "continue", label: "Continue Working" },
          { type: "modify", label: "Adjust Approach" },
          { type: "stop", label: "Stop & Deliver" },
        ],
        createdAt: Date.now(),
      };

      this.updateStatus("checkpoint");
      this.task.activeCheckpoint = checkpoint;
      this.persist();

      this.emit("task:checkpoint", {
        taskId: this.task.id,
        threadId: this.task.threadId,
        checkpoint,
      } satisfies TaskCheckpointPayload);

      const response = await this.awaitCheckpoint();
      if (this.isTerminated()) return;

      if (response.action === "stop") {
        break; // User wants to stop — deliver what we have
      }

      if (response.action === "modify" && response.guidance) {
        this.task.goal = `${this.task.goal}\n\nUser guidance: ${response.guidance}`;
      }

      // Continue — clear checkpoint and loop for next segment
      this.task.activeCheckpoint = undefined;
      this.updateStatus("running");
      this.persist();
      this.emitProgress();

      console.log(`[task] Continuing task ${this.task.id} after checkpoint (action: ${response.action})`);
    }

    // ── Task finished — produce deliverable ──
    if (this.isTerminated()) return;

    const deliverable = segmentResults[segmentResults.length - 1]
      || "Task completed but produced no output.";

    this.task.deliverable = deliverable;
    this.task.completedAt = Date.now();
    this.updateStatus("completed");
    this.persist();

    const elapsed = this.task.completedAt - this.task.createdAt;
    console.log(
      `[task] Task ${this.task.id} completed in ${Math.round(elapsed / 1000)}s | ` +
      `${this.task.totalUsage.totalTokens} tokens | ` +
      `${this.task.toolCallCount} tool calls | ` +
      `${segmentResults.length} segment(s)`
    );

    this.emit("task:complete", {
      taskId: this.task.id,
      threadId: this.task.threadId,
      deliverable,
      totalUsage: this.task.totalUsage,
      elapsedMs: elapsed,
    } satisfies TaskCompletePayload);

    try {
      await writeTaskDigest(this.task, this.model);
    } catch (digestError) {
      console.warn("[task] Failed to write task digest:", digestError);
    }
  }

  // ─── Prompt Builder ─────────────────────────────────────────────

  private buildPrompt(priorSegments?: string[]): string {
    const taskInstructions = this.customSystemPrompt
      ? this.customSystemPrompt
      : `You are a task specialist agent working in the background. Your job is to thoroughly accomplish the given goal using available tools.

Work methodology:
1. Think about what needs to be done and outline your approach
2. Execute each part systematically — use tools as needed
3. If a search doesn't give enough information, search again with different terms
4. Cross-reference findings when doing research
5. Be thorough rather than fast — quality matters
6. When finished, produce a comprehensive, well-structured deliverable

Important:
- You have access to search, read, write, and other tools
- Use them proactively — don't just reason, actually gather data
- Format your final output with clear headings, bullet points, and structure
- If the task involves research, cite sources and provide evidence`;

    // Build continuation context from prior segments
    const continuationContext = priorSegments && priorSegments.length > 0
      ? `\n\n<prior_work>\nYou have already completed ${priorSegments.length} work segment(s). Here is what you've found so far:\n\n${
          priorSegments.map((s, i) =>
            `--- Segment ${i + 1} ---\n${s.slice(0, 1000)}${s.length > 1000 ? "\n[truncated]" : ""}`
          ).join("\n\n")
        }\n</prior_work>\n\nContinue working toward the goal. Build on your prior findings. When you have enough information, produce a comprehensive final deliverable that synthesizes ALL your work.`
      : `\n\nWork on this goal now. Use available tools to research, analyze, and produce a detailed deliverable. When you're done, write your final comprehensive report as your response.`;

    return `${taskInstructions}\n\nYour goal: "${this.task.goal}"${continuationContext}`;
  }

  // ─── Checkpoint ─────────────────────────────────────────────────

  private awaitCheckpoint(): Promise<CheckpointResponse> {
    return new Promise<CheckpointResponse>((resolve) => {
      this.checkpointResolver = resolve;
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private updateStatus(status: TaskStatus): void {
    this.task.status = status;
    this.task.updatedAt = Date.now();
  }

  private persist(): void {
    saveTask(this.task);
  }

  private isTerminated(): boolean {
    return (
      this.abortController.signal.aborted ||
      this.task.status === "cancelled" ||
      this.task.status === "failed"
    );
  }

  private emitProgress(): void {
    this.emit("task:progress", {
      taskId: this.task.id,
      threadId: this.task.threadId,
      status: this.task.status,
      toolCallCount: this.task.toolCallCount,
      totalUsage: this.task.totalUsage,
    } satisfies TaskProgressPayload);
  }
}

// ─── Active Runners Registry ─────────────────────────────────────────

const activeRunners = new Map<string, TaskRunner>();

export function getActiveRunner(taskId: string): TaskRunner | undefined {
  return activeRunners.get(taskId);
}

export function registerRunner(taskId: string, runner: TaskRunner): void {
  activeRunners.set(taskId, runner);
}

export function unregisterRunner(taskId: string): void {
  activeRunners.delete(taskId);
}

export function getActiveRunnerCount(): number {
  return activeRunners.size;
}
