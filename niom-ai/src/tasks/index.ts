/**
 * Tasks module — background task management for NIOM.
 *
 * Task Streams model: tasks flow autonomously, users steer via comments.
 */

export { TaskManager } from "./manager.js";
export { executeTask, taskEvents } from "./runner.js";
export type {
    BackgroundTask,
    TaskRegistryEntry,
    TaskStatus,
    TaskType,
    TaskRun,
    TaskSchedule,
    TaskPlan,
    TaskPhase,
    TaskMemory,
    TaskComment,
    AutoPauseConfig,
} from "./types.js";
export { canTransition, emptyMemory, parseInterval, DEFAULT_AUTO_PAUSE } from "./types.js";
