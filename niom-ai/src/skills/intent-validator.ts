/**
 * Intent Validator — Tier 2 post-routing validation via LLM.
 *
 * Runs AFTER Skill Tree traversal, BEFORE execution. Uses the extraction
 * model (cheapest/fastest) to validate ambiguous routing decisions.
 *
 * This is NOT a replacement for the Skill Tree — it's a conditional
 * safety net that fires only when routing is uncertain (~20% of requests).
 *
 * Trigger conditions (any one):
 *   1. Ambiguous domain scores (top two within 0.1)
 *   2. Weak temporal signals (temporal language but no explicit schedule keyword)
 *   3. Long multi-clause queries with mixed intent signals
 *
 * Does NOT fire when (fast path preserved):
 *   1. High-confidence single-domain match (score > 0.75 and gap > 0.15)
 *   2. Tier 1 regex already handled schedule override
 *   3. Simple/short conversational queries (< 40 chars)
 *   4. Greetings / fast-path messages
 */

import { generateText, Output } from "ai";
import { z } from "zod";
import { getModelForRole } from "../ai/providers.js";
import { loadConfig } from "../config.js";
import type { SkillPath, ExecutionMode } from "./traversal.js";

// ── Trigger Detection ──

/** Weak temporal signals that MIGHT indicate scheduling but aren't explicit enough for Tier 1 regex */
const WEAK_TEMPORAL = /\b(morning|evening|night|afternoon|tomorrow|tonight|later|soon|regularly|often|frequently|routine|habit|ongoing|continuous|periodic|when(ever)?|before|after|until|while|during)\b/i;

/** Action + temporal combo that suggests scheduling intent */
const ACTION_TEMPORAL = /\b(send|create|generate|check|monitor|review|update|run|do|make|prepare|compile|draft|write)\b.*\b(morning|evening|daily|regularly|often|routine|every|before|after|whenever)\b/i;

/** Multi-clause indicators (commas, "and", "also", "then") suggesting mixed intent */
const MULTI_CLAUSE = /,.*\b(and|also|then|plus|but)\b/i;

// ── Schema ──

const IntentValidationSchema = z.object({
    executionModeOverride: z.enum(["stream", "generate", "background"]).nullable()
        .describe("Override execution mode if routing is incorrect. null = no change needed."),
    isRecurring: z.boolean()
        .describe("Whether this request implies recurring/scheduled execution."),
    scheduleHint: z.string().nullable()
        .describe("Human-readable schedule description if recurring (e.g., 'daily', 'every morning', 'weekly on Mondays'). null if not recurring."),
    confidence: z.number()
        .describe("How confident you are in the override decision, 0.0 to 1.0. Use 0.0 if no override needed."),
    reason: z.string()
        .describe("Brief explanation of your validation decision (1 sentence for logging)."),
});

type IntentValidation = z.infer<typeof IntentValidationSchema>;

// ── Public API ──

/**
 * Determine whether Tier 2 validation should fire for this SkillPath.
 *
 * Returns true only for ambiguous routing decisions — keeping the fast
 * path fast (~80% of requests skip this entirely).
 */
export function shouldValidate(path: SkillPath, hasScheduleSignal: boolean): boolean {
    const message = path.goal;

    // Skip: Tier 1 already handled
    if (hasScheduleSignal) return false;

    // Skip: greetings and trivially short messages
    if (message.length < 40) return false;

    // Skip: already a background task from automation score
    if (path.executionMode === "background") return false;

    // Condition 1: ambiguous domain scores (top two are close)
    if (path.domains.length >= 2) {
        const gap = path.domains[0].score - path.domains[1].score;
        if (gap < 0.1) return true;
    }

    // Condition 2: weak temporal signals (might be scheduling but unclear)
    if (WEAK_TEMPORAL.test(message)) return true;

    // Condition 3: action + temporal combo (strong scheduling signal missed by regex)
    if (ACTION_TEMPORAL.test(message)) return true;

    // Condition 4: long multi-clause query with mixed intent
    if (message.length > 120 && MULTI_CLAUSE.test(message)) return true;

    return false;
}

/**
 * Run the Tier 2 intent validation using the extraction model.
 *
 * Returns the original path if validation says no changes needed,
 * or a modified path with overrides applied.
 *
 * Designed to be fast (~300-500ms) and cheap (extraction model).
 * Only applies overrides with confidence > 0.7.
 */
export async function validateIntent(path: SkillPath): Promise<SkillPath> {
    const config = loadConfig();

    // Can't validate without an API key
    if (!config.provider_keys?.[config.provider]) return path;

    try {
        const model = getModelForRole("extraction", config);

        const { output } = await generateText({
            model,
            temperature: 0.1,
            output: Output.object({
                schema: IntentValidationSchema,
            }),
            messages: [
                {
                    role: "system",
                    content: VALIDATION_PROMPT,
                },
                {
                    role: "user",
                    content: buildValidationInput(path),
                },
            ],
        });

        if (!output) return path;

        return applyValidation(path, output);
    } catch (err: any) {
        // Non-critical — if validation fails, use unvalidated path
        console.warn(`[IntentValidator] Validation failed:`, err.message);
        return path;
    }
}

// ── Internals ──

const VALIDATION_PROMPT = `You are a routing validator for a personal AI assistant called NIOM. Your job is to validate whether a user message was routed to the correct execution mode.

The three execution modes are:
- "stream": Simple requests — conversation, questions, quick tasks. Direct response streamed to the user.
- "generate": Complex multi-step tasks — research, writing, analysis. Agent uses tools silently, then presents results.
- "background": Scheduled/recurring/long-running tasks — daily sends, monitoring, reminders. Creates a persistent task that runs on a schedule.

Your specific mandate is to catch MISSED scheduling/recurring intent. Here are signals that indicate "background" mode:
- Time-based patterns: "every morning", "weekly", "on Mondays", "before my standup"
- Recurring language: "part of my routine", "keep doing this", "regularly", "ongoing"
- Monitoring: "keep an eye on", "watch for", "alert me when"
- Event-driven: "whenever new articles drop", "when the price changes"
- Implicit scheduling: "I want this to be a habit", "make this automatic"

IMPORTANT:
- Only suggest an override if you are confident (>0.7) the current routing is wrong.
- If the current routing seems correct, set executionModeOverride to null and confidence to 0.0.
- Be conservative — false positives are worse than false negatives.
- One-time requests that mention time ("do this tonight") are NOT recurring.`;

function buildValidationInput(path: SkillPath): string {
    const topDomains = path.domains
        .slice(0, 3)
        .map(d => `${d.name} (${d.score.toFixed(2)})`)
        .join(", ");

    return `User message: "${path.goal}"

Current routing:
- Execution mode: ${path.executionMode}
- Primary domain: ${path.primaryDomain}
- Domain scores: ${topDomains}
- Is recurring: ${path.isRecurring}

Is this routing correct? Should the execution mode be different?`;
}

function applyValidation(path: SkillPath, validation: IntentValidation): SkillPath {
    // Only apply overrides with sufficient confidence
    if (!validation.executionModeOverride || validation.confidence < 0.7) {
        if (validation.confidence > 0) {
            console.log(
                `[IntentValidator] Low confidence (${validation.confidence.toFixed(2)}), ` +
                `keeping ${path.executionMode}: ${validation.reason}`
            );
        }
        return path;
    }

    // Apply the override
    const overriddenMode = validation.executionModeOverride as ExecutionMode;

    console.log(
        `[IntentValidator] Override: ${path.executionMode} → ${overriddenMode} ` +
        `(confidence: ${validation.confidence.toFixed(2)}) — ${validation.reason}` +
        (validation.scheduleHint ? ` [schedule: ${validation.scheduleHint}]` : "")
    );

    return {
        ...path,
        executionMode: overriddenMode,
        isRecurring: validation.isRecurring || path.isRecurring,
        isLongRunning: overriddenMode === "background" || path.isLongRunning,
        // If switching to background, ensure adequate step budget
        stepBudget: overriddenMode === "background" ? Math.max(path.stepBudget, 25) : path.stepBudget,
    };
}
