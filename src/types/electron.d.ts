import type {
  NiomConfig,
  ChatErrorPayload,
  Thread,
  ThreadMeta,
  MemoryUpdatePayload,
} from "@/shared/types";
import type {
  Task,
  TaskMeta,
  TaskStatus,
  TaskProgressPayload,
  TaskCheckpointPayload,
  TaskCompletePayload,
  TaskErrorPayload,
  TaskActivityPayload,
  CheckpointResponse,
} from "@/shared/task-types";

export interface NiomAPI {
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    platform: () => Promise<string>;
    version: () => Promise<string>;
  };
  shell: {
    openPath: (filePath: string) => Promise<void>;
    openUrl: (url: string) => Promise<void>;
  };
  hotkey: {
    /** Listen for global hotkey activation with active window context */
    onActivated: (callback: (context: { appName: string; windowTitle: string; capturedAt: number } | null) => void) => () => void;
  };
  tray: {
    /** Listen for tray menu navigation commands */
    onNavigate: (callback: (data: { view: string; threadId?: string; taskId?: string; action?: string }) => void) => () => void;
  };
  config: {
    get: () => Promise<(NiomConfig & { hasKeys: Record<string, boolean> }) | null>;
    set: (config: Partial<NiomConfig>) => Promise<void>;
    setApiKey: (provider: string, key: string) => Promise<void>;
    getApiKey: (provider: string) => Promise<string | null>;
  };
  chat: {
    /** Send messages to the agent (UIMessage[] from useChat) */
    stream: (threadId: string, messages: unknown[], model: string, recallEnabled?: boolean, taskAwarenessEnabled?: boolean) => void;
    /** Receive UIMessageChunk parts from the agent stream */
    onPart: (callback: (data: { threadId: string; chunk: unknown }) => void) => () => void;
    /** Stream completed successfully */
    onDone: (callback: (data: { threadId: string }) => void) => () => void;
    /** Stream error */
    onError: (callback: (data: ChatErrorPayload) => void) => () => void;
    /** Skill routing info */
    onRoute: (callback: (data: { threadId: string; label: string; primaryDomain: string; tools: string[]; confidence: number }) => void) => () => void;
    /** Agent hit step budget — still had work to do */
    onBudgetReached: (callback: (data: { threadId: string }) => void) => () => void;
    /** Task complexity suggestion — query complex enough for background task */
    onSuggestTask: (callback: (data: { threadId: string; query: string; score: number; reason: string }) => void) => () => void;
    /** Cancel an active stream */
    cancel: (threadId: string) => void;
  };
  threads: {
    list: () => Promise<ThreadMeta[]>;
    get: (id: string) => Promise<Thread | null>;
    save: (thread: Thread) => Promise<void>;
    delete: (id: string) => Promise<void>;
    /** Fire-and-forget: trigger background thread digest generation */
    digest: (thread: Thread, model?: string) => void;
    /** Fire-and-forget: trigger LLM thread title generation */
    generateTitle: (thread: Thread, model?: string) => void;
    /** Listen for LLM-generated title updates */
    onTitleUpdated: (callback: (data: { threadId: string; title: string }) => void) => () => void;
  };
  voice: {
    /** Transcribe audio buffer using Whisper API */
    transcribe: (audioBuffer: Buffer, mimeType: string) => Promise<{ text?: string; error?: string }>;
  };
  memory: {
    list: () => Promise<Record<string, MemoryItem[]>>;
    get: (memoryPath: string) => Promise<MemoryItem | null>;
    update: (memoryPath: string, content: string) => Promise<boolean>;
    delete: (memoryPath: string) => Promise<boolean>;
    stats: () => Promise<NCFStatsPayload>;
    export: () => Promise<{ memories: MemoryItem[]; exportedAt: number }>;
    import: (data: unknown) => Promise<{ imported: number; skipped: number }>;
    projects: () => Promise<Array<{
      hash: string;
      name: string;
      rootPath: string;
      techStack: Array<{ name: string; version?: string; detectedFrom: string }>;
      conventions: string[];
      analyzedAt: number;
    }>>;
    onUpdate: (callback: (data: MemoryUpdatePayload) => void) => () => void;
  };
  drafts: {
    get: (threadId: string, artifactId: string) => Promise<{ success: boolean; data?: ArtifactDraft; error?: string }>;
    update: (threadId: string, artifactId: string, content: string) => Promise<{ success: boolean; error?: string }>;
    apply: (threadId: string, artifactId: string) => Promise<{ success: boolean; data?: { path: string; bytesWritten: number; created: boolean }; error?: string }>;
    applyAll: (threadId: string) => Promise<{ success: boolean; data?: { applied: number; results: Array<{ artifactId: string; path: string; created: boolean; error?: string }> }; error?: string }>;
    discard: (threadId: string, artifactId: string) => Promise<{ success: boolean }>;
    discardAll: (threadId: string) => Promise<{ success: boolean }>;
  };
  tasks: {
    /** Start a new background task */
    start: (threadId: string, goal: string, model: string, recallEnabled?: boolean, templateOptions?: { systemPrompt?: string; maxSteps?: number; checkpointEvery?: number }) => void;
    /** Respond to a task checkpoint */
    respond: (data: CheckpointResponse) => void;
    /** Pause a running task */
    pause: (taskId: string) => void;
    /** Cancel a task */
    cancel: (taskId: string) => void;
    /** Resume a paused/interrupted task */
    resume: (taskId: string) => void;
    /** List tasks with optional filters */
    list: (filter?: { threadId?: string; status?: TaskStatus[] }) => Promise<TaskMeta[]>;
    /** Get a full task by ID */
    get: (id: string) => Promise<Task | null>;
    /** Delete a task */
    delete: (id: string) => Promise<void>;
    /** Task progress update */
    onProgress: (callback: (data: TaskProgressPayload) => void) => () => void;
    /** Task checkpoint — waiting for user input */
    onCheckpoint: (callback: (data: TaskCheckpointPayload) => void) => () => void;
    /** Task completed with deliverable */
    onComplete: (callback: (data: TaskCompletePayload) => void) => () => void;
    /** Task error */
    onError: (callback: (data: TaskErrorPayload) => void) => () => void;
    /** Real-time tool activity within a running task */
    onActivity: (callback: (data: TaskActivityPayload) => void) => () => void;
  };

  /** Auto-updater */
  updater: {
    /** Check for updates. Returns available version or null. */
    check: () => Promise<string | null>;
    /** Download the available update. */
    download: () => Promise<boolean>;
    /** Quit and install the downloaded update. */
    install: () => void;
    /** Listen for update status changes. */
    onStatus: (callback: (data: UpdaterStatus) => void) => () => void;
  };
}

declare global {
  /** A memory item returned from the main process. */
  interface MemoryItem {
    path: string;
    name: string;
    category: string;
    scope: "user" | "agent";
    abstract: string;
    content: string;
    size: number;
    updatedAt: number;
    createdAt: number;
  }

  /** Artifact draft for preview/staging. */
  interface ArtifactDraft {
    artifactId: string;
    targetPath: string;
    content: string;
    language: string;
    description: string;
    isModification: boolean;
    originalContent?: string;
    threadId: string;
  }

  /** NCF stats payload. */
  interface NCFStatsPayload {
    nodeCount: number;
    memoryCounts: Record<string, number>;
    totalMemories: number;
    projectCount: number;
    sessionCount: number;
    l0IndexSize: number;
  }

  interface Window {
    niom: NiomAPI;
  }

  /** Auto-updater status payload. */
  interface UpdaterStatus {
    status: "checking" | "available" | "up-to-date" | "downloading" | "ready" | "error";
    version?: string;
    progress?: number;
    error?: string;
  }
}

