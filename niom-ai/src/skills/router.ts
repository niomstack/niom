/**
 * Skill Router — resolves a SkillPath to concrete tool instances.
 *
 * Flow:
 *   1. SkillPathResolver.resolve() produces a SkillPath with domains + tools
 *   2. routeFromSkillPath() resolves tool instances from the registry
 *   3. Merges cross-domain tools if secondaryDomains are present
 *   4. Returns a ResolvedSkillPack ready for streamText()
 *
 * The router also handles:
 *   - Cross-domain merging (primary + secondary domain tools)
 *   - Composite system prompts (primary personality + secondary guidance)
 *   - MCP tool injection alongside pack tools
 *   - Fallback to "general" pack (which gets all tools)
 */

import type { SkillPath } from "./traversal.js";
import type { ResolvedSkillPack, SkillDomain } from "./types.js";
import { getPackForDomain } from "./registry.js";
import { builtinToolRegistry, getAllTools } from "../tools/index.js";
import { mcpManager } from "../mcp/client.js";


/**
 * Route a SkillPath to a resolved skill pack with concrete tool instances.
 *
 * Returns a pack with:
 *   - Focused tool set (only the tools this path needs)
 *   - Domain-specific system prompt (composite if cross-domain)
 *   - Eval rubric for quality assessment
 */
export function routeFromSkillPath(path: SkillPath): ResolvedSkillPack {
    const pack = getPackForDomain(path.primaryDomain);

    // Resolve tool IDs to actual tool instances
    const resolvedTools: Record<string, any> = {};

    if (pack.toolIds.length === 0) {
        // General pack: provide all tools as fallback
        Object.assign(resolvedTools, getAllTools());
    } else {
        // Domain pack: resolve specific tools
        for (const toolId of pack.toolIds) {
            if (toolId in builtinToolRegistry) {
                resolvedTools[toolId] = builtinToolRegistry[toolId];
            }
        }
    }

    // ── Skills Tree tool injection ──
    // Add tools identified by the tree traversal that the pack didn't include
    let treeToolCount = 0;
    for (const tool of path.tools) {
        if (!(tool.toolName in resolvedTools) && tool.toolName in builtinToolRegistry) {
            resolvedTools[tool.toolName] = builtinToolRegistry[tool.toolName];
            treeToolCount++;
        }
    }

    // ── Cross-Domain Orchestration ──
    // When secondaryDomains are detected, merge tools AND compose system prompts
    let compositePrompt = pack.systemPrompt;
    const secondaryPackNames: string[] = [];

    if (path.secondaryDomains.length > 0) {
        const secondaryInstructions: string[] = [];

        for (const domain of path.secondaryDomains) {
            const secondaryPack = getPackForDomain(domain);
            secondaryPackNames.push(secondaryPack.name);

            // Merge tools from secondary pack
            for (const toolId of secondaryPack.toolIds) {
                if (toolId in builtinToolRegistry && !(toolId in resolvedTools)) {
                    resolvedTools[toolId] = builtinToolRegistry[toolId];
                }
            }

            // Extract key instructions from secondary pack (first ## section or first 3 lines)
            const secondaryLines = secondaryPack.systemPrompt.split("\n");
            const briefInstructions = extractKeyInstructions(secondaryLines, secondaryPack.name);
            if (briefInstructions) {
                secondaryInstructions.push(briefInstructions);
            }
        }

        // Compose: primary prompt stays dominant, secondary adds supplementary guidance
        if (secondaryInstructions.length > 0) {
            compositePrompt = `${pack.systemPrompt}

## Cross-Domain Guidance
This task spans multiple domains. Your primary expertise is **${pack.name}**, but you're also drawing on:
${secondaryInstructions.join("\n\n")}`;
        }
    }

    // Always include MCP tools (they're user-configured external integrations)
    const mcpTools = mcpManager.getAllTools();
    if (Object.keys(mcpTools).length > 0) {
        Object.assign(resolvedTools, mcpTools);
    }

    const resolved: ResolvedSkillPack = {
        ...pack,
        systemPrompt: compositePrompt,
        tools: resolvedTools,
    };

    const routeInfo = secondaryPackNames.length > 0
        ? `${path.primaryDomain} → ${pack.name} Pack (+ ${secondaryPackNames.join(", ")})`
        : `${path.primaryDomain} → ${pack.name} Pack`;

    console.log(
        `[Router] ${routeInfo} ` +
        `(${Object.keys(resolvedTools).length} tools${treeToolCount > 0 ? `, +${treeToolCount} from tree` : ""}: ` +
        `${Object.keys(resolvedTools).slice(0, 5).join(", ")}${Object.keys(resolvedTools).length > 5 ? "..." : ""})`
    );

    return resolved;
}

/**
 * Extract brief, actionable instructions from a skill pack's system prompt
 * for use as supplementary guidance in cross-domain scenarios.
 */
function extractKeyInstructions(lines: string[], packName: string): string {
    // Find the "## Approach" or "## Rules" section and grab key bullets
    const keyLines: string[] = [];
    let inSection = false;

    for (const line of lines) {
        if (line.startsWith("## Approach") || line.startsWith("## Rules")) {
            inSection = true;
            continue;
        }
        if (inSection && line.startsWith("## ")) {
            break; // End of section
        }
        if (inSection && line.startsWith("- ")) {
            keyLines.push(line);
            if (keyLines.length >= 3) break; // Top 3 bullets only
        }
    }

    if (keyLines.length === 0) return "";

    return `**${packName} guidance:**\n${keyLines.join("\n")}`;
}
