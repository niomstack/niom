/**
 * Global Hotkey — Option+Space Spotlight Overlay
 *
 * Registers a system-wide hotkey (Option+Space) that:
 *   1. Captures the currently active window (app name + window title)
 *   2. Shows and focuses NIOM
 *   3. Sends the active window context to the renderer
 *
 * Toggle behavior (like Spotlight):
 *   - NIOM hidden/unfocused → show + focus + send context
 *   - NIOM focused → hide
 *
 * Active window detection:
 *   - macOS: AppleScript via osascript (frontmost app + window title)
 *   - Windows: Not yet implemented (falls back to no context)
 *   - Linux: Not yet implemented (falls back to no context)
 */

import { globalShortcut, BrowserWindow } from "electron";
import { execSync } from "child_process";

// ─── Types ───────────────────────────────────────────────────────────

export interface ActiveWindowContext {
  /** Name of the application (e.g. "Visual Studio Code", "Safari") */
  appName: string;
  /** Window title (often contains file path or page title) */
  windowTitle: string;
  /** Timestamp when the context was captured */
  capturedAt: number;
}

// ─── Active Window Detection ────────────────────────────────────────

/**
 * Get the currently active window's app name and title.
 * Uses platform-specific methods.
 */
function getActiveWindowContext(): ActiveWindowContext | null {
  try {
    if (process.platform === "darwin") {
      return getActiveWindowMac();
    }
    // Windows/Linux — not yet implemented
    return null;
  } catch (error) {
    console.warn("[hotkey] Failed to get active window:", error);
    return null;
  }
}

/**
 * macOS: Get frontmost app name and window title via AppleScript.
 * Uses osascript for reliable detection without native dependencies.
 */
function getActiveWindowMac(): ActiveWindowContext | null {
  try {
    // Get frontmost application name
    const appName = execSync(
      'osascript -e \'tell application "System Events" to get name of first application process whose frontmost is true\'',
      { timeout: 1000, encoding: "utf-8" },
    ).trim();

    // Get the window title of the frontmost app
    let windowTitle = "";
    try {
      windowTitle = execSync(
        `osascript -e 'tell application "System Events" to get title of front window of (first application process whose frontmost is true)'`,
        { timeout: 1000, encoding: "utf-8" },
      ).trim();
    } catch {
      // Some apps don't expose window titles (e.g. Finder with no windows)
    }

    // Skip if NIOM itself was the frontmost app
    if (appName === "Electron" || appName === "NIOM") {
      return null;
    }

    return {
      appName,
      windowTitle,
      capturedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

// ─── Hotkey Registration ────────────────────────────────────────────

/**
 * Register the global Option+Space hotkey.
 * Must be called after app.whenReady().
 *
 * @param getMainWindow - Function to get the main BrowserWindow
 */
export function registerGlobalHotkey(
  getMainWindow: () => BrowserWindow | null,
): void {
  const accelerator = "Alt+Space";

  const success = globalShortcut.register(accelerator, () => {
    const win = getMainWindow();
    if (!win) return;

    if (win.isFocused() && win.isVisible()) {
      // NIOM is focused → hide it (toggle off)
      win.hide();
    } else {
      // Capture active window context BEFORE showing NIOM
      const context = getActiveWindowContext();

      // Show and focus NIOM
      if (win.isMinimized()) {
        win.restore();
      }
      win.show();
      win.focus();

      // Send context to renderer
      if (context) {
        win.webContents.send("hotkey:activated", context);
        console.log(`[hotkey] Activated from: ${context.appName} — "${context.windowTitle}"`);
      } else {
        win.webContents.send("hotkey:activated", null);
      }
    }
  });

  if (success) {
    console.log(`[hotkey] Registered global shortcut: ${accelerator}`);
  } else {
    console.warn(`[hotkey] Failed to register global shortcut: ${accelerator} — may be in use by another app`);
  }
}

/**
 * Unregister all global shortcuts.
 * Called on app quit to clean up.
 */
export function unregisterGlobalHotkeys(): void {
  globalShortcut.unregisterAll();
}
