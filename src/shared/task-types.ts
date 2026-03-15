/**
 * Task Types — Shared between main process and renderer.
 *
 * A Task is a background agent that works toward a goal using the same
 * ToolLoopAgent as interactive chat, but with a task-oriented system prompt
 * and configurable checkpoint intervals.
 *
 * Architecture:
 *   TaskAgent (ToolLoopAgent) → tool calls → checkpoint → continue → ... → deliverable
 */

// ─── Task Status ─────────────────────────────────────────────────────

export type TaskStatus =
  | "running"            // Agent is actively working
  | "checkpoint"         // Paused at a checkpoint, waiting for user input
  | "completed"          // Successfully finished — deliverable available
  | "failed"             // Unrecoverable error
  | "paused"             // User-initiated pause
  | "cancelled";         // User cancelled

// ─── Activity Log ────────────────────────────────────────────────────

/** A single tool call made by the task agent. */
export interface TaskToolCall {
  /** Tool call ID from AI SDK */
  id: string;
  /** Tool name (e.g., "search", "read", "write") */
  toolName: string;
  /** Status of this tool call */
  status: "running" | "completed" | "error";
  /** Brief summary of what the tool did (from SkillResult.summary) */
  summary?: string;
  /** When this tool call started */
  startedAt: number;
  /** When this tool call completed */
  completedAt?: number;
}

// ─── Checkpoint ──────────────────────────────────────────────────────

export type CheckpointType = "progress" | "error";

export interface CheckpointData {
  id: string;
  type: CheckpointType;
  /** Human-readable summary of work done so far */
  summary: string;
  /** Key findings or data to show the user */
  findings?: string[];
  /** The error if type === "error" */
  error?: string;
  /** Available actions the user can take */
  actions: CheckpointAction[];
  createdAt: number;
}

export type CheckpointAction =
  | { type: "continue"; label: string }
  | { type: "modify"; label: string }
  | { type: "stop"; label: string }
  | { type: "retry"; label: string };

// ─── Task ────────────────────────────────────────────────────────────

export interface Task {
  id: string;
  /** The thread this task was born from */
  threadId: string;
  /** The user's original goal / prompt */
  goal: string;
  /** Model used for this task */
  model: string;
  status: TaskStatus;
  /** Live activity log — tool calls as they happen */
  activity: TaskToolCall[];
  /** Number of agent tool calls completed so far */
  toolCallCount: number;
  /** Pending checkpoint waiting for user response */
  activeCheckpoint?: CheckpointData;
  /** Final deliverable (populated on completion) */
  deliverable?: string;
  /** Cumulative token usage */
  totalUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  /** Template ID if started from a template */
  templateId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

// ─── Task Meta (for listing without full activity data) ──────────────

export interface TaskMeta {
  id: string;
  threadId: string;
  goal: string;
  status: TaskStatus;
  toolCallCount: number;
  totalUsage: Task["totalUsage"];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

// ─── IPC Event Payloads ──────────────────────────────────────────────

export interface TaskProgressPayload {
  taskId: string;
  threadId: string;
  status: TaskStatus;
  toolCallCount: number;
  /** Total tokens consumed so far */
  totalUsage: Task["totalUsage"];
}

export interface TaskCheckpointPayload {
  taskId: string;
  threadId: string;
  checkpoint: CheckpointData;
}

export interface TaskCompletePayload {
  taskId: string;
  threadId: string;
  deliverable: string;
  totalUsage: Task["totalUsage"];
  elapsedMs: number;
}

export interface TaskErrorPayload {
  taskId: string;
  threadId: string;
  error: string;
  /** If the error is recoverable, include a checkpoint */
  checkpoint?: CheckpointData;
}

/** Real-time tool activity within a running task. */
export interface TaskActivityPayload {
  taskId: string;
  threadId: string;
  toolCall: TaskToolCall;
}

// ─── Checkpoint Response (renderer → main) ───────────────────────────

export interface CheckpointResponse {
  taskId: string;
  checkpointId: string;
  action: "continue" | "modify" | "stop" | "retry";
  /** User-provided guidance when action === "modify" */
  guidance?: string;
}

// ─── Task Templates ──────────────────────────────────────────────────

export interface TaskTemplateField {
  id: string;
  label: string;
  placeholder: string;
  required?: boolean;
}

export interface TaskTemplate {
  id: string;
  name: string;
  icon: string;
  category: "research" | "code" | "creative" | "business";
  description: string;
  /** System prompt for the task agent — {{field_id}} placeholders get replaced */
  systemPrompt: string;
  /** Fill-in fields the user provides */
  fields: TaskTemplateField[];
  /** Max tool loop steps for this template */
  maxSteps?: number;
  /** How often to checkpoint (in tool calls) */
  checkpointEvery?: number;
}
