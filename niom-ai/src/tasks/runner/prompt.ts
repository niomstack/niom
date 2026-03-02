/**
 * Task system prompt construction.
 *
 * Builds the system prompt and memory section injected into
 * background task execution calls.
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
    if (task.memory.decisions.length > 0) {
        parts.push(`### User Decisions & Corrections\n⚠️ CRITICAL — The user has provided the following corrections. You MUST follow these:\n${task.memory.decisions.slice(-5).map(d => `- **${d}**`).join("\n")}`);
    }
    if (task.memory.feedback.length > 0) {
        const recent = task.memory.feedback.slice(-3);
        parts.push(`### Recent Feedback\n${recent.map(f =>
            `- Run ${f.runId.slice(0, 8)}: ${f.approved ? "✓ approved" : "✗ rejected"}${f.notes ? ` — "${f.notes}"` : ""}`
        ).join("\n")}`);
    }

    if (parts.length === 0) return "";
    return `\n## Memory (from ${task.totalRuns} previous runs)\n${parts.join("\n\n")}`;
}

export { TASK_STEP_LIMIT };
