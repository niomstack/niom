/**
 * Skill Graph — DAG Construction & Management
 *
 * Builds the Skill Tree DAG from loaded Skill Packs, as specified in
 * the research paper §3.1 (Listing 1-3, Table 2).
 *
 * Graph structure:
 *   root → domain nodes → tool (leaf) nodes
 *
 * Edge types (per paper Table 2):
 *   - hierarchy:    install-time parent→child, never decayed
 *   - semantic:     install-time cosine(exemplar_i, exemplar_j) > threshold
 *   - cooccurrence: usage — tools used together (M2f)
 *   - pipeline:     usage — sequential tool chains (M2f)
 *
 * Persistence: ~/.niom/skill-graph.json
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type {
  SkillPack,
  SkillNode,
  SkillEdge,
  SkillEdgeType,
  SkillGraphData,
  SkillNodeType,
} from "@/shared/skill-types";
import {
  embed,
  embedBatch,
  averageEmbeddings,
  cosineSimilarity,
  EMBEDDING_DIM,
} from "./embeddings";

// ─── Constants ───────────────────────────────────────────────────────

/** Current schema version for migration safety. */
const GRAPH_VERSION = 2;

/** Minimum cosine similarity to create a semantic edge. */
const SEMANTIC_EDGE_THRESHOLD = 0.55;

/** Persistence path. */
const GRAPH_PATH = path.join(os.homedir(), ".niom", "skill-graph.json");

// ─── Skill Graph Class ──────────────────────────────────────────────

export class SkillGraph {
  /** All nodes in the DAG, keyed by node ID. */
  nodes: Record<string, SkillNode> = {};

  /** All edges, keyed by "source::target". */
  edges: Record<string, SkillEdge> = {};

  /** Names of installed packs. */
  installedPacks: string[] = [];

  /** Timestamp of last modification. */
  lastUpdated = 0;

  // ── Construction ─────────────────────────────────────────────────

  /**
   * Build the full Skill Tree DAG from a set of Skill Packs.
   *
   * Steps (per paper §3.1):
   * 1. Create root node
   * 2. For each pack: create domain node + tool leaf nodes
   * 3. Add hierarchy edges (root→domain, domain→tool)
   * 4. Compute embeddings for all nodes (exemplar-based)
   * 5. Add semantic edges (cross-domain cosine > threshold)
   */
  async buildFromPacks(packs: SkillPack[]): Promise<void> {
    console.log(`[SkillGraph] Building graph from ${packs.length} packs...`);
    const startTime = performance.now();

    // Reset graph
    this.nodes = {};
    this.edges = {};
    this.installedPacks = packs.map((p) => p.name);

    // 1. Create root node
    this.addNode({
      id: "root",
      name: "NIOM",
      type: "root",
      description: "Root node — all domains are children",
      embedding: new Array(EMBEDDING_DIM).fill(0),
      parents: [],
      children: [],
      enabled: true,
      usageCount: 0,
      lastUsed: 0,
    });

    // 2-3. Create domain + tool nodes with hierarchy edges
    for (const pack of packs) {
      await this.addPackToGraph(pack);
    }

    // 4. Compute embeddings for all nodes
    await this.computeAllEmbeddings(packs);

    // 5. Add semantic edges (cross-domain similarity)
    this.computeSemanticEdges();

    this.lastUpdated = Date.now();
    const elapsed = Math.round(performance.now() - startTime);
    const nodeCount = Object.keys(this.nodes).length;
    const edgeCount = Object.keys(this.edges).length;

    console.log(`[SkillGraph] Built: ${nodeCount} nodes, ${edgeCount} edges in ${elapsed}ms`);
  }

  /**
   * Add a single pack's nodes and edges to the graph.
   */
  private async addPackToGraph(pack: SkillPack): Promise<void> {
    const domainId = `domain:${pack.domain}`;

    // Create domain node
    this.addNode({
      id: domainId,
      name: pack.name,
      type: "domain",
      description: pack.description,
      embedding: new Array(EMBEDDING_DIM).fill(0), // Computed later
      parents: ["root"],
      children: [],
      enabled: true,
      usageCount: 0,
      lastUsed: 0,
      packId: pack.name,
    });

    // Hierarchy edge: root → domain
    this.addEdge("root", domainId, "hierarchy", 1.0);

    // Add root's children reference
    this.nodes["root"].children.push(domainId);

    // Create tool leaf nodes
    for (const toolDecl of pack.tools) {
      const toolId = `tool:${toolDecl.name}`;

      // Tool node might already exist (shared across packs, e.g. deepResearch)
      if (!this.nodes[toolId]) {
        this.addNode({
          id: toolId,
          name: toolDecl.name,
          type: "tool",
          description: toolDecl.description,
          embedding: new Array(EMBEDDING_DIM).fill(0), // Computed later
          parents: [domainId],
          children: [],
          enabled: true,
          usageCount: 0,
          lastUsed: 0,
          packId: pack.name,
          toolName: toolDecl.name,
        });
      } else {
        // Tool exists in another pack — add this domain as additional parent (DAG)
        if (!this.nodes[toolId].parents.includes(domainId)) {
          this.nodes[toolId].parents.push(domainId);
        }
      }

      // Hierarchy edge: domain → tool
      this.addEdge(domainId, toolId, "hierarchy", 1.0);

      // Add domain's children reference
      if (!this.nodes[domainId].children.includes(toolId)) {
        this.nodes[domainId].children.push(toolId);
      }
    }
  }

  /**
   * Compute embeddings for all nodes using exemplar-based embedding.
   *
   * Per paper §3.3: "embed exemplar queries, not descriptions"
   * - Domain nodes: average of all pack exemplar embeddings
   * - Tool nodes: average of all tool exemplar embeddings
   * - Also stores individual exemplar embeddings for max-similarity scoring
   */
  private async computeAllEmbeddings(packs: SkillPack[]): Promise<void> {
    console.log("[SkillGraph] Computing embeddings...");

    // Collect all unique exemplar texts for batch embedding
    const allExemplars: string[] = [];
    const exemplarMap: Record<string, string[]> = {}; // nodeId → exemplar texts
    const negExemplarMap: Record<string, string[]> = {}; // nodeId → negative exemplar texts

    for (const pack of packs) {
      const domainId = `domain:${pack.domain}`;

      // Domain exemplars
      exemplarMap[domainId] = pack.exemplars;
      allExemplars.push(...pack.exemplars);

      if (pack.negativeExemplars?.length) {
        negExemplarMap[domainId] = pack.negativeExemplars;
        allExemplars.push(...pack.negativeExemplars);
      }

      // Tool exemplars
      for (const toolDecl of pack.tools) {
        const toolId = `tool:${toolDecl.name}`;
        // Merge exemplars if tool appears in multiple packs
        if (!exemplarMap[toolId]) {
          exemplarMap[toolId] = [];
        }
        exemplarMap[toolId].push(...toolDecl.exemplars);
        allExemplars.push(...toolDecl.exemplars);

        if (toolDecl.negativeExemplars?.length) {
          if (!negExemplarMap[toolId]) {
            negExemplarMap[toolId] = [];
          }
          negExemplarMap[toolId].push(...toolDecl.negativeExemplars);
          allExemplars.push(...toolDecl.negativeExemplars);
        }
      }
    }

    // Batch embed all unique exemplars
    const uniqueExemplars = [...new Set(allExemplars)];
    console.log(`[SkillGraph] Embedding ${uniqueExemplars.length} unique exemplars...`);

    const embeddings = await embedBatch(uniqueExemplars);
    const embeddingLookup = new Map<string, number[]>();
    uniqueExemplars.forEach((text, i) => embeddingLookup.set(text, embeddings[i]));

    // Assign embeddings to nodes
    for (const [nodeId, exemplars] of Object.entries(exemplarMap)) {
      const node = this.nodes[nodeId];
      if (!node) continue;

      // Individual exemplar embeddings (for max-similarity scoring)
      node.exemplarEmbeddings = exemplars.map(
        (text) => embeddingLookup.get(text) || new Array(EMBEDDING_DIM).fill(0),
      );

      // Average embedding (primary embedding for the node)
      node.embedding = averageEmbeddings(node.exemplarEmbeddings);
    }

    // Negative exemplar embeddings
    for (const [nodeId, negExemplars] of Object.entries(negExemplarMap)) {
      const node = this.nodes[nodeId];
      if (!node) continue;

      node.negativeExemplarEmbeddings = negExemplars.map(
        (text) => embeddingLookup.get(text) || new Array(EMBEDDING_DIM).fill(0),
      );
    }

    console.log("[SkillGraph] Embeddings computed");
  }

  /**
   * Create semantic edges between nodes whose exemplar embeddings
   * have cosine similarity above the threshold.
   *
   * Only creates edges between:
   * - domain ↔ domain (cross-domain relationships)
   * - tool ↔ tool (cross-tool relationships, even across domains)
   *
   * Per paper §3.4: these edges enable cross-domain routing and are
   * decayed if unused, unlike hierarchy edges.
   */
  private computeSemanticEdges(): void {
    const domainNodes = Object.values(this.nodes).filter(
      (n) => n.type === "domain" && n.embedding.some((v) => v !== 0),
    );

    const toolNodes = Object.values(this.nodes).filter(
      (n) => n.type === "tool" && n.embedding.some((v) => v !== 0),
    );

    let semanticEdgeCount = 0;

    // Domain ↔ Domain semantic edges
    for (let i = 0; i < domainNodes.length; i++) {
      for (let j = i + 1; j < domainNodes.length; j++) {
        const sim = cosineSimilarity(domainNodes[i].embedding, domainNodes[j].embedding);
        if (sim >= SEMANTIC_EDGE_THRESHOLD) {
          this.addEdge(domainNodes[i].id, domainNodes[j].id, "semantic", sim);
          this.addEdge(domainNodes[j].id, domainNodes[i].id, "semantic", sim);
          semanticEdgeCount += 2;
        }
      }
    }

    // Tool ↔ Tool semantic edges (across different domains only)
    for (let i = 0; i < toolNodes.length; i++) {
      for (let j = i + 1; j < toolNodes.length; j++) {
        // Skip tools in the same domain (already connected via hierarchy)
        if (toolNodes[i].packId === toolNodes[j].packId) continue;

        const sim = cosineSimilarity(toolNodes[i].embedding, toolNodes[j].embedding);
        if (sim >= SEMANTIC_EDGE_THRESHOLD) {
          this.addEdge(toolNodes[i].id, toolNodes[j].id, "semantic", sim);
          this.addEdge(toolNodes[j].id, toolNodes[i].id, "semantic", sim);
          semanticEdgeCount += 2;
        }
      }
    }

    console.log(`[SkillGraph] Created ${semanticEdgeCount} semantic edges`);
  }

  // ── Node & Edge Helpers ───────────────────────────────────────────

  private addNode(node: SkillNode): void {
    this.nodes[node.id] = node;
  }

  private addEdge(
    source: string,
    target: string,
    type: SkillEdgeType,
    weight: number,
  ): void {
    const key = `${source}::${target}`;
    this.edges[key] = {
      source,
      target,
      weight,
      type,
      reinforcements: 0,
      lastReinforced: Date.now(),
    };
  }

  // ── Query Functions ────────────────────────────────────────────────

  /** Get all domain nodes. */
  getDomainNodes(): SkillNode[] {
    return Object.values(this.nodes).filter((n) => n.type === "domain");
  }

  /** Get all tool (leaf) nodes. */
  getToolNodes(): SkillNode[] {
    return Object.values(this.nodes).filter((n) => n.type === "tool");
  }

  /** Get children of a node. */
  getChildren(nodeId: string): SkillNode[] {
    const node = this.nodes[nodeId];
    if (!node) return [];
    return node.children
      .map((id) => this.nodes[id])
      .filter(Boolean);
  }

  /** Get edges from a node. */
  getEdgesFrom(nodeId: string): SkillEdge[] {
    return Object.values(this.edges).filter((e) => e.source === nodeId);
  }

  /** Get edges to a node. */
  getEdgesTo(nodeId: string): SkillEdge[] {
    return Object.values(this.edges).filter((e) => e.target === nodeId);
  }

  /** Get a specific edge. */
  getEdge(source: string, target: string): SkillEdge | undefined {
    return this.edges[`${source}::${target}`];
  }

  /** Get node by ID. */
  getNode(nodeId: string): SkillNode | undefined {
    return this.nodes[nodeId];
  }

  // ── Persistence ────────────────────────────────────────────────────

  /**
   * Save the graph to disk at ~/.niom/skill-graph.json.
   */
  save(): void {
    try {
      const dir = path.dirname(GRAPH_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data: SkillGraphData = {
        version: GRAPH_VERSION,
        nodes: this.nodes,
        edges: this.edges,
        lastUpdated: this.lastUpdated,
        installedPacks: this.installedPacks,
      };

      fs.writeFileSync(GRAPH_PATH, JSON.stringify(data), "utf-8");
      console.log(`[SkillGraph] Saved to ${GRAPH_PATH}`);
    } catch (error) {
      console.error("[SkillGraph] Failed to save:", error);
    }
  }

  /**
   * Load the graph from disk. Returns false if no saved graph exists
   * or the version doesn't match (requiring rebuild).
   */
  load(): boolean {
    try {
      if (!fs.existsSync(GRAPH_PATH)) {
        console.log("[SkillGraph] No saved graph found");
        return false;
      }

      const raw = fs.readFileSync(GRAPH_PATH, "utf-8");
      const data: SkillGraphData = JSON.parse(raw);

      if (data.version !== GRAPH_VERSION) {
        console.log(`[SkillGraph] Version mismatch: ${data.version} → ${GRAPH_VERSION}, rebuilding`);
        return false;
      }

      this.nodes = data.nodes;
      this.edges = data.edges;
      this.lastUpdated = data.lastUpdated;
      this.installedPacks = data.installedPacks;

      const nodeCount = Object.keys(this.nodes).length;
      const edgeCount = Object.keys(this.edges).length;
      console.log(`[SkillGraph] Loaded: ${nodeCount} nodes, ${edgeCount} edges`);
      return true;
    } catch (error) {
      console.error("[SkillGraph] Failed to load:", error);
      return false;
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────

  /** Get graph statistics for debugging and status bar. */
  getStats(): {
    nodeCount: number;
    edgeCount: number;
    domainCount: number;
    toolCount: number;
    hierarchyEdges: number;
    semanticEdges: number;
    cooccurrenceEdges: number;
    pipelineEdges: number;
    packsInstalled: number;
  } {
    const edges = Object.values(this.edges);
    return {
      nodeCount: Object.keys(this.nodes).length,
      edgeCount: edges.length,
      domainCount: this.getDomainNodes().length,
      toolCount: this.getToolNodes().length,
      hierarchyEdges: edges.filter((e) => e.type === "hierarchy").length,
      semanticEdges: edges.filter((e) => e.type === "semantic").length,
      cooccurrenceEdges: edges.filter((e) => e.type === "cooccurrence").length,
      pipelineEdges: edges.filter((e) => e.type === "pipeline").length,
      packsInstalled: this.installedPacks.length,
    };
  }
}

// ─── Singleton Instance ──────────────────────────────────────────────

/** The global skill graph instance. */
export const skillGraph = new SkillGraph();

/**
 * Initialize the Skill Graph.
 *
 * Tries to load from disk first. If no saved graph exists or the version
 * is outdated, rebuilds from the built-in packs.
 *
 * Called during app startup from main process.
 */
export async function initializeSkillGraph(): Promise<void> {
  const { BUILTIN_PACKS } = await import("./builtin-packs");

  // Count expected tools from all packs
  const expectedToolCount = BUILTIN_PACKS.reduce(
    (sum, pack) => sum + pack.tools.length,
    0,
  );

  // Try loading from disk first
  const loaded = skillGraph.load();
  if (loaded) {
    // Validate that cached graph has the same number of tools as current packs.
    // If a new tool was added (or removed), the cache is stale and must rebuild.
    const cachedToolCount = skillGraph.getToolNodes().length;
    if (cachedToolCount !== expectedToolCount) {
      console.log(`[SkillGraph] Tool count mismatch: cached=${cachedToolCount}, expected=${expectedToolCount}. Rebuilding.`);
    } else {
      console.log("[SkillGraph] Using cached graph");

      // Apply temporal decay to stale edges on startup
      try {
        const { decayAllEdges } = await import("./edge-learning");
        const removed = decayAllEdges();
        if (removed > 0) {
          console.log(`[SkillGraph] Startup decay removed ${removed} dead edges`);
        }
      } catch {
        // Edge learning not critical for startup
      }

      return;
    }
  }

  // Build from built-in packs
  await skillGraph.buildFromPacks(BUILTIN_PACKS);
  skillGraph.save();
}
