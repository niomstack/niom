/**
 * listDirectory Tool
 *
 * Lists files and subdirectories at a given path. Returns structured
 * data with name, type, size, and modification time for each entry.
 * Scoped to the user's home directory.
 *
 * Pack: OS (primitive)
 * Approval: auto
 */

import { tool } from "ai";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import type { SkillResult } from "@/shared/skill-types";
import { success, error, timed, validatePath, getHomeDir } from "./helpers";

/** Maximum number of entries to return (prevents overwhelming the model). */
const MAX_ENTRIES = 100;

/** A single directory entry. */
interface DirEntry {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  modified: string;
}

/** Data returned by listDirectory. */
interface ListDirectoryData {
  path: string;
  entries: DirEntry[];
  totalEntries: number;
  truncated: boolean;
}

export const listDirectoryTool = tool({
  description: "List all files and subdirectories in a directory. Returns names, types, sizes, and modification times. Scoped to the user's home directory.",
  inputSchema: z.object({
    path: z.string().describe("Absolute or relative path to the directory to list. Relative paths resolve from the user's home directory."),
    showHidden: z.boolean().optional().default(false).describe("Whether to include hidden files (starting with .)"),
  }),
  execute: async (input): Promise<SkillResult<ListDirectoryData | null>> => {
    return timed(async () => {
      const inputPath = input.path;
      const showHidden = input.showHidden;
      const homeDir = getHomeDir();
      const resolvedPath = validatePath(inputPath, homeDir);

      if (!resolvedPath) {
        return error(
          `Path "${inputPath}" is outside the allowed directory. Directories must be within the user's home directory.`,
          { domain: "os", path: inputPath },
        );
      }

      // Check if directory exists
      if (!fs.existsSync(resolvedPath)) {
        return error(
          `Directory not found: "${resolvedPath}". The path does not exist.`,
          { domain: "os", path: resolvedPath },
        );
      }

      // Check if it's actually a directory
      const stat = fs.statSync(resolvedPath);
      if (!stat.isDirectory()) {
        return error(
          `"${resolvedPath}" is a file, not a directory. Use readFile instead.`,
          { domain: "os", path: resolvedPath },
        );
      }

      // Read directory entries
      let rawEntries: string[];
      try {
        rawEntries = fs.readdirSync(resolvedPath);
      } catch {
        return error(
          `Permission denied: cannot read directory "${resolvedPath}".`,
          { domain: "os", path: resolvedPath },
        );
      }

      // Filter hidden files if not requested
      if (!showHidden) {
        rawEntries = rawEntries.filter((name) => !name.startsWith("."));
      }

      const totalEntries = rawEntries.length;
      const truncated = totalEntries > MAX_ENTRIES;
      const entriesToProcess = rawEntries.slice(0, MAX_ENTRIES);

      // Build structured entries
      const entries: DirEntry[] = [];
      for (const name of entriesToProcess) {
        const entryPath = path.join(resolvedPath, name);
        try {
          const entryStat = fs.lstatSync(entryPath);
          let type: DirEntry["type"] = "other";
          if (entryStat.isFile()) type = "file";
          else if (entryStat.isDirectory()) type = "directory";
          else if (entryStat.isSymbolicLink()) type = "symlink";

          entries.push({
            name,
            type,
            size: entryStat.size,
            modified: entryStat.mtime.toISOString(),
          });
        } catch {
          // Skip entries we can't stat (broken symlinks, permission issues)
          entries.push({
            name,
            type: "other",
            size: 0,
            modified: "",
          });
        }
      }

      // Sort: directories first, then files, alphabetically within each
      entries.sort((a, b) => {
        if (a.type === "directory" && b.type !== "directory") return -1;
        if (a.type !== "directory" && b.type === "directory") return 1;
        return a.name.localeCompare(b.name);
      });

      const dirCount = entries.filter((e) => e.type === "directory").length;
      const fileCount = entries.filter((e) => e.type === "file").length;

      const summary = truncated
        ? `Directory "${path.basename(resolvedPath)}" contains ${totalEntries} entries (showing first ${MAX_ENTRIES}): ${dirCount} directories, ${fileCount} files.`
        : `Directory "${path.basename(resolvedPath)}" contains ${totalEntries} entries: ${dirCount} directories, ${fileCount} files.`;

      return success<ListDirectoryData>(
        {
          path: resolvedPath,
          entries,
          totalEntries,
          truncated,
        },
        summary,
        {
          domain: "os",
          path: resolvedPath,
          truncated,
        },
        {
          suggestions: ["readFile", "searchFiles"],
        },
      );
    });
  },
});
