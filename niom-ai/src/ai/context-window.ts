/**
 * context-window.ts — Intelligent context compression pipeline.
 *
 * Ensures the conversation never exceeds the model's context window.
 * Uses a 4-stage pipeline that applies progressively more aggressive
 * compression until the messages fit within the budget.
 *
 * No LLM calls — all compression is heuristic-based for zero cost.
 *
 * Pipeline:
 *   Stage 1: Truncate large tool results (biggest single-item wins)
 *   Stage 2: Deduplicate repeated tool calls (e.g., same file read twice)
 *   Stage 3: Summarize old exchanges (compress assistant turns to one-liners)
 *   Stage 4: Sliding window (drop middle messages, keep first + last N)
 */

import type { ModelMessage } from "ai";
import { estimateTokens, estimateMessageTokens, estimateTotalTokens } from "./tokens.js";

// ── Configuration ─────────────────────────────────────────

/** Tool results larger than this get truncated in Stage 1 */
const TRUNCATE_THRESHOLD = 2_000; // tokens

/** Keep this many tokens from the start of a truncated result */
const TRUNCATE_KEEP_HEAD = 800;

/** Keep this many tokens from the end of a truncated result */
const TRUNCATE_KEEP_TAIL = 200;

/** Messages within this window from the end are never compressed (stages 2-3) */
const PROTECTED_TAIL = 10;

// ── Types ─────────────────────────────────────────────────

export interface CompressionResult {
    messages: ModelMessage[];
    originalTokens: number;
    compressedTokens: number;
    stages: StageResult[];
}

interface StageResult {
    name: string;
    tokensSaved: number;
    actions: string[];  // Human-readable description of what was done
}

// ── Main Entry Point ──────────────────────────────────────

/**
 * Compress messages to fit within the given token budget.
 *
 * Runs stages sequentially, stopping as soon as messages fit.
 * Returns the compressed messages and diagnostic info.
 */
export function compressContext(
    messages: ModelMessage[],
    budget: number,
): CompressionResult {
    const originalTokens = estimateTotalTokens(messages);

    // Already fits — no compression needed
    if (originalTokens <= budget) {
        return {
            messages,
            originalTokens,
            compressedTokens: originalTokens,
            stages: [],
        };
    }

    let current = [...messages]; // shallow copy to avoid mutating the original
    const stages: StageResult[] = [];
    let currentTokens = originalTokens;

    // Stage 1: Truncate large tool results
    const stage1 = truncateLargeResults(current, budget);
    if (stage1.tokensSaved > 0) {
        current = stage1.messages;
        currentTokens -= stage1.tokensSaved;
        stages.push(stage1.result);
    }
    if (currentTokens <= budget) {
        return { messages: current, originalTokens, compressedTokens: currentTokens, stages };
    }

    // Stage 2: Deduplicate repeated tool results
    const stage2 = deduplicateToolResults(current, budget);
    if (stage2.tokensSaved > 0) {
        current = stage2.messages;
        currentTokens -= stage2.tokensSaved;
        stages.push(stage2.result);
    }
    if (currentTokens <= budget) {
        return { messages: current, originalTokens, compressedTokens: currentTokens, stages };
    }

    // Stage 3: Compress old exchanges
    const stage3 = compressOldExchanges(current, budget);
    if (stage3.tokensSaved > 0) {
        current = stage3.messages;
        currentTokens -= stage3.tokensSaved;
        stages.push(stage3.result);
    }
    if (currentTokens <= budget) {
        return { messages: current, originalTokens, compressedTokens: currentTokens, stages };
    }

    // Stage 4: Sliding window (last resort)
    const stage4 = applySlidingWindow(current, budget);
    current = stage4.messages;
    currentTokens = estimateTotalTokens(current); // Recount after major surgery
    stages.push(stage4.result);

    return { messages: current, originalTokens, compressedTokens: currentTokens, stages };
}

/**
 * Log compression results (call after compressContext).
 */
export function logCompression(result: CompressionResult): void {
    if (result.stages.length === 0) return;

    const saved = result.originalTokens - result.compressedTokens;
    const pct = Math.round((saved / result.originalTokens) * 100);
    console.log(
        `[context] ${result.originalTokens.toLocaleString()} tokens → ${result.compressedTokens.toLocaleString()} tokens (-${saved.toLocaleString()}, ${pct}%)`
    );
    for (const stage of result.stages) {
        console.log(`[context]   ${stage.name}: -${stage.tokensSaved.toLocaleString()} tokens (${stage.actions.join(", ")})`);
    }
}

// ══════════════════════════════════════════════════════════
//  Stage 1: Truncate Large Tool Results
// ══════════════════════════════════════════════════════════

function truncateLargeResults(
    messages: ModelMessage[],
    _budget: number,
): { messages: ModelMessage[]; tokensSaved: number; result: StageResult } {
    let tokensSaved = 0;
    const actions: string[] = [];
    const lastIndex = messages.length - 1;

    const result = messages.map((msg, i) => {
        // Never truncate the last message
        if (i === lastIndex) return msg;

        if (msg.role === "tool" || (msg.role === "assistant" && hasToolResults(msg))) {
            const { truncated, saved } = truncateMessageContent(msg, i > lastIndex - 2);
            if (saved > 0) {
                tokensSaved += saved;
                actions.push(`msg[${i}] -${saved}`);
                return truncated;
            }
        }
        return msg;
    });

    return {
        messages: result,
        tokensSaved,
        result: { name: "Truncate large results", tokensSaved, actions },
    };
}

function hasToolResults(msg: ModelMessage): boolean {
    if (!Array.isArray(msg.content)) return false;
    return msg.content.some((p: { type?: string }) => p.type === "tool-result");
}

function truncateMessageContent(
    msg: ModelMessage,
    isRecent: boolean,
): { truncated: ModelMessage; saved: number } {
    if (typeof msg.content === "string") {
        const tokens = estimateTokens(msg.content);
        if (tokens <= TRUNCATE_THRESHOLD) return { truncated: msg, saved: 0 };
        if (isRecent) return { truncated: msg, saved: 0 }; // Protect recent

        const headChars = TRUNCATE_KEEP_HEAD * 4;
        const tailChars = TRUNCATE_KEEP_TAIL * 4;
        const head = msg.content.slice(0, headChars);
        const tail = msg.content.slice(-tailChars);
        const omitted = tokens - TRUNCATE_KEEP_HEAD - TRUNCATE_KEEP_TAIL;
        const newContent = `${head}\n\n[... ${omitted.toLocaleString()} tokens omitted ...]\n\n${tail}`;
        return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            truncated: { ...msg, content: newContent } as any as ModelMessage,
            saved: tokens - estimateTokens(newContent),
        };
    }

    if (Array.isArray(msg.content)) {
        let totalSaved = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const newParts = (msg.content as any[]).map((part: any) => {
            if (part.type === "tool-result" && typeof part.result === "string") {
                const tokens = estimateTokens(part.result);
                if (tokens <= TRUNCATE_THRESHOLD || isRecent) return part;

                const headChars = TRUNCATE_KEEP_HEAD * 4;
                const tailChars = TRUNCATE_KEEP_TAIL * 4;
                const text = part.result as string;
                const head = text.slice(0, headChars);
                const tail = text.slice(-tailChars);
                const omitted = tokens - TRUNCATE_KEEP_HEAD - TRUNCATE_KEEP_TAIL;
                const truncatedResult = `${head}\n\n[... ${omitted.toLocaleString()} tokens omitted ...]\n\n${tail}`;
                totalSaved += tokens - estimateTokens(truncatedResult);
                return { ...part, result: truncatedResult };
            }

            // Handle nested tool results in content arrays
            if (part.type === "tool-result" && Array.isArray(part.result)) {
                const serialized = JSON.stringify(part.result);
                const tokens = estimateTokens(serialized);
                if (tokens <= TRUNCATE_THRESHOLD || isRecent) return part;

                const headChars = TRUNCATE_KEEP_HEAD * 4;
                const tailChars = TRUNCATE_KEEP_TAIL * 4;
                const head = serialized.slice(0, headChars);
                const tail = serialized.slice(-tailChars);
                const omitted = tokens - TRUNCATE_KEEP_HEAD - TRUNCATE_KEEP_TAIL;
                const truncatedResult = `${head}\n\n[... ${omitted.toLocaleString()} tokens omitted ...]\n\n${tail}`;
                totalSaved += tokens - estimateTokens(truncatedResult);
                return { ...part, result: truncatedResult };
            }

            return part;
        });

        return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            truncated: { ...msg, content: newParts } as any as ModelMessage,
            saved: totalSaved,
        };
    }

    return { truncated: msg, saved: 0 };
}

// ══════════════════════════════════════════════════════════
//  Stage 2: Deduplicate Repeated Tool Results
// ══════════════════════════════════════════════════════════

function deduplicateToolResults(
    messages: ModelMessage[],
    _budget: number,
): { messages: ModelMessage[]; tokensSaved: number; result: StageResult } {
    let tokensSaved = 0;
    const actions: string[] = [];

    // Track the last occurrence of each tool+argument combo
    const seen = new Map<string, number>(); // key → last index

    // First pass: find duplicates
    messages.forEach((msg, i) => {
        if (i >= messages.length - PROTECTED_TAIL) return; // Protect tail
        const key = extractToolKey(msg);
        if (key) seen.set(key, i);
    });

    // Also scan the protected tail to find latest versions
    messages.forEach((msg, i) => {
        if (i < messages.length - PROTECTED_TAIL) return;
        const key = extractToolKey(msg);
        if (key) seen.set(key, i);
    });

    // Second pass: replace earlier duplicates
    const result = messages.map((msg, i) => {
        if (i >= messages.length - PROTECTED_TAIL) return msg; // Keep tail as-is

        const key = extractToolKey(msg);
        if (!key) return msg;

        const lastIndex = seen.get(key);
        if (lastIndex !== undefined && lastIndex !== i && lastIndex > i) {
            // This is an earlier duplicate — replace with stub
            const originalTokens = estimateMessageTokens(msg);
            const stub = `[Previously read — see updated version below]`;
            const stubTokens = estimateTokens(stub);
            tokensSaved += Math.max(0, originalTokens - stubTokens);
            actions.push(`deduped "${key.slice(0, 40)}"`);
            return { ...msg, content: stub } as ModelMessage;
        }

        return msg;
    });

    return {
        messages: result,
        tokensSaved,
        result: { name: "Deduplicate tool results", tokensSaved, actions },
    };
}

/**
 * Extract a dedup key from a message (e.g., "readFile:/path/to/file").
 * Returns null for messages that can't/shouldn't be deduped.
 */
function extractToolKey(msg: ModelMessage): string | null {
    if (!Array.isArray(msg.content)) return null;

    for (const part of msg.content) {
        const p = part as Record<string, unknown>;
        if (p.type === "tool-call") {
            const name = p.toolName as string;
            // Only dedup read operations (read, list, search)
            if (["readFile", "listDirectory", "searchFiles", "grepSearch"].includes(name)) {
                const args = typeof p.args === "string" ? p.args : JSON.stringify(p.args ?? "");
                return `${name}:${args}`;
            }
        }
    }
    return null;
}

// ══════════════════════════════════════════════════════════
//  Stage 3: Compress Old Exchanges
// ══════════════════════════════════════════════════════════

function compressOldExchanges(
    messages: ModelMessage[],
    _budget: number,
): { messages: ModelMessage[]; tokensSaved: number; result: StageResult } {
    let tokensSaved = 0;
    const actions: string[] = [];
    let compressed = 0;

    const cutoff = messages.length - PROTECTED_TAIL;

    const result = messages.map((msg, i) => {
        // Only compress messages in the old section
        if (i >= cutoff) return msg;
        // Only compress assistant messages (keep user messages for context)
        if (msg.role !== "assistant") return msg;

        const originalTokens = estimateMessageTokens(msg);
        if (originalTokens < 200) return msg; // Not worth compressing small messages

        // Build a one-line summary from the message content
        const summary = buildMessageSummary(msg);
        const summaryTokens = estimateTokens(summary);
        const saved = originalTokens - summaryTokens;

        if (saved > 100) { // Only if meaningful savings
            tokensSaved += saved;
            compressed++;
            return { ...msg, content: summary } as ModelMessage;
        }

        return msg;
    });

    if (compressed > 0) {
        actions.push(`summarized ${compressed} old assistant messages`);
    }

    return {
        messages: result,
        tokensSaved,
        result: { name: "Compress old exchanges", tokensSaved, actions },
    };
}

/**
 * Build a concise one-line summary of an assistant message.
 * Extracts tool call names and brief text snippets.
 */
function buildMessageSummary(msg: ModelMessage): string {
    const parts: string[] = [];

    if (typeof msg.content === "string") {
        // Keep first 100 chars of text
        const preview = msg.content.slice(0, 100).replace(/\n/g, " ");
        return `[Earlier response: ${preview}${msg.content.length > 100 ? "..." : ""}]`;
    }

    if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
            const p = part as Record<string, unknown>;
            if (p.type === "text" && typeof p.text === "string") {
                const preview = (p.text as string).slice(0, 80).replace(/\n/g, " ");
                parts.push(preview);
            } else if (p.type === "tool-call") {
                const name = p.toolName as string || "tool";
                const args = p.args as Record<string, unknown> | undefined;
                // Extract the key argument (usually the first string arg)
                let argHint = "";
                if (args) {
                    const firstArg = Object.values(args).find(v => typeof v === "string") as string | undefined;
                    if (firstArg) argHint = `: ${firstArg.slice(0, 50)}`;
                }
                parts.push(`called ${name}${argHint}`);
            } else if (p.type === "tool-result") {
                // Skip tool results in summaries — they're too large
                parts.push(`(result)`);
            }
        }
    }

    if (parts.length === 0) return "[Earlier assistant response]";
    return `[Earlier: ${parts.join(" → ")}]`;
}

// ══════════════════════════════════════════════════════════
//  Stage 4: Sliding Window (last resort)
// ══════════════════════════════════════════════════════════

function applySlidingWindow(
    messages: ModelMessage[],
    budget: number,
): { messages: ModelMessage[]; result: StageResult } {
    // Strategy: keep first user message + as many tail messages as fit
    const firstUserIdx = messages.findIndex(m => m.role === "user");
    const firstMessage = firstUserIdx >= 0 ? messages[firstUserIdx] : null;
    const firstTokens = firstMessage ? estimateMessageTokens(firstMessage) : 0;

    // Budget for tail messages
    const markerTokens = 50; // "[N messages omitted]"
    const tailBudget = budget - firstTokens - markerTokens;

    // Walk backwards from the end, accumulating messages until we hit the budget
    let tailTokens = 0;
    let tailStart = messages.length;
    for (let i = messages.length - 1; i >= 0; i--) {
        const msgTokens = estimateMessageTokens(messages[i]);
        if (tailTokens + msgTokens > tailBudget) break;
        tailTokens += msgTokens;
        tailStart = i;
    }

    // Ensure we keep at least the last 4 messages
    tailStart = Math.min(tailStart, messages.length - 4);
    if (tailStart < 0) tailStart = 0;

    const dropped = tailStart - (firstUserIdx >= 0 ? 1 : 0);
    const marker: ModelMessage = {
        role: "user" as const,
        content: `[... ${dropped} earlier messages omitted for context window management ...]`,
    };

    const kept: ModelMessage[] = [];
    if (firstMessage && firstUserIdx < tailStart) {
        kept.push(firstMessage);
    }
    if (dropped > 0) {
        kept.push(marker);
    }
    kept.push(...messages.slice(tailStart));

    return {
        messages: kept,
        result: {
            name: "Sliding window",
            tokensSaved: 0, // Recount happens in the caller
            actions: [`kept first message + last ${messages.length - tailStart} of ${messages.length} messages, dropped ${dropped}`],
        },
    };
}
