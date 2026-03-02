/**
 * Intent Analysis — the first phase of the NIOM Agent Engine.
 *
 * Fast (~200ms) structured analysis of user intent via generateText() + Output.object().
 * Determines complexity tier, task type, and quality criteria — which
 * controls how much reasoning depth the engine applies.
 *
 * Complexity tiers:
 *   simple     → direct streamText, 3 steps, no evaluation
 *   standard   → streamText with goal-aware prompt, 10 steps
 *   complex    → full pipeline: plan + execute + evaluate loop, 25 steps
 *   long_running → background task (future: TaskManager)
 */

import { generateText, Output } from "ai";
import { z } from "zod";
import { getModelForRole } from "./providers.js";
import { loadConfig } from "../config.js";

// ── Schema ──

export const IntentAnalysis = z.object({
    goal: z.string().describe("Clear, concise statement of what the user wants to achieve"),
    complexity: z.enum(["simple", "standard", "complex", "long_running"]).describe(
        "simple = greeting, quick question, one-liner. " +
        "standard = needs a few tool calls (list files, read, explain). " +
        "complex = multi-step task requiring planning (refactor, build, research). " +
        "long_running = background/recurring task (monitor, scheduled, ongoing)."
    ),
    taskType: z.enum([
        "chat",       // conversation, questions, explanations
        "action",     // do something concrete (file ops, commands)
        "research",   // search, read, synthesize information
        "create",     // write, build, generate content
        "analyze",    // examine, explain, review existing things
        "organize",   // sort, clean, restructure
        "automate",   // recurring, scheduled, background
    ]).describe("Primary category of the task"),
    isLongRunning: z.boolean().describe("True if this should run in the background or be scheduled"),
    requiresApproval: z.boolean().describe("True if the plan should be shown to the user before execution"),
    qualityCriteria: z.string().optional().describe(
        "How to evaluate if the result is good enough. " +
        "E.g. 'All files should compile', 'Report should cover 3+ sources', 'Code should follow existing patterns'."
    ),
    estimatedSteps: z.number().optional().describe("Rough estimate of tool calls needed (1-30)"),
    thinkingHint: z.string().optional().describe(
        "Brief strategic note about HOW to approach this task. " +
        "E.g. 'Check project structure first', 'Search multiple sources then synthesize', 'Read the file before modifying'."
    ),
}).describe("Intent analysis result for routing the agent engine");

export type IntentAnalysis = z.infer<typeof IntentAnalysis>;

// ── Fast-Path Heuristics ──

const GREETING_PATTERN = /^(hi|hey|hello|yo|sup|thanks|thx|ty|ok|okay|sure|yes|no|bye|gm|gn|lol|haha|nice|cool|great|wow)[\s!.?]*$/i;
const QUESTION_PATTERN = /^(what|who|why|how|when|where|which|can you|could you|do you|are you|is it|tell me)\b/i;

/**
 * Check if we can skip the LLM analysis entirely for trivially simple messages.
 * Returns an IntentAnalysis if we can fast-path, null if we need the LLM.
 */
function fastPath(message: string): IntentAnalysis | null {
    const trimmed = message.trim();

    // Very short greetings / acknowledgments
    if (GREETING_PATTERN.test(trimmed)) {
        return {
            goal: trimmed,
            complexity: "simple",
            taskType: "chat",
            isLongRunning: false,
            requiresApproval: false,
        };
    }

    // Short conversational questions (under 60 chars, starts with question word)
    if (trimmed.length < 60 && QUESTION_PATTERN.test(trimmed) && !trimmed.includes("file") && !trimmed.includes("code") && !trimmed.includes("project")) {
        return {
            goal: trimmed,
            complexity: "simple",
            taskType: "chat",
            isLongRunning: false,
            requiresApproval: false,
        };
    }

    return null; // Need LLM analysis
}

// ── Analyze Prompt ──

const ANALYZE_SYSTEM_PROMPT = `You are an intent analyzer for NIOM, an ambient intelligence OS companion.

Analyze the user's message and determine:
1. **Goal**: What do they want? Be specific.
2. **Complexity**: How many steps and how much reasoning does this need?
3. **Task type**: What category of work is this?
4. **Quality criteria**: How would we know the result is good?
5. **Thinking hint**: A brief strategic note on how to approach this.

Complexity guidelines:
- "simple": Greetings, quick factual questions, single-tool actions (e.g. "list files", "what's my CPU?")
- "standard": Requires 2-5 tool calls with some reasoning (e.g. "explain this project structure", "find and show the config file")
- "complex": Multi-step task requiring planning, verification, and possibly iteration (e.g. "refactor this module", "research X and write a report", "set up CI for this project")
- "long_running": Should run in the background, possibly on a schedule (e.g. "monitor this folder", "write a blog every 2 days", "deep research on topic X")

Be fast and decisive. Don't overthink — this classification is used to route to the right execution depth.`;

// ── Main Function ──

/**
 * Analyze user intent. Returns structured analysis that controls
 * the engine's execution depth.
 *
 * Uses the "fast" model role (cheap, sub-second) for classification.
 * Falls back gracefully if the fast model isn't available.
 */
export async function analyzeIntent(
    latestMessage: string,
    conversationLength: number,
): Promise<IntentAnalysis> {
    // Fast-path: skip LLM for trivially simple messages
    const fast = fastPath(latestMessage);
    if (fast) {
        console.log(`[analyze] Fast-path: "${latestMessage.slice(0, 40)}" → simple/chat`);
        return fast;
    }

    // For short follow-up messages in an existing conversation, bias toward simple/standard
    const isFollowUp = conversationLength > 2 && latestMessage.trim().length < 30;

    const prompt = isFollowUp
        ? `This is a follow-up message in an ongoing conversation (${conversationLength} messages so far).\n\nUser: "${latestMessage}"`
        : `User: "${latestMessage}"`;

    // Tier 1: Try structured output with the fast model
    try {
        const model = getModelForRole("fast");

        const { output } = await generateText({
            model,
            output: Output.object({ schema: IntentAnalysis }),
            system: ANALYZE_SYSTEM_PROMPT,
            prompt,
            temperature: 0.1,
        });

        const result = output!;
        console.log(`[analyze] "${latestMessage.slice(0, 40)}" → ${result.complexity}/${result.taskType} (${result.estimatedSteps || "?"} steps)`);
        return result;
    } catch (err: any) {
        console.warn(`[analyze] Structured output failed (${err.message?.slice(0, 80)}), trying text fallback...`);
    }

    // Tier 2: Plain text JSON extraction (works with models that don't support json_schema)
    try {
        const { text: fallbackText } = await generateText({
            model: getModelForRole("fast"),
            system: ANALYZE_SYSTEM_PROMPT + `\n\nIMPORTANT: Respond ONLY with a valid JSON object matching this schema: { "goal": string, "complexity": "simple"|"standard"|"complex"|"long_running", "taskType": "chat"|"action"|"research"|"create"|"analyze"|"organize"|"automate", "isLongRunning": boolean, "requiresApproval": boolean, "qualityCriteria": string, "estimatedSteps": number, "thinkingHint": string }`,
            prompt,
            temperature: 0.1,
        });

        const jsonMatch = fallbackText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = IntentAnalysis.safeParse(JSON.parse(jsonMatch[0]));
            if (parsed.success) {
                console.log(`[analyze] Text fallback: "${latestMessage.slice(0, 40)}" → ${parsed.data.complexity}/${parsed.data.taskType}`);
                return parsed.data;
            }
        }
    } catch (err2: any) {
        console.warn(`[analyze] Text fallback also failed:`, err2.message?.slice(0, 80));
    }

    // Tier 3: Keyword-based heuristic (no LLM needed)
    const lower = latestMessage.toLowerCase();
    const hasRecurringKeywords = /\b(every|daily|weekly|hourly|monitor|schedule[d]?|recurring|background|automate)\b/.test(lower);
    const hasComplexKeywords = /\b(refactor|build|create|implement|research|analyze|migrate|set\s?up)\b/.test(lower);

    if (hasRecurringKeywords) {
        console.log(`[analyze] Heuristic fallback: "${latestMessage.slice(0, 40)}" → long_running/automate`);
        return {
            goal: latestMessage,
            complexity: "long_running",
            taskType: "automate",
            isLongRunning: true,
            requiresApproval: false,
            qualityCriteria: "Complete the goal accurately.",
        };
    }

    if (hasComplexKeywords || latestMessage.length > 100) {
        console.log(`[analyze] Heuristic fallback: "${latestMessage.slice(0, 40)}" → complex`);
        return {
            goal: latestMessage,
            complexity: "complex",
            taskType: "action",
            isLongRunning: false,
            requiresApproval: false,
        };
    }

    console.log(`[analyze] Heuristic fallback: "${latestMessage.slice(0, 40)}" → standard/chat`);
    return {
        goal: latestMessage,
        complexity: "standard",
        taskType: "chat",
        isLongRunning: false,
        requiresApproval: false,
    };
}
