import { Hono } from "hono";

const startTime = Date.now();

const health = new Hono();

health.get("/health", (c) => {
    return c.json({
        status: "ok",
        uptime_ms: Date.now() - startTime,
        version: "0.1.0",
    });
});

export default health;
