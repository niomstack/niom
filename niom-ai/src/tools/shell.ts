import { tool } from "ai";
import { z } from "zod";
import { execSync, exec } from "child_process";
import { getWorkspace } from "../config.js";
import { resolve, isAbsolute } from "path";
import { type AgentContext } from "../ai/context.js";

/**
 * Patterns for commands that are safe to auto-execute (read-only).
 * Everything else requires user confirmation via AI SDK's HITL flow.
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
        description: "Execute a shell command and return its output. The command runs in the user's configured workspace directory by default. Supports configurable timeout (up to 120s for long builds) and background mode for long-running processes.",
        inputSchema: z.object({
            command: z.string().describe("The shell command to execute"),
            cwd: z.string().optional().describe("Working directory (absolute, or relative to workspace). Defaults to the workspace root."),
            timeoutMs: z.number().int().min(1000).max(120000).optional().describe("Timeout in milliseconds (default: 30000, max: 120000 for long builds)"),
            background: z.boolean().optional().describe("If true, start the command in the background and return immediately (default: false)"),
        }),
        needsApproval: async ({ command }) => !isReadOnlyCommand(command),
        execute: async ({ command, cwd, timeoutMs, background }, options) => {
            const resolvedCwd = resolveCwd(cwd, options);
            const timeout = timeoutMs ?? 30000;

            // Background mode: start detached process
            if (background) {
                try {
                    const child = exec(command, {
                        cwd: resolvedCwd,
                        timeout: 0, // No timeout for background processes
                    });
                    const pid = child.pid;
                    child.unref();
                    return {
                        command,
                        cwd: resolvedCwd,
                        background: true,
                        pid,
                        status: "started",
                        hint: "Command is running in the background. Use runCommand with 'ps' or 'tasklist' to check status.",
                    };
                } catch (err: any) {
                    return { command, cwd: resolvedCwd, error: `Failed to start: ${err.message}` };
                }
            }

            // Synchronous execution
            try {
                const output = execSync(command, {
                    cwd: resolvedCwd,
                    timeout,
                    encoding: "utf-8",
                    maxBuffer: 2 * 1024 * 1024,
                    stdio: ["pipe", "pipe", "pipe"],
                });

                // Truncate very long output to save context
                const stdout = output.trim();
                const truncated = stdout.length > 8000;

                return {
                    command,
                    cwd: resolvedCwd,
                    stdout: truncated ? stdout.slice(0, 4000) + "\n\n... [output truncated] ...\n\n" + stdout.slice(-3000) : stdout,
                    exitCode: 0,
                    truncated,
                };
            } catch (err: any) {
                const stdout = err.stdout?.trim() || "";
                const stderr = err.stderr?.trim() || err.message;
                return {
                    command,
                    cwd: resolvedCwd,
                    stdout: stdout.slice(0, 4000),
                    stderr: stderr.slice(0, 4000),
                    exitCode: err.status ?? 1,
                };
            }
        },
    }),

    notifyUser: tool({
        description: "Send an OS-level desktop notification to the user. Use this for important alerts, task completions, or when you need the user's attention. Works on Windows, macOS, and Linux.",
        inputSchema: z.object({
            title: z.string().describe("Notification title"),
            message: z.string().describe("Notification message body"),
            urgency: z.enum(["low", "normal", "critical"]).optional().describe("Notification urgency level (default: normal)"),
        }),
        execute: async ({ title, message, urgency }) => {
            const level = urgency || "normal";

            try {
                if (process.platform === "win32") {
                    // Windows: PowerShell toast notification
                    const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
$template = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>${title.replace(/"/g, '&quot;')}</text>
      <text>${message.replace(/"/g, '&quot;')}</text>
    </binding>
  </visual>
</toast>
"@
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("NIOM").Show($toast)
`.trim();
                    execSync(`powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, "; ")}"`, {
                        timeout: 5000,
                        windowsHide: true,
                    });
                } else if (process.platform === "darwin") {
                    execSync(`osascript -e 'display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"'`, {
                        timeout: 5000,
                    });
                } else {
                    const urgencyFlag = level === "critical" ? "-u critical" : level === "low" ? "-u low" : "-u normal";
                    execSync(`notify-send ${urgencyFlag} "${title.replace(/"/g, '\\"')}" "${message.replace(/"/g, '\\"')}"`, {
                        timeout: 5000,
                    });
                }

                return { status: "sent", title, message, urgency: level };
            } catch (err: any) {
                return { status: "failed", error: err.message, title, message };
            }
        },
    }),
};
