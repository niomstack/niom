/**
 * Task Store — JSON persistence for tasks.
 *
 * Stores tasks as individual JSON files under ~/.niom/tasks/<id>.json.
 * Same pattern as thread.service.ts.
 * Tasks persist across app restarts — interrupted tasks resume from last checkpoint.
 */

import * as fs from "fs";
import * as path from "path";
import { PATHS } from "../services/config.service";
import type { Task, TaskMeta, TaskStatus } from "@/shared/task-types";

// ─── Paths ───────────────────────────────────────────────────────────

const TASKS_DIR = path.join(PATHS.NIOM_DIR, "tasks");

/** Ensure the tasks directory exists. */
export function initTasksDir(): void {
  if (!fs.existsSync(TASKS_DIR)) {
    fs.mkdirSync(TASKS_DIR, { recursive: true });
  }
}

// ─── CRUD ────────────────────────────────────────────────────────────

/** Save a task (create or update). */
export function saveTask(task: Task): void {
  initTasksDir();
  task.updatedAt = Date.now();
  const filePath = taskPath(task.id);
  fs.writeFileSync(filePath, JSON.stringify(task, null, 2));
}

/** Get a full task by ID. */
export function getTask(id: string): Task | null {
  const filePath = taskPath(id);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Task;
  } catch {
    console.warn(`[tasks] Failed to read task: ${id}`);
    return null;
  }
}

/** Delete a task by ID. */
export function deleteTask(id: string): void {
  const filePath = taskPath(id);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/** Delete all tasks belonging to a thread. */
export function deleteTasksByThread(threadId: string): void {
  const tasks = listTasks({ threadId });
  for (const task of tasks) {
    deleteTask(task.id);
  }
}

/** List all tasks as metadata (lightweight for UI listing). */
export function listTasks(filter?: { threadId?: string; status?: TaskStatus[] }): TaskMeta[] {
  initTasksDir();

  const files = fs.readdirSync(TASKS_DIR).filter((f) => f.endsWith(".json"));
  const metas: TaskMeta[] = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(TASKS_DIR, file), "utf-8");
      const task = JSON.parse(raw) as Task;

      // Apply filters
      if (filter?.threadId && task.threadId !== filter.threadId) continue;
      if (filter?.status && !filter.status.includes(task.status)) continue;

      metas.push({
        id: task.id,
        threadId: task.threadId,
        goal: task.goal,
        status: task.status,
        toolCallCount: task.toolCallCount,
        totalUsage: task.totalUsage,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
      });
    } catch {
      console.warn(`[tasks] Skipping corrupted task file: ${file}`);
    }
  }

  // Most recently updated first
  metas.sort((a, b) => b.updatedAt - a.updatedAt);
  return metas;
}

/** Find tasks that were interrupted (running) — for resume on restart. */
export function findResumableTasks(): Task[] {
  initTasksDir();

  const files = fs.readdirSync(TASKS_DIR).filter((f) => f.endsWith(".json"));
  const resumable: Task[] = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(TASKS_DIR, file), "utf-8");
      const task = JSON.parse(raw) as Task;

      // Tasks that were mid-execution when the app closed
      if (task.status === "running") {
        // Mark as checkpoint so user can choose to resume
        task.status = "checkpoint";
        task.activeCheckpoint = {
          id: crypto.randomUUID(),
          type: "progress",
          summary: `NIOM was restarted while this task was running (${task.toolCallCount} tool calls completed). Would you like to resume?`,
          actions: [
            { type: "continue", label: "Resume" },
            { type: "stop", label: "Stop Task" },
          ],
          createdAt: Date.now(),
        };
        saveTask(task);
        resumable.push(task);
      } else if (task.status === "checkpoint") {
        resumable.push(task);
      }
    } catch {
      // Skip corrupted files
    }
  }

  return resumable;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function taskPath(id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(TASKS_DIR, `${safeId}.json`);
}
