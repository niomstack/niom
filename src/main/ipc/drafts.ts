/**
 * Drafts IPC Handlers
 *
 * Handles renderer ↔ main IPC for artifact draft management.
 * - drafts:apply   — write a staged draft to disk
 * - drafts:applyAll — batch apply all drafts in a thread
 * - drafts:discard  — remove a draft without writing
 * - drafts:get      — read a draft's content (for preview)
 * - drafts:update   — save user edits to a draft
 */

import { ipcMain } from "electron";
import * as fs from "fs";
import * as path from "path";
import { PATHS } from "../services/config.service";
import type { ArtifactData } from "../tools/propose-artifact";

// ─── Helpers ─────────────────────────────────────────────────────────

function getDraftPath(threadId: string, artifactId: string): string {
  return path.join(PATHS.DRAFTS_DIR, threadId, `${artifactId}.json`);
}

function readDraft(threadId: string, artifactId: string): ArtifactData | null {
  try {
    const raw = fs.readFileSync(getDraftPath(threadId, artifactId), "utf-8");
    return JSON.parse(raw) as ArtifactData;
  } catch {
    return null;
  }
}

function deleteDraft(threadId: string, artifactId: string): void {
  try {
    fs.unlinkSync(getDraftPath(threadId, artifactId));
  } catch {
    // Already deleted or doesn't exist
  }
}

function writeDraftFile(draft: ArtifactData): { bytesWritten: number; created: boolean } {
  const dir = path.dirname(draft.targetPath);
  fs.mkdirSync(dir, { recursive: true });

  const existed = fs.existsSync(draft.targetPath);
  fs.writeFileSync(draft.targetPath, draft.content, "utf-8");

  return {
    bytesWritten: Buffer.byteLength(draft.content, "utf-8"),
    created: !existed,
  };
}

// ─── IPC Registration ────────────────────────────────────────────────

export function registerDraftsIPC(): void {
  // Get a single draft's content
  ipcMain.handle("drafts:get", async (_event, threadId: string, artifactId: string) => {
    const draft = readDraft(threadId, artifactId);
    if (!draft) {
      return { success: false, error: "Draft not found" };
    }
    return { success: true, data: draft };
  });

  // Update draft content (user edited in Monaco)
  ipcMain.handle("drafts:update", async (_event, threadId: string, artifactId: string, newContent: string) => {
    const draft = readDraft(threadId, artifactId);
    if (!draft) {
      return { success: false, error: "Draft not found" };
    }

    draft.content = newContent;
    fs.writeFileSync(getDraftPath(threadId, artifactId), JSON.stringify(draft, null, 2));
    return { success: true };
  });

  // Apply a single draft — write to disk and remove draft
  ipcMain.handle("drafts:apply", async (_event, threadId: string, artifactId: string) => {
    const draft = readDraft(threadId, artifactId);
    if (!draft) {
      return { success: false, error: "Draft not found" };
    }

    try {
      const result = writeDraftFile(draft);
      deleteDraft(threadId, artifactId);
      return {
        success: true,
        data: {
          path: draft.targetPath,
          bytesWritten: result.bytesWritten,
          created: result.created,
        },
      };
    } catch (err) {
      return { success: false, error: `Failed to write: ${(err as Error).message}` };
    }
  });

  // Apply all drafts for a thread
  ipcMain.handle("drafts:applyAll", async (_event, threadId: string) => {
    const draftsDir = path.join(PATHS.DRAFTS_DIR, threadId);
    if (!fs.existsSync(draftsDir)) {
      return { success: true, data: { applied: 0, results: [] } };
    }

    const files = fs.readdirSync(draftsDir).filter((f) => f.endsWith(".json"));
    const results: Array<{ artifactId: string; path: string; created: boolean; error?: string }> = [];

    for (const file of files) {
      const artifactId = file.replace(".json", "");
      const draft = readDraft(threadId, artifactId);
      if (!draft) continue;

      try {
        const result = writeDraftFile(draft);
        deleteDraft(threadId, artifactId);
        results.push({ artifactId, path: draft.targetPath, created: result.created });
      } catch (err) {
        results.push({ artifactId, path: draft.targetPath, created: false, error: (err as Error).message });
      }
    }

    return { success: true, data: { applied: results.length, results } };
  });

  // Discard a single draft
  ipcMain.handle("drafts:discard", async (_event, threadId: string, artifactId: string) => {
    deleteDraft(threadId, artifactId);
    return { success: true };
  });

  // Discard all drafts for a thread
  ipcMain.handle("drafts:discardAll", async (_event, threadId: string) => {
    const draftsDir = path.join(PATHS.DRAFTS_DIR, threadId);
    if (fs.existsSync(draftsDir)) {
      fs.rmSync(draftsDir, { recursive: true, force: true });
    }
    return { success: true };
  });
}
