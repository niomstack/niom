/**
 * Tool Index — flat registry and accessor for all built-in + MCP tools.
 *
 * Skill Packs compose tool subsets by referencing tool names.
 * The builtinToolRegistry provides a flat map of toolName → tool instance
 * so the router can resolve pack.toolIds to actual tool objects.
 */

import { fileTools } from "./file.js";
import { shellTools } from "./shell.js";
import { webTools } from "./web.js";
import { systemTools } from "./system.js";
import { computerTools } from "./computer.js";
import { researchTools } from "./research.js";
import { mcpManager } from "../mcp/client.js";

// ── Built-in Tool Registry ──
// Flat map of name → tool instance. Used by the skill router to resolve toolIds.

export const builtinToolRegistry: Record<string, any> = {
    // File intelligence
    readFile: fileTools.readFile,
    readFileRange: fileTools.readFileRange,
    writeFile: fileTools.writeFile,
    listDirectory: fileTools.listDirectory,
    deleteFile: fileTools.deleteFile,
    searchFiles: fileTools.searchFiles,
    editFile: fileTools.editFile,
    // Shell + system
    runCommand: shellTools.runCommand,
    notifyUser: shellTools.notifyUser,
    // Web
    webSearch: webTools.webSearch,
    fetchUrl: webTools.fetchUrl,
    // Research
    deepResearch: researchTools.deepResearch,
    // System
    systemInfo: systemTools.systemInfo,
    // Computer use
    screenshot: computerTools.screenshot,
    mouseClick: computerTools.mouseClick,
    mouseMove: computerTools.mouseMove,
    typeText: computerTools.typeText,
    pressKey: computerTools.pressKey,
    scroll: computerTools.scroll,
    getActiveWindow: computerTools.getActiveWindow,
};

// ── All Tools (built-in + MCP) ──

let _cachedTools: Record<string, any> | null = null;

/**
 * All tools available to the NIOM agent.
 *
 * Merges built-in tools with dynamically connected MCP server tools.
 * Cached — call `invalidateToolsCache()` when MCP connections change.
 */
export function getAllTools(): Record<string, any> {
    if (_cachedTools) return _cachedTools;
    _cachedTools = {
        ...builtinToolRegistry,
        ...mcpManager.getAllTools(),
    };
    return _cachedTools;
}

/**
 * Invalidate the tools cache. Called when MCP connections change.
 */
export function invalidateToolsCache(): void {
    _cachedTools = null;
}

