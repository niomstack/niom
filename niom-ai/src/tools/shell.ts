import { tool } from "ai";
import { z } from "zod";
import { execSync } from "child_process";
import { getWorkspace } from "../config.js";
import { resolve, isAbsolute } from "path";
import { type AgentContext } from "../ai/context.js";

/**
 * Patterns for commands that are safe to auto-execute (read-only).
 * Everything else requires user approval via AI SDK's HITL flow.
 */
const READ_ONLY_PATTERNS = [
    /^(ls|dir|cat|type|head|tail|wc|file|which|where|find|fd)\\b/,
    /^(echo|printf|date|uptime|whoami|hostname)\\b/,
    /^git\\s+(status|log|diff|branch|remote|show|tag)\\b/,
    /^(node|python|ruby|go|rustc|cargo|pnpm|npm|yarn)\\s+(-v|--version|--help)\\b/,
    /^(pwd|env|printenv|set)\\b/,
    /^(df|du|free|top|ps|lsof|netstat|ss)\\b/,
];

function isReadOnlyCommand(command: string): boolean {
    const trimmed = command.trim();
    return READ_ONLY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Extract workspace from tool execution context.
 */
function getWorkspaceFromContext(options?: { experimental_context?: unknown }): string {
    const ctx = options?.experimental_context as AgentContext | undefined;
    return ctx?.workspace || getWorkspace();
}

/**
 * Resolve a cwd path against the workspace from context.
 */
function resolveCwd(cwd: string | undefined, options?: { experimental_context?: unknown }): string {
    const workspace = getWorkspaceFromContext(options);
    if (!cwd) return workspace;
    if (isAbsolute(cwd)) return resolve(cwd);
    return resolve(workspace, cwd);
}

export const shellTools = {
    runCommand: tool({
        description: "Execute a shell command and return its output. The command runs in the user's configured workspace directory by default. Use for: exploring files, running builds, git operations, package management, system commands.",
        inputSchema: z.object({
            command: z.string().describe("The shell command to execute"),
            cwd: z.string().optional().describe("Working directory (absolute, or relative to workspace). Defaults to the workspace root."),
        }),
        needsApproval: async ({ command }) => !isReadOnlyCommand(command),
        execute: async ({ command, cwd }, options) => {
            const resolvedCwd = resolveCwd(cwd, options);
            try {
                const output = execSync(command, {
                    cwd: resolvedCwd,
                    timeout: 30000,
                    encoding: "utf-8",
                    maxBuffer: 1024 * 1024,
                    stdio: ["pipe", "pipe", "pipe"],
                });
                return {
                    command,
                    cwd: resolvedCwd,
                    stdout: output.trim(),
                    exitCode: 0,
                };
            } catch (err: any) {
                return {
                    command,
                    cwd: resolvedCwd,
                    stdout: err.stdout?.trim() || "",
                    stderr: err.stderr?.trim() || err.message,
                    exitCode: err.status ?? 1,
                };
            }
        },
    }),
};
