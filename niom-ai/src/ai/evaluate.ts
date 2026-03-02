/**
 * Result Evaluation — the quality-check phase of the NIOM Agent Engine.
 *
 * After the agent executes, this evaluates whether the goal was achieved
 * and whether the quality bar was met. Used for the evaluate-refine loop
 * in complex tasks.
 *
 * Not every execution needs evaluation:
 *   simple   → never evaluated (just respond)
 *   standard → evaluated once, result appended to response
 *   complex  → evaluated, may trigger re-execution with refinement hints
 */

import { generateText, Output } from "ai";
import { z } from "zod";
import { getModelForRole } from "./providers.js";

// ── Schema ──

export const Evaluation = z.object({
    satisfied: z.boolean().describe("True if the goal was fully achieved with acceptable quality"),
    qualityScore: z.number().min(0).max(1).describe("0-1 quality assessment of the result"),
    issues: z.array(z.string()).describe("Specific problems or gaps in the result"),
    recommendation: z.enum([
        "done",       // Goal met, deliver result
        "refine",     // Almost done, needs small improvements
        "retry",      // Approach failed, try a different strategy
        "ask_user",   // Need clarification or user input to continue
        "give_up",    // Can't achieve this goal with available tools
    ]).describe("What should the engine do next?"),
    refinementHint: z.string().optional().describe(
        "If recommendation is 'refine' or 'retry', describe what to do differently"
    ),
    summary: z.string().describe("One-sentence summary of the evaluation for logging"),
});

export type Evaluation = z.infer<typeof Evaluation>;

// ── Evaluate Prompt ──

const EVALUATE_SYSTEM_PROMPT = `You are a quality evaluator for NIOM, an ambient intelligence OS companion.

Your job is to evaluate whether the agent's execution achieved the user's goal.

Guidelines:
- Be honest but not harsh. If the agent achieved 80%+ of the goal, that's usually "done".
- Focus on concrete, actionable issues — not style preferences.
- "refine" means the result is close but needs specific improvements.
- "retry" means the approach was wrong and a different strategy is needed.
- "ask_user" means the goal is ambiguous and we need more information.
- "give_up" should be rare — only when the goal is truly impossible with available tools.
- If no quality criteria were specified, use common sense (correct, complete, well-formatted).

Be concise and practical. This evaluation controls whether the agent loops again.`;

// ── Main Function ──

/**
 * Evaluate the result of an agent execution.
 * Uses the "fast" model role — quality checks should be cheap and quick.
 */
export async function evaluateResult(
    goal: string,
    qualityCriteria: string | undefined,
    executionSummary: string,
): Promise<Evaluation> {
    try {
        // Use "fast" model for cheap quality evaluation
        const model = getModelForRole("fast");

        const prompt = [
            `## Goal`,
            goal,
            ``,
            qualityCriteria ? `## Quality Criteria\n${qualityCriteria}\n` : "",
            `## Agent's Execution`,
            executionSummary,
        ].filter(Boolean).join("\n");

        const { output } = await generateText({
            model,
            output: Output.object({ schema: Evaluation }),
            system: EVALUATE_SYSTEM_PROMPT,
            prompt,
            temperature: 0.1,
        });

        const result = output!;
        console.log(
            `[evaluate] ${result.satisfied ? "✓" : "✗"} quality=${result.qualityScore.toFixed(2)} → ${result.recommendation}` +
            (result.issues.length ? ` (${result.issues.length} issues)` : "")
        );

        return result;
    } catch (err: any) {
        console.warn(`[evaluate] Failed, assuming done:`, err.message);
        return {
            satisfied: true,
            qualityScore: 0.7,
            issues: [],
            recommendation: "done",
            summary: "Evaluation failed — assuming result is acceptable.",
        };
    }
}

/**
 * Build an execution summary from streamText result for evaluation.
 * Extracts text + tool call summaries into a concise string.
 *
 * Accepts AI SDK v6 step format: toolCalls use `input` (not `args`).
 */
export function buildExecutionSummary(
    text: string | undefined | null,
    steps: Array<{ text?: string; toolCalls?: Array<{ toolName: string; input?: any; args?: any }>; toolResults?: Array<{ result: any }> }> | undefined | null,
): string {
    const parts: string[] = [];

    if (steps?.length) {
        for (const step of steps) {
            if (step.toolCalls?.length) {
                for (let i = 0; i < step.toolCalls.length; i++) {
                    const tc = step.toolCalls[i];
                    const result = step.toolResults?.[i]?.result;
                    const resultStr = result
                        ? (typeof result === "string" ? result : JSON.stringify(result) ?? "").slice(0, 200)
                        : "no result";
                    const toolArgs = tc.input ?? tc.args;
                    const argsStr = (toolArgs ? JSON.stringify(toolArgs) ?? "" : "").slice(0, 100);
                    parts.push(`→ ${tc.toolName}(${argsStr}) = ${resultStr}`);
                }
            }
            if (step.text) {
                parts.push(step.text.slice(0, 300));
            }
        }
    }

    if (text && (!steps || !steps.some(s => s.text))) {
        parts.push(text.slice(0, 500));
    }

    return parts.join("\n").slice(0, 3000) || "(no output)";
}
