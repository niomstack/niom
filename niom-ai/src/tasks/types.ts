/**
 * Background Task types — the data model for long-running, scheduled,
 * and one-shot background tasks in NIOM.
 *
 * Tasks are created by the reasoning engine when the Analyze phase
 * detects a long-running or recurring intent. They persist across
 * sidecar restarts and can be paused, resumed, or cancelled.
 */

// ── Task Status (State Machine) ──
//
//                ┌──────────────────────────────────────┐
//                │                                       │
//     create     ↓                                       │
//   ──────→  [draft]                                     │
//               │                                        │
//         approve                                        │
//               │     ┌───── [scheduled] ←───── resume   │
//               ↓     │          │                  ↑    │
//           [planned]─┘     timer fires             │    │
//               │               │                   │    │
//          start│          ┌────↓────┐              │    │
//               ↓          │         │              │    │
//           [running] ←────┘    [paused] ←── pause  │    │
//               │                   │               │    │
//               ├── checkpoint ─────┤               │    │
//               │                   │               │    │
//               ├── complete ───→ [completed]        │    │
//               │                                   │    │
//               ├── error ──→ [failed] ─── retry ───┘    │
//               │                                        │
//               └── cancel ──→ [cancelled] ──────────────┘

export type TaskStatus =
    | "draft"       // Created but not yet approved/started
    | "planned"     // Plan generated, awaiting start or approval
    | "scheduled"   // Waiting for next run time
    | "running"     // Currently executing
    | "paused"      // Temporarily halted (user action)
    | "completed"   // Finished successfully
    | "failed"      // Last run failed
    | "cancelled";  // User cancelled

export type TaskType =
    | "one_shot"    // Runs once in background, notifies when done
    | "recurring"   // Runs on schedule (e.g., "every 2 days")
    | "continuous"  // Runs indefinitely, reacts to events (future)
    | "triggered";  // Waits for trigger, then executes (future)

// ── Task Schedule ──

export interface TaskSchedule {
    /** Human-readable interval: "2 days", "weekly", "hourly", "30 minutes" */
    interval: string;
    /** Parsed interval in milliseconds */
    intervalMs: number;
    /** Unix timestamp of next scheduled run */
    nextRunAt: number;
    /** Number of times this task has executed */
    runCount: number;
    /** Maximum number of runs (undefined = infinite) */
    maxRuns?: number;
}

// ── Task Approval ──

export interface TaskApproval {
    /** When to seek human approval for task output */
    mode: "always" | "first_n" | "never";
    /** For "first_n" mode: how many runs require approval before auto-executing */
    firstN: number;
    /** How many runs have been approved (for graduation tracking) */
    approvedRuns: number;
}

// ── Task Plan ──

export interface TaskPhase {
    id: string;
    description: string;
    status: "pending" | "running" | "completed" | "failed" | "skipped";
    startedAt?: number;
    completedAt?: number;
}

export interface TaskPlan {
    phases: TaskPhase[];
    qualityCriteria: string;
    estimatedDurationMin?: number;
}

// ── Task Memory (persists across runs) ──

export interface TaskMemory {
    /** Key learnings / facts discovered across runs */
    findings: string[];
    /** URLs, files, or sources referenced */
    sources: string[];
    /** User decisions that inform future runs */
    decisions: string[];
    /** Output files created by this task */
    filesCreated: string[];
    /** User feedback on past outputs */
    feedback: Array<{
        runId: string;
        approved: boolean;
        notes?: string;
    }>;
}

// ── Task Run (execution log) ──

export interface TaskRun {
    id: string;
    taskId: string;
    /** Sequential run number (1, 2, 3...) */
    runNumber: number;
    status: "running" | "completed" | "failed" | "pending_approval" | "rejected";
    startedAt: number;
    completedAt?: number;
    /** Duration in ms */
    durationMs?: number;
    /** Summary of what happened during this run */
    summary?: string;
    /** Phases executed during this run */
    phases: TaskPhase[];
    /** Tool calls made during this run */
    toolCalls: Array<{
        tool: string;
        input: any;
        output?: any;
        durationMs?: number;
    }>;
    /** Generated output (text, file paths, etc.) */
    output?: string;
    /** Error message if failed */
    error?: string;
    /** Quality evaluation result */
    evaluation?: {
        satisfied: boolean;
        qualityScore: number;
        issues: string[];
    };
}

// ── Background Task (main entity) ──

export interface BackgroundTask {
    id: string;
    /** Original user intent / goal */
    goal: string;
    taskType: TaskType;
    status: TaskStatus;

    /** Execution plan (generated by reasoning engine) */
    plan: TaskPlan;

    /** Schedule config (for recurring tasks) */
    schedule?: TaskSchedule;

    /** Approval settings */
    approval: TaskApproval;

    /** Persistent memory across runs */
    memory: TaskMemory;

    /** Linked conversation thread ID */
    threadId?: string;

    /** Timestamps */
    createdAt: number;
    updatedAt: number;
    lastRunAt?: number;

    /** Directory for output files */
    outputDir?: string;

    /** Runs completed for this task (summary only; full runs stored separately) */
    totalRuns: number;
    successfulRuns: number;
}

// ── Task Registry (index of all tasks) ──

export interface TaskRegistryEntry {
    id: string;
    goal: string;
    taskType: TaskType;
    status: TaskStatus;
    nextRunAt?: number;
    lastRunAt?: number;
    totalRuns: number;
    createdAt: number;
    updatedAt: number;
}

// ── Helpers ──

/** Valid transitions from each state */
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
    draft: ["planned", "scheduled", "running", "cancelled"],
    planned: ["scheduled", "running", "cancelled"],
    scheduled: ["running", "paused", "cancelled"],
    running: ["completed", "failed", "paused", "cancelled"],
    paused: ["scheduled", "running", "cancelled"],
    completed: ["scheduled", "cancelled"], // recurring tasks go back to scheduled
    failed: ["scheduled", "running", "cancelled"],
    cancelled: [], // terminal state
};

/** Check if a status transition is valid */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
    return VALID_TRANSITIONS[from].includes(to);
}

/** Create an empty task memory */
export function emptyMemory(): TaskMemory {
    return {
        findings: [],
        sources: [],
        decisions: [],
        filesCreated: [],
        feedback: [],
    };
}

/** Parse a human-readable interval string to milliseconds */
export function parseInterval(interval: string): number {
    const lower = interval.toLowerCase().trim();

    // Match patterns like "2 days", "30 minutes", "1 hour", "weekly"
    const match = lower.match(/^(\d+)\s*(second|minute|hour|day|week|month)s?$/);
    if (match) {
        const n = parseInt(match[1], 10);
        const unit = match[2];
        const multipliers: Record<string, number> = {
            second: 1000,
            minute: 60 * 1000,
            hour: 60 * 60 * 1000,
            day: 24 * 60 * 60 * 1000,
            week: 7 * 24 * 60 * 60 * 1000,
            month: 30 * 24 * 60 * 60 * 1000,
        };
        return n * (multipliers[unit] || 0);
    }

    // Named intervals
    const named: Record<string, number> = {
        hourly: 60 * 60 * 1000,
        daily: 24 * 60 * 60 * 1000,
        weekly: 7 * 24 * 60 * 60 * 1000,
        monthly: 30 * 24 * 60 * 60 * 1000,
    };
    if (named[lower]) return named[lower];

    // Fallback: 1 day
    console.warn(`[tasks] Could not parse interval "${interval}", defaulting to 1 day`);
    return 24 * 60 * 60 * 1000;
}
