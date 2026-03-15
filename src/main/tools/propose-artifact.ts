/**
 * proposeArtifact Tool
 *
 * Stages a file draft for user review before writing to disk.
 * The draft is saved in ~/.niom/drafts/{threadId}/ and rendered
 * as a rich preview card in the chat. The user can review, edit
 * inline (via Monaco), then apply or skip.
 *
 * This tool does NOT modify the user's filesystem — it only
 * creates a staging draft. No needsApproval required.
 *
 * Pack: OS (primitive)
 * Approval: auto (read-only staging)
 */

import { tool } from "ai";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import type { SkillResult } from "@/shared/skill-types";
import { success, error, timed } from "./helpers";
import { PATHS } from "../services/config.service";

/** Detect language from file extension for syntax highlighting */
function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".md": "markdown",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".sql": "sql",
    ".toml": "toml",
    ".xml": "xml",
    ".svg": "xml",
    ".txt": "plaintext",
    ".env": "plaintext",
    ".gitignore": "plaintext",
    ".dockerfile": "dockerfile",
  };
  // Also check basename for extensionless files
  const basename = path.basename(filePath).toLowerCase();
  if (basename === "dockerfile") return "dockerfile";
  if (basename === "makefile") return "makefile";

  return langMap[ext] || "plaintext";
}

/** Data returned by proposeArtifact on success. */
export interface ArtifactData {
  /** Unique artifact ID for IPC reference */
  artifactId: string;
  /** Target file path (where it would be written on Apply) */
  targetPath: string;
  /** File content */
  content: string;
  /** Detected or specified language for syntax highlighting */
  language: string;
  /** Short description of the file */
  description: string;
  /** Whether the target file already exists (modification vs creation) */
  isModification: boolean;
  /** Original content if modifying an existing file (for diff view) */
  originalContent?: string;
  /** The thread ID this draft belongs to */
  threadId: string;
}

export const proposeArtifactTool = tool({
  description:
    "Stage a file for user review before writing to disk. Creates a rich preview card " +
    "in the chat where the user can review, edit, then apply. Use this for creating new " +
    "files or making significant changes. For small edits (fixing a typo, adding a line), " +
    "use writeFile directly instead.",
  inputSchema: z.object({
    path: z.string().describe(
      "Target file path (absolute or relative to home). This is where the file will be written when the user clicks Apply.",
    ),
    content: z.string().describe("The full file content to propose."),
    description: z.string().describe(
      "Brief description of the file (e.g. 'Project README', 'TypeScript config', 'Express server entry point').",
    ),
    threadId: z.string().describe(
      "The current thread ID. Used to scope the draft to the conversation.",
    ),
  }),
  // No needsApproval — this is staging only, not a write operation
  execute: async (input): Promise<SkillResult<ArtifactData | null>> => {
    return timed(async () => {
      try {
        const { content, description, threadId } = input;
        const homeDir = require("os").homedir();
        const targetPath = path.isAbsolute(input.path)
          ? input.path
          : path.resolve(homeDir, input.path);

        // Check if it's a modification of an existing file
        let isModification = false;
        let originalContent: string | undefined;
        try {
          originalContent = fs.readFileSync(targetPath, "utf-8");
          isModification = true;
        } catch {
          // File doesn't exist — new creation
        }

        // Generate unique artifact ID
        const artifactId = `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // Detect language
        const language = detectLanguage(targetPath);

        // Stage the draft
        const draftsDir = path.join(PATHS.DRAFTS_DIR, threadId);
        console.log("[proposeArtifact] Staging to:", draftsDir);
        fs.mkdirSync(draftsDir, { recursive: true });

        const draftData: ArtifactData = {
          artifactId,
          targetPath,
          content,
          language,
          description,
          isModification,
          originalContent,
          threadId,
        };

        fs.writeFileSync(
          path.join(draftsDir, `${artifactId}.json`),
          JSON.stringify(draftData, null, 2),
        );

        console.log("[proposeArtifact] Staged:", artifactId, path.basename(targetPath));

        return success(
          draftData,
          `Staged: ${path.basename(targetPath)} — ${description}`,
          { domain: "os" },
        );
      } catch (err) {
        console.error("[proposeArtifact] Error:", err);
        return error(
          `Failed to stage artifact: ${(err as Error).message}`,
          { domain: "os" },
        );
      }
    });
  },
});
