/**
 * Tasks IPC Handlers — Main process entry point for the Tasks system.
 *
 * IPC channels:
 *   task:start     → Start a new task (renderer → main)
 *   task:respond   → Respond to a checkpoint (renderer → main)
 *   task:pause     → Pause a running task (renderer → main)
 *   task:resume    → Resume a paused task (renderer → main)
 *   task:cancel    → Cancel a task (renderer → main)
 *   task:list      → List tasks (renderer → main, invoke)
 *   task:get       → Get a single task (renderer → main, invoke)
 *
 *   task:progress   → Progress update (main → renderer)
 *   task:checkpoint  → Checkpoint waiting for user input (main → renderer)
 *   task:complete    → Task finished with deliverable (main → renderer)
 *   task:error       → Error (main → renderer)
 *   task:activity    → Real-time tool call activity (main → renderer)
 *
 * IPC handlers are thin — they validate, call services, return results.
 */

import { ipcMain, BrowserWindow, Notification } from "electron";
import { refreshTrayMenu } from "../services/tray.service";
import { resolveModel } from "../services/chat.service";
import {
  TaskRunner,
  getActiveRunner,
  registerRunner,
  unregisterRunner,
} from "../tasks/task-runner";
import {
  saveTask,
  getTask,
  listTasks,
  deleteTask,
  findResumableTasks,
  initTasksDir,
} from "../tasks/task-store";
import type {
  Task,
  TaskStatus,
  CheckpointResponse,
  TaskProgressPayload,
  TaskCheckpointPayload,
  TaskCompletePayload,
  TaskErrorPayload,
  TaskActivityPayload,
} from "@/shared/task-types";

/** Register all task-related IPC handlers. */
export function registerTasksIpc(getMainWindow: () => BrowserWindow | null): void {
  initTasksDir();

  // ── Start a new Task ────────────────────────────────────────────────
  ipcMain.on("task:start", async (_event, data: {
    threadId: string;
    goal: string;
    model: string;
    recallEnabled?: boolean;
    checkpointEvery?: number;
    maxSteps?: number;
    systemPrompt?: string;
  }) => {
    const win = getMainWindow();
    if (!win) return;

    try {
      const model = resolveModel(data.model);

      // Create the Task object
      const task: Task = {
        id: crypto.randomUUID(),
        threadId: data.threadId,
        goal: data.goal,
        model: data.model,
        status: "running",
        activity: [],
        toolCallCount: 0,
        totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      saveTask(task);

      // Create and register the runner
      const runner = new TaskRunner(task, model, {
        recallEnabled: data.recallEnabled,
        checkpointEvery: data.checkpointEvery,
        maxSteps: data.maxSteps,
        systemPrompt: data.systemPrompt,
      });
      registerRunner(task.id, runner);

      // Wire up IPC event forwarding (runner events → renderer)
      wireRunnerEvents(runner, win, task.id);

      // Run async — don't await, it runs in background
      runner.run().finally(() => {
        unregisterRunner(task.id);
      });

      // Send initial progress
      if (!win.isDestroyed()) {
        win.webContents.send("task:progress", {
          taskId: task.id,
          threadId: task.threadId,
          status: "running",
          toolCallCount: 0,
          totalUsage: task.totalUsage,
        } satisfies TaskProgressPayload);
      }

      console.log(`[tasks] Started task ${task.id} for thread ${data.threadId}`);

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[tasks] Failed to start task:", message);

      if (!win.isDestroyed()) {
        win.webContents.send("task:error", {
          taskId: "unknown",
          threadId: data.threadId,
          error: message,
        } satisfies TaskErrorPayload);
      }
    }
  });

  // ── Respond to a Checkpoint ─────────────────────────────────────────
  ipcMain.on("task:respond", async (_event, data: CheckpointResponse) => {
    const runner = getActiveRunner(data.taskId);
    if (runner) {
      runner.respondToCheckpoint(data);
      console.log(`[tasks] Checkpoint response for ${data.taskId}: ${data.action}`);
    } else {
      // No active runner — task was restored from disk after restart
      console.log(`[tasks] No active runner for ${data.taskId}, handling from persisted state`);
      const win = getMainWindow();
      if (!win) return;

      try {
        const task = getTask(data.taskId);
        if (!task) {
          console.error(`[tasks] Cannot respond — task ${data.taskId} not found`);
          return;
        }

        if (data.action === "stop") {
          task.status = "cancelled";
          task.activeCheckpoint = undefined;
          task.updatedAt = Date.now();
          saveTask(task);
          if (!win.isDestroyed()) {
            win.webContents.send("task:progress", {
              taskId: task.id,
              threadId: task.threadId,
              status: "cancelled",
              toolCallCount: task.toolCallCount,
              totalUsage: task.totalUsage,
            } satisfies TaskProgressPayload);
          }
          return;
        }

        // For continue/retry/modify — create a new runner and resume
        if (data.action === "modify" && data.guidance) {
          task.goal = `${task.goal}\n\nUser guidance: ${data.guidance}`;
        }

        task.activeCheckpoint = undefined;
        task.updatedAt = Date.now();
        saveTask(task);

        const modelId = task.model;
        const model = resolveModel(modelId);
        const newRunner = new TaskRunner(task, model);
        registerRunner(task.id, newRunner);
        wireRunnerEvents(newRunner, win, task.id);

        newRunner.resume().finally(() => {
          unregisterRunner(task.id);
        });

        console.log(`[tasks] Created new runner and resuming task ${task.id} (action: ${data.action})`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[tasks] Failed to handle checkpoint from persisted state:", message);
      }
    }
  });

  // ── Pause ───────────────────────────────────────────────────────────
  ipcMain.on("task:pause", (_event, data: { taskId: string }) => {
    const runner = getActiveRunner(data.taskId);
    if (runner) {
      runner.pause();
      console.log(`[tasks] Paused task ${data.taskId}`);
    }
  });

  // ── Cancel ──────────────────────────────────────────────────────────
  ipcMain.on("task:cancel", (_event, data: { taskId: string }) => {
    const runner = getActiveRunner(data.taskId);
    if (runner) {
      runner.cancel();
      unregisterRunner(data.taskId);
      console.log(`[tasks] Cancelled task ${data.taskId}`);
    }
  });

  // ── Resume a paused/interrupted Task ────────────────────────────────
  ipcMain.on("task:resume", async (_event, data: { taskId: string; model?: string }) => {
    const win = getMainWindow();
    if (!win) return;

    const existingRunner = getActiveRunner(data.taskId);
    if (existingRunner) {
      console.warn(`[tasks] Task ${data.taskId} already has an active runner`);
      return;
    }

    try {
      const task = getTask(data.taskId);
      if (!task) {
        console.error(`[tasks] Cannot resume — task ${data.taskId} not found`);
        return;
      }

      const modelId = data.model || task.model;
      const model = resolveModel(modelId);

      const runner = new TaskRunner(task, model);
      registerRunner(task.id, runner);
      wireRunnerEvents(runner, win, task.id);

      runner.resume().finally(() => {
        unregisterRunner(task.id);
      });

      console.log(`[tasks] Resumed task ${task.id}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[tasks] Failed to resume task:", message);
    }
  });

  // ── List Tasks (invoke — returns result) ────────────────────────────
  ipcMain.handle("tasks:list", (_event, filter?: {
    threadId?: string;
    status?: TaskStatus[];
  }) => {
    return listTasks(filter);
  });

  // ── Get Task (invoke — returns result) ──────────────────────────────
  ipcMain.handle("tasks:get", (_event, id: string) => {
    return getTask(id);
  });

  // ── Delete Task ─────────────────────────────────────────────────────
  ipcMain.handle("tasks:delete", (_event, id: string) => {
    const runner = getActiveRunner(id);
    if (runner) {
      runner.cancel();
      unregisterRunner(id);
    }
    deleteTask(id);
  });

  // ── Notify about resumable tasks on startup ─────────────────────────
  setTimeout(() => {
    const resumable = findResumableTasks();
    if (resumable.length > 0) {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        for (const task of resumable) {
          if (task.activeCheckpoint) {
            win.webContents.send("task:checkpoint", {
              taskId: task.id,
              threadId: task.threadId,
              checkpoint: task.activeCheckpoint,
            } satisfies TaskCheckpointPayload);
          }
        }
        console.log(`[tasks] Found ${resumable.length} resumable task(s) from previous session`);
      }
    }
  }, 3000);
}

/**
 * Wire TaskRunner events to IPC for renderer forwarding.
 */
function wireRunnerEvents(
  runner: TaskRunner,
  win: BrowserWindow,
  taskId: string,
): void {
  runner.on("task:progress", (payload: TaskProgressPayload) => {
    if (!win.isDestroyed()) {
      win.webContents.send("task:progress", payload);
    }
    refreshTrayMenu();
  });

  runner.on("task:activity", (payload: TaskActivityPayload) => {
    if (!win.isDestroyed()) {
      win.webContents.send("task:activity", payload);
    }
  });

  runner.on("task:checkpoint", (payload: TaskCheckpointPayload) => {
    if (!win.isDestroyed()) {
      win.webContents.send("task:checkpoint", payload);
    }
    if (!win.isDestroyed() && !win.isFocused()) {
      showTaskNotification(
        "Task Needs Your Input",
        payload.checkpoint.summary || "A task checkpoint requires your input.",
        win,
      );
    }
  });

  runner.on("task:complete", (payload: TaskCompletePayload) => {
    if (!win.isDestroyed()) {
      win.webContents.send("task:complete", payload);
    }
    if (!win.isDestroyed() && !win.isFocused()) {
      const elapsed = payload.elapsedMs ? `${Math.round(payload.elapsedMs / 1000)}s` : "";
      showTaskNotification(
        "Task Complete ✅",
        `Finished${elapsed ? ` in ${elapsed}` : ""}. Click to view the deliverable.`,
        win,
      );
    }
    refreshTrayMenu();
  });

  runner.on("task:error", (payload: TaskErrorPayload) => {
    if (!win.isDestroyed()) {
      win.webContents.send("task:error", payload);
    }
    if (!win.isDestroyed() && !win.isFocused()) {
      showTaskNotification(
        "Task Error",
        payload.error?.slice(0, 100) || "A task failed and needs your attention.",
        win,
      );
    }
  });
}

/** Show an OS notification and focus the window on click. */
function showTaskNotification(title: string, body: string, win: BrowserWindow): void {
  if (!Notification.isSupported()) return;

  const notification = new Notification({ title, body });
  notification.on("click", () => {
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
  notification.show();
}
