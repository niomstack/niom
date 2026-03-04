/**
 * Task memory updates — extract learnings from completed runs.
 *
 * After each task run, this module extracts URLs (as sources),
 * created files, and findings summary into the task's persistent memory.
 */

import type { BackgroundTask, TaskRun } from "../types.js";
import { TaskManager } from "../manager.js";

/**
 * Update task memory with info learned during a run.
 * Extracts findings and sources from the run output.
 */
export function updateTaskMemory(task: BackgroundTask, run: TaskRun): void {
    // Extract URLs from the output as sources
    if (run.output) {
        const urlPattern = /https?:\/\/[^\s)>"']+/g;
        const urls = run.output.match(urlPattern) || [];
        for (const url of urls.slice(0, 10)) {
            if (!task.memory.sources.includes(url)) {
                task.memory.sources.push(url);
            }
        }
        if (task.memory.sources.length > 50) {
            task.memory.sources = task.memory.sources.slice(-50);
        }
    }

    // Extract files created from tool calls
    for (const tc of run.toolCalls) {
        if (tc.tool === "writeFile" && tc.input?.path) {
            if (!task.memory.filesCreated.includes(tc.input.path)) {
                task.memory.filesCreated.push(tc.input.path);
            }
        }
    }

    // Record finding if run was successful
    if (run.status === "completed" && run.summary) {
        task.memory.findings.push(
            `Run #${run.runNumber} (${new Date(run.startedAt).toLocaleDateString()}): ${run.summary.slice(0, 200)}`
        );
        if (task.memory.findings.length > 30) {
            task.memory.findings = task.memory.findings.slice(-30);
        }
    }

    // Persist
    TaskManager.getInstance().updateTask(task.id, { memory: task.memory });
}
