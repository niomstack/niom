/**
 * NIOM Agent Engine — unified pipeline powered by the Skill Tree.
 *
 * Every user message flows through:
 *   Skill Tree → Route by executionMode → Execute → Done
 *
 * No LLM call for classification. No complexity tiers. No evaluate-refine loop.
 * The Skill Tree's embedding traversal (~15ms) determines everything:
 *   - stream     → streamText() for simple/conversational requests
 *   - generate   → generateText() for complex multi-step tasks, then stream response
 *   - background → create a TaskManager background task
 *
 * Skill Pack routing:
 *   The tree identifies the primary domain and pre-computes focused tools.
 *   The router resolves tool instances from the SkillPath.
 */

import { streamText, generateText, stepCountIs, type ModelMessage } from "ai";
import { getModel } from "./providers.js";
import { loadConfig } from "../config.js";
import { buildAgentContext, formatContextPreamble, recordToolUse } from "./context.js";
import { TaskManager } from "../tasks/manager.js";
import type { TaskType, TaskPlan } from "../tasks/types.js";
import { MemoryStore } from "../memory/store.js";
import { SkillPathResolver, type SkillPath } from "../skills/traversal.js";
import { routeFromSkillPath } from "../skills/router.js";
import type { ResolvedSkillPack } from "../skills/types.js";
import { getContextBudget } from "./tokens.js";
import { compressContext, logCompression } from "./context-window.js";
import { logger } from "./logger.js";

// ── System Prompt (base) ──
// Personality + rules are static. Skill Pack prompts inject domain-specific behavior.

export function getBaseSystemPrompt(skillPrompt?: string): string {
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

${skillPrompt ? `## Domain Expertise\n${skillPrompt}` : ""}

## Rules
- Never retry a denied tool call. Ask how the user wants to proceed instead.
- Write complete, working code — never use placeholders like "// TODO" or "..."
- If a task requires multiple steps, work through them one by one
- Keep responses focused and actionable`;
}

// ── Request Type ──

export interface RunRequest {
    messages: ModelMessage[];
    threadId?: string;
    context?: {
        focusFile?: string;
        openFiles?: string[];
        cursorLine?: number;
        cwd?: string;
    };
    /** Progress callback — emits status updates during long-running operations. */
    onProgress?: (status: string) => void;
}

// ── System Prompt Builder ──

/**
 * Build the full system prompt based on skill path + context.
 *
 * stream:     base + skill personality + context preamble
 * generate:   + goal awareness + complex task protocol
 * background: + goal awareness (for planning call)
 */
function buildSystemPrompt(
    path: SkillPath,
    contextPreamble: string,
    pack: ResolvedSkillPack,
): string {
    const parts = [getBaseSystemPrompt(pack.systemPrompt), contextPreamble];

    // Inject brain context (long-term memory about the user)
    const brainContext = MemoryStore.getInstance().getBrainContext();
    if (brainContext) {
        parts.push(brainContext);
    }

    // For non-simple requests, inject goal awareness
    if (path.executionMode !== "stream" || path.tools.length > 2) {
        parts.push(`## Your Goal for This Task
**Goal**: ${path.goal}
**Domain**: ${path.primaryDomain}${path.secondaryDomains.length ? ` (+ ${path.secondaryDomains.join(", ")})` : ""}
**Tools available**: ${Object.keys(pack.tools).length}`);
    }

    // For complex / generate tasks, add structured reasoning
    if (path.executionMode === "generate") {
        parts.push(`## Complex Task Protocol
This is a complex task. Follow this protocol:

1. **Plan first** — Before your first tool call, outline your approach in 2-4 bullet points. Show this to the user.
2. **Execute systematically** — Work through your plan step by step. After each major step, briefly note what was accomplished.
3. **Verify your work** — After completing the task, review what you did. Check that files exist, code compiles, outputs match expectations.
4. **Summarize clearly** — End with a clear summary of what was done, what files were changed, and any next steps.

Do NOT stop after just listing files or reading code. Complete the actual goal.`);
    }

    return parts.join("\n\n");
}

// ── Engine: Run ──

/**
 * The main agent engine entry point.
 *
 * Routes through the Skill Tree (~15ms), then executes based on executionMode.
 * No LLM classification call. No evaluate-refine loop.
 *
 * @returns A streamText result (streamable via toUIMessageStreamResponse)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runAgent(request: RunRequest): Promise<any> {
    const config = loadConfig();
    const model = getModel(config);
    const modelId = config.model || "gpt-4o-mini";
    const contextBudget = getContextBudget(modelId);

    const ctx = request.context || {};
    const normalizedContext = {
        focusFile: ctx.focusFile,
        openFiles: ctx.openFiles,
        cursorLine: ctx.cursorLine,
        cwd: ctx.cwd,
        threadId: request.threadId,
    };

    // Build structured context
    const agentContext = buildAgentContext(normalizedContext);
    const contextPreamble = formatContextPreamble(agentContext);

    // ── Single routing step: Skill Tree traversal (~15ms) ──
    const lastUserMessage = extractLastUserMessage(request.messages);
    const resolver = SkillPathResolver.getInstance();
    const path = await resolver.resolve(lastUserMessage);

    // ── Resolve tools from the path ──
    const pack = routeFromSkillPath(path);
    request.onProgress?.(`Routed to ${pack.name}…`);

    // ── Build prompt ──
    const systemPrompt = buildSystemPrompt(path, contextPreamble, pack);

    // ── Compress context to fit model limits ──
    const compression = compressContext(request.messages, contextBudget);
    logCompression(compression);
    if (compression.stages.length > 0) {
        logger.compression(compression.originalTokens, compression.compressedTokens, compression.stages.map(s => s.name));
    }
    const messages = compression.messages;

    logger.route(path.executionMode, path.primaryDomain, pack.name, Object.keys(pack.tools).length, path.traversalMs);
    console.log(`[engine] ${path.executionMode}/${path.primaryDomain} → ${pack.name} Pack (${Object.keys(pack.tools).length} tools, ${path.stepBudget} steps, ${path.traversalMs}ms) | goal: "${path.goal.slice(0, 60)}"`);

    // ── Route by execution mode ──

    // Background tasks: create and confirm
    if (path.executionMode === "background") {
        return runBackgroundTask(request, path, systemPrompt, model, agentContext);
    }

    // Generate mode: generateText for reasoning, then stream final response
    if (path.executionMode === "generate") {
        return runGenerateTask({ ...request, messages }, path, systemPrompt, model, agentContext, pack, contextBudget);
    }

    // Stream mode: direct streamText (simple/standard)
    return streamText({
        model,
        system: systemPrompt,
        messages,
        tools: pack.tools,
        stopWhen: stepCountIs(path.stepBudget),
        temperature: 0.3,
        experimental_context: agentContext,
        experimental_onToolCallFinish({ toolCall }: { toolCall: { toolName: string } }) {
            recordToolUse(toolCall.toolName);
            logger.toolCall("complete", toolCall.toolName);
        },
        prepareStep({ stepNumber, messages: stepMsgs }: { stepNumber: number; messages: ModelMessage[] }) {
            return buildPrepareStepResult(stepNumber, stepMsgs, pack.tools, contextBudget);
        },
    });
}

// ── Generate Mode: ExecuteText + Stream ──

/**
 * For complex tasks: execute with full step limit using generateText,
 * then stream the final polished response.
 *
 * No evaluate-refine loop. Trust the LLM. Users steer via conversation.
 */
async function runGenerateTask(
    request: RunRequest,
    path: SkillPath,
    systemPrompt: string,
    model: ReturnType<typeof getModel>,
    agentContext: ReturnType<typeof buildAgentContext>,
    pack: ResolvedSkillPack,
    contextBudget: number,
) {
    console.log(`[engine] Generate mode — ${path.stepBudget} step budget`);
    request.onProgress?.(`Thinking (${path.stepBudget} step budget)…`);

    let toolStep = 0;
    // Execute (non-streaming) with skill pack tools
    const result = await generateText({
        model,
        system: systemPrompt,
        messages: request.messages,
        tools: pack.tools,
        stopWhen: stepCountIs(path.stepBudget),
        temperature: 0.4,
        experimental_context: agentContext,
        experimental_onToolCallFinish({ toolCall }: { toolCall: { toolName: string } }) {
            recordToolUse(toolCall.toolName);
            toolStep++;
            const friendly = toolCall.toolName
                .replace(/([A-Z])/g, " $1")
                .replace(/^./, s => s.toUpperCase())
                .trim();
            request.onProgress?.(`Step ${toolStep}: ${friendly}`);
        },
        prepareStep({ stepNumber, messages: stepMsgs }: { stepNumber: number; messages: ModelMessage[] }) {
            return buildPrepareStepResult(stepNumber, stepMsgs, pack.tools, contextBudget);
        },
    });

    // Stream the final summary to the client
    console.log(`[engine] Generate complete, streaming final response`);
    request.onProgress?.("Composing response…");

    // Compress the summary messages too
    const summaryMessages: ModelMessage[] = [
        ...request.messages,
        { role: "assistant" as const, content: result.text || "I completed the task." },
        { role: "user" as const, content: "Please summarize what you accomplished." },
    ];
    const summaryCompressed = compressContext(summaryMessages, contextBudget);

    return streamText({
        model,
        system: systemPrompt,
        messages: summaryCompressed.messages,
        tools: pack.tools,
        stopWhen: stepCountIs(5),
        temperature: 0.3,
        experimental_context: agentContext,
        prepareStep({ stepNumber, messages: stepMessages }: { stepNumber: number; messages: ModelMessage[] }) {
            return buildPrepareStepResult(stepNumber, stepMessages, pack.tools, contextBudget);
        },
    });
}

// ── Background Task: Create Background Task ──

/**
 * For recurring / background tasks: plan and create a background task,
 * then stream a confirmation to the user.
 *
 * Uses a quick generateText call to extract task parameters (schedule,
 * phases, quality criteria), then creates the task via TaskManager.
 */
async function runBackgroundTask(
    request: RunRequest,
    path: SkillPath,
    systemPrompt: string,
    model: ReturnType<typeof getModel>,
    agentContext: ReturnType<typeof buildAgentContext>,
) {
    console.log(`[engine] Creating background task for: "${path.goal.slice(0, 60)}"`);

    // Use a quick LLM call to extract task structure
    let schedule: { interval: string } | undefined;
    let taskType: TaskType = "one_shot";
    let phases: Array<{ id: string; description: string; status: "pending" }> = [
        { id: "main", description: path.goal, status: "pending" },
    ];
    let qualityCriteria = "Complete the goal accurately.";

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
            prompt: `User request: "${path.goal}"`,
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
                } else if (path.isRecurring) {
                    // Skill tree detected recurring even if LLM didn't
                    schedule = { interval: "1 day" };
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
        // If skill tree detected recurring, use that as fallback
        if (path.isRecurring) {
            taskType = "recurring";
            schedule = { interval: "1 day" };
        }
    }

    // Create the task
    const tm = TaskManager.getInstance();
    const taskPlan: TaskPlan = { phases, qualityCriteria };

    const task = tm.createTask(path.goal, taskType, taskPlan, {
        schedule,
        threadId: request.threadId,
    });

    // Start the task
    tm.start(task.id);
    console.log(`[engine] Created task ${task.id.slice(0, 8)} (${taskType}${schedule ? `, every ${schedule.interval}` : ""})`);

    // Stream a confirmation to the user
    const confirmationPrompt = `You just created a background task for the user. Tell them what you set up.

Task details:
- **Goal**: ${path.goal}
- **Type**: ${taskType}${schedule ? ` (every ${schedule.interval})` : ""}
- **Phases**: ${phases.map((p, i) => `${i + 1}. ${p.description}`).join(", ")}
- **Quality criteria**: ${qualityCriteria}
- **How it works**: The task runs autonomously. They can steer it anytime by posting comments. If it's recurring, it will auto-pause after 7 days of no interaction.
- **Task ID**: ${task.id.slice(0, 8)}

Explain this warmly and concisely. Tell them they can manage it from the Tasks panel (⚡ icon). Mention they can post comments to steer the results. Don't repeat the word "task" excessively — be natural.`;

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
 * Build prepareStep result — handles conversation compression
 * and dynamic tool adjustment.
 */
function buildPrepareStepResult(
    stepNumber: number,
    messages: ModelMessage[],
    packTools: Record<string, any>,
    contextBudget: number,
): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // ── Context window management ──
    // Compress messages between steps to stay within model limits.
    // This is critical for multi-step tool-heavy flows where each step
    // adds tool call + tool result messages.
    const compression = compressContext(messages, contextBudget);
    if (compression.stages.length > 0) {
        logCompression(compression);
        result.messages = compression.messages;
    }

    // Dynamic tool adjustment: after step 10, remove web tools
    // to prevent infinite research tangents
    if (stepNumber > 10) {
        const activeToolNames = Object.keys(packTools)
            .filter(name => name !== "webSearch" && name !== "fetchUrl" && name !== "deepResearch");
        result.activeTools = activeToolNames;
    }

    return result;
}
