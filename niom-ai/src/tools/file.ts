import { tool } from "ai";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync } from "fs";
import { dirname, resolve, isAbsolute } from "path";
import { getWorkspace } from "../config.js";
import { recordFileRead, recordFileWrite, type AgentContext } from "../ai/context.js";

/**
 * Extract workspace from tool execution context.
 * Falls back to config workspace if experimental_context isn't available.
 */
function getWorkspaceFromContext(options?: { experimental_context?: unknown }): string {
    const ctx = options?.experimental_context as AgentContext | undefined;
    return ctx?.workspace || getWorkspace();
}

/**
 * Resolve a path against workspace from context.
 */
function resolvePath(path: string, options?: { experimental_context?: unknown }): string {
    if (isAbsolute(path)) return resolve(path);
    return resolve(getWorkspaceFromContext(options), path);
}

export const fileTools = {
    readFile: tool({
        description: "Read the contents of a file. Use when the user asks to see, view, or inspect a file. Returns the file content and metadata.",
        inputSchema: z.object({
            path: z.string().describe("File path (absolute, or relative to workspace)"),
        }),
        execute: async ({ path }, options) => {
            const resolved = resolvePath(path, options);
            if (!existsSync(resolved)) {
                return { error: `File not found: ${resolved}` };
            }
            const stat = statSync(resolved);
            if (stat.isDirectory()) {
                return { error: `Path is a directory, not a file: ${resolved}. Use listDirectory instead.` };
            }
            if (stat.size > 1024 * 1024) {
                return { error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max 1MB.` };
            }
            const content = readFileSync(resolved, "utf-8");
            recordFileRead(resolved);
            return { path: resolved, content, size: stat.size, lines: content.split("\n").length };
        },
    }),

    writeFile: tool({
        description: "Create or overwrite a file with the given content. Creates parent directories if needed. This is a destructive operation — requires user approval.",
        inputSchema: z.object({
            path: z.string().describe("File path (absolute, or relative to workspace)"),
            content: z.string().describe("Content to write to the file"),
        }),
        needsApproval: true,
        execute: async ({ path, content }, options) => {
            const resolved = resolvePath(path, options);
            const dir = dirname(resolved);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            writeFileSync(resolved, content, "utf-8");
            recordFileWrite(resolved);
            return { path: resolved, size: Buffer.byteLength(content), lines: content.split("\n").length, status: "written" };
        },
    }),

    listDirectory: tool({
        description: "List files and directories at the given path. Shows names, types (file/dir), and sizes. Use this to explore project structure or verify a file exists before operating on it.",
        inputSchema: z.object({
            path: z.string().describe("Directory path (absolute, or relative to workspace). Use '.' for the workspace root."),
        }),
        execute: async ({ path }, options) => {
            const resolved = resolvePath(path, options);
            if (!existsSync(resolved)) {
                return { error: `Directory not found: ${resolved}` };
            }
            const stat = statSync(resolved);
            if (!stat.isDirectory()) {
                return { error: `Path is a file, not a directory: ${resolved}. Use readFile instead.` };
            }
            try {
                const entries = readdirSync(resolved).map((name) => {
                    const fullPath = resolve(resolved, name);
                    try {
                        const s = statSync(fullPath);
                        return {
                            name,
                            type: s.isDirectory() ? "directory" as const : "file" as const,
                            size: s.isFile() ? s.size : undefined,
                        };
                    } catch {
                        return { name, type: "unknown" as const, size: undefined };
                    }
                });
                return { path: resolved, count: entries.length, entries };
            } catch {
                return { error: `Cannot read directory: ${resolved}` };
            }
        },
    }),

    deleteFile: tool({
        description: "Delete a file or directory. For directories, removes recursively. This is a destructive operation — requires user approval. IMPORTANT: Always verify the path exists (using listDirectory) before calling this.",
        inputSchema: z.object({
            path: z.string().describe("Path to the file or directory to delete (absolute, or relative to workspace)"),
        }),
        needsApproval: true,
        execute: async ({ path }, options) => {
            const resolved = resolvePath(path, options);
            if (!existsSync(resolved)) {
                return { error: `Path not found: ${resolved}` };
            }
            const stat = statSync(resolved);
            if (stat.isDirectory()) {
                rmSync(resolved, { recursive: true, force: true });
                return { path: resolved, type: "directory", status: "deleted" };
            }
            unlinkSync(resolved);
            return { path: resolved, type: "file", status: "deleted" };
        },
    }),
};
