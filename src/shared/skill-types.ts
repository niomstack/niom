/**
 * Skill Tree Type Definitions
 *
 * Data structures for the Skill Tree architecture, as specified in the
 * research paper "Skill Trees for AI Agents: Hierarchical Tool Selection
 * via Self-Improving Graphs" (Singh et al., 2026).
 *
 * These types define the three core structures (SkillNode, SkillEdge,
 * SkillPath), the Skill Pack format, and the standardized SkillResult
 * envelope returned by all tool executions.
 */

// ─── Pack Tiers ──────────────────────────────────────────────────────
// 3-Tier Pack Architecture per paper §3.2, Table 4.

/** Primitive: system-level capabilities (OS, Web, Computer Use) */
/** Intent: domain-specific reasoning (Code, Research, Business, Creative, Personal) */
/** Fallback: ambiguous queries — includes all tools */
export type PackTier = "primitive" | "intent" | "fallback";

// ─── Tool Approval ───────────────────────────────────────────────────

/** Controls whether a tool auto-executes or needs user confirmation. */
export type ToolApproval = "auto" | "confirm" | "deny";

// ─── Skill Pack (SKILL.md parsed representation) ─────────────────────

/** A single tool declaration within a Skill Pack. */
export interface PackToolDeclaration {
  /** Tool name, e.g. "readFile", "webSearch" */
  name: string;
  /** Human-readable description for the LLM */
  description: string;
  /** Short exemplar phrases for embedding (e.g. "read this file") */
  exemplars: string[];
  /** Negative exemplars — penalize false matches (per paper §5.8.3) */
  negativeExemplars?: string[];
  /** Approval policy. Defaults to "auto" for primitive, "confirm" for write ops */
  approval?: ToolApproval;
}

/** Evaluation rubric for a Skill Pack — how to judge success. */
export interface PackEvaluation {
  /** Prose rubric for the model to self-assess quality */
  rubric: string;
}

/** Parsed SKILL.md representation — the Skill Pack contract. */
export interface SkillPack {
  /** Unique pack identifier, e.g. "os", "code", "research" */
  name: string;
  /** Domain name for routing, e.g. "os", "web", "code" */
  domain: string;
  /** 3-tier classification */
  tier: PackTier;
  /** Human-readable description */
  description: string;
  /** Short exemplar phrases for domain-level embedding matching */
  exemplars: string[];
  /** Negative exemplars for domain level */
  negativeExemplars?: string[];
  /** Tool declarations owned by this pack */
  tools: PackToolDeclaration[];
  /** How to evaluate the success of tools in this pack */
  evaluation?: PackEvaluation;
  /** System prompt fragment (the markdown body of SKILL.md) */
  systemPrompt: string;
  /** Source path of the SKILL.md file */
  source: string;
}

// ─── Skill Tree Nodes (per paper §3.1, Listing 1) ────────────────────

export type SkillNodeType = "root" | "domain" | "subdomain" | "tool";

export interface SkillNode {
  /** Namespaced ID: "domain:code", "tool:readFile" */
  id: string;
  /** Human-readable: "Code", "Read File" */
  name: string;
  /** Node type in the DAG hierarchy */
  type: SkillNodeType;
  /** Semantic description for embedding */
  description: string;
  /** Primary embedding (384-dim MiniLM-L6-v2). L2-normalized avg of exemplars */
  embedding: number[];
  /** Multiple exemplar embeddings for max-similarity scoring */
  exemplarEmbeddings?: number[][];
  /** Negative exemplar embeddings for contrastive scoring (paper §5.8.3) */
  negativeExemplarEmbeddings?: number[][];
  /** DAG: multiple parents allowed */
  parents: string[];
  /** Sub-domains or tools */
  children: string[];
  /** User can toggle on/off */
  enabled: boolean;
  /** Lifetime usage count */
  usageCount: number;
  /** Last used timestamp */
  lastUsed: number;
  /** Source skill pack ID */
  packId?: string;
  /** For tool (leaf) nodes: the actual tool function name */
  toolName?: string;
}

// ─── Skill Tree Edges (per paper §3.1, Listing 2) ────────────────────

/** Edge types per paper Table 2. */
export type SkillEdgeType =
  | "hierarchy"      // Install-time: parent → child in DAG. Never decayed.
  | "semantic"       // Install-time: cosine sim > 0.6. Decayed if unused.
  | "cooccurrence"   // Usage: tools used together. Reinforced on co-use.
  | "pipeline";      // Usage: tool B follows tool A. Reinforced on sequential use.

export interface SkillEdge {
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Learned weight 0–1 */
  weight: number;
  /** Relationship type */
  type: SkillEdgeType;
  /** Times reinforced */
  reinforcements: number;
  /** Timestamp of last reinforcement */
  lastReinforced: number;
}

// ─── Skill Path (per paper §3.1, Listing 3) ──────────────────────────

/** Execution mode determined by routing. */
export type ExecutionMode = "stream" | "generate" | "background";

/** The output of Skill Tree traversal — everything needed for send-time injection. */
export interface SkillPath {
  /** Focused tool names selected by traversal */
  tools: string[];
  /** Primary domain, e.g. "code" */
  primaryDomain: string;
  /** Secondary domains contributing tools */
  secondaryDomains: string[];
  /** How to execute: stream (interactive), generate (one-shot), background (async) */
  executionMode: ExecutionMode;
  /** Agent step budget for multi-step execution */
  stepBudget: number;
  /** Traversal confidence score (0–1) */
  confidence: number;
  /** Domain-specific system prompt fragments to inject */
  systemPromptFragments: string[];
  /** Whether this is a recurring/scheduled task (from Tier 1 detection) */
  isRecurring: boolean;
  /** Extracted user intent/goal */
  goal: string;
}

// ─── Skill Result Envelope ───────────────────────────────────────────
// Standardized return type for ALL tool executions.
// Provides structured data for the model to validate result quality.

export type SkillResultStatus =
  | "success"        // Tool completed fully, data is reliable.
  | "error"          // Tool failed. `summary` explains why.
  | "partial"        // Tool succeeded but output was truncated/incomplete.
  | "needs_approval"; // Tool requires user confirmation before executing.

export interface SkillResultMetadata {
  /** Domain this tool belongs to */
  domain: string;
  /** Execution time in milliseconds */
  duration: number;
  /** Whether output was truncated (e.g. file too large) */
  truncated?: boolean;
  /** Bytes read/processed */
  bytesProcessed?: number;
  /** File/directory path involved */
  path?: string;
}

/**
 * Standardized tool result envelope.
 * Every tool in every Skill Pack returns this structure.
 */
export interface SkillResult<T = unknown> {
  /** Outcome status */
  status: SkillResultStatus;
  /** The actual payload — tool-specific data */
  data: T;
  /** Human-readable summary for the model to reason about */
  summary: string;
  /** Confidence in result quality (0–1). Low confidence = model should verify */
  confidence: number;
  /** Suggested next tools the agent might want to use (bootstraps pipeline edges) */
  suggestions?: string[];
  /** Execution metadata */
  metadata: SkillResultMetadata;
}

// ─── Skill Graph Persistence ─────────────────────────────────────────

/** Persisted skill graph format at ~/.niom/skill-graph.json */
export interface SkillGraphData {
  /** Schema version for migration */
  version: number;
  /** All nodes in the DAG */
  nodes: Record<string, SkillNode>;
  /** All edges (keyed by "source::target") */
  edges: Record<string, SkillEdge>;
  /** Timestamp of last modification */
  lastUpdated: number;
  /** Installed pack names */
  installedPacks: string[];
}
