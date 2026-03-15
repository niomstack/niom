/**
 * useNiomChat — Bridge between AI SDK v6's useChat and NIOM's thread persistence.
 *
 * Uses useChat from @ai-sdk/react with our ElectronChatTransport.
 * Handles:
 *   - Thread ↔ UIMessage conversion
 *   - Persistence (auto-save on completion)
 *   - Routing info via IPC listener
 *   - Error state management
 *
 * This replaces the old useChatStream hook entirely.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import type { UIMessage } from "ai";
import { toast } from "sonner";
import { ElectronChatTransport } from "@/transport/electron-chat-transport";
import type { Thread, NiomMessage } from "@/shared/types";
import { getTextFromParts } from "@/shared/types";

// ─── Route Info ──────────────────────────────────────────────────────

export interface RouteInfo {
  label: string;
  primaryDomain: string;
  tools: string[];
  confidence: number;
}

// ─── Hook Options ────────────────────────────────────────────────────

interface UseNiomChatOptions {
  /** The active thread — drives message history and persistence */
  thread: Thread | null;
  /** The current model ID */
  model: string;
  /** Thread update callback (to update parent state after save) */
  onThreadUpdate?: (thread: Thread) => void;
  /** Error callback */
  onError?: (error: string) => void;
  /** Called when the complexity heuristic suggests running as a Task */
  onStartTask?: (goal: string) => void;
  /** Whether cross-thread recall is enabled */
  recallEnabled?: boolean;
  /** Whether live task awareness is enabled */
  taskAwarenessEnabled?: boolean;
}

// ─── Hook Return ─────────────────────────────────────────────────────

interface UseNiomChatReturn {
  /** Full message list from useChat (UIMessage with parts) */
  messages: UIMessage[];
  /** Whether the agent is currently streaming */
  isStreaming: boolean;
  /** Send a new user message */
  sendMessage: (text: string) => void;
  /** Cancel the current stream */
  cancel: () => void;
  /** Routing info for the current stream */
  routeInfo: RouteInfo | null;
  /** Error message (null if none) */
  error: string | null;
  /** Dismiss the error */
  dismissError: () => void;
  /** Set messages directly (for loading a thread) */
  setMessages: (messages: UIMessage[]) => void;
  /** The chat status from useChat */
  status: string;
  /** Respond to a tool approval request (v6 native) */
  addToolApprovalResponse: (opts: { id: string; approved: boolean; reason?: string }) => void;
  /** Toggle cross-thread recall on the transport */
  setRecallEnabled: (enabled: boolean) => void;
  /** Toggle task awareness on the transport */
  setTaskAwarenessEnabled: (enabled: boolean) => void;
}

// ─── Transport Singleton ─────────────────────────────────────────────

// We create the transport once and update its config
const transport = new ElectronChatTransport({
  model: "anthropic:claude-sonnet-4-20250514",
  threadId: "",
});

// ─── Hook ────────────────────────────────────────────────────────────

export function useNiomChat(options: UseNiomChatOptions): UseNiomChatReturn {
  const { thread, model, onThreadUpdate, onError, onStartTask, recallEnabled, taskAwarenessEnabled } = options;
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef(thread);
  threadRef.current = thread;

  // Update transport config when thread/model/recall/awareness changes
  useEffect(() => {
    transport.setModel(model);
    if (thread?.id) {
      transport.setThreadId(thread.id);
    }
    transport.setRecallEnabled(recallEnabled ?? false);
    transport.setTaskAwarenessEnabled(taskAwarenessEnabled ?? false);
  }, [model, thread?.id, recallEnabled, taskAwarenessEnabled]);

  // Listen for routing info from main process
  useEffect(() => {
    const unsub = window.niom.chat.onRoute((data) => {
      if (data.threadId === thread?.id) {
        setRouteInfo({
          label: data.label,
          primaryDomain: data.primaryDomain,
          tools: data.tools,
          confidence: data.confidence,
        });
      }
    });
    return unsub;
  }, [thread?.id]);

  // useChat from @ai-sdk/react — handles ALL message/streaming state
  const {
    messages,
    setMessages,
    sendMessage: chatSendMessage,
    addToolApprovalResponse,
    stop,
    status,
  } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      onError?.(msg);
    },
    onFinish: async ({ message }) => {
      // Persist the updated thread with the new assistant message
      const currentThread = threadRef.current;
      if (!currentThread) return;

      try {
        const niomMsg = uiMessageToNiomMessage(message, model);
        const updatedThread: Thread = {
          ...currentThread,
          messages: [...currentThread.messages, niomMsg],
          updatedAt: Date.now(),
        };

        await window.niom.threads.save(updatedThread);

        // Re-fetch to get auto-generated title
        const saved = await window.niom.threads.get(updatedThread.id);
        if (saved) {
          onThreadUpdate?.(saved);

          // Trigger LLM title generation after first AI response (2+ messages)
          // Only if the title is still the heuristic one (not yet LLM-generated)
          if (saved.messages.length >= 2 && !saved.llmTitleGenerated) {
            window.niom.threads.generateTitle(saved, model);
          }
        }
      } catch {
        console.error("[chat] Failed to save thread after completion");
      }
    },
  });

  // Send a user message
  const sendMessage = useCallback(
    (text: string) => {
      setError(null);
      setRouteInfo(null);

      // Save user message to thread before sending
      const currentThread = threadRef.current;
      if (currentThread) {
        const userMsg: NiomMessage = {
          id: crypto.randomUUID(),
          role: "user",
          parts: [{ type: "text" as const, text }],
          content: text,
          createdAt: Date.now(),
        };
        const updatedThread: Thread = {
          ...currentThread,
          messages: [...currentThread.messages, userMsg],
          updatedAt: Date.now(),
        };
        onThreadUpdate?.(updatedThread);
        window.niom.threads.save(updatedThread).catch(() => {});
      }

      chatSendMessage({ text });
    },
    [chatSendMessage, onThreadUpdate],
  );

  // Ref to latest sendMessage for use in the budget-reached listener
  // (avoids stale closure issues since the listener is registered once)
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;

  // Listen for step budget exhaustion — show toast with Continue/Stop
  useEffect(() => {
    const unsub = window.niom.chat.onBudgetReached((data: { threadId: string }) => {
      if (data.threadId !== threadRef.current?.id) return;

      toast("⏱ NIOM has been working for a while", {
        description: "Want to keep going or stop here to review its work?",
        duration: Infinity,
        action: {
          label: "Keep Going",
          onClick: () => {
            sendMessageRef.current(
              "Continue working from where you left off. Pick up exactly where you stopped.",
            );
          },
        },
        cancel: {
          label: "Stop & Review",
          onClick: () => {},
        },
      });
    });
    return unsub;
  }, []);

  // Listen for task complexity suggestion — show toast with Accept/Decline
  const startTaskRef = useRef(onStartTask);
  startTaskRef.current = onStartTask;

  useEffect(() => {
    const unsub = window.niom.chat.onSuggestTask((data: {
      threadId: string;
      query: string;
      score: number;
      reason: string;
    }) => {
      if (data.threadId !== threadRef.current?.id) return;
      if (!startTaskRef.current) return;

      const queryRef = data.query;

      toast("⚡ This looks like a complex task", {
        description: data.reason + " Want to run it in the background?",
        duration: 15000,
        action: {
          label: "Run as Task",
          onClick: () => {
            startTaskRef.current?.(queryRef);
          },
        },
        cancel: {
          label: "Keep as Chat",
          onClick: () => {},
        },
      });
    });
    return unsub;
  }, []);

  const cancel = useCallback(() => {
    stop();
    if (thread?.id) {
      window.niom.chat.cancel(thread.id);
    }
  }, [stop, thread?.id]);

  const dismissError = useCallback(() => setError(null), []);

  const isStreaming = status === "streaming" || status === "submitted";

  return {
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
    setRecallEnabled: useCallback((enabled: boolean) => {
      transport.setRecallEnabled(enabled);
    }, []),
    setTaskAwarenessEnabled: useCallback((enabled: boolean) => {
      transport.setTaskAwarenessEnabled(enabled);
    }, []),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Convert a UIMessage (from useChat) to NiomMessage for thread persistence.
 * Preserves the full parts array AND denormalizes content for search/context.
 */
function uiMessageToNiomMessage(
  message: UIMessage,
  model: string,
): NiomMessage {
  return {
    ...message,
    content: getTextFromParts(message),
    model,
    createdAt: Date.now(),
  };
}

