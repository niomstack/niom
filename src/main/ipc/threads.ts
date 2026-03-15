import { ipcMain, BrowserWindow } from "electron";
import { listThreads, getThread, saveThread, deleteThread, generateLLMTitle } from "../services/thread.service";
import { deleteTasksByThread } from "../tasks/task-store";
import { writeThreadDigest } from "../context/thread-digest";
import { resolveModel } from "../services/chat.service";
import type { Thread } from "@/shared/types";

/** Register thread-related IPC handlers. */
export function registerThreadsIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("threads:list", async () => {
    return listThreads();
  });

  ipcMain.handle("threads:get", async (_event, id: string) => {
    return getThread(id);
  });

  ipcMain.handle("threads:save", async (_event, thread: Thread) => {
    saveThread(thread);
  });

  ipcMain.handle("threads:delete", async (_event, id: string) => {
    // Cascade: delete any tasks belonging to this thread first
    deleteTasksByThread(id);
    deleteThread(id);
  });

  // Fire-and-forget: generate/update thread digest when user navigates away.
  // Uses LLM distillation when available, falls back to heuristic extraction.
  ipcMain.on("threads:digest", (_event, data: { thread: Thread; model?: string }) => {
    const { thread, model: modelId } = data;
    // Run in background — don't block the UI
    (async () => {
      try {
        let model;
        if (modelId) {
          try {
            model = resolveModel(modelId);
          } catch {
            // Model resolution failed, use heuristic
          }
        }
        await writeThreadDigest(thread, model);
      } catch (error) {
        console.warn("[threads] Digest generation failed:", error);
      }
    })();
  });

  // Fire-and-forget: generate an LLM-powered thread title.
  // Triggered after 2+ messages. Sends threads:titleUpdated back to renderer.
  ipcMain.on("threads:generateTitle", (_event, data: { thread: Thread; model?: string }) => {
    const { thread, model: modelId } = data;
    (async () => {
      try {
        let model;
        if (modelId) {
          try {
            model = resolveModel(modelId);
          } catch {
            return;
          }
        }
        if (!model) return;

        const title = await generateLLMTitle(thread, model);
        if (title) {
          // Update the thread on disk
          const latest = getThread(thread.id);
          if (latest) {
            latest.title = title;
            latest.llmTitleGenerated = true;
            saveThread(latest);
          }

          // Notify the renderer
          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send("threads:titleUpdated", {
              threadId: thread.id,
              title,
            });
          }
          console.log(`[threads] LLM title for ${thread.id}: "${title}"`);
        }
      } catch (error) {
        console.warn("[threads] LLM title generation failed:", error);
      }
    })();
  });
}
