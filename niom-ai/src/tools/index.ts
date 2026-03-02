import { fileTools } from "./file.js";
import { shellTools } from "./shell.js";
import { webTools } from "./web.js";
import { systemTools } from "./system.js";
import { computerTools } from "./computer.js";
import { mcpManager } from "../mcp/client.js";

/**
 * Built-in tools — static, always available.
 */
export const builtinTools = {
    ...fileTools,
    ...shellTools,
    ...webTools,
    ...systemTools,
    ...computerTools,
};

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
        ...builtinTools,
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

export type ToolName = string;

