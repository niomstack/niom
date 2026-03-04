/**
 * Task progress events — EventEmitter for live SSE updates.
 *
 * Events carry full data so the frontend can build state directly
 * from the SSE stream without needing REST polling during execution.
 */

import { EventEmitter } from "events";

/**
 * Global event emitter for task progress updates.
 * Frontend SSE-subscribes to these events.
 */
export const taskEvents = new EventEmitter();
taskEvents.setMaxListeners(50);

export type TaskProgressEvent =
    | {
        type: "task:start";
        taskId: string;
        runId: string;
        runNumber: number;
        startedAt: number;
        phases: Array<{ id: string; description: string; status: string }>;
    }
    | { type: "task:phase"; taskId: string; phase: string; status: string }
    | {
        type: "task:tool";
        taskId: string;
        runId: string;
        tool: string;
        input?: any;
        output?: any;
        status: "start" | "complete";
    }
    | {
        type: "task:complete";
        taskId: string;
        runId: string;
        runNumber: number;
        status: string;
        output?: string;
        durationMs?: number;
        toolCount: number;
        qualityScore?: number;
    }
    | { type: "task:steer"; taskId: string; comment: string }
    | { type: "task:error"; taskId: string; runId?: string; error: string };

export function emit(event: TaskProgressEvent): void {
    taskEvents.emit("progress", event);
}
