/**
 * Task routes — CRUD + lifecycle + steering + progress endpoints.
 *
 * Task Streams model:
 *   GET    /tasks              — List all tasks (filterable by status/type)
 *   GET    /tasks/:id          — Get full task details
 *   POST   /tasks              — Create a new task
 *   PUT    /tasks/:id          — Update task (goal, plan, schedule, autoPause)
 *   DELETE /tasks/:id          — Delete a task
 *   POST   /tasks/:id/pause    — Pause a task
 *   POST   /tasks/:id/resume   — Resume a paused task
 *   POST   /tasks/:id/start    — Start/resume a task
 *   POST   /tasks/:id/run      — Trigger an immediate run
 *   POST   /tasks/:id/steer    — Post a steering comment
 *   GET    /tasks/:id/runs     — Get execution history
 *   GET    /tasks/events       — SSE stream for real-time task progress
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { TaskManager } from "../tasks/manager.js";
import { taskEvents } from "../tasks/runner.js";
import type { TaskType, TaskPlan } from "../tasks/types.js";

const tasks = new Hono();

// Helper: get the TaskManager singleton
function tm(): TaskManager {
    return TaskManager.getInstance();
}

// ── LIST ──

tasks.get("/tasks", (c) => {
    const status = c.req.query("status") as any;
    const taskType = c.req.query("type") as any;
    const threadId = c.req.query("threadId");

    const entries = tm().listTasks({
        status: status || undefined,
        taskType: taskType || undefined,
        threadId: threadId || undefined,
    });

    return c.json({ tasks: entries, total: entries.length });
});

// ── SSE PROGRESS STREAM (must be before :id routes) ──

tasks.get("/tasks/events", (c) => {
    return streamSSE(c, async (stream) => {
        const listener = (event: any) => {
            stream.writeSSE({
                event: event.type,
                data: JSON.stringify(event),
            });
        };

        taskEvents.on("progress", listener);

        // Send initial heartbeat
        await stream.writeSSE({ event: "connected", data: JSON.stringify({ timestamp: Date.now() }) });

        // Keep alive with heartbeat every 30s
        const heartbeat = setInterval(() => {
            stream.writeSSE({ event: "heartbeat", data: JSON.stringify({ timestamp: Date.now() }) })
                .catch(() => clearInterval(heartbeat));
        }, 30_000);

        // Clean up on disconnect
        stream.onAbort(() => {
            taskEvents.off("progress", listener);
            clearInterval(heartbeat);
        });

        // Keep the stream open indefinitely
        await new Promise(() => { }); // Will be aborted by client disconnect
    });
});

// ── GET ──

tasks.get("/tasks/:id", (c) => {
    const task = tm().getTask(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    return c.json(task);
});

// ── CREATE ──

tasks.post("/tasks", async (c) => {
    try {
        const body = await c.req.json();

        if (!body.goal || typeof body.goal !== "string") {
            return c.json({ error: "goal is required" }, 400);
        }

        const taskType: TaskType = body.taskType || "one_shot";
        const plan: TaskPlan = body.plan || {
            phases: [{ id: "main", description: body.goal, status: "pending" }],
            qualityCriteria: body.qualityCriteria || "Complete the goal accurately.",
        };

        const task = tm().createTask(body.goal, taskType, plan, {
            schedule: body.schedule,
            autoPause: body.autoPause,
            threadId: body.threadId,
        });

        return c.json(task, 201);
    } catch (err: any) {
        return c.json({ error: err.message || "Failed to create task" }, 500);
    }
});

// ── UPDATE ──

tasks.put("/tasks/:id", async (c) => {
    try {
        const body = await c.req.json();
        const task = tm().updateTask(c.req.param("id"), body);
        if (!task) return c.json({ error: "Task not found" }, 404);
        return c.json(task);
    } catch (err: any) {
        return c.json({ error: err.message || "Failed to update task" }, 500);
    }
});

// ── DELETE ──

tasks.delete("/tasks/:id", (c) => {
    const deleted = tm().deleteTask(c.req.param("id"));
    if (!deleted) return c.json({ error: "Task not found" }, 404);
    return c.json({ success: true });
});

// ── LIFECYCLE ──

tasks.post("/tasks/:id/pause", (c) => {
    const task = tm().pause(c.req.param("id"));
    if (!task) return c.json({ error: "Cannot pause task (not found or invalid state)" }, 400);
    return c.json(task);
});

tasks.post("/tasks/:id/resume", (c) => {
    const task = tm().resume(c.req.param("id"));
    if (!task) return c.json({ error: "Cannot resume task (not found or invalid state)" }, 400);
    return c.json(task);
});

tasks.post("/tasks/:id/start", (c) => {
    const task = tm().start(c.req.param("id"));
    if (!task) return c.json({ error: "Cannot start task (not found or invalid state)" }, 400);
    return c.json(task);
});

// ── TRIGGER IMMEDIATE RUN ──

tasks.post("/tasks/:id/run", async (c) => {
    try {
        const run = await tm().triggerRun(c.req.param("id"));
        if (!run) return c.json({ error: "Cannot run task (not found, already running, or no runner configured)" }, 400);
        return c.json(run);
    } catch (err: any) {
        return c.json({ error: err.message || "Run failed" }, 500);
    }
});

// ── STEERING (replaces approval) ──

tasks.post("/tasks/:id/steer", async (c) => {
    try {
        const body = await c.req.json();
        const comment = body.comment || body.text;

        if (!comment || typeof comment !== "string" || comment.trim().length === 0) {
            return c.json({ error: "comment is required" }, 400);
        }

        // If runNow is set, steer AND trigger a run
        if (body.runNow) {
            const run = await tm().steerAndRun(c.req.param("id"), comment.trim());
            return c.json({ steered: true, run });
        }

        const task = tm().steer(c.req.param("id"), comment.trim());
        if (!task) return c.json({ error: "Task not found" }, 404);

        return c.json({ steered: true, task });
    } catch (err: any) {
        return c.json({ error: err.message || "Steering failed" }, 500);
    }
});

// ── RUN HISTORY ──

tasks.get("/tasks/:id/runs", (c) => {
    const limit = parseInt(c.req.query("limit") || "20", 10);
    const runs = tm().getRuns(c.req.param("id"), limit);
    return c.json({ runs, total: runs.length });
});

export default tasks;
