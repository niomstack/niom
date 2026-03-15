import { app, BrowserWindow, nativeImage } from "electron";
import * as path from "path";

import { registerWindowIpc } from "./ipc/window";
import { registerConfigIpc } from "./ipc/config";
import { registerChatIpc } from "./ipc/chat";
import { registerThreadsIpc } from "./ipc/threads";
import { registerMemoryIpc } from "./ipc/memory";
import { registerDraftsIPC } from "./ipc/drafts";
import { registerTasksIpc } from "./ipc/tasks";
import { registerVoiceIpc } from "./ipc/voice";

import { initDataDirectories } from "./services/config.service";
import { registerGlobalHotkey, unregisterGlobalHotkeys } from "./services/hotkey.service";
import { createTray, destroyTray } from "./services/tray.service";
import { initializeSkillGraph } from "./skills/graph";
import { flushEdgeLearning } from "./skills/edge-learning";
import { initializeNCF, buildL0Index } from "./context/ncf";
import { initTasksDir } from "./tasks/task-store";
import { scanForProjects } from "./context/project-scanner";
import { loadTrustStore } from "./tools/trust";
import { initAutoUpdater } from "./services/updater.service";

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

const createWindow = (): void => {
  // Resolve app icon — __dirname is .webpack/main/ in dev, so use process.cwd()
  const resourcesBase = app.isPackaged
    ? path.join(process.resourcesPath)
    : process.cwd();
  const iconPath = path.join(resourcesBase, "resources", "niom-logo.png");
  const icon = nativeImage.createFromPath(iconPath);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 680,
    minHeight: 500,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#1e1b2e", // matches dark background
    icon,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  // Grant microphone permission for voice input
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      // Allow microphone access for voice input (Whisper transcription)
      if (permission === "media") {
        callback(true);
        return;
      }
      // Deny everything else by default
      callback(false);
    },
  );

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

// ─── Register all IPC handlers ──────────────────────────────────────

registerWindowIpc(getMainWindow);
registerConfigIpc();
registerChatIpc(getMainWindow);
registerThreadsIpc(getMainWindow);
registerMemoryIpc();
registerDraftsIPC();
registerTasksIpc(getMainWindow);
registerVoiceIpc();


// ─── App lifecycle ──────────────────────────────────────────────────

app.on("ready", () => {
  initDataDirectories();
  initTasksDir();
  createWindow();

  // Register global hotkey (Option+Space) — Spotlight-like toggle
  registerGlobalHotkey(getMainWindow);

  // Create system tray icon and menu
  createTray(getMainWindow);

  // Set macOS dock icon
  if (process.platform === "darwin") {
    const dockBase = app.isPackaged
      ? path.join(process.resourcesPath)
      : process.cwd();
    const dockIconPath = path.join(dockBase, "resources", "niom-logo.png");
    const dockIcon = nativeImage.createFromPath(dockIconPath);
    if (!dockIcon.isEmpty()) {
      app.dock?.setIcon(dockIcon);
    }
  }

  // Initialize NIOM Context Filesystem (NCF) — creates directory structure + L0 index.
  try {
    initializeNCF();
    buildL0Index();
  } catch (error) {
    console.error("[main] NCF initialization failed:", error);
  }

  // Initialize Skill Graph async — non-blocking.
  // Loads cached graph or builds from built-in packs (downloads model on first run).
  initializeSkillGraph().catch((error) => {
    console.error("[main] Skill Graph initialization failed:", error);
  });

  // Load persisted trust entries from disk.
  loadTrustStore();

  // Scan for workspace projects async — indexes tech stacks and conventions.
  scanForProjects().catch((error) => {
    console.error("[main] Project scanning failed:", error);
  });

  // Initialize auto-updater (only in packaged builds)
  if (app.isPackaged) {
    initAutoUpdater();
  }
});

app.on("window-all-closed", () => {
  // Flush any pending edge learning updates before quitting
  flushEdgeLearning();
  unregisterGlobalHotkeys();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  unregisterGlobalHotkeys();
  destroyTray();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
