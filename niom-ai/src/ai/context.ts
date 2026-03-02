/**
 * Agent context — structured workspace data passed via experimental_context.
 *
 * This is NOT injected into the system prompt. Instead, it flows through
 * the AI SDK's experimental_context mechanism:
 *   - streamText({ experimental_context: agentContext })
 *   - Tools receive it: execute(input, { experimental_context }) => ...
 *
 * This keeps the system prompt lean (personality + rules only)
 * while making every tool workspace-aware.
 */

import { existsSync, readFileSync } from "fs";
import { join, basename } from "path";
import { loadConfig } from "../config.js";

// ── Context Types ──

export interface AgentContext {
    /** Absolute path to the workspace/project root */
    workspace: string;
    /** Currently focused file in the editor (if known) */
    focusFile?: string;
    /** Files currently open in the editor */
    openFiles?: string[];
    /** Cursor line number in the focused file */
    cursorLine?: number;
    /** Detected project type and tech stack */
    project?: ProjectInfo;
    /** Session-level memory: what the agent has done recently */
    session: SessionMemory;
}

export interface ProjectInfo {
    type: string;       // "node" | "rust" | "python" | "go" | "unknown"
    name?: string;      // From package.json name, Cargo.toml name, etc.
    stack?: string[];   // ["typescript", "react", "tailwind"] etc.
}

export interface SessionMemory {
    /** Files the agent has read this session */
    filesRead: string[];
    /** Files the agent has written this session */
    filesWritten: string[];
    /** Tools used this session (tool name + count) */
    toolsUsed: Record<string, number>;
    /** Session start time */
    startedAt: number;
}

// ── Project Detection ──

const PROJECT_MARKERS: Array<{ file: string; type: string; stackDetector?: (root: string) => string[] }> = [
    {
        file: "package.json",
        type: "node",
        stackDetector: (root) => {
            try {
                const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
                const deps = { ...pkg.dependencies, ...pkg.devDependencies };
                const stack: string[] = [];
                if (deps.typescript || existsSync(join(root, "tsconfig.json"))) stack.push("typescript");
                if (deps.react) stack.push("react");
                if (deps.next) stack.push("next.js");
                if (deps.vue) stack.push("vue");
                if (deps.svelte) stack.push("svelte");
                if (deps.tailwindcss) stack.push("tailwind");
                if (deps.hono) stack.push("hono");
                if (deps.express) stack.push("express");
                if (deps.vite) stack.push("vite");
                return stack;
            } catch { return []; }
        },
    },
    { file: "Cargo.toml", type: "rust" },
    { file: "go.mod", type: "go" },
    { file: "pyproject.toml", type: "python" },
    { file: "requirements.txt", type: "python" },
    { file: "pom.xml", type: "java" },
    { file: "build.gradle", type: "java" },
    { file: "*.sln", type: "dotnet" },
];

let _projectCache: Map<string, ProjectInfo | undefined> = new Map();

export function detectProject(workspace: string): ProjectInfo | undefined {
    if (_projectCache.has(workspace)) return _projectCache.get(workspace);

    for (const marker of PROJECT_MARKERS) {
        if (marker.file.includes("*")) continue; // skip glob patterns for now
        const markerPath = join(workspace, marker.file);
        if (existsSync(markerPath)) {
            const stack = marker.stackDetector?.(workspace) ?? [];
            let name: string | undefined;
            try {
                if (marker.type === "node") {
                    const pkg = JSON.parse(readFileSync(markerPath, "utf-8"));
                    name = pkg.name;
                }
            } catch { /* ignore */ }
            const result = { type: marker.type, name: name || basename(workspace), stack };
            _projectCache.set(workspace, result);
            return result;
        }
    }
    _projectCache.set(workspace, undefined);
    return undefined;
}


// ── Session Memory (singleton, in-memory) ──

const session: SessionMemory = {
    filesRead: [],
    filesWritten: [],
    toolsUsed: {},
    startedAt: Date.now(),
};

export function recordFileRead(path: string): void {
    if (!session.filesRead.includes(path)) {
        session.filesRead.push(path);
        if (session.filesRead.length > 50) session.filesRead.shift();
    }
}

export function recordFileWrite(path: string): void {
    if (!session.filesWritten.includes(path)) {
        session.filesWritten.push(path);
        if (session.filesWritten.length > 50) session.filesWritten.shift();
    }
}

export function recordToolUse(toolName: string): void {
    session.toolsUsed[toolName] = (session.toolsUsed[toolName] || 0) + 1;
}

export function getSession(): SessionMemory {
    return { ...session };
}

// ── Build Context ──

export function buildAgentContext(requestContext?: {
    focusFile?: string;
    openFiles?: string[];
    cursorLine?: number;
    cwd?: string;
}): AgentContext {
    const config = loadConfig();
    const workspace = requestContext?.cwd || config.workspace;

    return {
        workspace,
        focusFile: requestContext?.focusFile,
        openFiles: requestContext?.openFiles,
        cursorLine: requestContext?.cursorLine,
        project: detectProject(workspace),
        session: getSession(),
    };
}

/**
 * Format a lightweight context preamble for the system prompt.
 *
 * This is NOT prompt bloat — it's a structured, <10-line snapshot
 * that lets the agent immediately know the user's environment
 * without needing to call tools first.
 */
export function formatContextPreamble(ctx: AgentContext): string {
    const lines: string[] = ["## Current Context"];

    // Workspace
    lines.push(`- **Workspace**: \`${ctx.workspace}\``);

    // Project
    if (ctx.project) {
        const stack = ctx.project.stack?.length ? ` (${ctx.project.stack.join(", ")})` : "";
        lines.push(`- **Project**: ${ctx.project.name || "unnamed"} — ${ctx.project.type}${stack}`);
    }

    // Focus file
    if (ctx.focusFile) {
        const cursor = ctx.cursorLine ? `:${ctx.cursorLine}` : "";
        lines.push(`- **Focus file**: \`${ctx.focusFile}${cursor}\``);
    }

    // Open files
    if (ctx.openFiles?.length) {
        const files = ctx.openFiles.map(f => `\`${basename(f)}\``).join(", ");
        lines.push(`- **Open files**: ${files}`);
    }

    // Session summary
    const s = ctx.session;
    const elapsed = Math.round((Date.now() - s.startedAt) / 60000);
    const actions: string[] = [];
    if (s.filesRead.length) actions.push(`read ${s.filesRead.length} files`);
    if (s.filesWritten.length) actions.push(`wrote ${s.filesWritten.length} files`);
    const toolCount = Object.values(s.toolsUsed).reduce((a, b) => a + b, 0);
    if (toolCount) actions.push(`${toolCount} tool calls`);
    if (actions.length || elapsed > 0) {
        lines.push(`- **Session**: ${elapsed}min — ${actions.join(", ") || "no actions yet"}`);
    }

    return lines.join("\n");
}
