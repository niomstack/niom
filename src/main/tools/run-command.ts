/**
 * runCommand Tool
 *
 * Executes a shell command in the user's default shell.
 * Captures stdout and stderr. Has a configurable timeout.
 * Scoped to the user's home directory.
 *
 * Pack: OS (primitive)
 * Approval: confirm (requires user approval before execution)
 */

import { tool } from "ai";
import { z } from "zod";
import { execSync } from "child_process";
import * as os from "os";
import type { SkillResult } from "@/shared/skill-types";
import { success, error, partial, timed } from "./helpers";

/** Default timeout in milliseconds (30 seconds). */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Maximum output size to return (50KB). */
const MAX_OUTPUT_SIZE = 50 * 1024;

/** Blocked commands that are too dangerous even with user approval. */
const BLOCKED_PATTERNS = [
  /\brm\s+-rf\s+[/~]/i,     // rm -rf on root or home
  /\bsudo\s+rm\b/i,          // sudo rm
  /\bmkfs\b/i,               // filesystem formatting
  /\bdd\s+if=/i,             // raw disk writes
  /\b:(){ :|:& };:/,         // fork bomb
  /\bshutdown\b/i,           // system shutdown
  /\breboot\b/i,             // system reboot
];

/** Data returned by runCommand on success. */
interface RunCommandData {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd: string;
}

export const runCommandTool = tool({
  description:
    "Execute a shell command in the user's default shell. " +
    "Returns stdout, stderr, and exit code. " +
    "Commands run with a 30-second timeout. " +
    "Working directory defaults to the user's home directory.",
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute."),
    cwd: z.string().optional().describe(
      "Working directory for the command. Defaults to the user's home directory.",
    ),
    timeout: z.number().optional().describe(
      "Timeout in seconds. Defaults to 30. Maximum 120.",
    ),
  }),
  needsApproval: true,
  execute: async (input): Promise<SkillResult<RunCommandData | null>> => {
    return timed(async () => {
      const command = input.command.trim();
      const homeDir = os.homedir();
      const cwd = input.cwd || homeDir;
      const timeoutMs = Math.min((input.timeout || 30) * 1000, 120_000);

      // Safety: block dangerous commands
      for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(command)) {
          return error(
            `Command blocked for safety: "${command}" matches a dangerous pattern. This command could cause irreversible system damage.`,
            { domain: "os" },
          );
        }
      }

      // Execute the command
      try {
        const result = execSync(command, {
          cwd,
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT_SIZE * 2,
          encoding: "utf-8",
          shell: process.env.SHELL || "/bin/zsh",
          // Merge env so the command has access to PATH etc.
          env: { ...process.env, HOME: homeDir },
          stdio: ["pipe", "pipe", "pipe"],
        });

        const stdout = truncateOutput(result || "");

        return success<RunCommandData>(
          {
            command,
            stdout,
            stderr: "",
            exitCode: 0,
            cwd,
          },
          stdout
            ? `Command succeeded: \`${truncateCommand(command)}\``
            : `Command succeeded (no output): \`${truncateCommand(command)}\``,
          {
            domain: "os",
            bytesProcessed: Buffer.byteLength(stdout, "utf-8"),
          },
          {
            suggestions: ["readFile", "writeFile"],
          },
        );
      } catch (execError: unknown) {
        // execSync throws on non-zero exit or timeout
        const err = execError as {
          status?: number;
          stdout?: string;
          stderr?: string;
          killed?: boolean;
          signal?: string;
        };

        // Timeout
        if (err.killed || err.signal === "SIGTERM") {
          return partial<RunCommandData>(
            {
              command,
              stdout: truncateOutput(err.stdout || ""),
              stderr: truncateOutput(err.stderr || ""),
              exitCode: -1,
              cwd,
            },
            `Command timed out after ${timeoutMs / 1000}s: \`${truncateCommand(command)}\``,
            {
              domain: "os",
              truncated: true,
            },
            {
              confidence: 0.3,
              suggestions: ["runCommand"],
            },
          );
        }

        // Non-zero exit
        const exitCode = err.status ?? 1;
        const stdout = truncateOutput(err.stdout || "");
        const stderr = truncateOutput(err.stderr || "");

        return success<RunCommandData>(
          {
            command,
            stdout,
            stderr,
            exitCode,
            cwd,
          },
          `Command exited with code ${exitCode}: \`${truncateCommand(command)}\`${stderr ? `\n${stderr.slice(0, 200)}` : ""}`,
          {
            domain: "os",
            bytesProcessed: Buffer.byteLength(stdout + stderr, "utf-8"),
          },
          {
            confidence: exitCode === 0 ? 1.0 : 0.5,
          },
        );
      }
    });
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────

/** Truncate output to MAX_OUTPUT_SIZE. */
function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_SIZE) return output;
  return output.slice(0, MAX_OUTPUT_SIZE) + "\n... (output truncated)";
}

/** Truncate command for display in summaries. */
function truncateCommand(command: string): string {
  if (command.length <= 80) return command;
  return command.slice(0, 77) + "...";
}
