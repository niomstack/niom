/**
 * TaskRunner — barrel export.
 *
 * The runner was split into focused sub-modules:
 *   runner/prompt.ts    — system prompt construction
 *   runner/execute.ts   — core execution engine
 *   runner/approval.ts  — approval flow
 *   runner/memory.ts    — task memory updates
 *   runner/events.ts    — progress event emitter
 */

export { executeTask } from "./runner/execute.js";
export { approveRun } from "./runner/approval.js";
export { taskEvents } from "./runner/events.js";
export type { TaskProgressEvent } from "./runner/events.js";
