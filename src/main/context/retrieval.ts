/**
 * NCF Hierarchical Retrieval — Directory Recursive Retrieval
 *
 * Adapted from OpenViking's "Directory Recursive Retrieval" strategy.
 *
 * Algorithm (per OpenViking §7):
 *   1. Embed the user's query
 *   2. Vector search L0 abstracts to locate high-scoring directories
 *   3. Drill into those directories, loading children's L0s
 *   4. Score propagation: final = α * embedding_score + (1 - α) * parent_score
 *   5. Convergence detection: stop when top-K results don't change for N rounds
 *   6. Load L1 overviews for top results (if score is high enough)
 *   7. Return ranked ContextMatch array
 *
 * Uses the existing all-MiniLM-L6-v2 embedding pipeline from skills/embeddings.ts.
 */

import type {
  ContextScope,
  ContextMatch,
  RetrievalResult,
  L0IndexEntry,
} from "@/shared/context-types";
import {
  getL0Index,
  readL1,
  getChildren,
} from "./ncf";
import {
  embed,
  cosineSimilarity,
} from "../skills/embeddings";

// ─── Constants ───────────────────────────────────────────────────────

/** Weight for embedding score vs parent score in score propagation. */
const SCORE_ALPHA = 0.5;

/** Minimum score to include in results. */
const MIN_SCORE = 0.25;

/** Score threshold for loading L1 overview. */
const L1_LOAD_THRESHOLD = 0.45;

/** Maximum results per scope. */
const MAX_RESULTS_PER_SCOPE = 5;

/** Maximum total results across all scopes. */
const MAX_TOTAL_RESULTS = 10;

/** Convergence detection: stop after this many rounds with no top-K change. */
const MAX_CONVERGENCE_ROUNDS = 3;

/** Maximum recursion depth in directory traversal. */
const MAX_DEPTH = 4;

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Retrieve relevant context for a user query.
 *
 * This is the main entry point for the NCF retrieval system.
 * Called by the chat service to inject context into the system prompt.
 *
 * @param query - The user's message text
 * @param scopes - Which scopes to search (default: all)
 * @returns Ranked context matches with loaded L0/L1 content
 */
export async function retrieveContext(
  query: string,
  scopes?: ContextScope[],
): Promise<RetrievalResult> {
  const startTime = Date.now();
  const targetScopes = scopes || ["user", "agent", "projects", "sessions"];

  // 1. Embed the query
  const queryEmb = await embed(query);

  // 2. Get L0 index entries filtered by scope
  const l0Index = getL0Index();
  const candidates = l0Index.filter((entry) =>
    targetScopes.includes(entry.scope),
  );

  // If no L0 entries have embeddings yet, fall back to text matching
  const hasEmbeddings = candidates.some((c) => c.embedding.length > 0);

  // 3. Score all L0 entries against the query
  const scored: ScoredEntry[] = [];
  for (const entry of candidates) {
    let score: number;

    if (hasEmbeddings && entry.embedding.length > 0) {
      // Vector similarity
      score = cosineSimilarity(queryEmb, entry.embedding);
    } else {
      // Fallback: simple text overlap scoring
      score = textOverlapScore(query, entry.abstract);
    }

    if (score >= MIN_SCORE) {
      scored.push({
        entry,
        score,
        depth: 0,
      });
    }
  }

  // 4. Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // 5. Recursive drill-down into top directories
  const explored = new Set<string>();
  let directoriesSearched = 0;
  let convergenceCount = 0;
  let previousTopK = "";

  // Priority queue ordered by score (simulated with sorted array)
  const drillQueue = scored.slice(0, 5); // Start with top-5

  while (drillQueue.length > 0 && convergenceCount < MAX_CONVERGENCE_ROUNDS) {
    const current = drillQueue.shift()!;

    if (explored.has(current.entry.path)) continue;
    explored.add(current.entry.path);
    directoriesSearched++;

    // Check depth limit
    if (current.depth >= MAX_DEPTH) continue;

    // Get children of this directory
    const children = getChildren(current.entry.path);

    for (const child of children) {
      if (child.type !== "directory") continue;
      if (explored.has(child.path)) continue;
      if (!child.abstract) continue;

      // Score propagation
      let childScore: number;
      if (hasEmbeddings) {
        const childEmb = await embed(child.abstract);
        const embScore = cosineSimilarity(queryEmb, childEmb);
        childScore = SCORE_ALPHA * embScore + (1 - SCORE_ALPHA) * current.score;
      } else {
        const textScore = textOverlapScore(query, child.abstract);
        childScore = SCORE_ALPHA * textScore + (1 - SCORE_ALPHA) * current.score;
      }

      if (childScore >= MIN_SCORE) {
        const childEntry: ScoredEntry = {
          entry: {
            path: child.path,
            abstract: child.abstract,
            embedding: [],
            scope: child.scope,
            updatedAt: child.updatedAt,
          },
          score: childScore,
          depth: current.depth + 1,
        };

        // Insert into scored list maintaining sort order
        const insertIdx = scored.findIndex((s) => s.score < childScore);
        if (insertIdx >= 0) {
          scored.splice(insertIdx, 0, childEntry);
        } else {
          scored.push(childEntry);
        }

        // Add to drill queue if score is promising
        if (childScore >= L1_LOAD_THRESHOLD) {
          drillQueue.push(childEntry);
          // Re-sort drill queue
          drillQueue.sort((a, b) => b.score - a.score);
        }
      }
    }

    // Convergence detection: check if top-K results changed
    const currentTopK = scored
      .slice(0, MAX_TOTAL_RESULTS)
      .map((s) => s.entry.path)
      .join(",");

    if (currentTopK === previousTopK) {
      convergenceCount++;
    } else {
      convergenceCount = 0;
      previousTopK = currentTopK;
    }
  }

  // 6. Build results grouped by scope
  const memories: ContextMatch[] = [];
  const projects: ContextMatch[] = [];
  const sessions: ContextMatch[] = [];

  const seen = new Set<string>();

  for (const entry of scored) {
    if (seen.has(entry.entry.path)) continue;
    seen.add(entry.entry.path);

    // Determine which list to add to
    const match = await buildContextMatch(entry);

    switch (entry.entry.scope) {
      case "user":
      case "agent":
        if (memories.length < MAX_RESULTS_PER_SCOPE) {
          memories.push(match);
        }
        break;
      case "projects":
        if (projects.length < MAX_RESULTS_PER_SCOPE) {
          projects.push(match);
        }
        break;
      case "sessions":
        if (sessions.length < MAX_RESULTS_PER_SCOPE) {
          sessions.push(match);
        }
        break;
    }

    // Stop if we have enough results
    if (memories.length + projects.length + sessions.length >= MAX_TOTAL_RESULTS) {
      break;
    }
  }

  return {
    memories,
    projects,
    sessions,
    durationMs: Date.now() - startTime,
    directoriesSearched,
  };
}

/**
 * Quick retrieval — only L0 abstracts, no drill-down.
 * Used for building the context injection in the system prompt.
 * Returns all L0 abstracts above a score threshold, formatted as a string.
 */
export async function retrieveL0Context(
  query: string,
  scopes?: ContextScope[],
): Promise<{ content: string; matchCount: number }> {
  const targetScopes = scopes || ["user", "agent", "projects"];
  const queryEmb = await embed(query);
  const l0Index = getL0Index();

  const matches: Array<{ path: string; abstract: string; score: number }> = [];

  for (const entry of l0Index) {
    if (!targetScopes.includes(entry.scope)) continue;

    let score: number;
    if (entry.embedding.length > 0) {
      score = cosineSimilarity(queryEmb, entry.embedding);
    } else {
      score = textOverlapScore(query, entry.abstract);
    }

    if (score >= MIN_SCORE) {
      matches.push({ path: entry.path, abstract: entry.abstract, score });
    }
  }

  // Sort by score
  matches.sort((a, b) => b.score - a.score);

  // Take top results
  const topMatches = matches.slice(0, 8);

  if (topMatches.length === 0) {
    return { content: "", matchCount: 0 };
  }

  // Format as context block
  const lines = topMatches.map(
    (m) => `[${m.path}] ${m.abstract}`,
  );

  const content = `## Retrieved Context\n${lines.join("\n")}`;

  return { content, matchCount: topMatches.length };
}

// ─── Internal Types ──────────────────────────────────────────────────

interface ScoredEntry {
  entry: L0IndexEntry;
  score: number;
  depth: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Build a ContextMatch from a scored entry.
 * Loads L1 overview if the score is above threshold.
 */
async function buildContextMatch(scored: ScoredEntry): Promise<ContextMatch> {
  const loadL1 = scored.score >= L1_LOAD_THRESHOLD;
  let overview: string | undefined;

  if (loadL1) {
    const l1Content = readL1(scored.entry.path);
    if (l1Content) {
      overview = l1Content;
    }
  }

  return {
    node: {
      path: scored.entry.path,
      type: "directory",
      scope: scored.entry.scope,
      abstract: scored.entry.abstract,
      updatedAt: scored.entry.updatedAt,
      createdAt: scored.entry.updatedAt,
    },
    score: scored.score,
    abstract: scored.entry.abstract,
    overview,
    loadedLayer: loadL1 && overview ? "L1" : "L0",
  };
}

/**
 * Simple text overlap scoring as a fallback when embeddings aren't available.
 * Counts shared words between query and text, normalized by text length.
 */
function textOverlapScore(query: string, text: string): number {
  const queryWords = new Set(
    query.toLowerCase().split(/\s+/).filter((w) => w.length > 2),
  );
  const textWords = text.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

  if (textWords.length === 0 || queryWords.size === 0) return 0;

  let overlap = 0;
  for (const word of textWords) {
    if (queryWords.has(word)) overlap++;
  }

  // Normalize: Jaccard-like but biased toward recall
  return overlap / Math.max(queryWords.size, 3);
}

/**
 * Quick synchronous L0 retrieval using text overlap (no embeddings).
 * Used for fast context injection in the system prompt.
 *
 * @param query - The user's message text
 * @param maxResults - Maximum results to return
 * @returns Scored L0 entries above threshold
 */
export function quickL0Retrieve(
  query: string,
  maxResults: number = 5,
): Array<{ path: string; abstract: string; score: number }> {
  const l0Index = getL0Index();
  const matches: Array<{ path: string; abstract: string; score: number }> = [];

  for (const entry of l0Index) {
    const score = textOverlapScore(query, entry.abstract);
    if (score >= MIN_SCORE) {
      matches.push({ path: entry.path, abstract: entry.abstract, score });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, maxResults);
}

