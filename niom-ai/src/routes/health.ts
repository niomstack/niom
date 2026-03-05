import { Hono } from "hono";
import { MemoryStore } from "../memory/store.js";

const startTime = Date.now();

const health = new Hono();

health.get("/health", (c) => {
    return c.json({
        status: "ok",
        uptime_ms: Date.now() - startTime,
        version: "0.1.0",
    });
});

/**
 * POST /shutdown — Graceful shutdown endpoint.
 *
 * Called by the Rust shell before killing the sidecar (e.g. before updates).
 * Flushes all pending MemoryStore writes so no data is lost, then exits.
 */
health.post("/shutdown", (c) => {
    console.log("[sidecar] Graceful shutdown requested — flushing memory…");

    try {
        MemoryStore.getInstance().shutdown();
    } catch (err) {
        console.warn("[sidecar] Error during shutdown flush:", err);
    }

    // Respond before exiting so the caller knows we flushed
    const response = c.json({ status: "shutting_down" });

    // Schedule exit after response is sent
    setTimeout(() => {
        console.log("[sidecar] Shutdown complete — exiting");
        process.exit(0);
    }, 200);

    return response;
});

export default health;
