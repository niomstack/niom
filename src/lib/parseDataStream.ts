/**
 * parseDataStream — Parses AI SDK UI Message Stream Protocol (SSE).
 * 
 * Calls handlers as events arrive:
 * - onText(delta, accumulated) — text content streaming
 * - onToolStart(toolCallId, toolName) — tool execution begins
 * - onToolInput(toolCallId, toolName, input) — full tool input available
 * - onToolOutput(toolCallId, output) — tool result available
 * - onToolApproval(approvalId, toolCallId, toolName, input) — tool needs user approval
 * - onStepStart() — new agent step begins
 * - onStepFinish() — agent step complete
 * - onFinish() — message complete
 * - onError(error) — error occurred
 */

export interface StreamHandlers {
    onText?: (delta: string, accumulated: string) => void;
    onToolStart?: (toolCallId: string, toolName: string) => void;
    onToolInput?: (toolCallId: string, toolName: string, input: any) => void;
    onToolOutput?: (toolCallId: string, output: any) => void;
    onToolApproval?: (approvalId: string, toolCallId: string, toolName: string, input: any) => void;
    onReasoning?: (text: string) => void;
    onStepStart?: () => void;
    onStepFinish?: () => void;
    onFinish?: () => void;
    onError?: (error: string) => void;
}

export async function parseDataStream(
    response: Response,
    handlers: StreamHandlers,
    signal?: AbortSignal
): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response stream");

    const decoder = new TextDecoder();
    let buffer = "";
    let accumulatedText = "";

    try {
        while (true) {
            if (signal?.aborted) break;

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE lines
            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; // Keep incomplete last line

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(":")) continue; // Skip empty lines and comments (keepalive pings)

                if (trimmed.startsWith("data: ")) {
                    const data = trimmed.slice(6);

                    // [DONE] marker
                    if (data === "[DONE]") {
                        handlers.onFinish?.();
                        return;
                    }

                    try {
                        const event = JSON.parse(data);
                        processEvent(event, handlers, accumulatedText, (text) => {
                            accumulatedText = text;
                        });
                    } catch {
                        // Non-JSON data line — treat as plain text
                        accumulatedText += data;
                        handlers.onText?.(data, accumulatedText);
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    handlers.onFinish?.();
}

function processEvent(
    event: any,
    handlers: StreamHandlers,
    accumulatedText: string,
    setAccumulated: (text: string) => void
): void {
    switch (event.type) {
        case "text-delta":
            accumulatedText += event.delta || "";
            setAccumulated(accumulatedText);
            handlers.onText?.(event.delta || "", accumulatedText);
            break;

        case "text-start":
        case "text-end":
            // Boundaries — no action needed for basic rendering
            break;

        case "tool-input-start":
            handlers.onToolStart?.(event.toolCallId, event.toolName);
            break;

        case "tool-input-available":
            handlers.onToolInput?.(event.toolCallId, event.toolName, event.input);
            break;

        case "tool-output-available":
            handlers.onToolOutput?.(event.toolCallId, event.output);
            break;

        case "start-step":
            handlers.onStepStart?.();
            break;

        case "finish-step":
            handlers.onStepFinish?.();
            break;

        case "finish":
            handlers.onFinish?.();
            break;

        case "error":
            handlers.onError?.(event.errorText || "Unknown error");
            break;

        case "tool-approval-request":
            handlers.onToolApproval?.(
                event.approvalId,
                event.toolCall?.toolCallId || event.toolCallId,
                event.toolCall?.toolName || event.toolName,
                event.toolCall?.input || event.input
            );
            break;

        case "start":
        case "abort":
            // Recognized but not handled
            break;

        case "reasoning-start":
        case "reasoning-end":
            // Boundaries — used by reasoning-delta
            break;

        case "reasoning-delta":
            if (event.delta) {
                handlers.onReasoning?.(event.delta);
            }
            break;

        default:
            // Unknown event type — ignore
            break;
    }
}
