/**
 * Task execution engine — core runner loop.
 *
 * This module is the "execution brain" for background tasks:
 *   1. Builds a synthetic conversation from the task goal + memory
 *   2. Runs through the AI engine (generateText, not streaming)
 *   3. Evaluates the output quality via evaluate-refine loop
 *   4. Records the run with tool calls, output, and evaluation
 *   5. Handles approval flow (pause if approval needed)
 */

import { generateText, stepCountIs } from "ai";
import { getModel } from "../../ai/providers.js";
import { getAllTools } from "../../tools/index.js";
import { loadConfig } from "../../config.js";
import { buildAgentContext, formatContextPreamble, recordToolUse } from "../../ai/context.js";
import { evaluateResult } from "../../ai/evaluate.js";
import { ToolHealthMonitor } from "../../ai/health.js";
import { TaskManager } from "../manager.js";
import { buildTaskSystemPrompt, TASK_STEP_LIMIT } from "./prompt.js";
import { shouldRequireApproval } from "./approval.js";
import { updateTaskMemory } from "./memory.js";
import { emit } from "./events.js";

import type { BackgroundTask, TaskRun, TaskPhase } from "../types.js";

// ── Constants ──

const MAX_TASK_REFINE_ITERATIONS = 2;

// ── Execute ──

/**
 * Execute a background task through the reasoning engine.
 * This is the `runCallback` passed to `TaskManager.init()`.
 */
export async function executeTask(task: BackgroundTask): Promise<TaskRun> {
    const startedAt = Date.now();
    const runNumber = task.totalRuns + 1;
    const runId = crypto.randomUUID();

    console.log(`[runner] Starting task ${task.id.slice(0, 8)} — run #${runNumber}: "${task.goal.slice(0, 60)}"`);
    emit({ type: "task:start", taskId: task.id, runNumber });

    // Build context
    const config = loadConfig();
    const model = getModel(config);
    const agentContext = buildAgentContext();
    const contextPreamble = formatContextPreamble(agentContext);
    const systemPrompt = buildTaskSystemPrompt(task, contextPreamble);

    // Build messages — the task goal as a user message, with memory context
    const messages = buildMessages(task, runNumber);

    // Track tool calls and phases
    let toolCalls: TaskRun["toolCalls"] = [];
    const phases: TaskPhase[] = task.plan.phases.map(p => ({
        ...p,
        status: "pending" as const,
    }));

    // Debounced live run writer
    const tm = TaskManager.getInstance();
    let liveRunTimer: ReturnType<typeof setTimeout> | null = null;
    function flushLiveRun() {
        if (liveRunTimer) { clearTimeout(liveRunTimer); liveRunTimer = null; }
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
    function scheduleLiveRun() {
        if (!liveRunTimer) {
            liveRunTimer = setTimeout(flushLiveRun, 2000);
        }
    }

    try {
        // Mark first phase as running
        if (phases.length > 0) {
            phases[0].status = "running";
            phases[0].startedAt = Date.now();
            emit({ type: "task:phase", taskId: task.id, phase: phases[0].description, status: "running" });
        }

        // Write initial "running" entry
        flushLiveRun();

        // Execute with evaluate-refine loop
        let resultText = "";
        let currentMessages = [...messages];
        let iteration = 0;
        let lastEvaluation: { satisfied: boolean; qualityScore: number; issues: string[] } | undefined;

        // Tool health monitor — tracks failures, detects loops, enables self-healing
        const health = new ToolHealthMonitor();
        let healthAborted = false;

        while (iteration <= MAX_TASK_REFINE_ITERATIONS) {
            iteration++;
            health.reset();
            console.log(`[runner] ${task.id.slice(0, 8)} — iteration ${iteration}/${MAX_TASK_REFINE_ITERATIONS + 1}`);

            const tools = getAllTools();
            const result = await generateText({
                model,
                system: systemPrompt,
                messages: currentMessages,
                tools,
                stopWhen: stepCountIs(TASK_STEP_LIMIT),
                temperature: 0.4,
                experimental_context: agentContext,

                // Self-healing: inspect tool health before each step
                prepareStep({ stepNumber }: { stepNumber: number }) {
                    const check = health.check(stepNumber);
                    const result: Record<string, unknown> = {};

                    if (check.systemSuffix) {
                        result.system = systemPrompt + check.systemSuffix;
                    }
                    if (check.disableTools?.length) {
                        const activeToolNames = Object.keys(tools)
                            .filter(t => !check.disableTools!.includes(t));
                        result.activeTools = activeToolNames;
                    }
                    if (check.shouldAbort) {
                        healthAborted = true;
                        console.warn(`[runner] ${task.id.slice(0, 8)} — ABORTING: ${check.abortReason}`);
                    }

                    return result;
                },

                // Track tool calls for health monitor + live progress events
                experimental_onToolCallFinish(event: any) {
                    const toolName = event.toolCall?.toolName ?? event.toolName ?? "unknown";
                    const args = event.toolCall?.input ?? event.toolCall?.args ?? event.args ?? {};

                    // Determine success/failure
                    let success = true;
                    let errorMsg: string | undefined;

                    if (event.success === false) {
                        success = false;
                        errorMsg = String(event.error || "Tool execution failed");
                    } else if (event.output != null) {
                        if (typeof event.output === "object") {
                            if (event.output.error) {
                                success = false;
                                errorMsg = event.output.error;
                            } else if (event.output.results?.length === 0) {
                                success = false;
                                errorMsg = event.output.message || "No results returned";
                            }
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

                    recordToolUse(toolName);
                    emit({ type: "task:tool", taskId: task.id, tool: toolName, status: "complete" });
                    scheduleLiveRun();
                },
            });

            // Check health abort
            if (healthAborted) {
                const records = health.getRecords();
                const failCount = records.filter(r => !r.success).length;
                console.warn(`[runner] ${task.id.slice(0, 8)} — run aborted by health monitor (${failCount}/${records.length} failures)`);
                resultText = result.text ?? "";
                break;
            }

            resultText = result.text ?? "";

            // ── Extract tool calls from result.steps (single source of truth) ──
            // The callback above is only used for health monitoring and live events.
            // Tool call data is extracted from the structured steps for accuracy.
            toolCalls = extractToolCalls(result);

            // Flush any pending live run update
            if (liveRunTimer) flushLiveRun();

            // Evaluate quality
            const toolSummary = toolCalls.map(tc => {
                const outputStr = tc.output == null
                    ? "no result"
                    : typeof tc.output === "string"
                        ? tc.output.slice(0, 200)
                        : (JSON.stringify(tc.output) ?? "").slice(0, 200);
                const argsStr = (tc.input ? JSON.stringify(tc.input) ?? "" : "").slice(0, 100);
                return `→ ${tc.tool}(${argsStr}) = ${outputStr}`;
            }).join("\n");
            const evalSummary = [toolSummary, resultText.slice(0, 2000)].filter(Boolean).join("\n\n").slice(0, 3000) || "(no output)";

            const evaluation = await evaluateResult(
                task.goal,
                task.plan.qualityCriteria,
                evalSummary,
            );

            lastEvaluation = {
                satisfied: evaluation.satisfied,
                qualityScore: evaluation.qualityScore,
                issues: evaluation.issues,
            };

            emit({
                type: "task:eval",
                taskId: task.id,
                satisfied: evaluation.satisfied,
                score: evaluation.qualityScore,
            });

            console.log(`[runner] ${task.id.slice(0, 8)} — eval: ${evaluation.satisfied ? "✓" : "✗"} (${evaluation.qualityScore.toFixed(2)})`);

            if (evaluation.satisfied || evaluation.recommendation === "done" || evaluation.recommendation === "give_up") {
                break;
            }

            // Refine if iterations remain
            if (iteration <= MAX_TASK_REFINE_ITERATIONS) {
                currentMessages = [
                    ...currentMessages,
                    { role: "assistant" as const, content: resultText || "I attempted the task." },
                    {
                        role: "user" as const,
                        content: `[System: Quality check found issues. Please refine.]\n\nIssues:\n${evaluation.issues.map(i => `- ${i}`).join("\n")}\n\n${evaluation.refinementHint ? `Hint: ${evaluation.refinementHint}\n\n` : ""}Please improve your work to fully achieve: "${task.goal}"`,
                    },
                ];
            }
        }

        // Mark phases completed
        const completedAt = Date.now();
        for (const phase of phases) {
            if (phase.status === "running" || phase.status === "pending") {
                phase.status = "completed";
                phase.completedAt = completedAt;
            }
        }

        // Determine if approval is needed
        const needsApproval = shouldRequireApproval(task);
        const runStatus = needsApproval ? "pending_approval" as const : "completed" as const;

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
            evaluation: lastEvaluation,
        };

        // Update task memory with learnings
        updateTaskMemory(task, run);

        if (needsApproval) {
            console.log(`[runner] ${task.id.slice(0, 8)} — run #${runNumber} needs approval`);
            emit({ type: "task:approval", taskId: task.id, runId });
            TaskManager.getInstance().transitionTo(task.id, "paused");
        }

        emit({ type: "task:complete", taskId: task.id, runId, status: runStatus });
        console.log(`[runner] ${task.id.slice(0, 8)} — run #${runNumber} ${runStatus} (${((completedAt - startedAt) / 1000).toFixed(1)}s, ${toolCalls.length} tools)`);

        return run;

    } catch (err: any) {
        if (liveRunTimer) { clearTimeout(liveRunTimer); liveRunTimer = null; }
        const completedAt = Date.now();
        console.error(`[runner] ${task.id.slice(0, 8)} — run #${runNumber} failed:`, err.message);
        emit({ type: "task:error", taskId: task.id, error: err.message });

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

// ── Tool call extraction (single source of truth: result.steps) ──

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

    if (task.totalRuns === 0) {
        messages.push({
            role: "user",
            content: `Execute this task NOW using your tools. Do not describe what you will do — just do it. Your final text output must BE the deliverable.\n\nTask: ${task.goal}`,
        });
        return messages;
    }

    // Subsequent runs — load previous context
    const tm = TaskManager.getInstance();
    const previousRuns = tm.getRuns(task.id, 5);
    const lastSuccessfulRun = previousRuns
        .filter(r => r.status === "completed" || r.status === "pending_approval")
        .pop();

    // Build correction block from rejected runs
    const rejectionFeedback = task.memory.feedback
        .filter(f => !f.approved && f.notes)
        .map(f => f.notes!)
        .slice(-3);

    const correctionBlock = rejectionFeedback.length > 0
        ? [
            `⚠️ CORRECTION FROM USER:`,
            ...rejectionFeedback.map(n => `→ "${n}"`),
            `You MUST incorporate these corrections into your work. The previous attempts were REJECTED because they did not follow this feedback.`,
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
                    correctionBlock,
                    `Execute run #${runNumber} of this recurring task NOW.`,
                    `Previous: ${task.successfulRuns}/${task.totalRuns} runs completed.`,
                    ``,
                    `IMPORTANT: The assistant message above shows what you produced in the previous run.`,
                    `You MUST produce NEW, FRESH content that continues or builds on the previous work.`,
                    `Do NOT repeat the same content.`,
                    ``,
                    task.memory.decisions.length > 0
                        ? `User decisions:\n${task.memory.decisions.map(d => `- **${d}**`).join("\n")}\n`
                        : "",
                    `Task: ${task.goal}`,
                ].filter(Boolean).join("\n"),
            });
        } else {
            messages.push({
                role: "user",
                content: [
                    correctionBlock,
                    `Re-execute this task NOW, improving on the previous attempt shown above.`,
                    ``,
                    `Task: ${task.goal}`,
                ].filter(Boolean).join("\n"),
            });
        }
    } else {
        messages.push({
            role: "user",
            content: [
                correctionBlock,
                `Execute run #${runNumber} of this task NOW using your tools.`,
                `Previous runs: ${task.totalRuns}. Use tools immediately to produce fresh results.`,
                ``,
                `Task: ${task.goal}`,
            ].filter(Boolean).join("\n"),
        });
    }

    return messages;
}
