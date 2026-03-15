/**
 * writeFile Tool
 *
 * Creates or overwrites a file at the specified path.
 * Generates a diff preview when overwriting existing files.
 * Scoped to the user's home directory.
 *
 * Pack: OS (primitive)
 * Approval: confirm (requires user approval before execution)
 */

import { tool } from "ai";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import type { SkillResult } from "@/shared/skill-types";
import { success, error, timed, validatePath, getHomeDir } from "./helpers";
import { isTrusted } from "./trust";

/** Maximum file size to write (1MB safety limit). */
const MAX_WRITE_SIZE = 1024 * 1024;

/** Data returned by writeFile on success. */
interface WriteFileData {
  path: string;
  bytesWritten: number;
  created: boolean;
  /** Unified diff preview (only if overwriting an existing file). */
  diff?: string;
}

export const writeFileTool = tool({
  description:
    "Create or overwrite a file at the specified path with the given content. " +
    "When overwriting, a diff is generated. Scoped to the user's home directory. " +
    "Use this for creating new files, saving generated content, or modifying existing files.",
  inputSchema: z.object({
    path: z.string().describe(
      "Absolute or relative path for the file. Relative paths resolve from the user's home directory.",
    ),
    content: z.string().describe("The full content to write to the file."),
  }),
  needsApproval: (input) => !isTrusted("write", input),
  execute: async (input): Promise<SkillResult<WriteFileData | null>> => {
    return timed(async () => {
      const inputPath = input.path;
      const homeDir = getHomeDir();
      const resolvedPath = validatePath(inputPath, homeDir);

      if (!resolvedPath) {
        return error(
          `Path "${inputPath}" is outside the allowed directory. Files must be within the user's home directory.`,
          { domain: "os", path: inputPath },
        );
      }

      // Validate content size
      const contentBytes = Buffer.byteLength(input.content, "utf-8");
      if (contentBytes > MAX_WRITE_SIZE) {
        return error(
          `Content is too large (${formatSize(contentBytes)}). Maximum write size is ${formatSize(MAX_WRITE_SIZE)}.`,
          { domain: "os", path: resolvedPath },
        );
      }

      // Check if file already exists (for diff generation)
      const exists = fs.existsSync(resolvedPath);
      let diff: string | undefined;

      if (exists) {
        try {
          const existingContent = fs.readFileSync(resolvedPath, "utf-8");
          diff = generateSimpleDiff(existingContent, input.content, resolvedPath);
        } catch {
          // If we can't read the existing file, skip diff
        }
      }

      // Ensure parent directories exist
      const parentDir = path.dirname(resolvedPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Write the file
      try {
        fs.writeFileSync(resolvedPath, input.content, "utf-8");
      } catch (e) {
        return error(
          `Failed to write file: ${e instanceof Error ? e.message : String(e)}`,
          { domain: "os", path: resolvedPath },
        );
      }

      const lineCount = input.content.split("\n").length;

      return success<WriteFileData>(
        {
          path: resolvedPath,
          bytesWritten: contentBytes,
          created: !exists,
          diff,
        },
        exists
          ? `Updated "${path.basename(resolvedPath)}" (${formatSize(contentBytes)}, ${lineCount} lines).`
          : `Created "${path.basename(resolvedPath)}" (${formatSize(contentBytes)}, ${lineCount} lines).`,
        {
          domain: "os",
          path: resolvedPath,
          bytesProcessed: contentBytes,
        },
        {
          suggestions: ["readFile"],
        },
      );
    });
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────

/** Format bytes into human-readable size. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Generate a simple unified-style diff between two strings.
 * Lightweight — no external diff library needed.
 */
function generateSimpleDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  const diffLines: string[] = [
    `--- a/${path.basename(filePath)}`,
    `+++ b/${path.basename(filePath)}`,
  ];

  let hasChanges = false;
  const maxLines = Math.max(oldLines.length, newLines.length);

  // Simple line-by-line comparison (not a true LCS diff, but practical)
  let i = 0;
  while (i < maxLines) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (oldLine === newLine) {
      // Context line — only include near changes
      i++;
      continue;
    }

    hasChanges = true;

    // Find the range of changes
    const changeStart = i;
    let oldEnd = i;
    let newEnd = i;

    // Scan forward through differing lines
    while (oldEnd < oldLines.length && newEnd < newLines.length && oldLines[oldEnd] !== newLines[newEnd]) {
      oldEnd++;
      newEnd++;
    }
    // Handle lines only in old
    while (oldEnd < oldLines.length && (newEnd >= newLines.length || oldLines[oldEnd] !== newLines[newEnd])) {
      oldEnd++;
    }
    // Handle lines only in new
    while (newEnd < newLines.length && (oldEnd >= oldLines.length || oldLines[oldEnd] !== newLines[newEnd])) {
      newEnd++;
    }

    // Hunk header
    diffLines.push(`@@ -${changeStart + 1},${oldEnd - changeStart} +${changeStart + 1},${newEnd - changeStart} @@`);

    // Context before (up to 2 lines)
    for (let c = Math.max(0, changeStart - 2); c < changeStart; c++) {
      if (c < oldLines.length) diffLines.push(` ${oldLines[c]}`);
    }

    // Removed lines
    for (let j = changeStart; j < oldEnd && j < oldLines.length; j++) {
      diffLines.push(`-${oldLines[j]}`);
    }
    // Added lines
    for (let j = changeStart; j < newEnd && j < newLines.length; j++) {
      diffLines.push(`+${newLines[j]}`);
    }

    i = Math.max(oldEnd, newEnd);
  }

  if (!hasChanges) return "(no changes)";

  // Cap diff output length
  const output = diffLines.join("\n");
  if (output.length > 3000) {
    return output.slice(0, 3000) + "\n... (diff truncated)";
  }
  return output;
}
