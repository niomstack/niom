/**
 * TaskManager — singleton that manages the lifecycle of background tasks.
 *
 * Task Streams model:
 *   - 4 states: running, flowing, paused, done
 *   - No approval gates — tasks just flow
 *   - User steers via inline comments
 *   - Auto-pause on idle (configurable per task)
 *
 * Responsibilities:
 *   1. CRUD operations (create, read, update, delete)
 *   2. State transitions (run, flow, pause, done)
 *   3. Scheduler loop (30s tick, checks nextRunAt + auto-pause)
 *   4. Steering (accept user comments, inject into next run)
 *
 * Tasks are encrypted at rest via MemoryStore at ~/.niom/memory/tasks/.
 * Runs are encrypted at ~/.niom/memory/runs/{taskId}/.
 */

import { MemoryStore, type TaskEntry } from "../memory/store.js";

import type {
    BackgroundTask,
    TaskRegistryEntry,
    TaskStatus,
    TaskType,
    TaskRun,
    TaskSchedule,
    TaskPlan,
    AutoPauseConfig,
} from "./types.js";
import {
    canTransition,
    emptyMemory,
    parseInterval,
    DEFAULT_AUTO_PAUSE,
} from "./types.js";

// ── Constants ──

const SCHEDULER_INTERVAL_MS = 30_000; // 30s tick
const MAX_TASKS = 100;

// ── Task Run Callbacks ──

/** Called by the scheduler when a task is due. Set by the sidecar at boot. */
export type TaskRunCallback = (task: BackgroundTask) => Promise<TaskRun>;

// ── Helper: BackgroundTask → TaskEntry (for index) ──

function toIndexEntry(task: BackgroundTask): TaskEntry {
    return {
        id: task.id,
        goal: task.goal,
        taskType: task.taskType,
        status: task.status,
        threadId: task.threadId,
        nextRunAt: task.schedule?.nextRunAt,
        lastRunAt: task.lastRunAt,
        totalRuns: task.totalRuns,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
    };
}

// ── TaskManager Class ──

export class TaskManager {
    private static instance: TaskManager | null = null;

    /** Full task objects (lazy-loaded on demand) */
    private taskCache: Map<string, BackgroundTask> = new Map();

    /** Scheduler interval handle */
    private schedulerHandle: ReturnType<typeof setInterval> | null = null;

    /** Callback for executing a task run */
    private runCallback: TaskRunCallback | null = null;

    /** Tasks currently being executed (prevent double-runs) */
    private runningTasks: Set<string> = new Set();

    private constructor() { }

    /** Get the singleton instance */
    static getInstance(): TaskManager {
        if (!TaskManager.instance) {
            TaskManager.instance = new TaskManager();
        }
        return TaskManager.instance;
    }

    private store(): MemoryStore {
        return MemoryStore.getInstance();
    }

    // ═══════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Initialize the TaskManager — start scheduler.
     * MemoryStore.init() must have been called first (handles index loading).
     */
    init(runCallback?: TaskRunCallback): void {
        this.runCallback = runCallback ?? null;
        this.startScheduler();
        const tasks = this.store().list("tasks");
        console.log(`[tasks] Initialized — ${tasks.length} tasks loaded, scheduler active`);
    }

    /** Stop the scheduler (for shutdown) */
    shutdown(): void {
        this.stopScheduler();
        console.log("[tasks] Shutdown complete");
    }

    // ═══════════════════════════════════════════════════════════════
    // PERSISTENCE — Tasks (delegated to MemoryStore)
    // ═══════════════════════════════════════════════════════════════

    private saveTask(task: BackgroundTask): void {
        this.store().save("tasks", task.id, task, toIndexEntry(task));
        this.taskCache.set(task.id, task);
    }

    private loadTask(taskId: string): BackgroundTask | null {
        // Check cache first
        const cached = this.taskCache.get(taskId);
        if (cached) return cached;

        const task = this.store().load<BackgroundTask>("tasks", taskId);
        if (task) {
            this.taskCache.set(taskId, task);
        }
        return task;
    }

    // ═══════════════════════════════════════════════════════════════
    // PERSISTENCE — Runs (delegated to MemoryStore)
    // ═══════════════════════════════════════════════════════════════

    saveRun(run: TaskRun): void {
        this.store().saveRun(run.taskId, run.runNumber, run);
    }

    deleteRun(taskId: string, runNumber: number): void {
        this.store().deleteRun(taskId, runNumber);
    }

    getRuns(taskId: string, limit = 20): TaskRun[] {
        return this.store().loadRuns<TaskRun>(taskId, limit);
    }

    // ═══════════════════════════════════════════════════════════════
    // CRUD
    // ═══════════════════════════════════════════════════════════════

    /**
     * Create a new background task.
     * Tasks start in "flowing" state (ready to run immediately or on schedule).
     */
    createTask(
        goal: string,
        taskType: TaskType,
        plan: TaskPlan,
        options: {
            schedule?: { interval: string; maxRuns?: number };
            autoPause?: Partial<AutoPauseConfig>;
            threadId?: string;
        } = {},
    ): BackgroundTask {
        const tasks = this.store().list("tasks");
        if (tasks.length >= MAX_TASKS) {
            throw new Error(`Maximum task limit reached (${MAX_TASKS})`);
        }

        const now = Date.now();
        const id = crypto.randomUUID();

        // Build schedule if provided
        let schedule: TaskSchedule | undefined;
        if (options.schedule) {
            const intervalMs = parseInterval(options.schedule.interval);
            schedule = {
                interval: options.schedule.interval,
                intervalMs,
                nextRunAt: now, // Run immediately on first creation
                runCount: 0,
                maxRuns: options.schedule.maxRuns,
            };
        }

        // Auto-pause config (user-customizable per task)
        const autoPause: AutoPauseConfig = {
            ...DEFAULT_AUTO_PAUSE,
            ...options.autoPause,
        };

        const task: BackgroundTask = {
            id,
            goal,
            taskType,
            status: "flowing", // Start in flowing state — ready to execute
            plan,
            schedule,
            autoPause,
            memory: emptyMemory(),
            threadId: options.threadId,
            createdAt: now,
            updatedAt: now,
            lastInteractionAt: now,
            totalRuns: 0,
            successfulRuns: 0,
        };

        this.saveTask(task);
        console.log(`[tasks] Created: "${goal}" (${taskType}, ${id.slice(0, 8)})`);
        return task;
    }

    /** Get a task by ID (loads from disk if not cached) */
    getTask(taskId: string): BackgroundTask | null {
        return this.loadTask(taskId);
    }

    /** List all tasks (from index — lightweight) */
    listTasks(filter?: { status?: TaskStatus; taskType?: TaskType; threadId?: string }): TaskRegistryEntry[] {
        let entries = this.store().list("tasks") as TaskRegistryEntry[];

        if (filter?.status) {
            entries = entries.filter(e => e.status === filter.status);
        }
        if (filter?.taskType) {
            entries = entries.filter(e => e.taskType === filter.taskType);
        }
        if (filter?.threadId) {
            entries = entries.filter(e => e.threadId === filter.threadId);
        }

        return entries.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    /** Update a task's mutable fields */
    updateTask(
        taskId: string,
        updates: Partial<Pick<BackgroundTask, "goal" | "plan" | "schedule" | "autoPause" | "memory" | "outputDir">>,
    ): BackgroundTask | null {
        const task = this.loadTask(taskId);
        if (!task) return null;

        Object.assign(task, updates, { updatedAt: Date.now() });
        this.saveTask(task);
        return task;
    }

    /** Delete a task (cancels if running, removes all data) */
    deleteTask(taskId: string): boolean {
        const task = this.loadTask(taskId);
        if (!task) return false;

        // Cancel if running
        if (task.status === "running") {
            this.runningTasks.delete(taskId);
        }

        // Remove from store (handles file + index)
        this.store().delete("tasks", taskId);
        this.taskCache.delete(taskId);

        console.log(`[tasks] Deleted: ${taskId.slice(0, 8)}`);
        return true;
    }

    // ═══════════════════════════════════════════════════════════════
    // STATE TRANSITIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Transition a task to a new status.
     * Validates the transition against the state machine.
     */
    transitionTo(taskId: string, newStatus: TaskStatus): BackgroundTask | null {
        const task = this.loadTask(taskId);
        if (!task) return null;

        if (!canTransition(task.status, newStatus)) {
            console.warn(`[tasks] Invalid transition: ${task.status} → ${newStatus} for ${taskId.slice(0, 8)}`);
            return null;
        }

        const oldStatus = task.status;
        task.status = newStatus;
        task.updatedAt = Date.now();

        if (newStatus === "running") {
            this.runningTasks.add(taskId);
        } else {
            this.runningTasks.delete(taskId);
        }

        this.saveTask(task);
        console.log(`[tasks] ${taskId.slice(0, 8)}: ${oldStatus} → ${newStatus}`);
        return task;
    }

    /** Pause a task */
    pause(taskId: string): BackgroundTask | null {
        return this.transitionTo(taskId, "paused");
    }

    /** Resume a paused task → flowing (will run on next schedule tick or immediately) */
    resume(taskId: string): BackgroundTask | null {
        const task = this.loadTask(taskId);
        if (!task) return null;

        task.lastInteractionAt = Date.now();

        if (task.schedule) {
            task.schedule.nextRunAt = Date.now() + task.schedule.intervalMs;
            this.saveTask(task);
        }

        return this.transitionTo(taskId, "flowing");
    }

    /** Start a task — trigger immediate run */
    start(taskId: string): BackgroundTask | null {
        const task = this.loadTask(taskId);
        if (!task) return null;

        task.lastInteractionAt = Date.now();

        if (task.schedule) {
            task.schedule.nextRunAt = Date.now(); // Run now
            this.saveTask(task);
        }

        return this.transitionTo(taskId, "flowing");
    }

    // ═══════════════════════════════════════════════════════════════
    // STEERING — User comments that influence future runs
    // ═══════════════════════════════════════════════════════════════

    /**
     * Add a steering comment to a task.
     * Comments flow into the next run's system prompt as context.
     */
    steer(taskId: string, comment: string): BackgroundTask | null {
        const task = this.loadTask(taskId);
        if (!task) return null;

        task.memory.comments.push({
            text: comment,
            timestamp: Date.now(),
        });

        // Also add to decisions for backward compat with prompt building
        task.memory.decisions.push(comment);

        task.lastInteractionAt = Date.now();
        task.updatedAt = Date.now();
        this.saveTask(task);

        console.log(`[tasks] ${taskId.slice(0, 8)}: steered — "${comment.slice(0, 60)}"`);
        return task;
    }

    /**
     * Add a steering comment AND trigger an immediate re-run.
     * For one-shot tasks where the user wants to correct the output.
     */
    steerAndRun(taskId: string, comment: string): Promise<TaskRun | null> {
        this.steer(taskId, comment);
        return this.triggerRun(taskId);
    }

    // ═══════════════════════════════════════════════════════════════
    // RUN RECORDING
    // ═══════════════════════════════════════════════════════════════

    /**
     * Record a completed run and handle state transitions.
     * No approval gates — just record, update stats, and schedule next run.
     */
    recordRun(taskId: string, run: TaskRun): BackgroundTask | null {
        const task = this.loadTask(taskId);
        if (!task) return null;

        // Save the run log
        this.saveRun(run);

        // Update task stats
        task.totalRuns++;
        task.lastRunAt = run.completedAt ?? Date.now();
        task.updatedAt = Date.now();

        if (run.status === "completed") {
            task.successfulRuns++;
        }

        // Mark any pending comments as applied to this run
        for (const comment of task.memory.comments) {
            if (!comment.appliedToRun) {
                comment.appliedToRun = run.runNumber;
            }
        }

        // Handle state transitions — no approval gate, just flow
        if (task.schedule) {
            task.schedule.runCount++;
            if (task.schedule.maxRuns && task.schedule.runCount >= task.schedule.maxRuns) {
                task.status = "done";
                console.log(`[tasks] ${taskId.slice(0, 8)}: max runs reached (${task.schedule.runCount}/${task.schedule.maxRuns})`);
            } else {
                task.schedule.nextRunAt = Date.now() + task.schedule.intervalMs;
                task.status = "flowing";
            }
        } else {
            // One-shot tasks → done after first successful run, flowing on failure
            task.status = run.status === "completed" ? "done" : "flowing";
        }

        this.runningTasks.delete(taskId);
        this.saveTask(task);
        return task;
    }

    // ═══════════════════════════════════════════════════════════════
    // SCHEDULER
    // ═══════════════════════════════════════════════════════════════

    private startScheduler(): void {
        if (this.schedulerHandle) return;

        this.schedulerHandle = setInterval(() => {
            this.tick();
        }, SCHEDULER_INTERVAL_MS);

        if (this.schedulerHandle.unref) {
            this.schedulerHandle.unref();
        }
    }

    private stopScheduler(): void {
        if (this.schedulerHandle) {
            clearInterval(this.schedulerHandle);
            this.schedulerHandle = null;
        }
    }

    private tick(): void {
        const now = Date.now();
        const entries = this.store().list("tasks");
        let triggered = 0;
        let autoPaused = 0;

        for (const entry of entries) {
            // Auto-pause check: idle too long → pause
            if (entry.status === "flowing") {
                const task = this.loadTask(entry.id);
                if (task && task.autoPause.enabled) {
                    const lastActivity = task.lastInteractionAt ?? task.lastRunAt ?? task.createdAt;
                    if (now - lastActivity > task.autoPause.idleTimeoutMs) {
                        this.transitionTo(entry.id, "paused");
                        autoPaused++;
                        console.log(`[tasks] ${entry.id.slice(0, 8)}: auto-paused (idle ${Math.round((now - lastActivity) / 86400000)}d)`);
                        continue;
                    }
                }
            }

            // Schedule check: time to run?
            if (entry.status !== "flowing") continue;
            if (!entry.nextRunAt || entry.nextRunAt > now) continue;
            if (this.runningTasks.has(entry.id)) continue;

            triggered++;
            this.triggerRun(entry.id).catch(err => {
                console.error(`[tasks] Failed to trigger ${entry.id.slice(0, 8)}:`, err);
            });
        }

        if (triggered > 0 || autoPaused > 0) {
            console.log(`[tasks] Scheduler tick: triggered ${triggered}, auto-paused ${autoPaused}`);
        }
    }

    async triggerRun(taskId: string): Promise<TaskRun | null> {
        if (!this.runCallback) {
            console.warn("[tasks] No run callback set — cannot execute tasks");
            return null;
        }

        const task = this.loadTask(taskId);
        if (!task) return null;

        if (this.runningTasks.has(taskId)) {
            console.warn(`[tasks] ${taskId.slice(0, 8)} is already running`);
            return null;
        }

        this.transitionTo(taskId, "running");

        try {
            const run = await this.runCallback(task);
            this.recordRun(taskId, run);
            return run;
        } catch (err: any) {
            console.error(`[tasks] Run failed for ${taskId.slice(0, 8)}:`, err);

            this.deleteRun(taskId, task.totalRuns + 1);

            const failedRun: TaskRun = {
                id: crypto.randomUUID(),
                taskId,
                runNumber: task.totalRuns + 1,
                status: "failed",
                startedAt: Date.now(),
                completedAt: Date.now(),
                durationMs: 0,
                phases: [],
                toolCalls: [],
                error: err.message || String(err),
            };
            this.recordRun(taskId, failedRun);
            return failedRun;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // QUERIES
    // ═══════════════════════════════════════════════════════════════

    getStatusCounts(): Record<TaskStatus, number> {
        const entries = this.store().list("tasks");
        const counts: Record<string, number> = {};
        for (const entry of entries) {
            counts[entry.status] = (counts[entry.status] || 0) + 1;
        }
        return counts as Record<TaskStatus, number>;
    }

    hasRunningTasks(): boolean {
        return this.runningTasks.size > 0;
    }

    getDueTasks(): TaskRegistryEntry[] {
        const now = Date.now();
        const entries = this.store().list("tasks");
        return (entries as TaskRegistryEntry[]).filter(
            e => e.status === "flowing" && e.nextRunAt && e.nextRunAt <= now
        );
    }
}
