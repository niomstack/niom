/**
 * ElectronChatTransport — AI SDK v6 ChatTransport for Electron IPC
 *
 * Bridges the renderer's `useChat` to the main process agent via IPC.
 * The main process runs the ToolLoopAgent and streams UIMessageChunks
 * back. This transport wraps those IPC events into a ReadableStream
 * that useChat consumes natively.
 *
 * This replaces our entire custom useChatStream hook.
 */

import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

/**
 * Options for the Electron IPC chat transport.
 */
export interface ElectronChatTransportOptions {
  /** Model ID (e.g. "anthropic:claude-sonnet-4-20250514") */
  model: string;
  /** Thread ID for scoping the stream */
  threadId: string;
  /** Whether cross-thread task recall is enabled */
  recallEnabled?: boolean;
  /** Whether live task awareness is enabled */
  taskAwarenessEnabled?: boolean;
}

export class ElectronChatTransport implements ChatTransport<UIMessage> {
  private model: string;
  private threadId: string;
  private recallEnabled: boolean;
  private taskAwarenessEnabled: boolean;

  constructor(options: ElectronChatTransportOptions) {
    this.model = options.model;
    this.threadId = options.threadId;
    this.recallEnabled = options.recallEnabled ?? false;
    this.taskAwarenessEnabled = options.taskAwarenessEnabled ?? false;
  }

  /** Update the model for subsequent calls */
  setModel(model: string) {
    this.model = model;
  }

  /** Update the thread ID for subsequent calls */
  setThreadId(threadId: string) {
    this.threadId = threadId;
  }

  /** Toggle cross-thread recall for subsequent calls */
  setRecallEnabled(enabled: boolean) {
    this.recallEnabled = enabled;
  }

  /** Toggle live task awareness for subsequent calls */
  setTaskAwarenessEnabled(enabled: boolean) {
    this.taskAwarenessEnabled = enabled;
  }

  /**
   * Send messages to the main process agent and return a ReadableStream
   * of UIMessageChunks. useChat consumes this stream natively.
   */
  async sendMessages({
    messages,
    abortSignal,
  }: {
    messages: UIMessage[];
    abortSignal?: AbortSignal;
  }): Promise<ReadableStream<UIMessageChunk>> {
    const threadId = this.threadId;
    const model = this.model;

    // Send the messages to the main process via IPC
    window.niom.chat.stream(threadId, messages, model, this.recallEnabled, this.taskAwarenessEnabled);

    // Create a ReadableStream fed by IPC events from the main process
    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        // Listen for UIMessageChunk parts from main process
        const unsubPart = window.niom.chat.onPart((data) => {
          if (data.threadId === threadId) {
            controller.enqueue(data.chunk as UIMessageChunk);
          }
        });

        // Listen for stream completion
        const unsubDone = window.niom.chat.onDone((data: { threadId: string }) => {
          if (data.threadId === threadId) {
            controller.close();
            cleanup();
          }
        });

        // Listen for errors
        const unsubError = window.niom.chat.onError((data: { threadId: string; error: string }) => {
          if (data.threadId === threadId) {
            controller.error(new Error(data.error));
            cleanup();
          }
        });

        // Handle abort
        const onAbort = () => {
          window.niom.chat.cancel(threadId);
          try {
            controller.close();
          } catch {
            // Stream may already be closed
          }
          cleanup();
        };

        abortSignal?.addEventListener("abort", onAbort);

        function cleanup() {
          unsubPart();
          unsubDone();
          unsubError();
          abortSignal?.removeEventListener("abort", onAbort);
        }
      },
    });
  }

  /**
   * Electron doesn't support stream reconnection (no persistent server).
   */
  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}
