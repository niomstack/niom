/**
 * logger.ts — Structured activity logger for NIOM.
 *
 * Writes to ~/.niom/logs/activity.log with timestamped entries.
 * Captures:
 *   - Agent engine events (route, execute, errors)
 *   - Tool call starts, completions, and errors
 *   - Context compression stats
 *   - Request lifecycle (start → complete/error)
 *
 * Log format: ISO timestamp | level | category | message
 *
 * Automatically rotates when the log file exceeds 5MB.
 */

import { appendFileSync, existsSync, mkdirSync, statSync, renameSync } from "fs";
import { join } from "path";
import { getDataDir } from "../config.js";

// ── Configuration ─────────────────────────────────────────

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_ROTATED = 3; // Keep up to 3 rotated files

type LogLevel = "info" | "warn" | "error" | "debug";
type LogCategory =
    | "engine"
    | "tool"
    | "context"
    | "request"
    | "config"
    | "skill"
    | "task"
    | "memory";

// ── Log File Management ───────────────────────────────────

let _logDir: string | null = null;
let _logPath: string | null = null;

function getLogDir(): string {
    if (_logDir) return _logDir;
    _logDir = join(getDataDir(), "logs");
    if (!existsSync(_logDir)) {
        mkdirSync(_logDir, { recursive: true });
    }
    return _logDir;
}

function getLogPath(): string {
    if (_logPath) return _logPath;
    _logPath = join(getLogDir(), "activity.log");
    return _logPath;
}

function rotateIfNeeded(): void {
    const logPath = getLogPath();
    if (!existsSync(logPath)) return;

    try {
        const stats = statSync(logPath);
        if (stats.size < MAX_LOG_SIZE) return;

        // Rotate: activity.log → activity.1.log → activity.2.log → ...
        const dir = getLogDir();
        for (let i = MAX_ROTATED; i >= 1; i--) {
            const src = i === 1
                ? logPath
                : join(dir, `activity.${i - 1}.log`);
            const dst = join(dir, `activity.${i}.log`);
            if (existsSync(src)) {
                try { renameSync(src, dst); } catch { /* ignore */ }
            }
        }
    } catch { /* ignore rotation errors */ }
}

// ── Core Logger ───────────────────────────────────────────

function writeLog(level: LogLevel, category: LogCategory, message: string, data?: Record<string, unknown>): void {
    try {
        rotateIfNeeded();
        const timestamp = new Date().toISOString();
        const dataStr = data ? ` | ${JSON.stringify(data)}` : "";
        const line = `${timestamp} | ${level.toUpperCase().padEnd(5)} | ${category.padEnd(8)} | ${message}${dataStr}\n`;
        appendFileSync(getLogPath(), line, "utf-8");
    } catch {
        // Never throw from the logger — it's a support layer
    }
}

// ── Public API ────────────────────────────────────────────

export const logger = {
    // ── Generic ──
    info: (category: LogCategory, message: string, data?: Record<string, unknown>) =>
        writeLog("info", category, message, data),

    warn: (category: LogCategory, message: string, data?: Record<string, unknown>) =>
        writeLog("warn", category, message, data),

    error: (category: LogCategory, message: string, data?: Record<string, unknown>) =>
        writeLog("error", category, message, data),

    debug: (category: LogCategory, message: string, data?: Record<string, unknown>) =>
        writeLog("debug", category, message, data),

    // ── Convenience methods ──

    /** Log a request lifecycle event */
    request(event: "start" | "complete" | "error", data: Record<string, unknown>) {
        const level: LogLevel = event === "error" ? "error" : "info";
        writeLog(level, "request", `Request ${event}`, data);
    },

    /** Log a tool call lifecycle event */
    toolCall(event: "start" | "complete" | "error" | "approval", toolName: string, data?: Record<string, unknown>) {
        const level: LogLevel = event === "error" ? "error" : "info";
        writeLog(level, "tool", `${toolName} → ${event}`, data);
    },

    /** Log context compression */
    compression(originalTokens: number, compressedTokens: number, stages: string[]) {
        const pct = Math.round(((originalTokens - compressedTokens) / originalTokens) * 100);
        writeLog("info", "context", `Compressed ${originalTokens} → ${compressedTokens} tokens (-${pct}%)`, {
            stages,
        });
    },

    /** Log engine routing decisions */
    route(mode: string, domain: string, packName: string, toolCount: number, traversalMs: number) {
        writeLog("info", "engine", `Routed: ${mode}/${domain} → ${packName} (${toolCount} tools, ${traversalMs}ms)`);
    },
};
