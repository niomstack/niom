/**
 * Edge Weight Learning — Temporal EMA from Execution Traces
 *
 * Implements the self-improving graph learning described in the
 * research paper §3.4 (Eq. 3):
 *
 *   w_{t+1} = w_t · e^(-λ·Δτ) + α · (1 - w_t · e^(-λ·Δτ))
 *
 * Where:
 *   - w_t     = current edge weight
 *   - Δτ      = time since last reinforcement (seconds)
 *   - λ       = decay rate (ln(2) / half-life for 30-day half-life)
 *   - α       = learning rate (0.15)
 *
 * Two types of usage edges:
 *   - cooccurrence: tools used together in the same step/response
 *   - pipeline:     sequential tool pairs (A→B) across steps
 *
 * Persistence:
 *   Graph is dirty-tracked and saved after edge updates with debounce
 *   to avoid excessive disk writes.
 */

import { skillGraph } from "./graph";
import type { SkillEdge, SkillEdgeType } from "@/shared/skill-types";

// ─── Constants ───────────────────────────────────────────────────────

/** Learning rate per paper §3.4 — how much each reinforcement increases weight. */
const ALPHA = 0.15;

/** Half-life for temporal decay: 30 days (in seconds). */
const HALF_LIFE_SECONDS = 30 * 24 * 60 * 60; // 2,592,000 seconds

/** Decay constant λ = ln(2) / half-life. */
const LAMBDA = Math.LN2 / HALF_LIFE_SECONDS;

/** Minimum edge weight — below this threshold, edge is effectively dead. */
const MIN_WEIGHT = 0.01;

/** Maximum edge weight — prevent saturation. */
const MAX_WEIGHT = 0.99;

/** Debounce interval for graph saves (ms). */
const SAVE_DEBOUNCE_MS = 5000;

// ─── Dirty Tracking ─────────────────────────────────────────────────

let isDirty = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Schedule a debounced save of the skill graph. */
function scheduleSave(): void {
  isDirty = true;
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    if (isDirty) {
      skillGraph.save();
      isDirty = false;
      console.log("[EdgeLearning] Debounced save complete");
    }
    saveTimer = null;
  }, SAVE_DEBOUNCE_MS);
}

/** Force an immediate save (e.g. on app shutdown). */
export function flushEdgeLearning(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (isDirty) {
    skillGraph.save();
    isDirty = false;
    console.log("[EdgeLearning] Flushed on shutdown");
  }
}

// ─── Temporal EMA Update Rule ───────────────────────────────────────

/**
 * Apply the Temporal EMA update to an edge weight.
 *
 * Per paper Eq. 3:
 *   decayed = w_t · e^(-λ·Δτ)
 *   w_{t+1} = decayed + α · (1 - decayed)
 *
 * This:
 *   1. First decays the current weight based on time since last use
 *   2. Then adds a learning increment proportional to (1 - decayed)
 *   3. Clamps to [MIN_WEIGHT, MAX_WEIGHT]
 *
 * @param currentWeight - Current edge weight (0-1)
 * @param lastReinforcedMs - Timestamp (ms) of last reinforcement
 * @param nowMs - Current timestamp (ms)
 * @returns New weight after decay + reinforcement
 */
function temporalEmaUpdate(
  currentWeight: number,
  lastReinforcedMs: number,
  nowMs: number,
): number {
  // Time elapsed in seconds
  const deltaT = Math.max(0, (nowMs - lastReinforcedMs) / 1000);

  // Decay current weight
  const decayed = currentWeight * Math.exp(-LAMBDA * deltaT);

  // Apply learning increment
  const newWeight = decayed + ALPHA * (1 - decayed);

  // Clamp
  return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, newWeight));
}

/**
 * Apply temporal decay only (no reinforcement).
 * Used to decay a weight without adding a learning increment.
 *
 * @param currentWeight - Current edge weight
 * @param lastReinforcedMs - Last reinforcement timestamp
 * @param nowMs - Current timestamp
 * @returns Decayed weight
 */
function temporalDecay(
  currentWeight: number,
  lastReinforcedMs: number,
  nowMs: number,
): number {
  const deltaT = Math.max(0, (nowMs - lastReinforcedMs) / 1000);
  const decayed = currentWeight * Math.exp(-LAMBDA * deltaT);
  return Math.max(MIN_WEIGHT, decayed);
}

// ─── Edge Reinforcement ─────────────────────────────────────────────

/**
 * Reinforce an edge between two nodes.
 *
 * If the edge exists, applies EMA update (decay + reinforce).
 * If the edge doesn't exist, creates it with initial weight α.
 *
 * @param sourceId - Source node ID (e.g. "tool:readFile")
 * @param targetId - Target node ID (e.g. "tool:listDirectory")
 * @param type - Edge type (cooccurrence or pipeline)
 */
function reinforceEdge(
  sourceId: string,
  targetId: string,
  type: SkillEdgeType,
): void {
  const now = Date.now();
  const key = `${sourceId}::${targetId}`;
  const existing = skillGraph.edges[key];

  if (existing) {
    // Skip if edge type doesn't match (don't reinforce hierarchy edges)
    if (existing.type !== type) return;

    // Apply EMA update
    existing.weight = temporalEmaUpdate(existing.weight, existing.lastReinforced, now);
    existing.reinforcements += 1;
    existing.lastReinforced = now;
  } else {
    // Create new edge with initial weight = ALPHA
    skillGraph.edges[key] = {
      source: sourceId,
      target: targetId,
      weight: ALPHA,
      type,
      reinforcements: 1,
      lastReinforced: now,
    };
  }
}

// ─── Co-occurrence Edges ────────────────────────────────────────────

/**
 * Record co-occurrence edges for a set of tools used together.
 *
 * For N tools used in the same response, creates N*(N-1) bidirectional
 * cooccurrence edges (each pair reinforced both ways).
 *
 * @param toolNames - Array of tool names used in this response
 */
export function recordCooccurrence(toolNames: string[]): void {
  if (toolNames.length < 2) return;

  // Convert tool names to node IDs
  const toolIds = toolNames
    .map((name) => `tool:${name}`)
    .filter((id) => skillGraph.getNode(id)); // Only existing nodes

  if (toolIds.length < 2) return;

  let edgesCreated = 0;

  // Create bidirectional cooccurrence edges for all pairs
  for (let i = 0; i < toolIds.length; i++) {
    for (let j = i + 1; j < toolIds.length; j++) {
      reinforceEdge(toolIds[i], toolIds[j], "cooccurrence");
      reinforceEdge(toolIds[j], toolIds[i], "cooccurrence");
      edgesCreated += 2;
    }
  }

  // Also update usage stats on the nodes
  const now = Date.now();
  for (const id of toolIds) {
    const node = skillGraph.getNode(id);
    if (node) {
      node.usageCount += 1;
      node.lastUsed = now;
    }
  }

  if (edgesCreated > 0) {
    console.log(
      `[EdgeLearning] Reinforced ${edgesCreated} cooccurrence edges for: [${toolNames.join(", ")}]`,
    );
    scheduleSave();
  }
}

// ─── Pipeline Edges ─────────────────────────────────────────────────

/**
 * Record pipeline edges for an ordered sequence of tool calls.
 *
 * For tools executed in order [A, B, C], creates directional pipeline
 * edges: A→B and B→C. These capture sequential execution patterns.
 *
 * @param toolSequence - Ordered array of tool names (execution order)
 */
export function recordPipeline(toolSequence: string[]): void {
  if (toolSequence.length < 2) return;

  // Convert to node IDs and filter to existing nodes
  const toolIds = toolSequence
    .map((name) => `tool:${name}`)
    .filter((id) => skillGraph.getNode(id));

  if (toolIds.length < 2) return;

  let edgesCreated = 0;

  // Create directional pipeline edges for consecutive pairs
  for (let i = 0; i < toolIds.length - 1; i++) {
    reinforceEdge(toolIds[i], toolIds[i + 1], "pipeline");
    edgesCreated++;
  }

  if (edgesCreated > 0) {
    console.log(
      `[EdgeLearning] Reinforced ${edgesCreated} pipeline edges for: ${toolSequence.join(" → ")}`,
    );
    scheduleSave();
  }
}

// ─── Combined Learning from Tool Trace ──────────────────────────────

/**
 * Learn from a complete tool execution trace.
 *
 * Called after a chat response completes (with tool calls).
 * Records both co-occurrence and pipeline relationships.
 *
 * @param toolSequence - Ordered list of tool names that were executed
 */
export function learnFromToolTrace(toolSequence: string[]): void {
  if (toolSequence.length === 0) return;

  console.log(
    `[EdgeLearning] Learning from trace: [${toolSequence.join(" → ")}]`,
  );

  // 1. Co-occurrence: all tools used together get bidirectional edges
  recordCooccurrence(toolSequence);

  // 2. Pipeline: consecutive pairs get directional edges
  recordPipeline(toolSequence);
}

// ─── Temporal Decay of Semantic Edges ───────────────────────────────

/**
 * Apply temporal decay to all non-hierarchy edges.
 *
 * Should be called periodically (e.g. on graph load, daily).
 * Hierarchy edges are never decayed.
 * Edges that fall below MIN_WEIGHT are removed.
 *
 * @returns Number of edges removed due to decay
 */
export function decayAllEdges(): number {
  const now = Date.now();
  let removed = 0;

  for (const [key, edge] of Object.entries(skillGraph.edges)) {
    // Never decay hierarchy edges — these are structural
    if (edge.type === "hierarchy") continue;

    // Apply temporal decay
    const decayed = temporalDecay(edge.weight, edge.lastReinforced, now);
    edge.weight = decayed;

    // Remove dead edges (below threshold with no recent reinforcement)
    if (decayed <= MIN_WEIGHT && edge.reinforcements > 0) {
      // Only remove if it's been long enough (at least 2x half-life)
      const timeSinceUse = now - edge.lastReinforced;
      if (timeSinceUse > HALF_LIFE_SECONDS * 2 * 1000) {
        delete skillGraph.edges[key];
        removed++;
      }
    }
  }

  if (removed > 0) {
    console.log(`[EdgeLearning] Removed ${removed} decayed edges`);
    scheduleSave();
  }

  return removed;
}

// ─── Stats ──────────────────────────────────────────────────────────

/** Get learning statistics for debugging/display. */
export function getLearningStats(): {
  cooccurrenceEdges: number;
  pipelineEdges: number;
  totalReinforcements: number;
  avgWeight: number;
} {
  const edges = Object.values(skillGraph.edges);

  const cooccurrence = edges.filter((e) => e.type === "cooccurrence");
  const pipeline = edges.filter((e) => e.type === "pipeline");
  const usageEdges = [...cooccurrence, ...pipeline];

  const totalReinforcements = usageEdges.reduce(
    (sum, e) => sum + e.reinforcements,
    0,
  );
  const avgWeight =
    usageEdges.length > 0
      ? usageEdges.reduce((sum, e) => sum + e.weight, 0) / usageEdges.length
      : 0;

  return {
    cooccurrenceEdges: cooccurrence.length,
    pipelineEdges: pipeline.length,
    totalReinforcements,
    avgWeight: Math.round(avgWeight * 1000) / 1000,
  };
}
