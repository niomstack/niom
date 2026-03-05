// Global safety net — prevent crashing on stray provider/SDK errors
process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.warn("[sidecar] Unhandled rejection (non-fatal):", msg);
});
process.on("uncaughtException", (err) => {
    console.error("[sidecar] Uncaught exception (non-fatal):", err.message);
    console.error(err.stack);
    // Don't rethrow — keep the sidecar alive
});

// Flush MemoryStore on process signals (covers OS-level kills during updates)
const gracefulExit = (signal: string) => {
    console.log(`[sidecar] Received ${signal} — flushing memory…`);
    try {
        // Dynamic import to avoid circular dependency at module load
        const { MemoryStore } = require("./memory/store.js");
        MemoryStore.getInstance().shutdown();
    } catch { /* best-effort */ }
    process.exit(0);
};
process.on("SIGTERM", () => gracefulExit("SIGTERM"));
process.on("SIGINT", () => gracefulExit("SIGINT"));

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
import skillRoutes from "./routes/skills.js";
import artifactRoutes from "./routes/artifacts.js";
import { TaskManager, executeTask } from "./tasks/index.js";
import { mcpManager } from "./mcp/client.js";
import { MemoryStore } from "./memory/store.js";

// ─── Load Config ─────────────────────────────────────────

const config = loadConfig();
const PORT = config.sidecar_port || 9741;

// ─── Create Server ───────────────────────────────────────

const app = new Hono();

// Middleware
app.use("*", logger());
app.use(
    "*",
    cors({
        origin: (origin) => {
            // Allow all localhost / tauri origins — sidecar only binds to 127.0.0.1
            if (!origin) return origin;  // non-browser requests (curl, etc.)
            if (
                origin.includes("localhost") ||
                origin.includes("127.0.0.1") ||
                origin.startsWith("tauri://")
            ) {
                return origin;
            }
            return undefined; // block everything else
        },
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
app.route("/api/skills", skillRoutes);
app.route("/", artifactRoutes);

// Root — API info
app.get("/", (c) => {
    const currentConfig = loadConfig(); // Re-read so model changes are reflected
    return c.json({
        name: "niom-ai",
        description: "NIOM AI Sidecar — Ambient Intelligence Agent",
        version: "0.1.0",
        model: currentConfig.model,
        provider: currentConfig.provider,
        workspace: currentConfig.workspace,
        endpoints: [
            "GET  /health              — sidecar health check",
            "POST /run                 — agent loop (SSE stream)",
            "POST /run/sync            — agent loop (JSON response)",
            "GET  /providers           — available models",
            "POST /providers/configure — switch model/key",
            "POST /providers/test      — test provider connection",
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
            "POST /api/skills/hint     — pre-compute skill path (type-time)",
            "GET  /api/skills/stats    — skill tree statistics",
            "GET  /api/skills/tree     — full graph for visualization",
            "POST /api/skills/record   — record tool usage for learning",
            "GET  /artifacts           — list artifacts for a context",
            "GET  /artifacts/:id/content — serve artifact content",
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
║  Provider: ${String(config.provider || "default").padEnd(29)}║
║  Keys:     ${String(Object.keys(config.provider_keys || {}).filter(k => config.provider_keys[k]).length + " configured").padEnd(29)}║
║  Workspace:${String(config.workspace).padEnd(30)}║
║  Config:   ~/.niom/config.json           ║
║  Memory:   ~/.niom/memory/               ║
╚══════════════════════════════════════════╝
`);

// ─── Initialize Skills → SkillTree → Memory → Tasks → MCP ──
import { initializeSkillPacks } from "./skills/registry.js";
import { SkillPathResolver } from "./skills/traversal.js";
import { getDataDir } from "./config.js";

initializeSkillPacks();
MemoryStore.getInstance().init();
TaskManager.getInstance().init(executeTask);
mcpManager.init().catch(err => {
    console.warn("[mcp] Init failed:", err.message);
});

// Initialize Skill Tree (async — runs in background, doesn't block startup)
// The embeddings module has a built-in fallback (hash-based vectors) so
// initialization will always succeed even if the ONNX model can't load.
const dataDir = getDataDir();
const resolver = SkillPathResolver.getInstance(dataDir);
resolver
    .initialize()
    .then(() => {
        console.log("[SkillTree] Ready");
    })
    .catch(err => {
        console.warn("[SkillTree] Init deferred:", err.message);
        // Retry after 10s — the embedding model might need time to download
        setTimeout(() => {
            resolver.reinitialize().catch(err2 =>
                console.warn("[SkillTree] Retry failed:", err2.message)
            );
        }, 10_000);
    });

serve(
    { fetch: app.fetch, port: PORT },
    (info) => {
        console.log(`[server] Listening on http://localhost:${info.port}`);
    }
);

export default app;
