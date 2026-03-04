/**
 * Task system prompt construction.
 *
 * Builds the system prompt and memory section injected into
 * background task execution calls.
 *
 * Task Streams model: steering comments replace approval feedback.
 */

import type { BackgroundTask } from "../types.js";
import { MemoryStore } from "../../memory/store.js";

const TASK_STEP_LIMIT = 25;

export function buildTaskSystemPrompt(
    task: BackgroundTask,
    contextPreamble: string,
): string {
    const memorySection = buildMemorySection(task);
    const brainContext = MemoryStore.getInstance().getBrainContext();

    return `You are **NIOM**, executing a background task autonomously.

## Task Goal
${task.goal}

## Task Type
${task.taskType}${task.schedule ? ` (recurring: ${task.schedule.interval})` : ""}

## Quality Criteria
${task.plan.qualityCriteria}

## Execution Plan
${task.plan.phases.map((p, i) => `${i + 1}. ${p.description} [${p.status}]`).join("\n")}
${memorySection}
${brainContext ? `\n${brainContext}\n` : ""}
${contextPreamble}

## Instructions
- You are running AUTONOMOUSLY in the background. The user is NOT watching.
- DO NOT describe what you plan to do. DO NOT narrate your intentions. JUST DO IT.
- IMMEDIATELY start calling tools to accomplish the goal. Every message should contain tool calls.
- Work through the plan phases systematically using your tools (web search, file operations, etc.).
- If a phase fails, note it briefly and continue with the next phase.
- Your FINAL text output IS the deliverable — it should contain the actual result (report, analysis, suggestions, generated content, etc.), NOT a description of what you did.
- Do NOT ask the user questions — make your best judgment.
- You have ${TASK_STEP_LIMIT} tool steps — use them all if needed to produce a thorough result.
- IMPORTANT: Your text response at the end must contain the COMPLETE final output that the user asked for.`;
}

export function buildMemorySection(task: BackgroundTask): string {
    const parts: string[] = [];

    if (task.memory.findings.length > 0) {
        parts.push(`### Previous Findings\n${task.memory.findings.slice(-10).map(f => `- ${f}`).join("\n")}`);
    }
    if (task.memory.sources.length > 0) {
        parts.push(`### Known Sources\n${task.memory.sources.slice(-10).map(s => `- ${s}`).join("\n")}`);
    }

    // Steering comments — the main feedback mechanism
    const pendingComments = task.memory.comments.filter(c => !c.appliedToRun);
    const recentComments = task.memory.comments.slice(-5);

    if (pendingComments.length > 0) {
        parts.push(
            `### ⚠️ User Steering (MUST FOLLOW)\n` +
            `The user posted these comments to guide your work. You MUST incorporate them:\n` +
            pendingComments.map(c => `- **"${c.text}"**`).join("\n")
        );
    } else if (recentComments.length > 0) {
        parts.push(
            `### Recent User Feedback\n` +
            recentComments.map(c => `- "${c.text}" (${c.appliedToRun ? `applied in run #${c.appliedToRun}` : "pending"})`).join("\n")
        );
    }

    // Legacy decisions (still useful for backward compat)
    const uniqueDecisions = task.memory.decisions.filter(d =>
        !task.memory.comments.some(c => c.text === d)
    );
    if (uniqueDecisions.length > 0) {
        parts.push(`### User Decisions\n${uniqueDecisions.slice(-5).map(d => `- **${d}**`).join("\n")}`);
    }

    if (parts.length === 0) return "";
    return `\n## Memory (from ${task.totalRuns} previous runs)\n${parts.join("\n\n")}`;
}

export { TASK_STEP_LIMIT };
