/**
 * NIOM Context Filesystem (NCF) — Type Definitions
 *
 * Adapted from OpenViking's "Context Database for AI Agents" by ByteDance.
 * Implements the filesystem paradigm where all agent context (memories,
 * resources, skills, sessions) is organized hierarchically with
 * tiered loading (L0/L1/L2).
 *
 * Reference: https://github.com/volcengine/OpenViking
 */

// ─── Context Scopes ──────────────────────────────────────────────────

/**
 * Top-level namespaces in the NCF virtual filesystem.
 * Mirrors OpenViking's viking:// scopes.
 */
export type ContextScope =
  | "user"       // User identity, preferences, memories
  | "agent"      // Agent operational data: skills, learned patterns
  | "projects"   // Workspace-scoped context (tech stack, conventions)
  | "sessions";  // Thread/session archives with summaries

// ─── Context Layers (L0/L1/L2) ──────────────────────────────────────

/**
 * Three-tier information model for optimizing token usage.
 *
 * Per OpenViking §3:
 *   L0 (Abstract) — ~100 tokens, always loaded, used for vector search
 *   L1 (Overview) — ~2K tokens, loaded on relevance, sufficient for planning
 *   L2 (Detail)   — unlimited, loaded on demand for deep reading
 */
export type ContextLayer = "L0" | "L1" | "L2";

/** Special filenames for L0/L1 layers in each directory. */
export const LAYER_FILES = {
  L0: ".abstract.md",
  L1: ".overview.md",
  META: ".meta.json",
  RELATIONS: ".relations.json",
} as const;

// ─── Memory Categories ───────────────────────────────────────────────

/**
 * Six memory categories, adapted from OpenViking's memory taxonomy.
 *
 * User memories (extracted from user's messages):
 *   - profile:     User identity/attributes (appendable)
 *   - preferences: User preferences by topic (appendable)
 *   - entities:    People, projects, tools mentioned (appendable)
 *   - events:      Decisions, milestones (immutable — never merged)
 *
 * Agent memories (extracted from agent's own executions):
 *   - cases:       Problem → solution records (immutable)
 *   - patterns:    Reusable execution patterns (appendable)
 */
export type MemoryCategory =
  | "profile"
  | "preferences"
  | "entities"
  | "events"
  | "cases"
  | "patterns";

/** Whether a memory category supports content merging with existing entries. */
export const MEMORY_MERGEABLE: Record<MemoryCategory, boolean> = {
  profile: true,
  preferences: true,
  entities: true,
  events: false,       // Immutable historical records
  cases: false,        // Immutable case studies
  patterns: true,
};

/** Which scope owns each memory category. */
export const MEMORY_SCOPE: Record<MemoryCategory, "user" | "agent"> = {
  profile: "user",
  preferences: "user",
  entities: "user",
  events: "user",
  cases: "agent",
  patterns: "agent",
};

// ─── Context Node ────────────────────────────────────────────────────

/**
 * A node in the NCF — represents a file or directory.
 * Every node has at minimum an L0 abstract and metadata.
 */
export interface ContextNode {
  /** Relative path from ~/.niom/context/ (e.g., "user/memories/preferences/coding.md") */
  path: string;

  /** Whether this is a directory or a leaf file */
  type: "directory" | "file";

  /** The scope this node belongs to */
  scope: ContextScope;

  /** L0 abstract text (~100 tokens). Cached in memory for fast retrieval. */
  abstract: string;

  /** Embedding of the L0 abstract for vector search. */
  embedding?: number[];

  /** When this node was last modified */
  updatedAt: number;

  /** When this node was created */
  createdAt: number;
}

// ─── Context Metadata ────────────────────────────────────────────────

/** Metadata stored in .meta.json alongside each directory/file. */
export interface ContextMeta {
  /** When the node was created */
  createdAt: number;

  /** When L0/L1 were last regenerated */
  layersUpdatedAt: number;

  /** Source of this context (threadId, manual, migration, task) */
  source?: string;

  /** Memory category (only for memory nodes) */
  category?: MemoryCategory | string;

  /** Word count of L2 content */
  l2WordCount?: number;

  /** Whether this node has been vectorized (embedding stored) */
  vectorized?: boolean;

  /** Thread ID that owns this context (for task/thread digests) */
  threadId?: string;

  /** Original task goal (for task digests) */
  taskGoal?: string;

  /** Thread title (for thread digests) */
  threadTitle?: string;

  /** Number of messages in the thread (for thread digests) */
  messageCount?: number;

  /** When the thread was last updated (for thread digest staleness check) */
  threadUpdatedAt?: number;
}

// ─── Memory Entry ────────────────────────────────────────────────────

/** A structured memory entry before it's written to the NCF. */
export interface MemoryEntry {
  /** Unique identifier */
  id: string;

  /** The memory content (markdown) */
  content: string;

  /** Which of the 6 categories this memory belongs to */
  category: MemoryCategory;

  /** Topic key for preferences/entities (e.g., "coding", "writing", "niom-project") */
  topic?: string;

  /** Thread/session that generated this memory */
  sourceThreadId?: string;

  /** Confidence score from extraction (0-1) */
  confidence: number;

  /** When this memory was extracted */
  createdAt: number;
}

// ─── Dedup Decision ──────────────────────────────────────────────────

/**
 * Dedup decisions for memory extraction, per OpenViking's dedup flow.
 *
 * When a new candidate memory is extracted, it's compared against existing
 * memories via vector similarity. An LLM then decides:
 *
 * For the candidate:
 *   - skip:   Candidate is duplicate, discard it
 *   - create: Create the candidate (optionally deleting conflicting existing)
 *
 * For each conflicting existing memory:
 *   - merge:  Merge candidate content into existing
 *   - delete: Delete the conflicting existing memory
 *   - keep:   Keep existing as-is
 */
export type CandidateDecision = "skip" | "create";
export type ExistingDecision = "merge" | "delete" | "keep";

export interface DedupResult {
  candidateDecision: CandidateDecision;
  /** If "create", IDs of existing memories to delete first */
  deleteExisting?: string[];
  /** If candidate is "skip", ID of existing memory to merge into */
  mergeIntoId?: string;
  /** Updated content for merge target */
  mergedContent?: string;
}

// ─── Session Commit ──────────────────────────────────────────────────

/** Result of a session commit operation. */
export interface SessionCommitResult {
  /** Status of the commit */
  status: "committed" | "error" | "skipped";

  /** Number of new memories extracted */
  memoriesExtracted: number;

  /** Number of existing memories updated (merged) */
  memoriesUpdated: number;

  /** Number of existing memories deleted (conflicting) */
  memoriesDeleted: number;

  /** Whether messages were archived */
  archived: boolean;

  /** Error message if status is "error" */
  error?: string;
}

// ─── Project Context ─────────────────────────────────────────────────

/** Auto-detected project metadata from workspace files. */
export interface ProjectContext {
  /** Hash of the workspace root path */
  workspaceHash: string;

  /** Display name (usually directory name) */
  name: string;

  /** Absolute path to workspace root */
  rootPath: string;

  /** Detected tech stack entries */
  techStack: TechStackEntry[];

  /** Key conventions extracted from config files */
  conventions: string[];

  /** When this project context was last analyzed */
  analyzedAt: number;
}

export interface TechStackEntry {
  /** Technology name (e.g., "TypeScript", "React", "Electron") */
  name: string;

  /** Version if detected */
  version?: string;

  /** Source file that revealed this (e.g., "package.json") */
  detectedFrom: string;
}

// ─── NCF Statistics ──────────────────────────────────────────────────

/** Statistics about the NCF for the status bar and settings UI. */
export interface NCFStats {
  /** Total number of context nodes */
  nodeCount: number;

  /** Memory count by category */
  memoryCounts: Record<MemoryCategory, number>;

  /** Number of projects indexed */
  projectCount: number;

  /** Number of sessions archived */
  sessionCount: number;

  /** Total L0 tokens (approximate) */
  totalL0Tokens: number;

  /** Whether initialization/migration is complete */
  initialized: boolean;

  /** When the NCF was last modified */
  lastUpdated: number;
}

// ─── Retrieval ───────────────────────────────────────────────────────

/** A scored context match from hierarchical retrieval. */
export interface ContextMatch {
  /** The matched node */
  node: ContextNode;

  /** Combined score (embedding + parent propagation) */
  score: number;

  /** The L0 abstract text */
  abstract: string;

  /** L1 overview text (loaded if score is high enough) */
  overview?: string;

  /** The layer that was loaded */
  loadedLayer: ContextLayer;
}

/** Result from a context retrieval query. */
export interface RetrievalResult {
  /** Matching memories */
  memories: ContextMatch[];

  /** Matching project context */
  projects: ContextMatch[];

  /** Matching session archives */
  sessions: ContextMatch[];

  /** Total retrieval time in ms */
  durationMs: number;

  /** Number of directories traversed */
  directoriesSearched: number;
}

// ─── L0 Index ────────────────────────────────────────────────────────

/**
 * In-memory index of all L0 abstracts + their embeddings.
 * Loaded on startup for fast vector search.
 */
export interface L0IndexEntry {
  /** Relative path in the NCF */
  path: string;

  /** The L0 abstract text */
  abstract: string;

  /** Pre-computed embedding for vector search */
  embedding: number[];

  /** Scope for filtered retrieval */
  scope: ContextScope;

  /** Last modified timestamp */
  updatedAt: number;
}
