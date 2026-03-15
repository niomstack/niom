/**
 * useTaskManager — Manages task state and IPC listeners for the Task system.
 *
 * Provides:
 *   - Real-time task progress via IPC listeners
 *   - Task actions (start, pause, cancel, respond to checkpoint)
 *   - Task list for the current thread + global view
 *   - Active task tracking with live activity feed
 *
 * Follows the same pattern as useNiomChat — thin hook bridging IPC to React state.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type {
  Task,
  TaskMeta,
  TaskStatus,
  TaskProgressPayload,
  TaskCheckpointPayload,
  TaskCompletePayload,
  TaskErrorPayload,
  TaskActivityPayload,
  CheckpointResponse,
} from "@/shared/task-types";

// ─── Hook Return ─────────────────────────────────────────────────────

export interface UseTaskManagerReturn {
  /** Active tasks for the current thread */
  threadTasks: TaskMeta[];
  /** All tasks across threads */
  allTasks: TaskMeta[];
  /** Currently focused task (for panel display) */
  activeTask: Task | null;
  /** Whether the task panel is open */
  isPanelOpen: boolean;
  /** Open the task panel for a specific task */
  openPanel: (taskId?: string) => void;
  /** Close the task panel */
  closePanel: () => void;
  /** Start a new background task */
  startTask: (goal: string, options?: { recallEnabled?: boolean }) => void;
  /** Respond to a checkpoint */
  respondToCheckpoint: (response: CheckpointResponse) => void;
  /** Pause a running task */
  pauseTask: (taskId: string) => void;
  /** Cancel a task */
  cancelTask: (taskId: string) => void;
  /** Resume a paused/interrupted task */
  resumeTask: (taskId: string) => void;
  /** Delete a task */
  deleteTask: (taskId: string) => void;
  /** Count of running tasks for the current thread */
  runningCount: number;
  /** Whether there's an active checkpoint awaiting user action */
  hasCheckpoint: boolean;
  /** Latest checkpoint payload (for checkpoint cards) */
  latestCheckpoint: TaskCheckpointPayload | null;
  /** Latest completion payload (for toast/notification) */
  latestCompletion: TaskCompletePayload | null;
  /** Dismiss the latest completion */
  dismissCompletion: () => void;
  /** Refresh the task list */
  refresh: () => Promise<void>;
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useTaskManager(
  threadId: string | undefined,
  model: string,
): UseTaskManagerReturn {
  const [threadTasks, setThreadTasks] = useState<TaskMeta[]>([]);
  const [allTasks, setAllTasks] = useState<TaskMeta[]>([]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [latestCheckpoint, setLatestCheckpoint] = useState<TaskCheckpointPayload | null>(null);
  const [latestCompletion, setLatestCompletion] = useState<TaskCompletePayload | null>(null);

  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  const latestCheckpointRef = useRef(latestCheckpoint);
  latestCheckpointRef.current = latestCheckpoint;

  // ── Fetch Tasks ─────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    try {
      const all = await window.niom.tasks.list();
      setAllTasks(all);

      let filtered: TaskMeta[] = [];
      if (threadIdRef.current) {
        filtered = all.filter((t: TaskMeta) => t.threadId === threadIdRef.current);
        setThreadTasks(filtered);
      } else {
        setThreadTasks([]);
      }

      // Restore checkpoint state from persisted tasks on load
      const pendingTask = filtered.find(
        (t) => t.status === "checkpoint",
      );
      if (pendingTask && !latestCheckpointRef.current) {
        try {
          const fullTask = await window.niom.tasks.get(pendingTask.id);
          if (fullTask && (fullTask as Task).activeCheckpoint) {
            const task = fullTask as Task;
            setLatestCheckpoint({
              taskId: task.id,
              threadId: task.threadId,
              checkpoint: task.activeCheckpoint!,
            });
            setActiveTask(task);
          }
        } catch {
          // Ignore — checkpoint data just won't be restored
        }
      }
    } catch (err) {
      console.warn("[task-manager] Failed to fetch tasks:", err);
    }
  }, []);

  // Load on mount + when thread changes
  useEffect(() => {
    refresh();
  }, [threadId, refresh]);

  // ── IPC Listeners ───────────────────────────────────────────────────

  useEffect(() => {
    // Progress updates
    const unsubProgress = window.niom.tasks.onProgress((data: unknown) => {
      const payload = data as TaskProgressPayload;

      setThreadTasks((prev) =>
        prev.map((t) =>
          t.id === payload.taskId
            ? { ...t, status: payload.status, toolCallCount: payload.toolCallCount, updatedAt: Date.now() }
            : t,
        ),
      );
      setAllTasks((prev) =>
        prev.map((t) =>
          t.id === payload.taskId
            ? { ...t, status: payload.status, toolCallCount: payload.toolCallCount, updatedAt: Date.now() }
            : t,
        ),
      );

      // Update active task if it's the one being viewed
      if (activeTask?.id === payload.taskId) {
        if (payload.status === "running") {
          setLatestCheckpoint(null);
        }
        loadTask(payload.taskId);
      }
    });

    // Checkpoint
    const unsubCheckpoint = window.niom.tasks.onCheckpoint((data: unknown) => {
      const payload = data as TaskCheckpointPayload;
      if (payload.threadId === threadIdRef.current || !threadIdRef.current) {
        setLatestCheckpoint(payload);
        if (payload.threadId === threadIdRef.current) {
          setIsPanelOpen(true);
          loadTask(payload.taskId);
        }
      }
    });

    // Completion
    const unsubComplete = window.niom.tasks.onComplete((data: unknown) => {
      const payload = data as TaskCompletePayload;
      setLatestCompletion(payload);
      refresh();
      if (activeTask?.id === payload.taskId) {
        loadTask(payload.taskId);
      }
    });

    // Error
    const unsubError = window.niom.tasks.onError((data: unknown) => {
      const payload = data as TaskErrorPayload;
      refresh();
      if (activeTask?.id === payload.taskId) {
        loadTask(payload.taskId);
      }
    });

    // Tool call activity — real-time updates
    const unsubActivity = window.niom.tasks.onActivity((data: unknown) => {
      const payload = data as TaskActivityPayload;
      if (activeTask?.id === payload.taskId) {
        setActiveTask((prev) => {
          if (!prev || prev.id !== payload.taskId) return prev;
          const activity = [...prev.activity];
          const existingIdx = activity.findIndex((tc) => tc.id === payload.toolCall.id);

          if (existingIdx >= 0) {
            activity[existingIdx] = payload.toolCall;
          } else {
            activity.push(payload.toolCall);
          }

          return {
            ...prev,
            activity,
            toolCallCount: activity.filter((a) => a.status !== "running").length,
          };
        });
      }
    });

    return () => {
      unsubProgress();
      unsubActivity();
      unsubCheckpoint();
      unsubComplete();
      unsubError();
    };
  }, [activeTask?.id, refresh]);

  // ── Load a full task (for panel display) ────────────────────────────

  const loadTask = useCallback(async (taskId: string) => {
    try {
      const task = await window.niom.tasks.get(taskId);
      if (task) {
        setActiveTask(task as Task);
      }
    } catch (err) {
      console.warn("[task-manager] Failed to load task:", err);
    }
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────

  const startTask = useCallback((goal: string, options?: {
    recallEnabled?: boolean;
    systemPrompt?: string;
    maxSteps?: number;
    checkpointEvery?: number;
  }) => {
    if (!threadIdRef.current) return;
    window.niom.tasks.start(
      threadIdRef.current,
      goal,
      model,
      options?.recallEnabled,
      options?.systemPrompt || options?.maxSteps || options?.checkpointEvery
        ? { systemPrompt: options.systemPrompt, maxSteps: options.maxSteps, checkpointEvery: options.checkpointEvery }
        : undefined,
    );

    // Optimistic add to list
    const optimistic: TaskMeta = {
      id: "pending-" + Date.now(),
      threadId: threadIdRef.current,
      goal,
      status: "running",
      toolCallCount: 0,
      totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setThreadTasks((prev) => [optimistic, ...prev]);
    setAllTasks((prev) => [optimistic, ...prev]);

    // Refresh after a brief delay to get real task ID
    setTimeout(refresh, 1000);
  }, [model, refresh]);

  const respondToCheckpoint = useCallback((response: CheckpointResponse) => {
    window.niom.tasks.respond(response);
    setLatestCheckpoint(null);
  }, []);

  const pauseTask = useCallback((taskId: string) => {
    window.niom.tasks.pause(taskId);
  }, []);

  const cancelTask = useCallback((taskId: string) => {
    window.niom.tasks.cancel(taskId);
    refresh();
  }, [refresh]);

  const resumeTask = useCallback((taskId: string) => {
    window.niom.tasks.resume(taskId);
    refresh();
  }, [refresh]);

  const deleteTask = useCallback((taskId: string) => {
    window.niom.tasks.delete(taskId);
    setThreadTasks((prev) => prev.filter((t) => t.id !== taskId));
    setAllTasks((prev) => prev.filter((t) => t.id !== taskId));
    if (activeTask?.id === taskId) {
      setActiveTask(null);
      setIsPanelOpen(false);
    }
  }, [activeTask?.id]);

  const openPanel = useCallback((taskId?: string) => {
    setIsPanelOpen(true);
    if (taskId) {
      loadTask(taskId);
    }
  }, [loadTask]);

  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
  }, []);

  const dismissCompletion = useCallback(() => {
    setLatestCompletion(null);
  }, []);

  // ── Derived State ───────────────────────────────────────────────────

  const runningCount = threadTasks.filter(
    (t) => t.status === "running",
  ).length;

  const hasCheckpoint = (
    (latestCheckpoint !== null && latestCheckpoint.threadId === threadIdRef.current) ||
    threadTasks.some((t) => t.status === "checkpoint")
  );

  return {
    threadTasks,
    allTasks,
    activeTask,
    isPanelOpen,
    openPanel,
    closePanel,
    startTask,
    respondToCheckpoint,
    pauseTask,
    cancelTask,
    resumeTask,
    deleteTask,
    runningCount,
    hasCheckpoint,
    latestCheckpoint,
    latestCompletion,
    dismissCompletion,
    refresh,
  };
}
