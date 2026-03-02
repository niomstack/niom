/**
 * Task progress events — EventEmitter for live SSE updates.
 */

import { EventEmitter } from "events";

/**
 * Global event emitter for task progress updates.
 * Frontend SSE-subscribes to these events.
 */
export const taskEvents = new EventEmitter();
taskEvents.setMaxListeners(50);

export type TaskProgressEvent =
    | { type: "task:start"; taskId: string; runNumber: number }
    | { type: "task:phase"; taskId: string; phase: string; status: string }
    | { type: "task:tool"; taskId: string; tool: string; status: "start" | "complete" }
    | { type: "task:eval"; taskId: string; satisfied: boolean; score: number }
    | { type: "task:complete"; taskId: string; runId: string; status: string }
    | { type: "task:approval"; taskId: string; runId: string }
    | { type: "task:error"; taskId: string; error: string };

export function emit(event: TaskProgressEvent): void {
    taskEvents.emit("progress", event);
}
