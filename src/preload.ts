import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("niom", {
  // ─── Window Controls ────────────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
    platform: () => ipcRenderer.invoke("window:platform"),
    version: () => ipcRenderer.invoke("app:version") as Promise<string>,
  },

  // ─── Shell Helpers ──────────────────────────────────────────────
  shell: {
    openPath: (filePath: string) => ipcRenderer.invoke("shell:openPath", filePath),
    openUrl: (url: string) => ipcRenderer.invoke("shell:openUrl", url),
  },

  // ─── Hotkey ─────────────────────────────────────────────────────
  hotkey: {
    /** Listen for global hotkey activation with active window context */
    onActivated: (callback: (context: { appName: string; windowTitle: string; capturedAt: number } | null) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { appName: string; windowTitle: string; capturedAt: number } | null,
      ) => callback(data);
      ipcRenderer.on("hotkey:activated", handler);
      return () => {
        ipcRenderer.removeListener("hotkey:activated", handler);
      };
    },
  },

  // ─── Tray ───────────────────────────────────────────────────────
  tray: {
    /** Listen for tray menu navigation commands */
    onNavigate: (callback: (data: { view: string; threadId?: string; taskId?: string; action?: string }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { view: string; threadId?: string; taskId?: string; action?: string },
      ) => callback(data);
      ipcRenderer.on("tray:navigate", handler);
      return () => {
        ipcRenderer.removeListener("tray:navigate", handler);
      };
    },
  },

  // ─── Config ─────────────────────────────────────────────────────
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    set: (config: Record<string, unknown>) => ipcRenderer.invoke("config:set", config),
    setApiKey: (provider: string, key: string) =>
      ipcRenderer.invoke("config:setApiKey", { provider, key }),
    getApiKey: (provider: string) => ipcRenderer.invoke("config:getApiKey", provider),
  },

  // ─── Chat Streaming (AI SDK v6 — UIMessageChunk protocol) ───────
  chat: {
    /** Send messages to the agent. Messages are UIMessage[] from useChat. */
    stream: (
      threadId: string,
      messages: unknown[],
      model: string,
      recallEnabled?: boolean,
      taskAwarenessEnabled?: boolean,
    ) => {
      ipcRenderer.send("chat:stream", { threadId, messages, model, recallEnabled, taskAwarenessEnabled });
    },

    /** Receive UIMessageChunk parts from the agent stream */
    onPart: (callback: (data: { threadId: string; chunk: unknown }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { threadId: string; chunk: unknown },
      ) => callback(data);
      ipcRenderer.on("chat:part", handler);
      return () => {
        ipcRenderer.removeListener("chat:part", handler);
      };
    },

    /** Stream completed successfully */
    onDone: (callback: (data: { threadId: string }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { threadId: string },
      ) => callback(data);
      ipcRenderer.on("chat:done", handler);
      return () => {
        ipcRenderer.removeListener("chat:done", handler);
      };
    },

    /** Stream error */
    onError: (callback: (data: { threadId: string; error: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { threadId: string; error: string }) =>
        callback(data);
      ipcRenderer.on("chat:error", handler);
      return () => {
        ipcRenderer.removeListener("chat:error", handler);
      };
    },

    /** Skill routing info (for UI labels) */
    onRoute: (callback: (data: {
      threadId: string;
      label: string;
      primaryDomain: string;
      tools: string[];
      confidence: number;
    }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { threadId: string; label: string; primaryDomain: string; tools: string[]; confidence: number },
      ) => callback(data);
      ipcRenderer.on("chat:route", handler);
      return () => {
        ipcRenderer.removeListener("chat:route", handler);
      };
    },

    /** Agent hit step budget — still had work to do */
    onBudgetReached: (callback: (data: { threadId: string }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { threadId: string },
      ) => callback(data);
      ipcRenderer.on("chat:budget-reached", handler);
      return () => {
        ipcRenderer.removeListener("chat:budget-reached", handler);
      };
    },

    /** Task complexity suggestion — query is complex enough for background task */
    onSuggestTask: (callback: (data: {
      threadId: string;
      query: string;
      score: number;
      reason: string;
    }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { threadId: string; query: string; score: number; reason: string },
      ) => callback(data);
      ipcRenderer.on("chat:suggest-task", handler);
      return () => {
        ipcRenderer.removeListener("chat:suggest-task", handler);
      };
    },

    /** Cancel an active stream */
    cancel: (threadId: string) => ipcRenderer.send("chat:cancel", { threadId }),
  },

  // ─── Threads ────────────────────────────────────────────────────
  threads: {
    list: () => ipcRenderer.invoke("threads:list"),
    get: (id: string) => ipcRenderer.invoke("threads:get", id),
    save: (thread: Record<string, unknown>) => ipcRenderer.invoke("threads:save", thread),
    delete: (id: string) => ipcRenderer.invoke("threads:delete", id),
    /** Fire-and-forget: trigger background thread digest generation */
    digest: (thread: Record<string, unknown>, model?: string) =>
      ipcRenderer.send("threads:digest", { thread, model }),
    /** Fire-and-forget: trigger LLM thread title generation */
    generateTitle: (thread: Record<string, unknown>, model?: string) =>
      ipcRenderer.send("threads:generateTitle", { thread, model }),
    /** Listen for LLM-generated title updates */
    onTitleUpdated: (callback: (data: { threadId: string; title: string }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { threadId: string; title: string },
      ) => callback(data);
      ipcRenderer.on("threads:titleUpdated", handler);
      return () => {
        ipcRenderer.removeListener("threads:titleUpdated", handler);
      };
    },
  },

  // ─── Voice ──────────────────────────────────────────────────────
  voice: {
    /** Transcribe audio buffer using Whisper API */
    transcribe: (audioBuffer: Buffer, mimeType: string): Promise<{ text?: string; error?: string }> =>
      ipcRenderer.invoke("voice:transcribe", audioBuffer, mimeType),
  },

  // ─── Memory ─────────────────────────────────────────────────────
  memory: {
    list: () => ipcRenderer.invoke("memory:list"),
    get: (memoryPath: string) => ipcRenderer.invoke("memory:get", memoryPath),
    update: (memoryPath: string, content: string) => ipcRenderer.invoke("memory:update", memoryPath, content),
    delete: (memoryPath: string) => ipcRenderer.invoke("memory:delete", memoryPath),
    stats: () => ipcRenderer.invoke("memory:stats"),
    export: () => ipcRenderer.invoke("memory:export"),
    import: (data: unknown) => ipcRenderer.invoke("memory:import", data),
    projects: () => ipcRenderer.invoke("memory:projects"),
    onUpdate: (callback: (data: { newFacts: number; totalFacts: number }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { newFacts: number; totalFacts: number },
      ) => callback(data);
      ipcRenderer.on("memory:updated", handler);
      return () => {
        ipcRenderer.removeListener("memory:updated", handler);
      };
    },
  },

  // ─── Drafts (Artifact Preview) ──────────────────────────────────
  drafts: {
    get: (threadId: string, artifactId: string) =>
      ipcRenderer.invoke("drafts:get", threadId, artifactId),
    update: (threadId: string, artifactId: string, content: string) =>
      ipcRenderer.invoke("drafts:update", threadId, artifactId, content),
    apply: (threadId: string, artifactId: string) =>
      ipcRenderer.invoke("drafts:apply", threadId, artifactId),
    applyAll: (threadId: string) =>
      ipcRenderer.invoke("drafts:applyAll", threadId),
    discard: (threadId: string, artifactId: string) =>
      ipcRenderer.invoke("drafts:discard", threadId, artifactId),
    discardAll: (threadId: string) =>
      ipcRenderer.invoke("drafts:discardAll", threadId),
  },

  // ─── Tasks ──────────────────────────────────────────────────────
  tasks: {
    /** Start a new background task */
    start: (threadId: string, goal: string, model: string, recallEnabled?: boolean, templateOptions?: { systemPrompt?: string; maxSteps?: number; checkpointEvery?: number }) =>
      ipcRenderer.send("task:start", { threadId, goal, model, recallEnabled, ...templateOptions }),

    /** Respond to a task checkpoint (continue/modify/stop/retry/skip) */
    respond: (data: { taskId: string; checkpointId: string; action: string; guidance?: string }) =>
      ipcRenderer.send("task:respond", data),

    /** Pause a running task */
    pause: (taskId: string) => ipcRenderer.send("task:pause", { taskId }),

    /** Cancel a task */
    cancel: (taskId: string) => ipcRenderer.send("task:cancel", { taskId }),

    /** Resume a paused/interrupted task */
    resume: (taskId: string) => ipcRenderer.send("task:resume", { taskId }),

    /** List tasks (with optional filters) */
    list: (filter?: { threadId?: string; status?: string[] }) =>
      ipcRenderer.invoke("tasks:list", filter),

    /** Get a single task by ID */
    get: (id: string) => ipcRenderer.invoke("tasks:get", id),

    /** Delete a task */
    delete: (id: string) => ipcRenderer.invoke("tasks:delete", id),

    /** Task progress update (main → renderer) */
    onProgress: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("task:progress", handler);
      return () => { ipcRenderer.removeListener("task:progress", handler); };
    },

    /** Task checkpoint — paused, waiting for user input (main → renderer) */
    onCheckpoint: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("task:checkpoint", handler);
      return () => { ipcRenderer.removeListener("task:checkpoint", handler); };
    },

    /** Task completed with deliverable (main → renderer) */
    onComplete: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("task:complete", handler);
      return () => { ipcRenderer.removeListener("task:complete", handler); };
    },

    /** Task error (main → renderer) */
    onError: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("task:error", handler);
      return () => { ipcRenderer.removeListener("task:error", handler); };
    },

    /** Real-time tool activity within a running task (main → renderer) */
    onActivity: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on("task:activity", handler);
      return () => { ipcRenderer.removeListener("task:activity", handler); };
    },
  },

  // ─── Auto-Updater ───────────────────────────────────────────────
  updater: {
    /** Check for updates. Returns available version or null. */
    check: () => ipcRenderer.invoke("updater:check") as Promise<string | null>,
    /** Download the available update. */
    download: () => ipcRenderer.invoke("updater:download") as Promise<boolean>,
    /** Quit and install the downloaded update. */
    install: () => ipcRenderer.invoke("updater:install"),
    /** Listen for update status changes. */
    onStatus: (callback: (data: { status: string; version?: string; progress?: number; error?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { status: string; version?: string; progress?: number; error?: string }) => callback(data);
      ipcRenderer.on("updater:status", handler);
      return () => { ipcRenderer.removeListener("updater:status", handler); };
    },
  },
});
