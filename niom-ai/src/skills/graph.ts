/**
 * Skill Graph — the hierarchical DAG for tool selection.
 *
 * Structure:
 *   root
 *     ├── domain: Code
 *     │     ├── sub-domain: Frontend
 *     │     │     ├── tool: editFile
 *     │     │     └── tool: searchFiles
 *     │     └── sub-domain: Backend
 *     │           └── tool: runCommand
 *     ├── domain: Research
 *     │     └── tool: deepResearch
 *     └── domain: Business
 *           └── ...
 *
 * Key properties:
 *   - DAG (not tree) — tools can belong to multiple parents
 *   - Each node has an embedding vector for similarity search
 *   - Edges have weights that evolve from usage patterns
 *   - Hierarchical traversal: ~25 comparisons vs ~200 flat
 *
 * Persistence: save/load to ~/.niom/skill-graph.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

// ── Node Types ──

export type SkillNodeType = "root" | "domain" | "subdomain" | "tool";

export interface SkillNode {
    /** Unique identifier (e.g., "domain:code", "tool:editFile") */
    id: string;
    /** Human-readable name */
    name: string;
    /** Node type in the hierarchy */
    type: SkillNodeType;
    /** Description used for embedding (from SKILL.md or tool description) */
    description: string;
    /** 384-dim embedding vector (stored as number[] for JSON serialization) */
    embedding: number[];
    /** Parent node IDs (DAG: a tool can have multiple parents) */
    parents: string[];
    /** Child node IDs */
    children: string[];
    /** Whether this node is currently enabled */
    enabled: boolean;
    /** Usage statistics */
    usageCount: number;
    /** Last time this node was activated (Unix timestamp) */
    lastUsed: number;
    /** Source skill pack ID (for tools and domains from packs) */
    packId?: string;
    /** For tool nodes: the actual tool name in the registry */
    toolName?: string;
}

// ── Edge Types ──

export type EdgeType =
    | "hierarchy"     // Parent-child structural relationship
    | "semantic"      // Cosine similarity between descriptions
    | "cooccurrence"  // Tools frequently used together
    | "pipeline";     // Tools used in sequence (A → B)

export interface SkillEdge {
    /** Source node ID */
    from: string;
    /** Target node ID */
    to: string;
    /** Relationship type */
    type: EdgeType;
    /** Edge weight (0.0 - 1.0) — higher = stronger relationship */
    weight: number;
    /** Number of times this edge was traversed/reinforced */
    reinforcements: number;
    /** Last reinforcement timestamp */
    lastReinforced: number;
}

// ── Serializable Graph State ──

interface GraphState {
    version: number;
    nodes: SkillNode[];
    edges: SkillEdge[];
    metadata: {
        createdAt: number;
        updatedAt: number;
        totalTraversals: number;
    };
}

// ── Skill Graph Class ──

export class SkillGraph {
    private nodes: Map<string, SkillNode> = new Map();
    private edges: SkillEdge[] = [];
    private adjacency: Map<string, SkillEdge[]> = new Map();
    private totalTraversals = 0;
    private dirty = false;
    private savePath: string;

    constructor(savePath: string) {
        this.savePath = savePath;
    }

    // ── Node Operations ──

    /**
     * Add or update a node in the graph.
     */
    addNode(node: SkillNode): void {
        const existing = this.nodes.get(node.id);
        if (existing) {
            // Update: preserve usage stats, update everything else
            node.usageCount = existing.usageCount;
            node.lastUsed = existing.lastUsed;
        }
        this.nodes.set(node.id, node);
        this.dirty = true;
    }

    /**
     * Get a node by ID.
     */
    getNode(id: string): SkillNode | undefined {
        return this.nodes.get(id);
    }

    /**
     * Get all nodes of a specific type.
     */
    getNodesByType(type: SkillNodeType): SkillNode[] {
        return Array.from(this.nodes.values()).filter(n => n.type === type);
    }

    /**
     * Get enabled children of a node.
     */
    getEnabledChildren(nodeId: string): SkillNode[] {
        const node = this.nodes.get(nodeId);
        if (!node) return [];
        return node.children
            .map(id => this.nodes.get(id))
            .filter((n): n is SkillNode => n !== undefined && n.enabled);
    }

    /**
     * Get all tool nodes (leaves of the graph).
     */
    getToolNodes(): SkillNode[] {
        return this.getNodesByType("tool");
    }

    /**
     * Record that a node was used (update stats).
     */
    recordUsage(nodeId: string): void {
        const node = this.nodes.get(nodeId);
        if (node) {
            node.usageCount++;
            node.lastUsed = Date.now();
            this.dirty = true;
        }
    }

    /**
     * Get all node IDs.
     */
    getAllNodeIds(): string[] {
        return Array.from(this.nodes.keys());
    }

    /**
     * Get total node count.
     */
    get nodeCount(): number {
        return this.nodes.size;
    }

    /**
     * Get total edge count.
     */
    get edgeCount(): number {
        return this.edges.length;
    }

    // ── Edge Operations ──

    /**
     * Add an edge between two nodes.
     * If an edge of the same type already exists between these nodes, reinforce it.
     */
    addEdge(edge: SkillEdge): void {
        const existing = this.findEdge(edge.from, edge.to, edge.type);
        if (existing) {
            // Reinforce: increase weight and count
            existing.weight = Math.min(1.0, existing.weight + 0.1);
            existing.reinforcements++;
            existing.lastReinforced = Date.now();
        } else {
            this.edges.push(edge);
            // Update adjacency
            if (!this.adjacency.has(edge.from)) this.adjacency.set(edge.from, []);
            this.adjacency.get(edge.from)!.push(edge);
        }
        this.dirty = true;
    }

    /**
     * Find a specific edge.
     */
    findEdge(from: string, to: string, type: EdgeType): SkillEdge | undefined {
        return this.edges.find(e => e.from === from && e.to === to && e.type === type);
    }

    /**
     * Get all outgoing edges from a node.
     */
    getOutgoingEdges(nodeId: string): SkillEdge[] {
        return this.adjacency.get(nodeId) || [];
    }

    /**
     * Get edges between two specific nodes (all types).
     */
    getEdgesBetween(from: string, to: string): SkillEdge[] {
        return this.edges.filter(e => e.from === from && e.to === to);
    }

    /**
     * Decay all edge weights by a factor (called periodically).
     * Removes edges that fall below a minimum threshold.
     */
    decayEdges(decayRate: number = 0.01, minWeight: number = 0.05): number {
        let removed = 0;

        this.edges = this.edges.filter(edge => {
            // Don't decay hierarchy edges
            if (edge.type === "hierarchy") return true;

            edge.weight -= decayRate;
            if (edge.weight < minWeight) {
                removed++;
                return false;
            }
            return true;
        });

        if (removed > 0) {
            this.rebuildAdjacency();
            this.dirty = true;
        }

        return removed;
    }

    // ── Co-occurrence Learning ──

    /**
     * Record that a sequence of tools was used together.
     * Creates/reinforces co-occurrence and pipeline edges.
     */
    recordToolSequence(toolNames: string[]): void {
        if (toolNames.length < 2) return;

        const now = Date.now();
        this.totalTraversals++;

        for (let i = 0; i < toolNames.length; i++) {
            const toolIdA = `tool:${toolNames[i]}`;
            const nodeA = this.nodes.get(toolIdA);
            if (!nodeA) continue;

            // Record usage
            this.recordUsage(toolIdA);

            // Co-occurrence: every tool with every other tool in this sequence
            for (let j = i + 1; j < toolNames.length; j++) {
                const toolIdB = `tool:${toolNames[j]}`;
                if (!this.nodes.has(toolIdB)) continue;

                this.addEdge({
                    from: toolIdA,
                    to: toolIdB,
                    type: "cooccurrence",
                    weight: 0.3,
                    reinforcements: 1,
                    lastReinforced: now,
                });
            }

            // Pipeline: sequential pairs (A → B)
            if (i < toolNames.length - 1) {
                const toolIdB = `tool:${toolNames[i + 1]}`;
                if (!this.nodes.has(toolIdB)) continue;

                this.addEdge({
                    from: toolIdA,
                    to: toolIdB,
                    type: "pipeline",
                    weight: 0.4,
                    reinforcements: 1,
                    lastReinforced: now,
                });
            }
        }

        this.dirty = true;
    }

    // ── Persistence ──

    /**
     * Save the graph to disk (only if modified).
     */
    save(): void {
        if (!this.dirty) return;

        const state: GraphState = {
            version: 1,
            nodes: Array.from(this.nodes.values()),
            edges: this.edges,
            metadata: {
                createdAt: this.nodes.size > 0
                    ? Math.min(...Array.from(this.nodes.values()).map(n => n.lastUsed || Date.now()))
                    : Date.now(),
                updatedAt: Date.now(),
                totalTraversals: this.totalTraversals,
            },
        };

        // Ensure directory exists
        const dir = dirname(this.savePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        writeFileSync(this.savePath, JSON.stringify(state, null, 2));
        this.dirty = false;

        console.log(
            `[SkillGraph] Saved: ${this.nodes.size} nodes, ${this.edges.length} edges → ${this.savePath}`
        );
    }

    /**
     * Load the graph from disk.
     */
    load(): boolean {
        if (!existsSync(this.savePath)) return false;

        try {
            const raw = readFileSync(this.savePath, "utf-8");
            const state: GraphState = JSON.parse(raw);

            if (state.version !== 1) {
                console.warn(`[SkillGraph] Unknown version ${state.version}, starting fresh`);
                return false;
            }

            this.nodes.clear();
            for (const node of state.nodes) {
                this.nodes.set(node.id, node);
            }

            this.edges = state.edges;
            this.rebuildAdjacency();
            this.totalTraversals = state.metadata.totalTraversals || 0;
            this.dirty = false;

            console.log(
                `[SkillGraph] Loaded: ${this.nodes.size} nodes, ${this.edges.length} edges ` +
                `(${this.totalTraversals} traversals)`
            );

            return true;
        } catch (err) {
            console.error(`[SkillGraph] Failed to load:`, err);
            return false;
        }
    }

    /**
     * Check if graph has been modified since last save.
     */
    get isDirty(): boolean {
        return this.dirty;
    }

    // ── Private ──

    private rebuildAdjacency(): void {
        this.adjacency.clear();
        for (const edge of this.edges) {
            if (!this.adjacency.has(edge.from)) this.adjacency.set(edge.from, []);
            this.adjacency.get(edge.from)!.push(edge);
        }
    }
}
