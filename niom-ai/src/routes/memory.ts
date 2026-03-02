/**
 * Memory routes — brain (long-term memory) management.
 *
 *   GET    /memory/brain       — view all brain data (facts, preferences, patterns)
 *   POST   /memory/brain/fact  — add a fact
 *   DELETE /memory/brain/fact  — remove a fact
 *   POST   /memory/brain/pref  — set a preference
 *   DELETE /memory/brain       — clear all brain data
 */

import { Hono } from "hono";
import { MemoryStore } from "../memory/store.js";

const memory = new Hono();

function store(): MemoryStore {
    return MemoryStore.getInstance();
}

// ── View Brain ──

memory.get("/memory/brain", (c) => {
    const brain = store().getBrain();
    const context = store().getBrainContext();
    return c.json({ brain, contextPreview: context });
});

// ── Add Fact ──

memory.post("/memory/brain/fact", async (c) => {
    const body = await c.req.json();
    if (!body.fact || typeof body.fact !== "string") {
        return c.json({ error: "fact (string) is required" }, 400);
    }
    store().learnFact(body.fact);
    return c.json({ status: "learned", brain: store().getBrain() });
});

// ── Remove Fact ──

memory.delete("/memory/brain/fact", async (c) => {
    const body = await c.req.json();
    const success = store().removeFact(body.fact ?? body.index);
    if (!success) return c.json({ error: "Fact not found" }, 404);
    return c.json({ status: "removed", brain: store().getBrain() });
});

// ── Set Preference ──

memory.post("/memory/brain/pref", async (c) => {
    const body = await c.req.json();
    if (!body.key || !body.value) {
        return c.json({ error: "key and value are required" }, 400);
    }
    store().setPreference(body.key, body.value);
    return c.json({ status: "set", brain: store().getBrain() });
});

// ── Clear Brain ──

memory.delete("/memory/brain", (c) => {
    store().clearBrain();
    return c.json({ status: "cleared" });
});

export default memory;
