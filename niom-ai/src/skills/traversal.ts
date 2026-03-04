/**
 * Skill Traversal Engine — the single routing brain for NIOM.
 *
 * Replaces analyze.ts (LLM classifier), evaluate.ts (refine loop),
 * and detectDomain() (regex fallback). ALL routing decisions flow
 * through the Skill Tree's embedding-based hierarchical traversal.
 *
 * The three-phase algorithm:
 *
 *   Phase A (Install-Time): Build the graph
 *     - Embed each skill pack description → create domain nodes
 *     - Embed each tool description → create tool leaf nodes
 *     - Build hierarchy edges + semantic similarity edges
 *     - Create automation sub-domain for background task detection
 *
 *   Phase B (Type-Time): Pre-compute skill path
 *     - Embed partial user message
 *     - Traverse DAG: root → best domains → best tools
 *     - Determine execution mode, step budget, domain signals
 *     - ~25 comparisons vs ~200 flat = 8x faster
 *     - Cache result for send-time
 *
 *   Phase C (Send-Time): Inject pre-computed result
 *     - Use cached skill path to build focused tool set
 *     - Skill path replaces IntentAnalysis entirely
 *
 * Performance budget:
 *   - Install-time indexing: ~500ms (one-time)
 *   - Type-time traversal: ~15ms (debounced per keystroke)
 *   - Send-time lookup: <1ms (cache hit)
 */

import { SkillGraph } from "./graph.js";
import { embedText, cosineSimilarity } from "./embeddings.js";
import { getAllPacks, getPackForDomain } from "./registry.js";
import { builtinToolRegistry } from "../tools/index.js";
import { shouldValidate, validateIntent } from "./intent-validator.js";
import { join } from "path";
import type { SkillDomain } from "./types.js";

// ── Types ──

/** Execution mode — replaces complexity tiers */
export type ExecutionMode = "stream" | "generate" | "background";

/** Result of a skill path traversal — replaces IntentAnalysis */
export interface SkillPath {
    /** Matched domain nodes (sorted by relevance) */
    domains: Array<{ id: string; name: string; score: number }>;
    /** Matched tool nodes (sorted by relevance) */
    tools: Array<{ id: string; toolName: string; score: number }>;
    /** Total comparisons made (for performance tracking) */
    comparisons: number;
    /** Traversal time in milliseconds */
    traversalMs: number;
    /** Timestamp when this path was computed */
    computedAt: number;

    // ── Routing decisions (replaces analyze.ts) ──

    /** How to execute: stream (simple), generate (complex), background (task) */
    executionMode: ExecutionMode;
    /** Dynamic step limit (replaces hardcoded STEP_LIMITS) */
    stepBudget: number;
    /** User's original message (passthrough as goal) */
    goal: string;
    /** Top-scoring domain */
    primaryDomain: SkillDomain;
    /** Other high-scoring domains for cross-domain merging */
    secondaryDomains: SkillDomain[];
    /** System prompt fragments from matched domain packs */
    systemPromptFragments: string[];
    /** Whether this is a recurring/scheduled request */
    isRecurring: boolean;
    /** Whether this is a long-running request */
    isLongRunning: boolean;
}

// ── Greeting / Fast-Path Detection ──

const GREETING_PATTERN = /^(hi|hey|hello|yo|sup|thanks|thx|ty|ok|okay|sure|yes|no|bye|gm|gn|lol|haha|nice|cool|great|wow)[\s!.?]*$/i;

/**
 * Check if a message is trivially simple (greeting, single word).
 * Returns a minimal SkillPath without traversal if so.
 */
function fastPath(message: string): SkillPath | null {
    const trimmed = message.trim();

    if (GREETING_PATTERN.test(trimmed)) {
        return {
            domains: [{ id: "domain:general", name: "General", score: 1.0 }],
            tools: [],
            comparisons: 0,
            traversalMs: 0,
            computedAt: Date.now(),
            executionMode: "stream",
            stepBudget: 3,
            goal: trimmed,
            primaryDomain: "general",
            secondaryDomains: [],
            systemPromptFragments: [],
            isRecurring: false,
            isLongRunning: false,
        };
    }

    return null;
}

// ── Automation sub-domain descriptions ──
// These are embedded at install time to detect background task intent

const AUTOMATION_DESCRIPTIONS = [
    "remind me, set a reminder, daily reminder, notification alert",
    "schedule a task, run something every day, recurring job, periodic automation",
    "monitor, watch, track changes, keep an eye on, background process",
    "every day, everyday, daily, weekly, hourly, monthly, every morning, every evening",
    "automate, automation, run in background, background task, scheduled task",
    "recurring, repeat, periodically, on a schedule, cron, timer",
];

// ── SkillPathResolver (Singleton) ──

export class SkillPathResolver {
    private static instance: SkillPathResolver;
    private graph: SkillGraph;
    private initialized = false;
    private initializing: Promise<void> | null = null;

    // Type-time cache: partial message → skill path
    private pathCache: Map<string, SkillPath> = new Map();
    private readonly PATH_CACHE_MAX = 50;
    private readonly PATH_CACHE_TTL = 30_000; // 30 seconds

    private constructor(dataDir: string) {
        const graphPath = join(dataDir, "skill-graph.json");
        this.graph = new SkillGraph(graphPath);
    }

    static getInstance(dataDir?: string): SkillPathResolver {
        if (!SkillPathResolver.instance) {
            if (!dataDir) throw new Error("SkillPathResolver requires dataDir on first call");
            SkillPathResolver.instance = new SkillPathResolver(dataDir);
        }
        return SkillPathResolver.instance;
    }

    // ── Phase A: Install-Time Indexing ──

    /**
     * Build or rebuild the skill graph from all registered packs.
     * Called once at startup (or when packs change).
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        if (this.initializing) return this.initializing;

        this.initializing = this._initialize();
        await this.initializing;
    }

    /**
     * Force re-initialization (e.g., after pack toggle or install).
     * Rebuilds the graph from the current registry state.
     */
    async reinitialize(): Promise<void> {
        this.initialized = false;
        this.initializing = null;
        this.pathCache.clear();
        await this.initialize();
    }

    private async _initialize(): Promise<void> {
        const start = Date.now();

        // Try to load existing graph
        const loaded = this.graph.load();

        // Build/rebuild from current packs
        await this.indexAllPacks();

        this.initialized = true;
        this.graph.save();

        console.log(
            `[SkillTree] Initialized in ${Date.now() - start}ms: ` +
            `${this.graph.nodeCount} nodes, ${this.graph.edgeCount} edges` +
            (loaded ? " (loaded + refreshed)" : " (built fresh)")
        );
    }

    /**
     * Index all registered skill packs into the graph.
     */
    private async indexAllPacks(): Promise<void> {
        const packs = getAllPacks();

        // 1. Create root node
        const rootEmbedding = await embedText("general purpose AI assistant personal intelligence");
        this.graph.addNode({
            id: "root",
            name: "NIOM",
            type: "root",
            description: "Root of the skill tree",
            embedding: Array.from(rootEmbedding),
            parents: [],
            children: [],
            enabled: true,
            usageCount: 0,
            lastUsed: 0,
        });

        // 2. Create domain nodes from packs
        for (const pack of packs) {
            if (pack.domain === "general") continue; // General is the fallback, not a tree node

            const domainId = `domain:${pack.domain}`;
            const domainEmbedding = await embedText(
                `${pack.name}: ${pack.description}. ${pack.systemPrompt.slice(0, 200)}`
            );

            this.graph.addNode({
                id: domainId,
                name: pack.name,
                type: "domain",
                description: pack.description,
                embedding: Array.from(domainEmbedding),
                parents: ["root"],
                children: [],
                enabled: pack.enabled,
                usageCount: 0,
                lastUsed: 0,
                packId: pack.id,
            });

            // Root → domain hierarchy edge
            this.graph.addEdge({
                from: "root",
                to: domainId,
                type: "hierarchy",
                weight: 1.0,
                reinforcements: 0,
                lastReinforced: Date.now(),
            });

            // Update root's children
            const root = this.graph.getNode("root")!;
            if (!root.children.includes(domainId)) {
                root.children.push(domainId);
            }

            // 3. Create tool nodes for this domain
            for (const toolName of pack.toolIds) {
                const toolId = `tool:${toolName}`;
                const toolDef = builtinToolRegistry[toolName];

                if (!toolDef) continue;

                // Get tool description from the tool definition
                const toolDesc = typeof toolDef.description === "string"
                    ? toolDef.description
                    : `Tool: ${toolName}`;

                // Only embed if not already in graph (tools shared across packs)
                let toolNode = this.graph.getNode(toolId);
                if (!toolNode) {
                    const toolEmbedding = await embedText(`${toolName}: ${toolDesc}`);
                    toolNode = {
                        id: toolId,
                        name: toolName,
                        type: "tool",
                        description: toolDesc,
                        embedding: Array.from(toolEmbedding),
                        parents: [domainId],
                        children: [],
                        enabled: true,
                        usageCount: 0,
                        lastUsed: 0,
                        toolName,
                    };
                    this.graph.addNode(toolNode);
                } else {
                    // Tool exists — add this domain as another parent (DAG)
                    if (!toolNode.parents.includes(domainId)) {
                        toolNode.parents.push(domainId);
                    }
                }

                // Domain → tool hierarchy edge
                this.graph.addEdge({
                    from: domainId,
                    to: toolId,
                    type: "hierarchy",
                    weight: 1.0,
                    reinforcements: 0,
                    lastReinforced: Date.now(),
                });

                // Update domain's children
                const domainNode = this.graph.getNode(domainId)!;
                if (!domainNode.children.includes(toolId)) {
                    domainNode.children.push(toolId);
                }
            }
        }

        // 4. Create automation sub-domain (for background task detection)
        await this.indexAutomationSubDomain();

        // 5. Build semantic similarity edges between related tools
        await this.buildSemanticEdges();
    }

    /**
     * Create the automation sub-domain with embedded descriptions
     * for detecting recurring/scheduled/reminder intent.
     */
    private async indexAutomationSubDomain(): Promise<void> {
        const automationId = "subdomain:automation";

        // Combine all automation descriptions for a rich embedding
        const fullDesc = AUTOMATION_DESCRIPTIONS.join(". ");
        const automationEmbedding = await embedText(fullDesc);

        this.graph.addNode({
            id: automationId,
            name: "Automation",
            type: "subdomain",
            description: "Recurring tasks, reminders, scheduling, monitoring, background automation",
            embedding: Array.from(automationEmbedding),
            parents: ["domain:personal"],
            children: [],
            enabled: true,
            usageCount: 0,
            lastUsed: 0,
        });

        // Personal → Automation hierarchy edge
        this.graph.addEdge({
            from: "domain:personal",
            to: automationId,
            type: "hierarchy",
            weight: 1.0,
            reinforcements: 0,
            lastReinforced: Date.now(),
        });

        // Update personal domain's children
        const personalNode = this.graph.getNode("domain:personal");
        if (personalNode && !personalNode.children.includes(automationId)) {
            personalNode.children.push(automationId);
        }

        // Also embed individual automation concepts as sub-nodes for finer matching
        const automationConcepts = [
            { id: "concept:reminders", desc: "remind me, set reminder, daily reminder, notification, alert me, don't forget" },
            { id: "concept:scheduling", desc: "schedule, every day, everyday, daily, weekly, hourly, run at, cron, periodic" },
            { id: "concept:monitoring", desc: "monitor, watch, track, keep an eye on, alert when, detect changes" },
        ];

        for (const concept of automationConcepts) {
            const conceptEmbedding = await embedText(concept.desc);
            this.graph.addNode({
                id: concept.id,
                name: concept.id.split(":")[1],
                type: "tool", // Treat as leaf for traversal scoring
                description: concept.desc,
                embedding: Array.from(conceptEmbedding),
                parents: [automationId],
                children: [],
                enabled: true,
                usageCount: 0,
                lastUsed: 0,
            });

            this.graph.addEdge({
                from: automationId,
                to: concept.id,
                type: "hierarchy",
                weight: 1.0,
                reinforcements: 0,
                lastReinforced: Date.now(),
            });

            const autoNode = this.graph.getNode(automationId);
            if (autoNode && !autoNode.children.includes(concept.id)) {
                autoNode.children.push(concept.id);
            }
        }
    }

    /**
     * Build semantic edges between tools that are semantically related
     * but not necessarily in the same domain.
     */
    private async buildSemanticEdges(): Promise<void> {
        const toolNodes = this.graph.getToolNodes();
        const SEMANTIC_THRESHOLD = 0.6; // Only create edges for significantly similar tools

        for (let i = 0; i < toolNodes.length; i++) {
            for (let j = i + 1; j < toolNodes.length; j++) {
                const a = toolNodes[i];
                const b = toolNodes[j];

                // Skip if same tool or already have a hierarchy edge
                if (a.id === b.id) continue;

                const sim = cosineSimilarity(
                    new Float32Array(a.embedding),
                    new Float32Array(b.embedding),
                );

                if (sim > SEMANTIC_THRESHOLD) {
                    this.graph.addEdge({
                        from: a.id,
                        to: b.id,
                        type: "semantic",
                        weight: sim,
                        reinforcements: 0,
                        lastReinforced: Date.now(),
                    });
                }
            }
        }
    }

    // ── Phase B: Resolve SkillPath (replaces analyzeIntent) ──

    /**
     * Resolve the full skill path for a message.
     * This is the SINGLE routing function for NIOM — replaces:
     *   - analyzeIntent() (LLM classifier)
     *   - detectDomain() (regex fallback)
     *   - routeToSkillPack() domain lookup (partially)
     *
     * Returns execution mode, step budget, tools, domains — everything
     * the agent engine needs to execute.
     */
    async resolve(message: string): Promise<SkillPath> {
        // Fast-path: greetings/acknowledgments skip traversal
        const fast = fastPath(message);
        if (fast) {
            console.log(`[SkillTree] Fast-path: "${message.slice(0, 40)}" → stream/general`);
            return fast;
        }

        const start = Date.now();

        // Check cache
        const cacheKey = message.slice(0, 100).toLowerCase().trim();
        const cached = this.pathCache.get(cacheKey);
        if (cached && (Date.now() - cached.computedAt) < this.PATH_CACHE_TTL) {
            return cached;
        }

        await this.initialize();

        let comparisons = 0;

        // 1. Embed the query
        const queryEmbedding = await embedText(message);

        // 2. Score against domain nodes
        const domainNodes = this.graph.getNodesByType("domain").filter(n => n.enabled);
        const domainScores: Array<{ id: string; name: string; score: number; domain: SkillDomain }> = [];

        for (const domain of domainNodes) {
            const sim = cosineSimilarity(queryEmbedding, new Float32Array(domain.embedding));
            comparisons++;

            // Boost by usage frequency (logarithmic, max +0.1)
            const usageBoost = Math.min(0.1, Math.log2(domain.usageCount + 1) * 0.02);
            domainScores.push({
                id: domain.id,
                name: domain.name,
                score: sim + usageBoost,
                domain: (domain.id.replace("domain:", "") as SkillDomain),
            });
        }

        domainScores.sort((a, b) => b.score - a.score);

        // 3. Check automation sub-domain score (for background task detection)
        let automationScore = 0;
        const automationNode = this.graph.getNode("subdomain:automation");
        if (automationNode) {
            automationScore = cosineSimilarity(queryEmbedding, new Float32Array(automationNode.embedding));
            comparisons++;

            // Also check automation concept children
            const conceptNodes = this.graph.getEnabledChildren("subdomain:automation");
            for (const concept of conceptNodes) {
                const conceptSim = cosineSimilarity(queryEmbedding, new Float32Array(concept.embedding));
                comparisons++;
                automationScore = Math.max(automationScore, conceptSim);
            }
        }

        // 4. Drill into top 2 domains → score tools
        const TOP_DOMAINS = 2;
        const topDomains = domainScores.slice(0, TOP_DOMAINS);
        const toolScores = new Map<string, { toolName: string; score: number }>();

        for (const domain of topDomains) {
            const children = this.graph.getEnabledChildren(domain.id);

            for (const child of children) {
                if (child.type !== "tool") continue;
                comparisons++;

                const sim = cosineSimilarity(queryEmbedding, new Float32Array(child.embedding));

                // Weighted score: direct similarity + domain relevance * hierarchy weight
                const hierarchyBoost = domain.score * 0.3;
                const usageBoost = Math.min(0.05, Math.log2(child.usageCount + 1) * 0.01);

                // Co-occurrence bonus: tools that are frequently used together
                let cooccurrenceBonus = 0;
                const outEdges = this.graph.getOutgoingEdges(child.id);
                for (const edge of outEdges) {
                    if (edge.type === "cooccurrence" || edge.type === "pipeline") {
                        // Bonus if the target tool is also in our candidate set
                        if (toolScores.has(edge.to)) {
                            cooccurrenceBonus += edge.weight * 0.05;
                        }
                    }
                }

                const totalScore = sim + hierarchyBoost + usageBoost + cooccurrenceBonus;

                const existing = toolScores.get(child.id);
                if (!existing || existing.score < totalScore) {
                    toolScores.set(child.id, {
                        toolName: child.toolName || child.name,
                        score: totalScore,
                    });
                }
            }
        }

        // 5. Sort tools
        const sortedTools = Array.from(toolScores.entries())
            .map(([id, { toolName, score }]) => ({ id, toolName, score }))
            .sort((a, b) => b.score - a.score);

        // 6. Determine execution mode and step budget
        const topDomainScore = topDomains[0]?.score || 0;
        const toolCount = sortedTools.length;
        const primaryDomain = topDomains[0]?.domain || "general";

        // Background task threshold: automation nodes score high
        const AUTOMATION_THRESHOLD = 0.55;
        const isAutomation = automationScore > AUTOMATION_THRESHOLD;

        // Schedule signal detection: keywords that explicitly signal recurring/scheduled intent.
        // These should trigger background mode INDEPENDENTLY of automation embedding score,
        // because scheduling intent can appear in ANY domain query
        // (e.g., "send me AI posts everyday" → primary domain is business, but intent is recurring).
        const SCHEDULE_PATTERN = /\b(every\s*day|everyday|daily|weekly|hourly|monthly|every\s+(morning|evening|night|hour|week|month|minute)|remind\s+me|keep\s+(doing|monitoring|checking|running|tracking)|on\s+repeat|recurring|recur|schedule|scheduled|on\s+a\s+(regular|daily|weekly)\s+basis|automat(e|ically)\s+(send|run|do|check|create|generate))\b/i;
        const hasScheduleSignal = SCHEDULE_PATTERN.test(message);

        const isBackgroundTask = isAutomation || hasScheduleSignal;
        const isRecurring = isBackgroundTask && (hasScheduleSignal || /\b(every|daily|weekly|hourly|monthly|everyday|recurring|repeat|schedule)\b/i.test(message));

        if (hasScheduleSignal && !isAutomation) {
            console.log(`[SkillTree] Schedule signal detected in "${message.slice(0, 50)}…" — overriding to background mode`);
        }

        let executionMode: ExecutionMode;
        let stepBudget: number;

        if (isBackgroundTask) {
            executionMode = "background";
            stepBudget = 25;
        } else if (topDomainScore > 0.7 && toolCount <= 3 && message.length < 100) {
            // High confidence + few tools + short message = stream
            executionMode = "stream";
            stepBudget = Math.max(3, Math.min(10, toolCount * 3));
        } else {
            // Lower confidence or multi-tool = generate (complex path)
            executionMode = "generate";
            stepBudget = Math.max(10, Math.min(25, toolCount * 4));
        }

        // 7. Collect system prompt fragments from matched packs
        const systemPromptFragments: string[] = [];
        for (const domain of topDomains) {
            const pack = getPackForDomain(domain.domain);
            if (pack.systemPrompt) {
                systemPromptFragments.push(pack.systemPrompt);
            }
        }

        // 8. Secondary domains (for cross-domain merging)
        const secondaryDomains = topDomains.slice(1)
            .filter(d => d.score > 0.4) // Only include if reasonably relevant
            .map(d => d.domain);

        let result: SkillPath = {
            domains: topDomains.map(d => ({ id: d.id, name: d.name, score: d.score })),
            tools: sortedTools,
            comparisons,
            traversalMs: Date.now() - start,
            computedAt: Date.now(),
            executionMode,
            stepBudget,
            goal: message,
            primaryDomain,
            secondaryDomains,
            systemPromptFragments,
            isRecurring,
            isLongRunning: isBackgroundTask,
        };

        // ── Tier 2: Conditional LLM intent validation ──
        // Fires only for ambiguous routing (~20% of requests).
        // Uses the extraction model (~300ms) to validate execution mode.
        if (shouldValidate(result, hasScheduleSignal)) {
            console.log(`[SkillTree] Ambiguous routing — running Tier 2 intent validation…`);
            result = await validateIntent(result);
        }

        // Cache
        if (this.pathCache.size >= this.PATH_CACHE_MAX) {
            const firstKey = this.pathCache.keys().next().value;
            if (firstKey) this.pathCache.delete(firstKey);
        }
        this.pathCache.set(cacheKey, result);

        console.log(
            `[SkillTree] "${message.slice(0, 40)}" → ${result.executionMode}/${primaryDomain} ` +
            `(${sortedTools.length} tools, ${result.stepBudget} steps, ${comparisons} comparisons, ${result.traversalMs}ms)` +
            (isBackgroundTask ? ` [automation: ${automationScore.toFixed(2)}]` : "")
        );

        return result;
    }

    // ── Legacy compatibility (used by hint endpoint) ──

    /**
     * @deprecated Use resolve() instead. Kept for backward compatibility with /api/skills/hint.
     */
    async resolveSkillPath(query: string): Promise<SkillPath> {
        return this.resolve(query);
    }

    /**
     * Clear the type-time cache (e.g., when user starts a new conversation).
     */
    clearCache(): void {
        this.pathCache.clear();
    }

    // ── Phase C: Send-Time Integration ──

    /**
     * Get the pre-computed tool names for a query.
     * Returns null if no cached path exists.
     */
    getCachedToolNames(query: string, topK: number = 8): string[] | null {
        const cacheKey = query.slice(0, 100).toLowerCase().trim();
        const cached = this.pathCache.get(cacheKey);
        if (!cached || (Date.now() - cached.computedAt) > this.PATH_CACHE_TTL) {
            return null;
        }
        return cached.tools.slice(0, topK).map(t => t.toolName);
    }

    // ── Edge Weight Learning (Phase C post-execution) ──

    /**
     * After a conversation completes, record the tool sequence
     * to strengthen co-occurrence and pipeline edges.
     */
    recordToolUsage(toolNames: string[]): void {
        if (!this.initialized || toolNames.length === 0) return;

        this.graph.recordToolSequence(toolNames);

        // Save periodically (every 10 traversals)
        if (this.graph.isDirty) {
            this.graph.save();
        }
    }

    /**
     * Run daily edge decay to prune unused relationships.
     */
    runDecay(): number {
        const removed = this.graph.decayEdges(0.01, 0.05);
        if (removed > 0) {
            console.log(`[SkillTree] Decayed ${removed} weak edges`);
            this.graph.save();
        }
        return removed;
    }

    // ── Getters ──

    getGraph(): SkillGraph {
        return this.graph;
    }

    isReady(): boolean {
        return this.initialized;
    }

    getStats(): {
        nodes: number;
        edges: number;
        domains: number;
        tools: number;
        cacheSize: number;
    } {
        return {
            nodes: this.graph.nodeCount,
            edges: this.graph.edgeCount,
            domains: this.graph.getNodesByType("domain").length,
            tools: this.graph.getNodesByType("tool").length,
            cacheSize: this.pathCache.size,
        };
    }
}
