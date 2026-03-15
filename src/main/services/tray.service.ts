/**
 * System Tray — Quick access to NIOM from the menu bar.
 *
 * Features:
 *   - Tray icon with tooltip showing running task count
 *   - Context menu:
 *     - New Thread
 *     - Recent Threads (last 5)
 *     - Running Tasks (with submenu)
 *     - Settings
 *     - Quit NIOM
 *   - Dynamic updates when tasks start/complete
 *   - Click-to-show toggle
 *
 * On macOS, the tray icon sits in the menu bar.
 * The menu rebuilds whenever refreshTrayMenu() is called.
 */

import { Tray, Menu, nativeImage, BrowserWindow, app } from "electron";
import * as path from "path";
import { listThreads } from "../services/thread.service";
import { listTasks } from "../tasks/task-store";
import type { TaskMeta } from "@/shared/task-types";

// ─── State ───────────────────────────────────────────────────────────

let tray: Tray | null = null;
let getWindowFn: (() => BrowserWindow | null) | null = null;

// ─── Icon Loading ───────────────────────────────────────────────────

function loadTrayIcon(): Electron.NativeImage {
  const resourcesBase = app.isPackaged
    ? path.join(process.resourcesPath)
    : process.cwd();
  const iconPath = path.join(resourcesBase, "resources", "niom-logo.png");
  const icon = nativeImage.createFromPath(iconPath);

  // macOS tray icons should be ~22px (template images for dark/light menu bar)
  // Resize to appropriate tray size
  return icon.resize({ width: 18, height: 18 });
}

// ─── Menu Building ──────────────────────────────────────────────────

/**
 * Build and set the tray context menu.
 * Called on init and whenever state changes (task updates, etc.).
 */
function buildTrayMenu(): void {
  if (!tray || !getWindowFn) return;

  const win = getWindowFn();

  // Fetch recent threads (last 5)
  let recentThreads: Array<{ id: string; title: string; updatedAt: number }> = [];
  try {
    const threads = listThreads();
    recentThreads = threads
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5);
  } catch {
    // Silent fail — threads might not be loaded yet
  }

  // Fetch running/pending tasks
  let activeTasks: TaskMeta[] = [];
  try {
    activeTasks = listTasks({ status: ["running", "paused"] });
  } catch {
    // Silent fail
  }

  // Build the menu
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    // ── New Thread ──
    {
      label: "New Thread",
      accelerator: "CmdOrCtrl+N",
      click: () => {
        if (win) {
          win.show();
          win.focus();
          win.webContents.send("tray:navigate", { view: "home", action: "newThread" });
        }
      },
    },
    { type: "separator" },

    // ── Recent Threads ──
    ...(recentThreads.length > 0
      ? [
          {
            label: "Recent Threads",
            submenu: recentThreads.map((thread) => ({
              label: thread.title.length > 40
                ? thread.title.slice(0, 40) + "…"
                : thread.title,
              click: () => {
                if (win) {
                  win.show();
                  win.focus();
                  win.webContents.send("tray:navigate", {
                    view: "chat",
                    threadId: thread.id,
                  });
                }
              },
            })) as Electron.MenuItemConstructorOptions[],
          } as Electron.MenuItemConstructorOptions,
        ]
      : [
          { label: "No recent threads", enabled: false } as Electron.MenuItemConstructorOptions,
        ]),
    { type: "separator" },

    // ── Running Tasks ──
    ...(activeTasks.length > 0
      ? [
          {
            label: `Tasks (${activeTasks.length} active)`,
            submenu: activeTasks.map((task) => {
              const statusIcon = task.status === "running" ? "⚡" : "⏸";
              const progress = task.toolCallCount > 0
                ? ` (${task.toolCallCount} calls)`
                : "";
              return {
                label: `${statusIcon} ${task.goal.length > 35 ? task.goal.slice(0, 35) + "…" : task.goal}${progress}`,
                click: () => {
                  if (win) {
                    win.show();
                    win.focus();
                    win.webContents.send("tray:navigate", {
                      view: "chat",
                      threadId: task.threadId,
                      taskId: task.id,
                    });
                  }
                },
              };
            }) as Electron.MenuItemConstructorOptions[],
          } as Electron.MenuItemConstructorOptions,
        ]
      : [
          { label: "No active tasks", enabled: false } as Electron.MenuItemConstructorOptions,
        ]),
    { type: "separator" },

    // ── Settings ──
    {
      label: "Settings",
      accelerator: "CmdOrCtrl+,",
      click: () => {
        if (win) {
          win.show();
          win.focus();
          win.webContents.send("tray:navigate", { view: "settings" });
        }
      },
    },
    { type: "separator" },

    // ── Show / Hide ──
    {
      label: win?.isVisible() ? "Hide NIOM" : "Show NIOM",
      click: () => {
        if (win) {
          if (win.isVisible()) {
            win.hide();
          } else {
            win.show();
            win.focus();
          }
        }
      },
    },

    // ── Quit ──
    {
      label: "Quit NIOM",
      accelerator: "CmdOrCtrl+Q",
      click: () => {
        app.quit();
      },
    },
  ];

  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  tray.setContextMenu(contextMenu);

  // Update tooltip
  const taskCount = activeTasks.length;
  const tooltip = taskCount > 0
    ? `NIOM — ${taskCount} task${taskCount === 1 ? "" : "s"} running`
    : "NIOM";
  tray.setToolTip(tooltip);
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Create the system tray icon and menu.
 * Called once from app.ready.
 */
export function createTray(getMainWindow: () => BrowserWindow | null): void {
  getWindowFn = getMainWindow;

  const icon = loadTrayIcon();
  tray = new Tray(icon);

  // Click behavior: show/focus the window
  tray.on("click", () => {
    const win = getMainWindow();
    if (win) {
      if (win.isVisible() && win.isFocused()) {
        win.hide();
      } else {
        win.show();
        win.focus();
      }
    }
  });

  // Build initial menu
  buildTrayMenu();

  console.log("[tray] System tray created");
}

/**
 * Refresh the tray menu (call after task state changes).
 */
export function refreshTrayMenu(): void {
  buildTrayMenu();
}

/**
 * Destroy the tray icon.
 */
export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
