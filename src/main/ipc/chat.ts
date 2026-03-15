/**
 * Chat IPC Handlers — AI SDK v6 Native
 *
 * The main process runs a ToolLoopAgent and streams UIMessageChunks
 * to the renderer via IPC. The renderer's ElectronChatTransport wraps
 * these into a ReadableStream for useChat consumption.
 *
 * IPC channels:
 *   chat:stream  → Start agent stream (renderer → main)
 *   chat:cancel  → Cancel active stream (renderer → main)
 *   chat:part    → UIMessageChunk (main → renderer)
 *   chat:done    → Stream complete (main → renderer)
 *   chat:error   → Stream error (main → renderer)
 *   chat:route   → Skill routing info (main → renderer)
 *   chat:approveToolCall → Tool approval response (renderer → main, handled by useChat native flow)
 */

import { ipcMain, BrowserWindow } from "electron";
import { convertToModelMessages } from "ai";
import type { UIMessage } from "ai";
import { createNiomAgent } from "../agent";
import { resolveModel, ChatServiceError } from "../services/chat.service";
import { extractUserMemories, extractAgentMemories, writeMemoriesToNCF } from "../context/memory-extractor";
import { commitSession } from "../context/session";
import { getThread } from "../services/thread.service";
import { learnFromToolTrace } from "../skills/edge-learning";
import { grantTrust } from "../tools/trust";
import { detectProjectFromPath } from "../context/project-scanner";

/** Active streams indexed by threadId — allows cancellation */
const activeStreams = new Map<string, AbortController>();

/** Register chat-related IPC handlers. */
export function registerChatIpc(getMainWindow: () => BrowserWindow | null): void {
  // ── Stream Handler ─────────────────────────────────────────────────
  ipcMain.on("chat:stream", async (_event, data: {
    threadId: string;
    messages: UIMessage[];
    model: string;
    recallEnabled?: boolean;
    taskAwarenessEnabled?: boolean;
  }) => {
    const { threadId, messages, model: modelId, recallEnabled, taskAwarenessEnabled } = data;
    const win = getMainWindow();
    if (!win) return;

    // Cancel any existing stream for this thread
    if (activeStreams.has(threadId)) {
      activeStreams.get(threadId)!.abort();
      activeStreams.delete(threadId);
    }

    const controller = new AbortController();
    activeStreams.set(threadId, controller);

    // Track tool names for edge learning
    const toolTrace: string[] = [];

    try {
      // Resolve model
      const model = resolveModel(modelId);

      // Create agent with skill routing via prepareCall
      const agent = createNiomAgent(model, {
        threadId,
        recallEnabled,
        taskAwarenessEnabled,
        onRoute: (label, tools, confidence, primaryDomain) => {
          if (!win.isDestroyed()) {
            win.webContents.send("chat:route", {
              threadId,
              label,
              primaryDomain,
              tools,
              confidence,
            });
          }
        },
        onTaskSuggestion: (query, detection) => {
          if (!win.isDestroyed()) {
            win.webContents.send("chat:suggest-task", {
              threadId,
              query,
              score: detection.score,
              reason: detection.reason,
            });
          }
        },
      });

      // Convert UIMessages to ModelMessages for the agent
      const modelMessages = await convertToModelMessages(messages);

      // Stream using the agent
      const result = await agent.stream({
        messages: modelMessages,
        abortSignal: controller.signal,
        onStepFinish: ({ toolCalls }) => {
          // Track tool names for edge learning
          if (toolCalls) {
            for (const call of toolCalls) {
              toolTrace.push(call.toolName);
              // Grant trust for tools that completed (were approved)
              grantTrust(call.toolName, call.input);
              // On-demand project detection: if a tool touched a file, detect the workspace
              const inp = call.input as Record<string, unknown>;
              if (typeof inp?.path === "string") {
                detectProjectFromPath(String(inp.path)).catch(() => {});
              }
            }
          }
        },
      });

      // Pipe UIMessageStream chunks to renderer via IPC
      const uiStream = result.toUIMessageStream();

      for await (const chunk of uiStream) {
        if (controller.signal.aborted || win.isDestroyed()) break;
        win.webContents.send("chat:part", { threadId, chunk });
      }

      if (!controller.signal.aborted && !win.isDestroyed()) {
        win.webContents.send("chat:done", { threadId });

        // Check if the agent was stopped mid-work by the step budget.
        // finishReason === "tool-calls" means the model wanted to make more
        // tool calls but stopWhen fired, cutting it off.
        const [finishReason, usage] = await Promise.all([
          result.finishReason,
          result.usage,
        ]);

        console.log(`[chat] ${modelId} | ${usage.inputTokens}→${usage.outputTokens} tokens (${usage.totalTokens} total)`);

        if (finishReason === "tool-calls" && !win.isDestroyed()) {
          console.log(`[chat] Step budget exhausted for thread ${threadId} — prompting user to continue`);
          win.webContents.send("chat:budget-reached", { threadId });
        }

        // Edge weight learning — fire and forget
        if (toolTrace.length > 0) {
          try {
            learnFromToolTrace(toolTrace);
          } catch (e) {
            console.warn("[chat] Edge learning failed:", e);
          }
        }

        // Async memory extraction (NCF) — fire and forget
        triggerMemoryExtraction(threadId, win, toolTrace).catch(() => {});
      }
    } catch (error: unknown) {
      if (controller.signal.aborted) return;

      if (!win.isDestroyed()) {
        const chatError = ChatServiceError.fromUnknown(error);
        win.webContents.send("chat:error", {
          threadId,
          error: chatError.toUserMessage(),
        });
        console.error(`[chat] Error (${chatError.code}):`, chatError.message);
      }
    } finally {
      activeStreams.delete(threadId);
    }
  });

  // ── Cancel Handler ─────────────────────────────────────────────────
  ipcMain.on("chat:cancel", (_event, data: { threadId: string }) => {
    const ctrl = activeStreams.get(data.threadId);
    if (ctrl) {
      ctrl.abort();
      activeStreams.delete(data.threadId);
      console.log(`[chat] Stream cancelled for thread ${data.threadId}`);
    }
  });
}

// ─── Memory Extraction (unchanged) ──────────────────────────────────

/**
 * Post-conversation memory extraction — NCF-powered.
 * Runs async after stream completion — never blocks the chat flow.
 */
async function triggerMemoryExtraction(
  threadId: string,
  win: BrowserWindow,
  toolTrace: string[] = [],
): Promise<void> {
  try {
    const thread = getThread(threadId);
    if (!thread || thread.messages.length < 2) return;

    const [userMemories, agentMemories] = await Promise.all([
      extractUserMemories(thread.messages, threadId),
      extractAgentMemories(thread.messages, toolTrace, threadId),
    ]);

    const allMemories = [...userMemories, ...agentMemories];

    if (allMemories.length > 0) {
      const result = writeMemoriesToNCF(allMemories);
      console.log(
        `[memory] NCF: ${result.written} written, ${result.merged} merged, ${result.skipped} skipped` +
        ` | user=${userMemories.length} agent=${agentMemories.length}`,
      );
    }

    if (allMemories.length > 0 && !win.isDestroyed()) {
      win.webContents.send("memory:updated", {
        newFacts: allMemories.length,
        totalFacts: allMemories.length,
      });
    }

    if (thread.messages.length >= 4) {
      commitSession(threadId, thread.messages, toolTrace)
        .then((result) => {
          if (result.status === "committed") {
            console.log(
              `[session] Committed thread ${threadId}: ` +
              `${result.memoriesExtracted} memories, archived=${result.archived}`,
            );
          }
        })
        .catch((err) => console.warn("[session] Commit failed:", err));
    }
  } catch (error) {
    console.warn("[memory] Extraction trigger failed:", error);
  }
}
