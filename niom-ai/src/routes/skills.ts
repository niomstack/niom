/**
 * Skill Tree API routes — pre-computation, management & marketplace endpoints.
 *
 * POST  /api/skills/hint               — type-time: pre-computed skill path for partial message
 * GET   /api/skills/stats              — graph statistics
 * GET   /api/skills/tree               — full graph data for UI visualization
 * GET   /api/skills/packs              — list all registered packs
 * POST  /api/skills/record             — record tool usage for learning
 * PATCH /api/skills/:domain/toggle     — enable/disable a skill pack
 * GET   /api/skills/marketplace/search — search Skills.sh + MCP Registry
 * POST  /api/skills/marketplace/install — install community skill or MCP server
 * DELETE /api/skills/marketplace/:id   — uninstall community skill
 * GET   /api/skills/marketplace/installed — list installed community skills
 */

import { Hono } from "hono";
import { SkillPathResolver } from "../skills/traversal.js";
import { getAllPacks, setPackEnabled } from "../skills/registry.js";
import {
    searchMarketplace,
    getFeaturedSkills,
    installMarketplaceSkill,
    uninstallMarketplaceSkill,
    getInstalledCommunitySkills,
} from "../skills/marketplace.js";
import type { SkillDomain } from "../skills/types.js";

const skills = new Hono();

/**
 * POST /skills/hint — Pre-compute skill path during typing.
 *
 * Called by the frontend every 300ms (debounced) with the partial message.
 * Returns the most relevant domains and tools for the current input.
 */
skills.post("/hint", async (c) => {
    try {
        const { message } = await c.req.json();

        if (!message || typeof message !== "string" || message.trim().length < 3) {
            return c.json({ domains: [], tools: [], comparisons: 0 });
        }

        let resolver: SkillPathResolver;
        try {
            resolver = SkillPathResolver.getInstance();
        } catch {
            // Not yet initialized (startup race) — return gracefully
            return c.json({ domains: [], tools: [], comparisons: 0, status: "warming_up" });
        }

        if (!resolver.isReady()) {
            return c.json({ domains: [], tools: [], comparisons: 0, status: "warming_up" });
        }

        const path = await resolver.resolveSkillPath(message);

        return c.json({
            domains: path.domains.slice(0, 3),
            tools: path.tools.slice(0, 8),
            comparisons: path.comparisons,
            traversalMs: path.traversalMs,
        });
    } catch (err: any) {
        console.error("[skills/hint] Error:", err.message);
        return c.json({ error: err.message }, 500);
    }
});

/**
 * GET /skills/stats — Graph statistics.
 */
skills.get("/stats", (c) => {
    try {
        const resolver = SkillPathResolver.getInstance();
        return c.json({
            ready: resolver.isReady(),
            ...resolver.getStats(),
        });
    } catch {
        return c.json({ ready: false, nodes: 0, edges: 0 });
    }
});

/**
 * GET /skills/packs — List all registered skill packs.
 */
skills.get("/packs", (c) => {
    const packs = getAllPacks().map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        domain: p.domain,
        toolIds: p.toolIds,
        enabled: p.enabled,
        source: p.source,
        toolCount: p.toolIds.length,
    }));
    return c.json({ packs });
});

/**
 * GET /skills/tree — Full graph data for visualization.
 */
skills.get("/tree", (c) => {
    try {
        const resolver = SkillPathResolver.getInstance();
        if (!resolver.isReady()) {
            return c.json({ nodes: [], edges: [] });
        }

        const graph = resolver.getGraph();
        const nodes = graph.getAllNodeIds().map(id => {
            const node = graph.getNode(id)!;
            return {
                id: node.id,
                name: node.name,
                type: node.type,
                description: node.description.slice(0, 200),
                parents: node.parents,
                children: node.children,
                enabled: node.enabled,
                usageCount: node.usageCount,
                lastUsed: node.lastUsed,
                packId: node.packId,
                toolName: node.toolName,
            };
        });

        // Return edges without embeddings (too large for API)
        const edges = graph.getAllNodeIds().flatMap(id => {
            return graph.getOutgoingEdges(id).map(e => ({
                from: e.from,
                to: e.to,
                type: e.type,
                weight: e.weight,
                reinforcements: e.reinforcements,
            }));
        });

        return c.json({ nodes, edges });
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

/**
 * POST /skills/record — Record tool usage for edge learning.
 */
skills.post("/record", async (c) => {
    try {
        const { tools } = await c.req.json();

        if (!Array.isArray(tools) || tools.length === 0) {
            return c.json({ recorded: false });
        }

        const resolver = SkillPathResolver.getInstance();
        resolver.recordToolUsage(tools);

        return c.json({ recorded: true, toolCount: tools.length });
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

// ── Skill Management ──

/**
 * PATCH /skills/:domain/toggle — Enable or disable a skill pack.
 */
skills.patch("/:domain/toggle", async (c) => {
    try {
        const domain = c.req.param("domain") as SkillDomain;
        const { enabled } = await c.req.json();

        if (typeof enabled !== "boolean") {
            return c.json({ error: "enabled must be a boolean" }, 400);
        }

        // Find the pack matching this domain
        const packs = getAllPacks();
        const pack = packs.find(p => p.domain === domain);
        if (!pack) {
            return c.json({ error: `No pack found for domain: ${domain}` }, 404);
        }

        const success = setPackEnabled(pack.id, enabled);
        if (!success) {
            return c.json({ error: "Failed to update pack" }, 500);
        }

        console.log(`[Skills] ${pack.name} Pack ${enabled ? "enabled" : "disabled"}`);

        // Re-index the skill tree to reflect the change
        try {
            const resolver = SkillPathResolver.getInstance();
            if (resolver.isReady()) {
                await resolver.reinitialize(); // Refresh graph
            }
        } catch {
            // Tree not initialized — skip
        }

        return c.json({
            domain,
            packId: pack.id,
            name: pack.name,
            enabled,
        });
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

// ── Marketplace ──

/**
 * GET /skills/marketplace/featured — Return curated featured skills from both registries.
 */
skills.get("/marketplace/featured", async (c) => {
    try {
        const results = await getFeaturedSkills();
        return c.json({ results });
    } catch (err: any) {
        console.error("[marketplace/featured] Error:", err.message);
        return c.json({ error: err.message, results: [] }, 500);
    }
});

/**
 * GET /skills/marketplace/search — Search Skills.sh + MCP Registry.
 */
skills.get("/marketplace/search", async (c) => {
    try {
        const query = c.req.query("q") || "";
        if (query.length < 2) {
            return c.json({ results: [], query });
        }

        const results = await searchMarketplace(query);
        return c.json({ results, query });
    } catch (err: any) {
        console.error("[marketplace/search] Error:", err.message);
        return c.json({ error: err.message, results: [] }, 500);
    }
});

/**
 * POST /skills/marketplace/install — Install a community skill or MCP server.
 */
skills.post("/marketplace/install", async (c) => {
    try {
        const { source, identifier, config } = await c.req.json();

        if (!source || !identifier) {
            return c.json({ error: "source and identifier are required" }, 400);
        }

        const result = await installMarketplaceSkill(source, identifier, config);
        return c.json(result);
    } catch (err: any) {
        console.error("[marketplace/install] Error:", err.message);
        return c.json({ error: err.message }, 500);
    }
});

/**
 * DELETE /skills/marketplace/:id — Uninstall a community skill.
 */
skills.delete("/marketplace/:id", async (c) => {
    try {
        const id = c.req.param("id");
        const result = await uninstallMarketplaceSkill(id);
        return c.json(result);
    } catch (err: any) {
        return c.json({ error: err.message }, 500);
    }
});

/**
 * GET /skills/marketplace/installed — List installed community skills.
 */
skills.get("/marketplace/installed", (c) => {
    try {
        const installed = getInstalledCommunitySkills();
        return c.json({ skills: installed });
    } catch (err: any) {
        return c.json({ error: err.message, skills: [] }, 500);
    }
});

export default skills;

