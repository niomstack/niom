/**
 * NIOM Agent Engine — the core reasoning pipeline.
 *
 * Every user message flows through:
 *   Analyze → Think → Plan → Execute → Evaluate → [loop or done]
 *
 * The depth of each phase adapts to complexity:
 *   simple     → direct streamText(), 3 steps, no evaluate
 *   standard   → goal-aware prompt, 10 steps, post-eval
 *   complex    → plan-aware prompt, 25 steps, evaluate + refine loop
 *   long_running → background TaskManager (creates scheduled task)
 *
 * Context flows through two paths:
 *   1. experimental_context → tools receive it for workspace-aware execution
 *   2. System prompt → static personality + context preamble + analysis context
 */

import { streamText, generateText, stepCountIs, type ModelMessage } from "ai";
import { getModel } from "./providers.js";
import { getAllTools, builtinTools } from "../tools/index.js";
import { loadConfig } from "../config.js";
import { buildAgentContext, formatContextPreamble, recordToolUse } from "./context.js";
import { analyzeIntent, type IntentAnalysis } from "./analyze.js";
import { evaluateResult, buildExecutionSummary, type Evaluation } from "./evaluate.js";
import { TaskManager } from "../tasks/manager.js";
import type { TaskType, TaskPlan } from "../tasks/types.js";
import { buildCapabilitiesPrompt } from "./capabilities.js";
import { MemoryStore } from "../memory/store.js";

// ── Step Limits per Complexity ──

const STEP_LIMITS: Record<IntentAnalysis["complexity"], number> = {
    simple: 3,
    standard: 10,
    complex: 25,
    long_running: 25, // Used for planning LLM call step limit
};

const MAX_REFINE_ITERATIONS = 2; // Max times the evaluate-refine loop can repeat

// ── System Prompt (base) ──
// Personality + rules are static. Capabilities are injected dynamically
// from the capability registry so new features auto-surface to the AI.

export function getBaseSystemPrompt(): string {
    return `You are **NIOM**, a thoughtful ambient intelligence assistant running as an always-on OS companion.

## Your Personality
- You're a skilled, friendly colleague — not a CLI wrapper
- Explain what you're doing and why, in plain language
- Be concise but warm. No verbose preambles — get to the point
- When things go wrong, explain clearly and suggest next steps

## How You Work

### Think Before Acting
Before performing any action, briefly explain your plan:
- "Let me find that file first, then I'll remove it for you."
- "I'll check the project structure to understand the layout."
- "Let me verify this exists before making changes."

### Verify Before Destructive Actions
**Always** verify resources exist before modifying or deleting them:
1. Use \`listDirectory\` or \`readFile\` to confirm a file/folder exists
2. Show the user what you found
3. Then perform the action with their approval

Never blindly run destructive commands or pass unverified paths.

### Explain Results Clearly
After tool calls complete, explain what happened in human-friendly terms:
- ✅ "Done! I removed the \`fragments\` directory and its 3 files."
- ✅ "The project is a Next.js app with 12 components. Here's the structure..."
- ❌ Don't just echo raw JSON output back to the user

### Use Markdown for Readability
Structure your responses with:
- **Bold** for emphasis
- \`code\` for file paths, commands, and technical terms
- Lists for multiple items
- Code blocks for file contents or command output

${buildCapabilitiesPrompt()}

## Rules
- Never retry a denied tool call. Ask how the user wants to proceed instead.
- Write complete, working code — never use placeholders like "// TODO" or "..."
- If a task requires multiple steps, work through them one by one
- Keep responses focused and actionable`;
}

// ── Request Type ──

export interface RunRequest {
    messages: ModelMessage[];
    context?: {
        focusFile?: string;
        openFiles?: string[];
        cursorLine?: number;
        cwd?: string;
    };
}

// ── System Prompt Builders ──

/**
 * Build the full system prompt based on analysis + context.
 *
 * Simple:   base + context preamble
 * Standard: + goal awareness + quality criteria
 * Complex:  + explicit planning instructions + self-evaluation
 */
function buildSystemPrompt(
    analysis: IntentAnalysis,
    contextPreamble: string,
): string {
    const parts = [getBaseSystemPrompt(), contextPreamble];

    // Inject brain context (long-term memory about the user)
    const brainContext = MemoryStore.getInstance().getBrainContext();
    if (brainContext) {
        parts.push(brainContext);
    }

    // For standard+, inject goal awareness
    if (analysis.complexity !== "simple") {
        parts.push(`## Your Goal for This Task
**Goal**: ${analysis.goal}
**Task type**: ${analysis.taskType}
**Estimated effort**: ${analysis.estimatedSteps || "a few"} steps`);

        if (analysis.qualityCriteria) {
            parts.push(`**Quality bar**: ${analysis.qualityCriteria}`);
        }

        if (analysis.thinkingHint) {
            parts.push(`**Strategy hint**: ${analysis.thinkingHint}`);
        }
    }

    // For complex tasks, add structured reasoning instructions
    if (analysis.complexity === "complex" || analysis.complexity === "long_running") {
        parts.push(`## Complex Task Protocol
This is a complex task. Follow this protocol:

1. **Plan first** — Before your first tool call, outline your approach in 2-4 bullet points. Show this to the user.
2. **Execute systematically** — Work through your plan step by step. After each major step, briefly note what was accomplished.
3. **Verify your work** — After completing the task, review what you did. Check that files exist, code compiles, outputs match expectations.
4. **Self-evaluate** — Before giving your final response, ask yourself: "Did I fully achieve the goal? Is the quality acceptable?" If not, fix it.
5. **Summarize clearly** — End with a clear summary of what was done, what files were changed, and any next steps.

Do NOT stop after just listing files or reading code. Complete the actual goal.`);
    }

    return parts.join("\n\n");
}

// ── Engine: Run ──

/**
 * The main agent engine entry point.
 *
 * Analyzes intent, routes by complexity, and returns a streamable result.
 * For complex tasks, may run evaluate-refine loops internally.
 *
 * @returns A streamText result (streamable via toUIMessageStreamResponse)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runAgent(request: RunRequest): Promise<any> {
    const config = loadConfig();
    const model = getModel(config);

    const ctx = request.context || {};
    const normalizedContext = {
        focusFile: ctx.focusFile,
        openFiles: ctx.openFiles,
        cursorLine: ctx.cursorLine,
        cwd: ctx.cwd,
    };

    // Build structured context
    const agentContext = buildAgentContext(normalizedContext);
    const contextPreamble = formatContextPreamble(agentContext);

    // ── Phase 1: ANALYZE ──
    // Determine intent, complexity, and quality criteria
    const lastUserMessage = extractLastUserMessage(request.messages);
    const analysis = await analyzeIntent(lastUserMessage, request.messages.length);

    // ── Route by complexity ──
    const systemPrompt = buildSystemPrompt(analysis, contextPreamble);
    const stepLimit = STEP_LIMITS[analysis.complexity];

    console.log(`[engine] ${analysis.complexity}/${analysis.taskType} → ${stepLimit} steps | goal: "${analysis.goal.slice(0, 60)}"`);

    // For long-running tasks: create a background task and confirm to user
    if (analysis.complexity === "long_running" || analysis.isLongRunning) {
        return runLongRunningTask(request, analysis, systemPrompt, model, agentContext);
    }

    // For complex tasks: use evaluate-refine loop via generateText,
    // then stream the final polished response
    if (analysis.complexity === "complex") {
        return runComplexTask(request, analysis, systemPrompt, model, agentContext, stepLimit);
    }

    // For simple/standard: direct streamText with adapted config
    const tools = getAllTools();
    return streamText({
        model,
        system: systemPrompt,
        messages: request.messages,
        tools,
        stopWhen: stepCountIs(stepLimit),
        temperature: analysis.complexity === "simple" ? 0.3 : 0.4,
        experimental_context: agentContext,
        experimental_onToolCallFinish({ toolCall }: { toolCall: { toolName: string } }) {
            recordToolUse(toolCall.toolName);
        },
        prepareStep({ stepNumber, messages }: { stepNumber: number; messages: ModelMessage[] }) {
            return buildPrepareStepResult(stepNumber, messages, analysis);
        },
    });
}

// ── Complex Task: Evaluate-Refine Loop ──

/**
 * For complex tasks: execute with full step limit, then evaluate.
 * If evaluation says "refine", inject feedback and re-execute.
 *
 * Returns a streamText result (the final attempt streams to the client).
 */
async function runComplexTask(
    request: RunRequest,
    analysis: IntentAnalysis,
    systemPrompt: string,
    model: ReturnType<typeof getModel>,
    agentContext: ReturnType<typeof buildAgentContext>,
    stepLimit: number,
) {
    let messages = [...request.messages];
    let iteration = 0;

    // Evaluate-refine loop (non-streaming iterations)
    while (iteration < MAX_REFINE_ITERATIONS) {
        iteration++;
        console.log(`[engine] Complex task — iteration ${iteration}/${MAX_REFINE_ITERATIONS + 1}`);

        // Execute (non-streaming) to get a complete result for evaluation
        const tools = getAllTools();
        const result = await generateText({
            model,
            system: systemPrompt,
            messages,
            tools,
            stopWhen: stepCountIs(stepLimit),
            temperature: 0.4,
            experimental_context: agentContext,
            experimental_onToolCallFinish({ toolCall }: { toolCall: { toolName: string } }) {
                recordToolUse(toolCall.toolName);
            },
        });

        // result.steps exists on AI SDK v6 — cast through unknown for the type bridge
        const summary = buildExecutionSummary(result.text ?? "", result.steps as unknown as Parameters<typeof buildExecutionSummary>[1]);

        // Evaluate
        const evaluation = await evaluateResult(
            analysis.goal,
            analysis.qualityCriteria,
            summary,
        );

        // If satisfied or should give up, break to final streaming response
        if (evaluation.satisfied || evaluation.recommendation === "done" || evaluation.recommendation === "give_up") {
            console.log(`[engine] Evaluation: satisfied (${evaluation.qualityScore.toFixed(2)}) — streaming final response`);
            break;
        }

        // If needs user input, break and let the stream ask
        if (evaluation.recommendation === "ask_user") {
            console.log(`[engine] Evaluation: needs user input — streaming question`);
            break;
        }

        // Not satisfied — inject evaluation feedback and loop
        console.log(`[engine] Evaluation: ${evaluation.recommendation} (${evaluation.qualityScore.toFixed(2)}) — refining...`);

        // Append the agent's response and evaluation feedback as messages
        messages = [
            ...messages,
            { role: "assistant" as const, content: result.text || "I attempted to complete the task." },
            {
                role: "user" as const,
                content: `[System: Quality evaluation found issues. Please address them and improve your response.]\n\n` +
                    `Issues:\n${evaluation.issues.map(i => `- ${i}`).join("\n")}\n\n` +
                    (evaluation.refinementHint ? `Hint: ${evaluation.refinementHint}\n\n` : "") +
                    `Please refine your work to fully achieve the goal: "${analysis.goal}"`,
            },
        ];
    }

    // Final attempt: stream to client (this is what the user sees)
    console.log(`[engine] Streaming final response (after ${iteration} evaluation rounds)`);

    const finalTools = getAllTools();
    return streamText({
        model,
        system: systemPrompt,
        messages,
        tools: finalTools,
        stopWhen: stepCountIs(stepLimit),
        temperature: 0.4,
        experimental_context: agentContext,
        experimental_onToolCallFinish({ toolCall }: { toolCall: { toolName: string } }) {
            recordToolUse(toolCall.toolName);
        },
        prepareStep({ stepNumber, messages: stepMessages }: { stepNumber: number; messages: ModelMessage[] }) {
            return buildPrepareStepResult(stepNumber, stepMessages, analysis);
        },
    });
}

// ── Long-Running Task: Create Background Task ──

/**
 * For long-running / recurring tasks: plan and create a background task,
 * then stream a confirmation to the user.
 *
 * Uses a quick generateText call to extract task parameters (schedule,
 * phases, quality criteria), then creates the task via TaskManager.
 */
async function runLongRunningTask(
    request: RunRequest,
    analysis: IntentAnalysis,
    systemPrompt: string,
    model: ReturnType<typeof getModel>,
    agentContext: ReturnType<typeof buildAgentContext>,
) {
    console.log(`[engine] Creating background task for: "${analysis.goal.slice(0, 60)}"`);

    // Use a quick LLM call to extract task structure
    let schedule: { interval: string } | undefined;
    let taskType: TaskType = "one_shot";
    let phases: Array<{ id: string; description: string; status: "pending" }> = [
        { id: "main", description: analysis.goal, status: "pending" },
    ];
    let qualityCriteria = analysis.qualityCriteria || "Complete the goal accurately.";

    try {
        const { text: planText } = await generateText({
            model,
            system: `You are a task planner. Given a user's request, extract:
1. Whether it's recurring (look for "every", "daily", "weekly", intervals)
2. The schedule interval if recurring (e.g., "2 days", "1 week", "6 hours")
3. 2-4 execution phases
4. Quality criteria

Respond in this exact JSON format:
{"recurring": true/false, "interval": "2 days", "phases": ["Phase 1 description", "Phase 2 description"], "quality": "How to evaluate success"}`,
            prompt: `User request: "${analysis.goal}"`,
            temperature: 0.1,
        });

        try {
            // Extract JSON from the response (handle markdown code blocks)
            const jsonMatch = planText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const plan = JSON.parse(jsonMatch[0]);
                if (plan.recurring && plan.interval) {
                    schedule = { interval: plan.interval };
                    taskType = "recurring";
                }
                if (Array.isArray(plan.phases) && plan.phases.length > 0) {
                    phases = plan.phases.map((desc: string, i: number) => ({
                        id: `phase_${i + 1}`,
                        description: desc,
                        status: "pending" as const,
                    }));
                }
                if (plan.quality) {
                    qualityCriteria = plan.quality;
                }
            }
        } catch { /* use defaults */ }
    } catch (err: any) {
        console.warn("[engine] Task planning LLM failed, using defaults:", err.message);
    }

    // Create the task
    const tm = TaskManager.getInstance();
    const taskPlan: TaskPlan = { phases, qualityCriteria };

    const task = tm.createTask(analysis.goal, taskType, taskPlan, {
        schedule,
        approval: { mode: "first_n", firstN: 3 },
    });

    // Start the task
    tm.start(task.id);
    console.log(`[engine] Created task ${task.id.slice(0, 8)} (${taskType}${schedule ? `, every ${schedule.interval}` : ""})`);

    // Stream a confirmation to the user
    const confirmationPrompt = `You just created a background task for the user. Tell them what you set up.

Task details:
- **Goal**: ${analysis.goal}
- **Type**: ${taskType}${schedule ? ` (every ${schedule.interval})` : ""}
- **Phases**: ${phases.map((p, i) => `${i + 1}. ${p.description}`).join(", ")}
- **Quality criteria**: ${qualityCriteria}
- **Approval**: First 3 runs need approval, then auto-approved
- **Task ID**: ${task.id.slice(0, 8)}

Explain this warmly and concisely. Tell them they can manage it from the Tasks panel (⚡ icon). Don't repeat the word "task" excessively — be natural.`;

    return streamText({
        model,
        system: systemPrompt,
        messages: [
            ...request.messages,
            { role: "user" as const, content: confirmationPrompt },
        ],
        tools: {},  // No tools needed for confirmation
        temperature: 0.4,
    });
}

// ── Helpers ──

/**
 * Extract the last user message text from the messages array.
 */
function extractLastUserMessage(messages: ModelMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === "user") {
            if (typeof msg.content === "string") return msg.content;
            if (Array.isArray(msg.content)) {
                const textPart = msg.content.find((p: { type: string }) => p.type === "text");
                if (textPart && "text" in textPart) return (textPart as { text: string }).text;
            }
        }
    }
    return "";
}

/**
 * Build prepareStep result — shared between simple/standard and complex paths.
 *
 * Handles:
 *   - Conversation compression (messages > 30)
 *   - Dynamic tool adjustment (remove web tools after step 10)
 */
function buildPrepareStepResult(
    stepNumber: number,
    messages: ModelMessage[],
    analysis: IntentAnalysis,
): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Compress long conversation history
    if (messages.length > 30) {
        result.messages = [
            messages[0],
            ...messages.slice(-15),
        ];
    }

    // Dynamic tool adjustment: after step 10, remove web tools
    // to prevent infinite research tangents
    if (stepNumber > 10) {
        const tools = getAllTools();
        const { webSearch, fetchUrl, ...coreTools } = tools;
        result.activeTools = Object.keys(coreTools);
    }

    return result;
}
