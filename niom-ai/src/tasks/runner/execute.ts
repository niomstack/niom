/**
 * Task execution engine — core runner.
 *
 * Philosophy: Execute once. Trust the LLM. Let user feedback drive improvement.
 *
 * The flow is intentionally simple:
 *   1. Build system prompt with task goal, plan, memory, and context
 *   2. Build messages with previous run output + user feedback (if any)
 *   3. Route through the Skill Tree → resolve focused tools
 *   4. Call generateText ONCE — let the LLM do its thing
 *   5. Record the result (tool calls, output, etc.)
 *   6. Record tool usage in Skill Tree for co-occurrence learning
 *   7. Done
 *
 * No evaluate-refine loop. No complexity tiers. No extra LLM calls.
 *
 * Quality control happens naturally:
 *   - User steers via inline comments
 *   - Comments are injected into the NEXT run's context
 *   - Each consecutive run is better because the LLM sees the feedback
 *   - The ToolHealthMonitor prevents infinite tool loops within a single run
 */

import { generateText, stepCountIs, type ModelMessage } from "ai";
import { getModel } from "../../ai/providers.js";
import { SkillPathResolver } from "../../skills/traversal.js";
import { routeFromSkillPath } from "../../skills/router.js";
import { loadConfig } from "../../config.js";
import { buildAgentContext, formatContextPreamble, recordToolUse } from "../../ai/context.js";
import { ToolHealthMonitor } from "../../ai/health.js";
import { TaskManager } from "../manager.js";
import { buildTaskSystemPrompt, TASK_STEP_LIMIT } from "./prompt.js";
import { updateTaskMemory } from "./memory.js";
import { emit } from "./events.js";
import { getContextBudget } from "../../ai/tokens.js";
import { compressContext, logCompression } from "../../ai/context-window.js";
import { logger } from "../../ai/logger.js";

import type { BackgroundTask, TaskRun, TaskPhase } from "../types.js";

// ── Execute ──

/**
 * Execute a background task — single pass, no loops.
 * This is the `runCallback` passed to `TaskManager.init()`.
 */
export async function executeTask(task: BackgroundTask): Promise<TaskRun> {
    const startedAt = Date.now();
    const runNumber = task.totalRuns + 1;
    const runId = crypto.randomUUID();

    console.log(`[runner] ${task.id.slice(0, 8)} — run #${runNumber}: "${task.goal.slice(0, 80)}"`);

    // ── Build context ──

    const config = loadConfig();
    const model = getModel(config);
    const modelId = config.model || "gpt-4o-mini";
    const contextBudget = getContextBudget(modelId);
    const agentContext = buildAgentContext({ threadId: task.threadId });
    agentContext.taskId = task.id;
    const contextPreamble = formatContextPreamble(agentContext);
    const systemPrompt = buildTaskSystemPrompt(task, contextPreamble);
    const messages = buildMessages(task, runNumber) as ModelMessage[];

    logger.info("task", `Task ${task.id.slice(0, 8)} run #${runNumber}: "${task.goal.slice(0, 80)}"`);

    // ── Phase tracking ──

    const phases: TaskPhase[] = task.plan.phases.map(p => ({
        ...p,
        status: "pending" as const,
    }));

    if (phases.length > 0) {
        phases[0].status = "running";
        phases[0].startedAt = Date.now();
        emit({ type: "task:phase", taskId: task.id, phase: phases[0].description, status: "running" });
    }

    // ── Live run writer ──

    let toolCalls: TaskRun["toolCalls"] = [];
    const tm = TaskManager.getInstance();

    function flushLiveRun() {
        tm.saveRun({
            id: runId,
            taskId: task.id,
            runNumber,
            status: "running",
            startedAt,
            phases,
            toolCalls,
        });
    }

    flushLiveRun(); // Write initial "running" entry

    // Emit start with full metadata so frontend can build the run immediately
    emit({
        type: "task:start",
        taskId: task.id,
        runId,
        runNumber,
        startedAt,
        phases: phases.map(p => ({ id: p.id || "main", description: p.description, status: p.status })),
    });

    // ── Execute ──

    try {
        // Route through the Skill Tree — same routing as conversations
        const resolver = SkillPathResolver.getInstance();
        const skillPath = await resolver.resolve(task.goal);
        const pack = routeFromSkillPath(skillPath);

        console.log(`[runner] ${task.id.slice(0, 8)} — Skill Tree: ${skillPath.primaryDomain} → ${pack.name} Pack (${Object.keys(pack.tools).length} tools)`);

        // Tool health monitor — prevents infinite tool loops
        const health = new ToolHealthMonitor();
        let healthAborted = false;

        const result = await generateText({
            model,
            system: systemPrompt,
            messages,
            tools: pack.tools,
            stopWhen: stepCountIs(TASK_STEP_LIMIT),
            temperature: 0.4,
            experimental_context: agentContext,

            // Self-healing + context compression
            prepareStep({ stepNumber, messages: stepMsgs }: { stepNumber: number; messages: ModelMessage[] }) {
                const check = health.check(stepNumber);
                const out: Record<string, unknown> = {};

                // Context compression — prevent exceeding model limits
                const compression = compressContext(stepMsgs, contextBudget);
                if (compression.stages.length > 0) {
                    logCompression(compression);
                    out.messages = compression.messages;
                }

                if (check.systemSuffix) {
                    out.system = systemPrompt + check.systemSuffix;
                }
                if (check.disableTools?.length) {
                    out.activeTools = Object.keys(pack.tools)
                        .filter(t => !check.disableTools!.includes(t));
                }
                if (check.shouldAbort) {
                    healthAborted = true;
                    console.warn(`[runner] ${task.id.slice(0, 8)} — ABORTING: ${check.abortReason}`);
                    logger.warn("task", `Task ${task.id.slice(0, 8)} aborted: ${check.abortReason}`);
                }

                return out;
            },

            // Track tool calls for live progress
            experimental_onToolCallFinish(event: any) {
                const toolName = event.toolCall?.toolName ?? event.toolName ?? "unknown";
                const args = event.toolCall?.input ?? event.toolCall?.args ?? event.args ?? {};
                const output = event.output ?? event.toolCall?.output;

                let success = true;
                let errorMsg: string | undefined;

                if (event.success === false) {
                    success = false;
                    errorMsg = String(event.error || "Tool execution failed");
                } else if (event.output != null) {
                    if (typeof event.output === "object") {
                        if (event.output.error) { success = false; errorMsg = event.output.error; }
                        else if (event.output.results?.length === 0) { success = false; errorMsg = event.output.message || "No results"; }
                    }
                } else {
                    success = false;
                    errorMsg = "Tool returned no output";
                }

                health.record({
                    tool: toolName,
                    args,
                    success,
                    error: errorMsg,
                    stepNumber: event.stepNumber ?? 0,
                    timestamp: Date.now(),
                });

                // Push to live toolCalls array so flushLiveRun writes real data
                toolCalls.push({
                    tool: toolName,
                    input: args,
                    output: success ? output : (errorMsg || output),
                });

                recordToolUse(toolName);
                logger.toolCall(success ? "complete" : "error", toolName, {
                    taskId: task.id,
                    ...(errorMsg ? { error: errorMsg } : {}),
                });
                emit({
                    type: "task:tool",
                    taskId: task.id,
                    runId,
                    tool: toolName,
                    input: args,
                    output: success ? output : (errorMsg || output),
                    status: "complete",
                });
                flushLiveRun();
            },
        });

        if (healthAborted) {
            const records = health.getRecords();
            const failCount = records.filter(r => !r.success).length;
            console.warn(`[runner] ${task.id.slice(0, 8)} — aborted by health monitor (${failCount}/${records.length} failures)`);
        }

        const resultText = result.text ?? "";
        toolCalls = extractToolCalls(result);

        // Record tool usage in Skill Tree for co-occurrence learning
        const toolNames = toolCalls.map(tc => tc.tool);
        if (toolNames.length > 0) {
            resolver.recordToolUsage(toolNames);
        }

        // Final flush to ensure all tool calls are persisted\r
        flushLiveRun();

        // ── Complete ──

        const completedAt = Date.now();

        // Mark phases completed
        for (const phase of phases) {
            if (phase.status === "running" || phase.status === "pending") {
                phase.status = "completed";
                phase.completedAt = completedAt;
            }
        }

        // No approval gate — just mark as completed
        const runStatus = "completed" as const;

        // Build quick quality summary (no LLM call — just heuristics)
        const successfulTools = toolCalls.filter(tc =>
            tc.output != null && !(typeof tc.output === "object" && tc.output?.error)
        ).length;
        const qualityScore = toolCalls.length > 0
            ? Math.min(0.5 + (successfulTools / toolCalls.length) * 0.5, 1.0)
            : resultText.length > 50 ? 0.7 : 0.5;

        const run: TaskRun = {
            id: runId,
            taskId: task.id,
            runNumber,
            status: runStatus,
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            summary: resultText.slice(0, 500),
            phases,
            toolCalls,
            output: resultText,
            evaluation: {
                satisfied: true,
                qualityScore,
                issues: [],
            },
        };

        // Update task memory with learnings
        updateTaskMemory(task, run);

        emit({
            type: "task:complete",
            taskId: task.id,
            runId,
            runNumber,
            status: runStatus,
            output: resultText.slice(0, 2000),
            durationMs: completedAt - startedAt,
            toolCount: toolCalls.length,
            qualityScore,
        });
        console.log(
            `[runner] ${task.id.slice(0, 8)} — run #${runNumber} ${runStatus}` +
            ` (${((completedAt - startedAt) / 1000).toFixed(1)}s, ${toolCalls.length} tools, ${successfulTools} ok)`
        );
        logger.info("task", `Task ${task.id.slice(0, 8)} run #${runNumber} ${runStatus}`, {
            durationMs: completedAt - startedAt,
            toolCount: toolCalls.length,
            successCount: successfulTools,
            qualityScore,
        });

        return run;

    } catch (err: any) {
        const completedAt = Date.now();
        console.error(`[runner] ${task.id.slice(0, 8)} — run #${runNumber} failed:`, err.message);
        logger.error("task", `Task ${task.id.slice(0, 8)} run #${runNumber} failed: ${err.message}`);
        emit({ type: "task:error", taskId: task.id, runId, error: err.message });

        for (const phase of phases) {
            if (phase.status === "running") {
                phase.status = "failed";
                phase.completedAt = completedAt;
            }
        }

        return {
            id: runId,
            taskId: task.id,
            runNumber,
            status: "failed",
            startedAt,
            completedAt,
            durationMs: completedAt - startedAt,
            phases,
            toolCalls,
            error: err.message || String(err),
        };
    }
}

// ── Tool call extraction ──

function extractToolCalls(result: any): TaskRun["toolCalls"] {
    const calls: TaskRun["toolCalls"] = [];
    const steps = result.steps;
    if (!Array.isArray(steps)) return calls;

    for (const step of steps) {
        const stepToolCalls = step.toolCalls ?? [];
        const stepToolResults = step.toolResults ?? [];
        for (const tc of stepToolCalls) {
            const matching = stepToolResults.find((tr: any) => tr.toolCallId === tc.toolCallId);
            calls.push({
                tool: tc.toolName,
                input: tc.input ?? tc.args ?? {},
                output: matching?.result ?? matching?.output ?? undefined,
                durationMs: 0,
            });
        }
    }
    return calls;
}

// ── Message building ──

function buildMessages(
    task: BackgroundTask,
    runNumber: number,
): Array<{ role: "user" | "assistant"; content: string }> {
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

    // First run — just the task
    if (task.totalRuns === 0) {
        messages.push({
            role: "user",
            content: `Execute this task NOW using your tools. Do not describe what you will do — just do it. Your final text output must BE the deliverable.\n\nTask: ${task.goal}`,
        });
        return messages;
    }

    // Subsequent runs — include previous output + steering comments
    const tm = TaskManager.getInstance();
    const previousRuns = tm.getRuns(task.id, 5);
    const lastSuccessfulRun = previousRuns
        .filter(r => r.status === "completed")
        .pop();

    // Steering comments from user (the Task Streams feedback mechanism)
    const pendingComments = task.memory.comments
        .filter(c => !c.appliedToRun)
        .map(c => c.text)
        .slice(-3);

    const steeringBlock = pendingComments.length > 0
        ? [
            `⚠️ USER STEERING COMMENTS (MUST FOLLOW):`,
            ...pendingComments.map(n => `→ "${n}"`),
            `You MUST incorporate these instructions. The user posted them to guide your work.`,
            ``,
        ].join("\n")
        : "";

    if (lastSuccessfulRun?.output) {
        messages.push({
            role: "assistant",
            content: `[Previous Run #${lastSuccessfulRun.runNumber} Output]\n\n${lastSuccessfulRun.output.slice(0, 4000)}`,
        });

        if (task.taskType === "recurring") {
            messages.push({
                role: "user",
                content: [
                    steeringBlock,
                    `Execute run #${runNumber} of this recurring task NOW.`,
                    `Previous: ${task.successfulRuns}/${task.totalRuns} runs completed.`,
                    ``,
                    `IMPORTANT: Produce NEW, FRESH content. Do NOT repeat previous output.`,
                    task.memory.decisions.length > 0
                        ? `\nUser guidance:\n${task.memory.decisions.map(d => `- **${d}**`).join("\n")}\n`
                        : "",
                    `Task: ${task.goal}`,
                ].filter(Boolean).join("\n"),
            });
        } else {
            messages.push({
                role: "user",
                content: [
                    steeringBlock,
                    `Re-execute this task NOW, improving on the previous attempt.`,
                    ``,
                    `Task: ${task.goal}`,
                ].filter(Boolean).join("\n"),
            });
        }
    } else {
        messages.push({
            role: "user",
            content: [
                steeringBlock,
                `Execute run #${runNumber} of this task NOW using your tools.`,
                `Previous runs: ${task.totalRuns}. Use tools immediately to produce results.`,
                ``,
                `Task: ${task.goal}`,
            ].filter(Boolean).join("\n"),
        });
    }

    return messages;
}
