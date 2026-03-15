/**
 * read Tool — Unified File/Directory Reader
 *
 * Smart reader that auto-detects whether the path is a file or directory
 * and returns the appropriate result. No more "use listDirectory instead" errors.
 *
 * The LLM can use this tool in a loop — e.g. read path → it's a dir → 
 * read same path (gets dir listing) → pick a file → read file. All with
 * one tool, self-correcting via structured output.
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

/** Maximum file size to read (100KB). */
const MAX_FILE_SIZE = 100 * 1024;

/** Maximum directory entries to return. */
const MAX_ENTRIES = 100;

// ─── Types ───────────────────────────────────────────────────────────

interface DirEntry {
  name: string;
  type: "file" | "dir" | "symlink" | "other";
  size: number;
}

interface ReadFileResult {
  kind: "file";
  path: string;
  content: string;
  size: number;
  lines: number;
  extension: string;
  truncated: boolean;
}

interface ReadDirResult {
  kind: "directory";
  path: string;
  entries: DirEntry[];
  totalEntries: number;
  truncated: boolean;
  summary: string;
}

type ReadResult = ReadFileResult | ReadDirResult;

// ─── Tool Definition ─────────────────────────────────────────────────

export const readTool = tool({
  description:
    "Read a file or list a directory. Automatically detects the type.\n" +
    "- If path is a file: returns the file contents as text.\n" +
    "- If path is a directory: returns the listing of entries.\n" +
    "- Use lineStart/lineEnd to read a specific range of a large file.\n" +
    "Scoped to the user's home directory.",
  inputSchema: z.object({
    path: z.string().describe(
      "Absolute or relative path to read. Relative paths resolve from the user's home directory.",
    ),
    lineStart: z.number().optional().describe(
      "Start line (1-indexed) for partial file reads. Only applies to files.",
    ),
    lineEnd: z.number().optional().describe(
      "End line (1-indexed, inclusive) for partial file reads. Only applies to files.",
    ),
    showHidden: z.boolean().optional().default(false).describe(
      "Include hidden files/dirs (starting with .) when listing directories.",
    ),
  }),
  execute: async (input): Promise<SkillResult<ReadResult | null>> => {
    return timed(async () => {
      const inputPath = input.path;
      const homeDir = getHomeDir();
      const resolvedPath = validatePath(inputPath, homeDir);

      if (!resolvedPath) {
        return error(
          `Path "${inputPath}" is outside your home directory.`,
          { domain: "os", path: inputPath },
        );
      }

      if (!fs.existsSync(resolvedPath)) {
        return error(
          `Not found: "${resolvedPath}". Check the path and try again.`,
          { domain: "os", path: resolvedPath },
        );
      }

      const stat = fs.statSync(resolvedPath);

      // ── Directory ────────────────────────────────────────────────
      if (stat.isDirectory()) {
        return readDirectory(resolvedPath, input.showHidden ?? false);
      }

      // ── File ─────────────────────────────────────────────────────
      if (stat.isFile()) {
        return readFile(resolvedPath, stat.size, input.lineStart, input.lineEnd);
      }

      return error(
        `"${resolvedPath}" is not a regular file or directory.`,
        { domain: "os", path: resolvedPath },
      );
    });
  },
});

// ─── Readers ─────────────────────────────────────────────────────────

function readDirectory(
  resolvedPath: string,
  showHidden: boolean,
): SkillResult<ReadResult | null> {
  let rawEntries: string[];
  try {
    rawEntries = fs.readdirSync(resolvedPath);
  } catch {
    return error(
      `Permission denied: cannot read "${resolvedPath}".`,
      { domain: "os", path: resolvedPath },
    );
  }

  if (!showHidden) {
    rawEntries = rawEntries.filter((n) => !n.startsWith("."));
  }

  const totalEntries = rawEntries.length;
  const truncated = totalEntries > MAX_ENTRIES;
  const slice = rawEntries.slice(0, MAX_ENTRIES);

  const entries: DirEntry[] = [];
  for (const name of slice) {
    try {
      const s = fs.lstatSync(path.join(resolvedPath, name));
      let type: DirEntry["type"] = "other";
      if (s.isFile()) type = "file";
      else if (s.isDirectory()) type = "dir";
      else if (s.isSymbolicLink()) type = "symlink";
      entries.push({ name, type, size: s.size });
    } catch {
      entries.push({ name, type: "other", size: 0 });
    }
  }

  // Sort: dirs first, then files
  entries.sort((a, b) => {
    if (a.type === "dir" && b.type !== "dir") return -1;
    if (a.type !== "dir" && b.type === "dir") return 1;
    return a.name.localeCompare(b.name);
  });

  const dirs = entries.filter((e) => e.type === "dir").length;
  const files = entries.filter((e) => e.type === "file").length;
  const summary = `${dirs} directories, ${files} files${truncated ? ` (showing first ${MAX_ENTRIES} of ${totalEntries})` : ""}`;

  return success<ReadDirResult>(
    { kind: "directory", path: resolvedPath, entries, totalEntries, truncated, summary },
    `📁 ${path.basename(resolvedPath)}/  — ${summary}`,
    { domain: "os", path: resolvedPath },
  );
}

function readFile(
  resolvedPath: string,
  fileSize: number,
  lineStart?: number,
  lineEnd?: number,
): SkillResult<ReadResult | null> {
  const extension = path.extname(resolvedPath).slice(1) || "txt";
  const basename = path.basename(resolvedPath);

  // Full read (with size limit)
  if (!lineStart && !lineEnd) {
    if (fileSize > MAX_FILE_SIZE) {
      const fd = fs.openSync(resolvedPath, "r");
      const buffer = Buffer.alloc(MAX_FILE_SIZE);
      fs.readSync(fd, buffer, 0, MAX_FILE_SIZE, 0);
      fs.closeSync(fd);

      const content = buffer.toString("utf-8");
      const lines = content.split("\n").length;

      return partial<ReadFileResult>(
        { kind: "file", path: resolvedPath, content, size: fileSize, lines, extension, truncated: true },
        `📄 ${basename} (${fmtSize(fileSize)}) — showing first ${fmtSize(MAX_FILE_SIZE)}. Use lineStart/lineEnd for a specific range.`,
        { domain: "os", path: resolvedPath, truncated: true },
        { confidence: 0.7 },
      );
    }

    const content = fs.readFileSync(resolvedPath, "utf-8");
    const lines = content.split("\n").length;

    return success<ReadFileResult>(
      { kind: "file", path: resolvedPath, content, size: fileSize, lines, extension, truncated: false },
      `📄 ${basename} (${fmtSize(fileSize)}, ${lines} lines)`,
      { domain: "os", path: resolvedPath },
    );
  }

  // Line-range read
  const content = fs.readFileSync(resolvedPath, "utf-8");
  const allLines = content.split("\n");
  const start = Math.max(1, lineStart || 1) - 1; // 0-indexed
  const end = Math.min(allLines.length, lineEnd || allLines.length);
  const slice = allLines.slice(start, end).join("\n");

  return success<ReadFileResult>(
    { kind: "file", path: resolvedPath, content: slice, size: fileSize, lines: end - start, extension, truncated: true },
    `📄 ${basename} — lines ${start + 1}–${end} of ${allLines.length}`,
    { domain: "os", path: resolvedPath },
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
