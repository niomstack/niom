// Global safety net — prevent crashing on stray gateway/SDK errors
process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.warn("[sidecar] Unhandled rejection (non-fatal):", msg);
});

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { loadConfig } from "./config.js";
import health from "./routes/health.js";
import run from "./routes/run.js";
import providers from "./routes/providers.js";
import threadRoutes from "./routes/threads.js";
import taskRoutes from "./routes/tasks.js";
import mcpRoutes from "./routes/mcp.js";
import memoryRoutes from "./routes/memory.js";
import { TaskManager, executeTask } from "./tasks/index.js";
import { mcpManager } from "./mcp/client.js";
import { MemoryStore } from "./memory/store.js";

// ─── Load Config ─────────────────────────────────────────

const config = loadConfig();
const PORT = config.sidecar_port || 3001;

// ─── Create Server ───────────────────────────────────────

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
    "*",
    cors({
        origin: [
            "http://localhost:1420", // Vite dev server
            "tauri://localhost",     // Tauri production
            "https://tauri.localhost",
        ],
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowHeaders: ["Content-Type"],
    })
);

// Routes
app.route("/", health);
app.route("/", run);
app.route("/", providers);
app.route("/", threadRoutes);
app.route("/", taskRoutes);
app.route("/", mcpRoutes);
app.route("/", memoryRoutes);

// Root — API info
app.get("/", (c) => {
    const currentConfig = loadConfig(); // Re-read so model changes are reflected
    return c.json({
        name: "niom-ai",
        description: "NIOM AI Sidecar — Ambient Intelligence Agent",
        version: "0.1.0",
        model: currentConfig.model,
        workspace: currentConfig.workspace,
        endpoints: [
            "GET  /health              — sidecar health check",
            "POST /run                 — agent loop (SSE stream)",
            "POST /run/sync            — agent loop (JSON response)",
            "GET  /providers           — available models",
            "POST /providers/configure — switch model/key",
            "POST /providers/test      — test gateway connection",
            "GET  /threads             — list threads (encrypted)",
            "GET  /threads/:id         — get full thread",
            "PUT  /threads/:id         — save thread",
            "DELETE /threads/:id       — delete thread",
            "DELETE /threads           — clear all threads",
            "GET  /tasks               — list background tasks",
            "GET  /tasks/:id           — get task details",
            "POST /tasks               — create a task",
            "PUT  /tasks/:id           — update a task",
            "DELETE /tasks/:id         — delete a task",
            "POST /tasks/:id/pause     — pause a task",
            "POST /tasks/:id/resume    — resume a task",
            "POST /tasks/:id/start     — start a task",
            "POST /tasks/:id/run       — trigger immediate run",
            "GET  /tasks/:id/runs      — execution history",
            "POST /mcp/connect         — connect to MCP server",
            "DELETE /mcp/:name         — disconnect MCP server",
            "GET  /mcp/servers         — list MCP connections",
            "GET  /memory/brain        — view brain (long-term memory)",
        ],
    });
});

// ─── Start Server ────────────────────────────────────────

console.log(`
╔══════════════════════════════════════════╗
║       NIOM AI Sidecar v0.1.0             ║
║                                          ║
║  Port:     ${String(PORT).padEnd(29)}║
║  Model:    ${String(config.model || "default").padEnd(29)}║
║  Gateway:  ${String(config.gateway_key ? "✓ configured" : "✗ no key").padEnd(29)}║
║  Workspace:${String(config.workspace).padEnd(30)}║
║  Config:   ~/.niom/config.json           ║
║  Memory:   ~/.niom/memory/               ║
╚══════════════════════════════════════════╝
`);

// ─── Initialize Memory → Tasks → MCP ────────────────────
MemoryStore.getInstance().init();
TaskManager.getInstance().init(executeTask);
mcpManager.init().catch(err => {
    console.warn("[mcp] Init failed:", err.message);
});

serve(
    { fetch: app.fetch, port: PORT },
    (info) => {
        console.log(`[server] Listening on http://localhost:${info.port}`);
    }
);

export default app;
