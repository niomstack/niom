import { useState, useCallback, useRef, useEffect } from "react";
import { Toaster, toast } from "sonner";
import { Titlebar } from "@/components/titlebar";
import { StatusBar } from "@/components/status-bar";
import { HomeView } from "@/components/views/home-view";
import type { HomeViewRef } from "@/components/views/home-view";
import { SettingsView } from "@/components/views/settings-view";
import { ChatView } from "@/components/views/chat-view";
import { OnboardingView } from "@/components/views/onboarding-view";
import { useNiomChat } from "@/hooks/use-niom-chat";
import { useTaskManager } from "@/hooks/use-task-manager";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import type { Thread, NiomMessage } from "@/shared/types";

export type AppView = "home" | "chat" | "settings" | "onboarding";

function generateId(): string {
  return crypto.randomUUID();
}

function App() {
  const [isDark, setIsDark] = useState(true);
  const [view, setView] = useState<AppView>("home");
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [selectedModel, setSelectedModel] = useState("anthropic:claude-sonnet-4-20250514");
  const [recallEnabled, setRecallEnabled] = useState(false);
  const [taskAwarenessEnabled, setTaskAwarenessEnabled] = useState(false);
  const [windowContext, setWindowContext] = useState<{ appName: string; windowTitle: string } | null>(null);
  const activeThreadRef = useRef<Thread | null>(null);
  const homeViewRef = useRef<HomeViewRef>(null);

  activeThreadRef.current = activeThread;

  // Load default model + theme from config on mount, check onboarding
  useEffect(() => {
    checkApiKeyStatus();
    window.niom?.config?.get().then((config) => {
      if (config?.defaultModel) {
        setSelectedModel(config.defaultModel);
      }
      if (config?.theme) {
        setIsDark(config.theme === "dark");
      }
      // Check if onboarding is needed
      if (!config?.onboardingComplete) {
        const hasKey = config?.hasKeys
          ? Object.values(config.hasKeys).some((v) => v === true)
          : false;
        if (!hasKey) {
          setView("onboarding");
        }
      }
      setOnboardingChecked(true);
    });
  }, []);
  // Sync dark class to <html> so portals (Drawer, Dialog, etc.) inherit it.
  // React portals render into document.body which is outside our <div className="dark">,
  // so we must also set the class on documentElement.
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDark]);

  // Re-check API key status when returning from settings
  useEffect(() => {
    if (view === "home") checkApiKeyStatus();
  }, [view]);

  async function checkApiKeyStatus() {
    try {
      const config = await window.niom?.config?.get();
      if (config) {
        const hasKey = config.hasKeys
          ? Object.values(config.hasKeys).some((v) => v === true)
          : config.providers?.some((p) => p.enabled) ?? false;
        setHasApiKey(hasKey);
      }
    } catch {
      // If config check fails, assume optimistic
    }
  }

  // Listen for memory updates → show toast
  useEffect(() => {
    const cleanup = window.niom?.memory?.onUpdate((data) => {
      if (data.newFacts > 0) {
        toast(
          `🧠 NIOM learned ${data.newFacts} ${data.newFacts === 1 ? "thing" : "things"} about you`,
          {
            description: `${data.totalFacts} total ${data.totalFacts === 1 ? "memory" : "memories"}`,
            duration: 3000,
          },
        );
      }
    });
    return cleanup;
  }, []);

  // Listen for global hotkey (Option+Space) activation
  useEffect(() => {
    const cleanup = window.niom?.hotkey?.onActivated((context) => {
      // Store the active window context
      if (context) {
        setWindowContext({ appName: context.appName, windowTitle: context.windowTitle });
      }

      // If in settings, navigate back to home
      if (view === "settings") {
        setView("home");
      }

      // Focus the prompt box textarea
      requestAnimationFrame(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          'textarea[placeholder]'
        );
        textarea?.focus();
      });
    });
    return cleanup;
  }, [view]);

  // (Tray navigation listener is below — after useNiomChat declaration)

  // ── AI SDK v6 Chat Hook ──────────────────────────────────────────────

  const {
    messages,
    isStreaming,
    sendMessage,
    cancel,
    routeInfo,
    error,
    dismissError,
    setMessages,
    status,
    addToolApprovalResponse,
  } = useNiomChat({
    thread: activeThread,
    model: selectedModel,
    recallEnabled,
    taskAwarenessEnabled,
    onThreadUpdate: setActiveThread,
    onStartTask: useCallback((goal: string) => {
      // This callback is stored in a ref inside useNiomChat,
      // so it always has access to the latest taskManager
      taskManagerRef.current?.startTask(goal);
    }, []),
  });

  // ── Task Manager Hook ────────────────────────────────────────────────

  const taskManager = useTaskManager(
    activeThread?.id,
    selectedModel,
  );

  // Ref bridge: allows useNiomChat's onStartTask to call taskManager.startTask
  const taskManagerRef = useRef(taskManager);
  taskManagerRef.current = taskManager;

  // Listen for LLM-generated title updates
  useEffect(() => {
    const cleanup = window.niom?.threads?.onTitleUpdated((data) => {
      // Update active thread title if it matches
      setActiveThread((prev) => {
        if (prev && prev.id === data.threadId) {
          return { ...prev, title: data.title, llmTitleGenerated: true };
        }
        return prev;
      });
    });
    return cleanup;
  }, []);

  // Task completion toasts
  useEffect(() => {
    if (taskManager.latestCompletion) {
      toast.success("✨ Task completed!", {
        description: "Your background task has finished. Open the task panel to view results.",
        duration: 5000,
        action: {
          label: "View",
          onClick: () => taskManager.openPanel(taskManager.latestCompletion?.taskId),
        },
      });
      taskManager.dismissCompletion();
    }
  }, [taskManager.latestCompletion]);

  // Listen for tray menu navigation commands
  useEffect(() => {
    const cleanup = window.niom?.tray?.onNavigate(async (data) => {
      switch (data.view) {
        case "home":
          setView("home");
          if (data.action === "newThread") {
            requestAnimationFrame(() => {
              const textarea = document.querySelector<HTMLTextAreaElement>(
                'textarea[placeholder]'
              );
              textarea?.focus();
            });
          }
          break;
        case "chat":
          if (data.threadId) {
            try {
              const thread = await window.niom.threads.get(data.threadId);
              if (thread) {
                setActiveThread(thread);
                setView("chat");
                setSelectedModel(thread.defaultModel);
                const uiMessages = (thread.messages || []).map((msg: any) => ({
                  ...msg,
                  parts: msg.parts || [{ type: "text" as const, text: msg.content || "" }],
                }));
                setMessages(uiMessages);
              }
            } catch {
              console.error("[app] Tray: failed to load thread");
            }
          }
          break;
        case "settings":
          setView("settings");
          break;
      }
    });
    return cleanup;
  }, [setMessages]);

  // Create a new thread and start a chat
  const handleStartChat = useCallback(
    async (text: string, model: string) => {
      const threadId = generateId();
      setSelectedModel(model);

      // CRITICAL: Clear any leftover messages from a previous chat session.
      // useChat retains its internal message state across view transitions,
      // so we must reset before starting a new thread to prevent old messages
      // (including incomplete tool_use/tool_result pairs) from being sent.
      setMessages([]);

      // Create thread shell — sendMessage will add the user message
      const thread: Thread = {
        id: threadId,
        title: "New Chat",
        messages: [],
        defaultModel: model,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      setActiveThread(thread);
      setView("chat");

      // Save thread first
      try {
        await window.niom.threads.save(thread);
      } catch {
        console.error("[app] Failed to save thread");
      }

      // Use requestAnimationFrame to ensure React has committed the state
      // updates (cleared messages, new thread) before sending the message.
      requestAnimationFrame(() => {
        sendMessage(text);
      });
    },
    [sendMessage, setMessages],
  );

  // Start a new thread and immediately launch as a background Task
  const handleStartChatAsTask = useCallback(
    async (goal: string, model: string) => {
      const threadId = generateId();
      setSelectedModel(model);

      // Seed the thread with the user's goal + an assistant ack
      const now = Date.now();
      const userMsg: NiomMessage = {
        id: generateId(),
        role: "user" as const,
        parts: [{ type: "text" as const, text: goal }],
        content: goal,
        createdAt: now,
      };
      const ackMsg: NiomMessage = {
        id: generateId(),
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: `⚡ I'm working on this as a **background Task**. You can track progress using the Task panel (⚡ button in the header).\n\nFeel free to keep chatting here — the task runs independently in the background.` }],
        content: "Working on this as a background Task.",
        model,
        createdAt: now + 1,
      };

      setMessages([userMsg, ackMsg]);

      const thread: Thread = {
        id: threadId,
        title: goal.slice(0, 60) + (goal.length > 60 ? "…" : ""),
        messages: [userMsg, ackMsg],
        defaultModel: model,
        createdAt: now,
        updatedAt: now,
      };

      setActiveThread(thread);
      setView("chat");

      try {
        await window.niom.threads.save(thread);
      } catch {
        console.error("[app] Failed to save thread for task");
      }

      // Start the task in the newly created thread
      window.niom.tasks.start(threadId, goal, model);

      // Refresh task list after a brief delay
      setTimeout(() => taskManager.refresh(), 1000);
    },
    [setMessages, taskManager],
  );

  // Launch a task from a template with specialized config
  const handleLaunchTemplate = useCallback(
    async (goal: string, systemPrompt: string, maxSteps?: number, checkpointEvery?: number) => {
      const threadId = generateId();
      const model = selectedModel;
      const now = Date.now();

      const userMsg: NiomMessage = {
        id: generateId(),
        role: "user" as const,
        parts: [{ type: "text" as const, text: goal }],
        content: goal,
        createdAt: now,
      };
      const ackMsg: NiomMessage = {
        id: generateId(),
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: `⚡ Launching **template task** in the background. Track progress using the Task panel.\n\nThis task uses a specialized system prompt optimized for this type of work.` }],
        content: "Launching template task.",
        model,
        createdAt: now + 1,
      };

      setMessages([userMsg, ackMsg]);

      const thread: Thread = {
        id: threadId,
        title: goal.slice(0, 60) + (goal.length > 60 ? "…" : ""),
        messages: [userMsg, ackMsg],
        defaultModel: model,
        createdAt: now,
        updatedAt: now,
      };

      setActiveThread(thread);
      setView("chat");

      try {
        await window.niom.threads.save(thread);
      } catch {
        console.error("[app] Failed to save thread for template task");
      }

      // Start with template params
      window.niom.tasks.start(threadId, goal, model, undefined, {
        systemPrompt,
        maxSteps,
        checkpointEvery,
      });

      setTimeout(() => taskManager.refresh(), 1000);
    },
    [selectedModel, setMessages, taskManager],
  );

  // Send a new message within an existing chat
  const handleChatSubmit = useCallback(
    (text: string, model: string) => {
      setSelectedModel(model);
      sendMessage(text);
    },
    [sendMessage],
  );

  const handleBack = useCallback(() => {
    if (isStreaming) cancel();

    // Trigger background thread digest before leaving
    // (fire-and-forget — uses LLM distillation when available)
    const thread = activeThreadRef.current;
    if (thread && thread.messages.length >= 3) {
      window.niom.threads.digest(thread, selectedModel);
    }

    setView("home");
    setActiveThread(null);
    // Clear useChat's internal message state so the next new chat starts clean
    setMessages([]);
  }, [isStreaming, cancel, setMessages, selectedModel]);

  // Escape to cancel streaming
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isStreaming) {
        cancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isStreaming, cancel]);

  // Load an existing thread from the thread list
  const handleSelectThread = useCallback(
    async (id: string) => {
      try {
        const thread = await window.niom.threads.get(id);
        if (thread) {
          setActiveThread(thread);
          setView("chat");
          setSelectedModel(thread.defaultModel);

          // Load persisted messages into useChat so they render
          // Ensure each message has parts (migration from old ChatMessage format)
          const uiMessages = (thread.messages || []).map((msg: any) => ({
            ...msg,
            parts: msg.parts || [{ type: "text" as const, text: msg.content || "" }],
          }));
          setMessages(uiMessages);
        }
      } catch {
        console.error("[app] Failed to load thread");
      }
    },
    [setMessages],
  );

  const handleDeleteThread = useCallback(async (id: string) => {
    try {
      await window.niom.threads.delete(id);
    } catch {
      console.error("[app] Failed to delete thread");
    }
  }, []);

  // Navigate from a task card to its source thread with the task panel open
  const handleSelectTask = useCallback(
    async (taskId: string, threadId: string) => {
      try {
        const thread = await window.niom.threads.get(threadId);
        if (thread) {
          setActiveThread(thread);
          setView("chat");
          setSelectedModel(thread.defaultModel);

          const uiMessages = (thread.messages || []).map((msg: any) => ({
            ...msg,
            parts: msg.parts || [{ type: "text" as const, text: msg.content || "" }],
          }));
          setMessages(uiMessages);

          // Auto-open the task panel for this task
          requestAnimationFrame(() => {
            taskManager.openPanel(taskId);
          });
        }
      } catch {
        console.error("[app] Failed to navigate to task thread");
      }
    },
    [setMessages, taskManager],
  );

  // ─── Keyboard Shortcuts (Cmd+N, Cmd+K, Cmd+,) ─────────────────────
  useKeyboardShortcuts({
    onNewThread: useCallback(() => {
      if (isStreaming) cancel();
      setActiveThread(null);
      setMessages([]);
      setView("home");
      requestAnimationFrame(() => {
        homeViewRef.current?.focusPrompt();
      });
    }, [isStreaming, cancel, setMessages]),

    onSearchThreads: useCallback(() => {
      if (view !== "home") {
        if (isStreaming) cancel();
        setActiveThread(null);
        setMessages([]);
        setView("home");
      }
      requestAnimationFrame(() => {
        homeViewRef.current?.focusSearch();
      });
    }, [view, isStreaming, cancel, setMessages]),

    onOpenSettings: useCallback(() => {
      setView("settings");
    }, []),
  });

  return (
    <div className={isDark ? "dark" : ""}>
      <div className="flex h-screen flex-col bg-background text-foreground transition-colors duration-300">
        <Titlebar
          isDark={isDark}
          onToggleTheme={() => {
            const next = !isDark;
            setIsDark(next);
            window.niom?.config?.set({ theme: next ? "dark" : "light" });
          }}
          onOpenSettings={() => setView("settings")}
          showSettingsButton={view !== "settings"}
        />
        <div className="relative flex-1 overflow-hidden">
          {view === "home" && (
            <HomeView
              ref={homeViewRef}
              isDark={isDark}
              onSubmit={handleStartChat}
              onSubmitAsTask={handleStartChatAsTask}
              onLaunchTemplate={handleLaunchTemplate}
              onSelectThread={handleSelectThread}
              onDeleteThread={handleDeleteThread}
              onOpenSettings={() => setView("settings")}
              hasApiKey={hasApiKey}
              tasks={taskManager.allTasks}
              onSelectTask={handleSelectTask}
              onDeleteTask={taskManager.deleteTask}
              recallEnabled={recallEnabled}
              onRecallChange={setRecallEnabled}
              windowContext={windowContext}
              onClearWindowContext={() => setWindowContext(null)}
            />
          )}
          {view === "chat" && activeThread && (
            <ChatView
              thread={activeThread}
              messages={messages}
              isStreaming={isStreaming}
              error={error}
              routeInfo={routeInfo}
              status={status}
              onBack={handleBack}
              onSubmit={handleChatSubmit}
              onCancel={cancel}
              onDismissError={dismissError}
              onToolApprovalResponse={addToolApprovalResponse}
              taskManager={taskManager}
              recallEnabled={recallEnabled}
              onRecallChange={setRecallEnabled}
              taskAwarenessEnabled={taskAwarenessEnabled}
              onTaskAwarenessChange={setTaskAwarenessEnabled}
              windowContext={windowContext}
              onClearWindowContext={() => setWindowContext(null)}
            />
          )}
          {view === "settings" && (
            <SettingsView onBack={() => setView("home")} />
          )}
          {view === "onboarding" && (
            <OnboardingView
              onComplete={() => {
                setView("home");
                checkApiKeyStatus();
              }}
            />
          )}
        </div>
        <StatusBar activeModel={activeThread?.defaultModel} />
        <Toaster
          theme={isDark ? "dark" : "light"}
          position="bottom-right"
          richColors
          toastOptions={{
            className: "font-mono text-xs",
          }}
        />
      </div>
    </div>
  );
}

export default App;
