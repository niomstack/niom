/**
 * Skills module — barrel export.
 *
 * Provides all public APIs for the skill system:
 *   - Types (SkillPack, SkillDomain, etc.)
 *   - Registry (registerPack, getPackForDomain, initializeSkillPacks, etc.)
 *   - Router (routeFromSkillPath)
 *   - Traversal (SkillPathResolver, SkillPath)
 *   - Loader (loadSkillFile, loadBuiltinPacks, loadInstalledPacks)
 */

export * from "./types.js";
export { registerPack, getPack, getPackForDomain, getPacksByDomain, getEnabledPacks, getAllPacks, setPackEnabled, initializeSkillPacks } from "./registry.js";
export { routeFromSkillPath } from "./router.js";
export { SkillPathResolver, type SkillPath, type ExecutionMode } from "./traversal.js";
export { loadSkillFile, loadBuiltinPacks, loadInstalledPacks } from "./loader.js";
