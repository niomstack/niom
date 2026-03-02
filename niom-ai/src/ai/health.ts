/**
 * Tool Health Monitor — tracks tool call patterns and detects failure loops.
 *
 * Used by both the chat agent (streamText) and the task runner (generateText)
 * via their prepareStep callbacks to inject corrective guidance when the agent
 * is stuck in a failure loop.
 *
 * Self-healing flow:
 *   1. onToolCallFinish records every tool result (success/failure)
 *   2. prepareStep checks health before each LLM call
 *   3. If failures detected, returns corrective system message and/or tool restrictions
 *   4. If critical threshold hit, signals the loop to stop
 */

import type { ModelMessage } from "ai";

// ── Types ──

export interface ToolCallRecord {
    tool: string;
    args: Record<string, unknown>;
    success: boolean;
    error?: string;
    stepNumber: number;
    timestamp: number;
}

export interface HealthCheck {
    /** Corrective system message to prepend, if any */
    systemSuffix?: string;
    /** Tools to disable for this step */
    disableTools?: string[];
    /** Whether the loop should abort (critical failure) */
    shouldAbort: boolean;
    /** Human-readable reason if aborting */
    abortReason?: string;
}

// ── Configuration ──

const CONFIG = {
    /** How many consecutive failures of the same tool before intervening */
    CONSECUTIVE_FAILURE_THRESHOLD: 3,
    /** How many total failures before circuit-breaking a specific tool */
    TOOL_FAILURE_CIRCUIT_BREAK: 5,
    /** If failure rate exceeds this across all tools, suggest stopping */
    GLOBAL_FAILURE_RATE_THRESHOLD: 0.7,
    /** Minimum tool calls before checking global failure rate */
    MIN_CALLS_FOR_GLOBAL_CHECK: 6,
};

// ── Monitor ──

export class ToolHealthMonitor {
    private records: ToolCallRecord[] = [];
    private circuitBroken = new Set<string>();

    /** Record a tool call result. Called from onToolCallFinish. */
    record(entry: ToolCallRecord): void {
        this.records.push(entry);
    }

    /** Get all records (for evaluation summary, debugging) */
    getRecords(): readonly ToolCallRecord[] {
        return this.records;
    }

    /** Reset for a new iteration/run */
    reset(): void {
        this.records = [];
        this.circuitBroken.clear();
    }

    /**
     * Check health and return corrective actions.
     * Called from prepareStep before each LLM call.
     */
    check(stepNumber: number): HealthCheck {
        if (this.records.length === 0) {
            return { shouldAbort: false };
        }

        const corrections: string[] = [];
        const disableTools: string[] = [];

        // ── 1. Consecutive same-tool failures ──
        // e.g. webSearch failed 3 times in a row
        const consecutive = this.getConsecutiveFailures();
        if (consecutive) {
            const { tool, count, errors } = consecutive;

            if (count >= CONFIG.TOOL_FAILURE_CIRCUIT_BREAK) {
                // Circuit-break: disable the tool entirely
                this.circuitBroken.add(tool);
                disableTools.push(tool);
                corrections.push(
                    `STOP using "${tool}" — it has failed ${count} times consecutively. ` +
                    `Last error: ${errors[errors.length - 1]}. ` +
                    `Use a completely different approach to accomplish your goal.`
                );
            } else if (count >= CONFIG.CONSECUTIVE_FAILURE_THRESHOLD) {
                corrections.push(
                    `WARNING: "${tool}" has failed ${count} times in a row. ` +
                    `Errors: ${errors.slice(-2).join("; ")}. ` +
                    `Try a DIFFERENT approach — different query, different tool, or skip this step.`
                );
            }
        }

        // ── 2. Repeated empty/invalid inputs ──
        // Agent sending blank queries, etc.
        const emptyInputCalls = this.records
            .slice(-5)
            .filter(r => {
                const args = r.args || {};
                return Object.values(args).some(v =>
                    v === "" || v === null || v === undefined
                );
            });

        if (emptyInputCalls.length >= 2) {
            corrections.push(
                `You sent ${emptyInputCalls.length} tool calls with empty or missing required arguments. ` +
                `This indicates a problem with your approach. ` +
                `STOP and think about what inputs you actually need before making another tool call.`
            );
        }

        // ── 3. Same exact tool call repeated ──
        // Agent calling the exact same thing expecting different results
        const duplicates = this.getDuplicateCalls();
        if (duplicates.length > 0) {
            corrections.push(
                `You called the same tool with identical arguments multiple times: ` +
                duplicates.map(d => `${d.tool}(${d.argsStr})`).join(", ") + `. ` +
                `This will produce the same result. Change your approach.`
            );
        }

        // ── 4. Global failure rate check ──
        if (this.records.length >= CONFIG.MIN_CALLS_FOR_GLOBAL_CHECK) {
            const failCount = this.records.filter(r => !r.success).length;
            const failRate = failCount / this.records.length;

            if (failRate >= CONFIG.GLOBAL_FAILURE_RATE_THRESHOLD) {
                return {
                    shouldAbort: true,
                    abortReason:
                        `${failCount}/${this.records.length} tool calls failed (${(failRate * 100).toFixed(0)}% failure rate). ` +
                        `The current approach is not working. Aborting to prevent further waste.`,
                    systemSuffix: corrections.join("\n\n"),
                    disableTools,
                };
            }
        }

        // ── 5. Add circuit-broken tools to disable list ──
        for (const tool of this.circuitBroken) {
            if (!disableTools.includes(tool)) {
                disableTools.push(tool);
            }
        }

        return {
            shouldAbort: false,
            systemSuffix: corrections.length > 0
                ? `\n\n⚠️ SELF-CORRECTION REQUIRED:\n${corrections.join("\n\n")}`
                : undefined,
            disableTools: disableTools.length > 0 ? disableTools : undefined,
        };
    }

    // ── Private helpers ──

    private getConsecutiveFailures(): { tool: string; count: number; errors: string[] } | null {
        if (this.records.length === 0) return null;

        // Walk backwards from the most recent record
        const latest = this.records[this.records.length - 1];
        if (latest.success) return null;

        let count = 0;
        const errors: string[] = [];

        for (let i = this.records.length - 1; i >= 0; i--) {
            const r = this.records[i];
            if (r.tool === latest.tool && !r.success) {
                count++;
                if (r.error) errors.unshift(r.error);
            } else {
                break; // streak broken
            }
        }

        return count >= CONFIG.CONSECUTIVE_FAILURE_THRESHOLD
            ? { tool: latest.tool, count, errors }
            : null;
    }

    private getDuplicateCalls(): { tool: string; argsStr: string }[] {
        const recent = this.records.slice(-8);
        const seen = new Map<string, number>();
        const duplicates: { tool: string; argsStr: string }[] = [];

        for (const r of recent) {
            const argsStr = JSON.stringify(r.args || {});
            const key = `${r.tool}:${argsStr}`;
            const prev = seen.get(key) || 0;
            seen.set(key, prev + 1);
            if (prev + 1 >= 2 && !duplicates.some(d => d.tool === r.tool && d.argsStr === argsStr)) {
                duplicates.push({ tool: r.tool, argsStr: argsStr.slice(0, 60) });
            }
        }

        return duplicates;
    }
}
