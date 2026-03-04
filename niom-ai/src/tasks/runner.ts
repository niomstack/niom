/**
 * TaskRunner — barrel export.
 *
 * The runner was split into focused sub-modules:
 *   runner/prompt.ts    — system prompt construction (with steering comments)
 *   runner/execute.ts   — single-pass execution engine
 *   runner/memory.ts    — task memory updates
 *   runner/events.ts    — progress event emitter
 *
 * Task Streams model: no approval module. Steering replaces approve/reject.
 */

export { executeTask } from "./runner/execute.js";
export { taskEvents } from "./runner/events.js";
export type { TaskProgressEvent } from "./runner/events.js";
