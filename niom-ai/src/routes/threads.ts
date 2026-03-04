/**
 * Thread API routes — CRUD for encrypted thread storage.
 *
 *   GET    /threads       — list all (summaries)
 *   GET    /threads/:id   — get full thread
 *   PUT    /threads/:id   — save thread
 *   DELETE /threads/:id   — delete thread + cascade (tasks, artifacts)
 *   DELETE /threads       — clear all + cascade
 */

import { Hono } from "hono";
import { listThreads, getThread, saveThread, deleteThread, clearAllThreads } from "../threads.js";
import { extractFactsFromConversation } from "../ai/extract.js";
import { TaskManager } from "../tasks/manager.js";
import { ArtifactManager } from "../artifacts/index.js";

const threads = new Hono();

threads.get("/threads", (c) => {
    return c.json({ threads: listThreads() });
});

threads.get("/threads/:id", (c) => {
    const thread = getThread(c.req.param("id"));
    return thread ? c.json(thread) : c.json({ error: "Not found" }, 404);
});

threads.put("/threads/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    if (body.id !== id) return c.json({ error: "ID mismatch" }, 400);
    if (!Array.isArray(body.messages)) return c.json({ error: "messages required" }, 400);

    // Check if this is a conversation with enough messages for fact extraction
    const existingThread = getThread(id);
    const isGrowing = !existingThread || body.messages.length > (existingThread.messages?.length ?? 0);

    saveThread(body);

    // Trigger fact extraction asynchronously (non-blocking) when conversation has grown
    if (isGrowing && body.messages.length >= 4 && body.messages.length % 6 === 0) {
        // Extract every ~6 new messages to avoid hammering the API
        extractFactsFromConversation(body.messages, body.title || "Untitled").catch(() => { });
    }

    return c.json({ status: "saved", id });
});

threads.delete("/threads/:id", (c) => {
    const threadId = c.req.param("id");

    if (!deleteThread(threadId)) {
        return c.json({ error: "Not found" }, 404);
    }

    // Cascade cleanup (async, non-blocking)
    cascadeCleanup(threadId);

    return c.json({ status: "deleted" });
});

threads.delete("/threads", (c) => {
    // Get all thread IDs before clearing so we can cascade
    const allThreads = listThreads();
    const count = clearAllThreads();

    // Cascade cleanup for each thread
    for (const thread of allThreads) {
        cascadeCleanup(thread.id);
    }

    return c.json({ status: "cleared", count });
});

/**
 * Cascade cleanup when a conversation is deleted:
 *   1. Delete all tasks linked to this thread
 *   2. Clean up non-workspace artifacts for the conversation
 *   3. Clean up non-workspace artifacts for each deleted task
 *
 * Workspace artifacts are intentionally preserved — they're the user's project files.
 */
function cascadeCleanup(threadId: string): void {
    try {
        const tm = TaskManager.getInstance();
        const am = ArtifactManager.getInstance();

        // 1. Find and delete all tasks linked to this thread
        const linkedTasks = tm.listTasks({ threadId });
        for (const task of linkedTasks) {
            // Clean up task artifacts first (before deleting the task)
            am.cleanup("task", task.id);
            tm.deleteTask(task.id);
        }

        // 2. Clean up conversation artifacts
        am.cleanup("conversation", threadId);

        if (linkedTasks.length > 0) {
            console.log(`[threads] Cascade: deleted ${linkedTasks.length} task(s) + artifacts for thread ${threadId.slice(0, 8)}`);
        }
    } catch (err: any) {
        console.warn(`[threads] Cascade cleanup failed for ${threadId.slice(0, 8)}:`, err.message);
    }
}

export default threads;
