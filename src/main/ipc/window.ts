import { ipcMain, BrowserWindow, shell } from "electron";

/** Register all window-related IPC handlers */
export function registerWindowIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.on("window:minimize", () => getMainWindow()?.minimize());

  ipcMain.on("window:maximize", () => {
    const win = getMainWindow();
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.on("window:close", () => getMainWindow()?.close());

  ipcMain.handle("window:isMaximized", () => getMainWindow()?.isMaximized() ?? false);

  ipcMain.handle("window:platform", () => process.platform);

  // ─── Shell helpers ───────────────────────────────────────────────
  ipcMain.handle("shell:openPath", async (_event, filePath: string) => {
    return shell.showItemInFolder(filePath);
  });

  ipcMain.handle("shell:openUrl", async (_event, url: string) => {
    // Only allow http/https URLs
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return shell.openExternal(url);
    }
  });
}
