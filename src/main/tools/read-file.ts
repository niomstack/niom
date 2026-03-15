/**
 * readFile Tool
 *
 * Reads the contents of a file at a given path. Scoped to the user's
 * home directory to prevent path traversal. Returns partial results
 * for files exceeding the size limit.
 *
 * Pack: OS (primitive)
 * Approval: auto
 */

import { tool } from "ai";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import type { SkillResult } from "@/shared/skill-types";
import { success, error, partial, timed, validatePath, getHomeDir } from "./helpers";

/** Maximum file size to read (100KB). Files beyond this are truncated. */
const MAX_FILE_SIZE = 100 * 1024;

/** Data returned by readFile on success. */
interface ReadFileData {
  path: string;
  content: string;
  size: number;
  extension: string;
}

export const readFileTool = tool({
  description: "Read the contents of a file at the specified path. Returns the file contents as text. Scoped to the user's home directory.",
  inputSchema: z.object({
    path: z.string().describe("Absolute or relative path to the file to read. Relative paths resolve from the user's home directory."),
  }),
  execute: async (input): Promise<SkillResult<ReadFileData | null>> => {
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

      // Check if file exists
      if (!fs.existsSync(resolvedPath)) {
        return error(
          `File not found: "${resolvedPath}". The file does not exist at this path.`,
          { domain: "os", path: resolvedPath },
        );
      }

      // Check if it's actually a file (not a directory)
      const stat = fs.statSync(resolvedPath);
      if (!stat.isFile()) {
        return error(
          `"${resolvedPath}" is a directory, not a file. Use listDirectory instead.`,
          { domain: "os", path: resolvedPath },
        );
      }

      const fileSize = stat.size;
      const extension = path.extname(resolvedPath).slice(1) || "txt";

      // Check size limit
      if (fileSize > MAX_FILE_SIZE) {
        // Read first MAX_FILE_SIZE bytes
        const fd = fs.openSync(resolvedPath, "r");
        const buffer = Buffer.alloc(MAX_FILE_SIZE);
        fs.readSync(fd, buffer, 0, MAX_FILE_SIZE, 0);
        fs.closeSync(fd);

        const content = buffer.toString("utf-8");

        return partial<ReadFileData>(
          {
            path: resolvedPath,
            content,
            size: fileSize,
            extension,
          },
          `File "${path.basename(resolvedPath)}" is ${formatSize(fileSize)} — showing first ${formatSize(MAX_FILE_SIZE)}. The output is truncated.`,
          {
            domain: "os",
            path: resolvedPath,
            truncated: true,
            bytesProcessed: MAX_FILE_SIZE,
          },
          {
            confidence: 0.7,
            suggestions: ["readFileRange"],
          },
        );
      }

      // Read the full file
      const content = fs.readFileSync(resolvedPath, "utf-8");

      return success<ReadFileData>(
        {
          path: resolvedPath,
          content,
          size: fileSize,
          extension,
        },
        `Successfully read "${path.basename(resolvedPath)}" (${formatSize(fileSize)}, ${content.split("\n").length} lines).`,
        {
          domain: "os",
          path: resolvedPath,
          bytesProcessed: fileSize,
        },
        {
          suggestions: ["editFile", "searchFiles"],
        },
      );
    });
  },
});

/** Format bytes into human-readable size. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
