import { tool } from "ai";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync } from "fs";
import { dirname, resolve, isAbsolute } from "path";
import { execSync } from "child_process";
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
        description: "Read the contents of a file. Returns content with metadata (size, line count, modified date). Files over 500 lines are auto-truncated — use readFileRange for specific sections.",
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
            const lines = content.split("\n");
            recordFileRead(resolved);

            // Auto-truncate large files to save context window
            const MAX_LINES = 500;
            if (lines.length > MAX_LINES) {
                const head = lines.slice(0, 200).join("\n");
                const tail = lines.slice(-200).join("\n");
                return {
                    path: resolved,
                    content: `${head}\n\n... [${lines.length - 400} lines truncated — use readFileRange for specific sections] ...\n\n${tail}`,
                    size: stat.size,
                    lines: lines.length,
                    modified: stat.mtime.toISOString(),
                    truncated: true,
                    hint: `File has ${lines.length} lines. Use readFileRange to read specific sections.`,
                };
            }

            return {
                path: resolved,
                content,
                size: stat.size,
                lines: lines.length,
                modified: stat.mtime.toISOString(),
                truncated: false,
            };
        },
    }),

    readFileRange: tool({
        description: "Read a specific range of lines from a file. Use this for large files instead of reading the entire file. Line numbers are 1-indexed and inclusive.",
        inputSchema: z.object({
            path: z.string().describe("File path (absolute, or relative to workspace)"),
            startLine: z.number().int().min(1).describe("First line to read (1-indexed, inclusive)"),
            endLine: z.number().int().min(1).describe("Last line to read (1-indexed, inclusive)"),
        }),
        execute: async ({ path, startLine, endLine }, options) => {
            const resolved = resolvePath(path, options);
            if (!existsSync(resolved)) {
                return { error: `File not found: ${resolved}` };
            }
            const stat = statSync(resolved);
            if (stat.isDirectory()) {
                return { error: `Path is a directory. Use listDirectory instead.` };
            }
            const content = readFileSync(resolved, "utf-8");
            const allLines = content.split("\n");
            const totalLines = allLines.length;

            // Clamp range
            const start = Math.max(1, startLine);
            const end = Math.min(totalLines, endLine);

            if (start > totalLines) {
                return { error: `startLine ${start} exceeds file length (${totalLines} lines)` };
            }

            const selectedLines = allLines.slice(start - 1, end);
            // Prepend line numbers for easier reference
            const numbered = selectedLines.map((line, i) => `${start + i}: ${line}`).join("\n");

            recordFileRead(resolved);
            return {
                path: resolved,
                content: numbered,
                range: { start, end },
                totalLines,
                linesReturned: selectedLines.length,
            };
        },
    }),

    searchFiles: tool({
        description: "Search for text patterns across files in a directory (recursive grep). Returns matching lines with context. Smart defaults: ignores node_modules, .git, dist, build, and binary files. Use this to find code, config values, function definitions, or any text across a project.",
        inputSchema: z.object({
            pattern: z.string().describe("Text or regex pattern to search for"),
            directory: z.string().optional().describe("Directory to search in (absolute, or relative to workspace). Defaults to workspace root."),
            fileGlob: z.string().optional().describe("File glob pattern to filter (e.g., '*.ts', '*.md', '*.json'). Defaults to all text files."),
            contextLines: z.number().int().min(0).max(10).optional().describe("Number of context lines around each match (default: 2)"),
            maxResults: z.number().int().min(1).max(50).optional().describe("Maximum number of matches to return (default: 20)"),
            caseSensitive: z.boolean().optional().describe("Whether the search is case-sensitive (default: false)"),
        }),
        execute: async ({ pattern, directory, fileGlob, contextLines, maxResults, caseSensitive }, options) => {
            const searchDir = directory ? resolvePath(directory, options) : getWorkspaceFromContext(options);
            if (!existsSync(searchDir)) {
                return { error: `Directory not found: ${searchDir}` };
            }

            const ctx = contextLines ?? 2;
            const limit = maxResults ?? 20;
            const caseFlag = caseSensitive ? "" : "-i";

            // Default ignores for common non-interesting directories
            const defaultExcludes = [
                "node_modules", ".git", "dist", "build", ".next", "__pycache__",
                ".cache", "coverage", ".turbo", ".vercel", "target",
            ];
            const excludeArgs = defaultExcludes.map(d => `--exclude-dir="${d}"`).join(" ");
            const fileFilter = fileGlob ? `--include="${fileGlob}"` : "";

            // Use grep (available on all platforms via Git Bash on Windows)
            const cmd = `grep -rn ${caseFlag} -C ${ctx} ${fileFilter} ${excludeArgs} --binary-files=without-match -- "${pattern.replace(/"/g, '\\"')}" "${searchDir}"`;

            try {
                const output = execSync(cmd, {
                    encoding: "utf-8",
                    timeout: 15000,
                    maxBuffer: 2 * 1024 * 1024,
                    cwd: searchDir,
                });

                // Parse grep output into structured matches
                const matches: Array<{ file: string; line: number; content: string; context?: string[] }> = [];
                const lines = output.split("\n").filter(Boolean);
                let currentMatch: null | { file: string; line: number; content: string; context: string[] } = null;

                for (const line of lines) {
                    if (line === "--") {
                        // Separator between matches
                        if (currentMatch) {
                            matches.push(currentMatch);
                            if (matches.length >= limit) break;
                        }
                        currentMatch = null;
                        continue;
                    }

                    // Match line: "file:lineNumber:content" or context "file-lineNumber-content"
                    const matchResult = line.match(/^(.+?):(\d+):(.*)$/);
                    const contextResult = line.match(/^(.+?)-(\d+)-(.*)$/);

                    if (matchResult) {
                        if (currentMatch) {
                            matches.push(currentMatch);
                            if (matches.length >= limit) break;
                        }
                        currentMatch = {
                            file: matchResult[1],
                            line: parseInt(matchResult[2]),
                            content: matchResult[3],
                            context: [],
                        };
                    } else if (contextResult && currentMatch) {
                        currentMatch.context.push(`${contextResult[2]}: ${contextResult[3]}`);
                    }
                }
                if (currentMatch && matches.length < limit) {
                    matches.push(currentMatch);
                }

                return {
                    pattern,
                    directory: searchDir,
                    matchCount: matches.length,
                    totalLinesScanned: lines.length,
                    matches: matches.slice(0, limit),
                    truncated: matches.length >= limit,
                };
            } catch (err: any) {
                // grep returns exit code 1 when no matches found
                if (err.status === 1) {
                    return { pattern, directory: searchDir, matchCount: 0, matches: [], message: "No matches found." };
                }
                return { error: `Search failed: ${err.message?.slice(0, 200)}`, pattern, directory: searchDir };
            }
        },
    }),

    editFile: tool({
        description: "Make surgical edits to a file without rewriting the entire content. Supports find-and-replace (with optional regex), insert at line, and delete line ranges. This is a destructive operation — requires user confirmation.",
        inputSchema: z.object({
            path: z.string().describe("File path (absolute, or relative to workspace)"),
            operations: z.array(z.object({
                type: z.enum(["replace", "insert", "delete"]).describe("Operation type"),
                find: z.string().optional().describe("For 'replace': exact text or regex pattern to find"),
                replace: z.string().optional().describe("For 'replace': replacement text. For 'insert': text to insert"),
                line: z.number().int().optional().describe("For 'insert': line number to insert before (1-indexed). For 'delete': start line"),
                endLine: z.number().int().optional().describe("For 'delete': end line (inclusive, 1-indexed)"),
                isRegex: z.boolean().optional().describe("For 'replace': treat 'find' as a regex pattern (default: false)"),
                replaceAll: z.boolean().optional().describe("For 'replace': replace all occurrences (default: false, replaces first only)"),
            })).describe("List of edit operations to apply in order"),
        }),
        needsApproval: true,
        execute: async ({ path, operations }, options) => {
            const resolved = resolvePath(path, options);
            if (!existsSync(resolved)) {
                return { error: `File not found: ${resolved}` };
            }

            let content = readFileSync(resolved, "utf-8");
            const results: Array<{ type: string; success: boolean; detail?: string }> = [];

            for (const op of operations) {
                try {
                    if (op.type === "replace" && op.find !== undefined && op.replace !== undefined) {
                        const pattern = op.isRegex
                            ? new RegExp(op.find, op.replaceAll ? "g" : "")
                            : op.find;

                        if (typeof pattern === "string") {
                            if (op.replaceAll) {
                                const count = content.split(pattern).length - 1;
                                content = content.split(pattern).join(op.replace);
                                results.push({ type: "replace", success: count > 0, detail: `Replaced ${count} occurrence(s)` });
                            } else {
                                const idx = content.indexOf(pattern);
                                if (idx === -1) {
                                    results.push({ type: "replace", success: false, detail: `Text not found: "${op.find.slice(0, 60)}"` });
                                } else {
                                    content = content.substring(0, idx) + op.replace + content.substring(idx + pattern.length);
                                    results.push({ type: "replace", success: true, detail: "Replaced first occurrence" });
                                }
                            }
                        } else {
                            // Regex
                            const before = content;
                            content = content.replace(pattern, op.replace);
                            results.push({ type: "replace", success: content !== before, detail: content !== before ? "Regex replace applied" : "No regex match found" });
                        }
                    } else if (op.type === "insert" && op.line !== undefined && op.replace !== undefined) {
                        const lines = content.split("\n");
                        const insertAt = Math.max(0, Math.min(lines.length, op.line - 1));
                        lines.splice(insertAt, 0, op.replace);
                        content = lines.join("\n");
                        results.push({ type: "insert", success: true, detail: `Inserted at line ${op.line}` });
                    } else if (op.type === "delete" && op.line !== undefined) {
                        const lines = content.split("\n");
                        const start = Math.max(1, op.line) - 1;
                        const end = Math.min(lines.length, op.endLine ?? op.line);
                        const deleted = end - start;
                        lines.splice(start, deleted);
                        content = lines.join("\n");
                        results.push({ type: "delete", success: true, detail: `Deleted ${deleted} line(s) starting at line ${op.line}` });
                    } else {
                        results.push({ type: op.type, success: false, detail: "Invalid operation parameters" });
                    }
                } catch (err: any) {
                    results.push({ type: op.type, success: false, detail: err.message });
                }
            }

            writeFileSync(resolved, content, "utf-8");
            recordFileWrite(resolved);

            const newLines = content.split("\n").length;
            return {
                path: resolved,
                operations: results,
                newSize: Buffer.byteLength(content),
                newLines,
                allSucceeded: results.every(r => r.success),
            };
        },
    }),

    writeFile: tool({
        description: "Create or overwrite a file with the given content. Creates parent directories if needed. This is a destructive operation — requires user confirmation.",
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

            // Auto-register as artifact if we know the context
            const ctx = options?.experimental_context as AgentContext | undefined;
            if (ctx?.threadId || ctx?.taskId) {
                try {
                    const { ArtifactManager } = await import("../artifacts/index.js");
                    ArtifactManager.getInstance().register(resolved, {
                        type: ctx.taskId ? "task" : "conversation",
                        id: (ctx.taskId || ctx.threadId)!,
                        workspace: ctx.workspace,
                    });
                } catch { /* non-critical — don't fail the write */ }
            }

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
        description: "Delete a file or directory. For directories, removes recursively. This is a destructive operation — requires user confirmation. IMPORTANT: Always verify the path exists (using listDirectory) before calling this.",
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
