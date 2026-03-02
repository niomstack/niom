/**
 * Thread API routes — CRUD for encrypted thread storage.
 *
 *   GET    /threads       — list all (summaries)
 *   GET    /threads/:id   — get full thread
 *   PUT    /threads/:id   — save thread
 *   DELETE /threads/:id   — delete thread
 *   DELETE /threads       — clear all
 */

import { Hono } from "hono";
import { listThreads, getThread, saveThread, deleteThread, clearAllThreads } from "../threads.js";
import { extractFactsFromConversation } from "../ai/extract.js";

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
    return deleteThread(c.req.param("id"))
        ? c.json({ status: "deleted" })
        : c.json({ error: "Not found" }, 404);
});

threads.delete("/threads", (c) => {
    return c.json({ status: "cleared", count: clearAllThreads() });
});

export default threads;
