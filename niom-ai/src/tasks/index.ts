/**
 * Tasks module — background task management for NIOM.
 *
 * Re-exports all public types and the TaskManager singleton.
 */

export { TaskManager } from "./manager.js";
export { executeTask, approveRun, taskEvents } from "./runner.js";
export type {
    BackgroundTask,
    TaskRegistryEntry,
    TaskStatus,
    TaskType,
    TaskRun,
    TaskSchedule,
    TaskApproval,
    TaskPlan,
    TaskPhase,
    TaskMemory,
} from "./types.js";
export { canTransition, emptyMemory, parseInterval } from "./types.js";
