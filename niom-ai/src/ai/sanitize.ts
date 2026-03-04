/**
 * sanitize.ts — Message sanitizer for the AI SDK.
 *
 * The frontend sends messages that may not perfectly match the
 * ModelMessage[] schema expected by the AI SDK. This module
 * sanitizes incoming messages to ensure they're valid.
 *
 * Common issues:
 *   - Missing `content` field (null/undefined instead of "")
 *   - Tool result content as plain string instead of proper ToolContent
 *   - Extra fields the schema doesn't expect
 *   - Empty messages that confuse providers
 */

import type { ModelMessage } from "ai";

/**
 * Sanitize a messages array to ensure it conforms to ModelMessage[].
 *
 * This is a defensive layer — it catches malformed messages before
 * they hit the AI SDK's strict validation.
 *
 * @returns A cleaned messages array (new array, original untouched)
 */
export function sanitizeMessages(messages: unknown[]): ModelMessage[] {
    if (!Array.isArray(messages)) return [];

    const sanitized: ModelMessage[] = [];

    for (const msg of messages) {
        const m = msg as Record<string, unknown>;
        if (!m || typeof m !== "object") continue;

        const role = m.role as string;
        if (!role) continue;

        try {
            switch (role) {
                case "user":
                    sanitized.push(sanitizeUserMessage(m));
                    break;
                case "assistant":
                    sanitized.push(sanitizeAssistantMessage(m));
                    break;
                case "tool":
                    sanitized.push(sanitizeToolMessage(m));
                    break;
                case "system":
                    sanitized.push(sanitizeSystemMessage(m));
                    break;
                default:
                    // Unknown role — try to use as-is, skip if truly broken
                    if (m.content !== undefined) {
                        sanitized.push(m as ModelMessage);
                    }
            }
        } catch (err) {
            // Skip messages that can't be sanitized at all
            console.warn(`[sanitize] Skipping malformed message (role=${role}):`, err);
        }
    }

    return sanitized;
}

function sanitizeUserMessage(m: Record<string, unknown>): ModelMessage {
    // User messages must have content as string or content parts array
    if (typeof m.content === "string") {
        return { role: "user", content: m.content || " " }; // Never empty string
    }

    if (Array.isArray(m.content)) {
        // Filter out invalid parts
        const parts = (m.content as any[])
            .filter((p: any) => p && typeof p === "object" && p.type)
            .map((p: any) => {
                if (p.type === "text") {
                    return { type: "text" as const, text: String(p.text ?? "") };
                }
                return p; // image, file parts — pass through
            });

        if (parts.length === 0) {
            return { role: "user", content: " " };
        }
        return { role: "user", content: parts } as ModelMessage;
    }

    // Fallback: coerce to string
    return { role: "user", content: String(m.content ?? " ") };
}

function sanitizeAssistantMessage(m: Record<string, unknown>): ModelMessage {
    if (typeof m.content === "string") {
        return { role: "assistant", content: m.content || " " };
    }

    if (Array.isArray(m.content)) {
        const parts = (m.content as any[])
            .filter((p: any) => p && typeof p === "object" && p.type)
            .map((p: any) => {
                if (p.type === "text") {
                    return { type: "text" as const, text: String(p.text ?? "") };
                }
                if (p.type === "tool-call") {
                    return {
                        type: "tool-call" as const,
                        toolCallId: String(p.toolCallId ?? p.id ?? ""),
                        toolName: String(p.toolName ?? ""),
                        args: p.args ?? p.input ?? {},
                    };
                }
                return p; // reasoning, tool-approval-request — pass through
            });

        if (parts.length === 0) {
            return { role: "assistant", content: " " };
        }
        return { role: "assistant", content: parts } as ModelMessage;
    }

    return { role: "assistant", content: String(m.content ?? " ") };
}

function sanitizeToolMessage(m: Record<string, unknown>): ModelMessage {
    if (Array.isArray(m.content)) {
        const parts = (m.content as any[])
            .filter((p: any) => p && typeof p === "object" && p.type)
            .map((p: any) => {
                if (p.type === "tool-result") {
                    // Ensure result is properly structured
                    let result = p.result;
                    if (result === undefined || result === null) {
                        result = "";
                    }
                    // If result is an object, wrap in the expected format
                    if (typeof result === "object" && result.type === undefined) {
                        result = { type: "json" as const, value: result };
                    }
                    return {
                        type: "tool-result" as const,
                        toolCallId: String(p.toolCallId ?? ""),
                        toolName: p.toolName,
                        result,
                    };
                }
                return p; // tool-approval-response — pass through
            });

        if (parts.length === 0) {
            // Empty tool message — this is invalid, make it a placeholder
            console.warn("[sanitize] Removing empty tool message");
            return { role: "tool", content: [{ type: "tool-result", toolCallId: "unknown", result: "" }] } as any as ModelMessage;
        }
        return { role: "tool", content: parts } as any as ModelMessage;
    }

    // Tool messages with string content — shouldn't happen, but handle it
    if (typeof m.content === "string") {
        return { role: "tool", content: [{ type: "tool-result", toolCallId: "unknown", result: m.content }] } as any as ModelMessage;
    }

    console.warn("[sanitize] Tool message with unexpected content:", typeof m.content);
    return m as ModelMessage;
}

function sanitizeSystemMessage(m: Record<string, unknown>): ModelMessage {
    return { role: "system" as any, content: String(m.content ?? "") } as ModelMessage;
}
