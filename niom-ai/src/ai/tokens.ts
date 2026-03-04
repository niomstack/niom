/**
 * tokens.ts — Fast token estimation and model context limits.
 *
 * Uses a heuristic (4 chars ≈ 1 token) that intentionally overestimates
 * to avoid edge cases. No tokenizer library needed — the goal is speed,
 * not precision. We're managing a budget, not billing.
 */

import type { ModelMessage } from "ai";

// ── Token Estimation ──────────────────────────────────────

/**
 * Estimate token count for a string.
 * ~4 characters per token for English text (conservative).
 * JSON/code tends to be ~3.5 chars/token, so this slightly overestimates.
 */
export function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 3.8);
}

/**
 * Estimate tokens for a single message (handles all content shapes).
 * Adds overhead for role/structure tokens (~4 per message).
 */
export function estimateMessageTokens(msg: ModelMessage): number {
    const overhead = 4; // role + formatting tokens

    if (typeof msg.content === "string") {
        return overhead + estimateTokens(msg.content);
    }

    if (Array.isArray(msg.content)) {
        let total = overhead;
        for (const part of msg.content) {
            if ("text" in part && typeof part.text === "string") {
                total += estimateTokens(part.text);
            } else if ("type" in part && part.type === "image") {
                total += 1000; // rough image token estimate
            } else if ("type" in part && part.type === "tool-call") {
                const tc = part as { toolName?: string; args?: unknown };
                total += estimateTokens(tc.toolName || "");
                total += estimateTokens(
                    typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args ?? "")
                );
            } else if ("type" in part && part.type === "tool-result") {
                const tr = part as { result?: unknown };
                total += estimateTokens(
                    typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result ?? "")
                );
            } else {
                // Fallback: serialize whatever it is
                total += estimateTokens(JSON.stringify(part));
            }
        }
        return total;
    }

    // Fallback for unexpected shapes
    return overhead + estimateTokens(JSON.stringify(msg.content ?? ""));
}

/**
 * Estimate total tokens for an array of messages.
 */
export function estimateTotalTokens(messages: ModelMessage[]): number {
    let total = 0;
    for (const msg of messages) {
        total += estimateMessageTokens(msg);
    }
    return total;
}

// ── Model Context Limits ──────────────────────────────────

interface ModelLimit {
    maxInput: number;
    reserveOutput: number;
}

/**
 * Known model context limits.
 * maxInput = total context window for input
 * reserveOutput = tokens reserved for the model's response
 */
const MODEL_LIMITS: Record<string, ModelLimit> = {
    // Anthropic
    "claude-opus-4-20250514": { maxInput: 200_000, reserveOutput: 16_384 },
    "claude-sonnet-4-20250514": { maxInput: 200_000, reserveOutput: 16_384 },
    "claude-3-5-sonnet-20241022": { maxInput: 200_000, reserveOutput: 8_192 },
    "claude-3-5-haiku-20241022": { maxInput: 200_000, reserveOutput: 8_192 },

    // OpenAI
    "gpt-4o": { maxInput: 128_000, reserveOutput: 16_384 },
    "gpt-4o-mini": { maxInput: 128_000, reserveOutput: 16_384 },
    "gpt-4-turbo": { maxInput: 128_000, reserveOutput: 4_096 },
    "o1": { maxInput: 200_000, reserveOutput: 100_000 },
    "o1-mini": { maxInput: 128_000, reserveOutput: 65_536 },
    "o3-mini": { maxInput: 200_000, reserveOutput: 100_000 },

    // Google
    "gemini-2.5-pro-preview-05-06": { maxInput: 1_000_000, reserveOutput: 65_536 },
    "gemini-2.5-flash-preview-05-20": { maxInput: 1_000_000, reserveOutput: 65_536 },
    "gemini-2.0-flash": { maxInput: 1_000_000, reserveOutput: 8_192 },
    "gemini-1.5-pro": { maxInput: 2_000_000, reserveOutput: 8_192 },

    // Groq
    "llama-3.3-70b-versatile": { maxInput: 128_000, reserveOutput: 8_192 },
    "llama-3.1-8b-instant": { maxInput: 128_000, reserveOutput: 8_192 },

    // Mistral
    "mistral-large-latest": { maxInput: 128_000, reserveOutput: 8_192 },
    "mistral-small-latest": { maxInput: 32_000, reserveOutput: 4_096 },

    // xAI
    "grok-3": { maxInput: 131_072, reserveOutput: 8_192 },
    "grok-3-mini": { maxInput: 131_072, reserveOutput: 8_192 },
};

/** Reserve for system prompt + tool definitions */
const SYSTEM_RESERVE = 6_000;

/**
 * Get the usable context budget for a given model.
 *
 * Returns the maximum number of tokens that can be used for messages
 * (after reserving space for output, system prompt, and tool definitions).
 *
 * For unknown models, falls back to a conservative 100K limit.
 */
export function getContextBudget(modelId: string): number {
    // Try exact match first
    let limit = MODEL_LIMITS[modelId];

    // Try prefix match (handles provider-prefixed names like "openai/gpt-4o")
    if (!limit) {
        const bare = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
        limit = MODEL_LIMITS[bare];
    }

    // Try substring match (handles versioned names)
    if (!limit) {
        for (const [key, val] of Object.entries(MODEL_LIMITS)) {
            if (modelId.includes(key) || key.includes(modelId)) {
                limit = val;
                break;
            }
        }
    }

    // Conservative fallback
    if (!limit) {
        limit = { maxInput: 100_000, reserveOutput: 8_192 };
    }

    return limit.maxInput - limit.reserveOutput - SYSTEM_RESERVE;
}
