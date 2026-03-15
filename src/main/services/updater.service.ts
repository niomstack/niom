/**
 * Auto-Updater Service — Checks for updates via GitHub Releases.
 *
 * Uses electron-updater with GitHub as the update provider.
 * Updates are downloaded in the background and installed on quit.
 *
 * Emits IPC events to renderer:
 *   - updater:status → { status, version?, progress?, error? }
 */

import { autoUpdater, type UpdateInfo } from "electron-updater";
import { ipcMain, BrowserWindow } from "electron";

// ─── Setup ───────────────────────────────────────────────────────────

/** Configure and start the auto-updater. */
export function initAutoUpdater(): void {
  // Don't auto-download — let user decide
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // ── Event handlers ──────────────────────────────────────────────

  autoUpdater.on("checking-for-update", () => {
    broadcastStatus("checking");
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    broadcastStatus("available", info.version);
    console.log(`[updater] Update available: v${info.version}`);
  });

  autoUpdater.on("update-not-available", () => {
    broadcastStatus("up-to-date");
  });

  autoUpdater.on("download-progress", (progress) => {
    broadcastStatus("downloading", undefined, Math.round(progress.percent));
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    broadcastStatus("ready", info.version);
    console.log(`[updater] Update downloaded: v${info.version}`);
  });

  autoUpdater.on("error", (err) => {
    broadcastStatus("error", undefined, undefined, err.message);
    console.error("[updater] Error:", err.message);
  });

  // ── IPC handlers ────────────────────────────────────────────────

  ipcMain.handle("updater:check", async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo?.version ?? null;
    } catch (err) {
      console.error("[updater] Check failed:", err);
      return null;
    }
  });

  ipcMain.handle("updater:download", async () => {
    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch (err) {
      console.error("[updater] Download failed:", err);
      return false;
    }
  });

  ipcMain.handle("updater:install", () => {
    autoUpdater.quitAndInstall(false, true);
  });

  // ── Initial check (after 10s delay) ─────────────────────────────

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Silently fail — user can manually check
    });
  }, 10_000);
}

// ─── Helpers ─────────────────────────────────────────────────────────

type UpdateStatus = "checking" | "available" | "up-to-date" | "downloading" | "ready" | "error";

function broadcastStatus(
  status: UpdateStatus,
  version?: string,
  progress?: number,
  error?: string,
): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("updater:status", { status, version, progress, error });
  });
}
