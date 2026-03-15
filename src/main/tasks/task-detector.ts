/**
 * Task Detector — Query Complexity Heuristic
 *
 * Analyzes a user query + SkillPath routing result to determine whether
 * the request is complex enough to run as a background Task.
 *
 * Signals used:
 *   1. Multi-domain routing (query spans 2+ skill domains)
 *   2. High step budget from routing (>= 15 steps)
 *   3. Temporal markers ("over the next week", "daily", "every day")
 *   4. Multi-part goal structure ("first... then... finally...")
 *   5. Complexity keywords ("research", "analyze", "build", "plan", etc.)
 *   6. Query length (long queries = more complex)
 *   7. Background execution mode from routing
 *
 * Returns a complexity score (0–1) and a boolean recommendation.
 * The threshold is intentionally high to avoid false positives —
 * it's better to miss some tasks than to annoy users with unnecessary prompts.
 */

import type { SkillPath } from "@/shared/skill-types";

// ─── Types ───────────────────────────────────────────────────────────

export interface TaskDetectionResult {
  /** Should this be suggested as a Task? */
  shouldSuggest: boolean;
  /** Complexity score: 0 = trivial, 1 = highly complex */
  score: number;
  /** Human-readable reason for the suggestion */
  reason: string;
  /** Breakdown of individual signals */
  signals: {
    multiDomain: number;
    highStepBudget: number;
    temporalMarkers: number;
    multiPartGoal: number;
    complexityKeywords: number;
    queryLength: number;
    backgroundMode: number;
  };
}

// ─── Configuration ───────────────────────────────────────────────────

/** Threshold above which we suggest running as a Task */
const SUGGESTION_THRESHOLD = 0.55;

/** Temporal marker patterns */
const TEMPORAL_PATTERNS = [
  /over the next \w+/i,
  /this (week|month|quarter)/i,
  /every (day|week|morning|evening)/i,
  /daily|weekly|monthly/i,
  /for the next \d+/i,
  /by (tomorrow|next week|end of)/i,
  /on an ongoing basis/i,
  /recurring(ly)?/i,
  /schedule/i,
  /automat(e|ically)/i,
];

/** Multi-part goal indicators */
const MULTI_PART_PATTERNS = [
  /first[,.]?\s.+then\b/i,
  /step\s*\d+/i,
  /\d+\)\s/,                      // numbered list: 1) 2) 3)
  /\band\s+then\b/i,
  /\bfinally\b/i,
  /\bafterwards?\b/i,
  /\bonce\s+that'?s?\s+done\b/i,
  /\bnext[,.]?\s/i,              // "next, do X"
];

/** Complexity keywords — things that imply deep, multi-step work */
const COMPLEXITY_KEYWORDS = [
  "research", "investigate", "analyze", "analysis",
  "deep dive", "comprehensive", "thorough", "exhaustive",
  "build", "implement", "develop", "create a full",
  "plan", "strategy", "roadmap", "outline",
  "compare", "evaluate", "benchmark", "assess",
  "report", "document", "write up",
  "manage", "monitor", "track",
  "refactor", "migrate", "redesign",
  "set up", "configure", "deploy",
  "audit", "review",
];

// ─── Detector ────────────────────────────────────────────────────────

/**
 * Analyze a query + its SkillPath routing result and determine complexity.
 *
 * @param query - The user's raw query text
 * @param skillPath - The resolved SkillPath from Skill Tree traversal
 * @returns Detection result with score, recommendation, and signal breakdown
 */
export function detectTaskComplexity(
  query: string,
  skillPath: SkillPath,
): TaskDetectionResult {
  const lower = query.toLowerCase();

  // ── Signal 1: Multi-domain routing ──────────────────────────────
  // Multiple domains = the query spans different capability areas
  const domainCount = 1 + (skillPath.secondaryDomains?.length || 0);
  const multiDomain = domainCount >= 3 ? 1.0 : domainCount >= 2 ? 0.6 : 0;

  // ── Signal 2: High step budget ──────────────────────────────────
  // Routing assigned a high step budget = it expects many tool calls
  const highStepBudget =
    skillPath.stepBudget >= 25 ? 1.0 :
    skillPath.stepBudget >= 20 ? 0.7 :
    skillPath.stepBudget >= 15 ? 0.4 : 0;

  // ── Signal 3: Temporal markers ──────────────────────────────────
  // Mentions of time spans, recurring work, scheduling
  const temporalHits = TEMPORAL_PATTERNS.filter((p) => p.test(query)).length;
  const temporalMarkers = temporalHits >= 2 ? 1.0 : temporalHits === 1 ? 0.7 : 0;

  // ── Signal 4: Multi-part goal structure ─────────────────────────
  // "First... then... finally..." patterns
  const multiPartHits = MULTI_PART_PATTERNS.filter((p) => p.test(query)).length;
  const multiPartGoal = multiPartHits >= 2 ? 1.0 : multiPartHits === 1 ? 0.5 : 0;

  // ── Signal 5: Complexity keywords ──────────────────────────────
  const keywordHits = COMPLEXITY_KEYWORDS.filter((kw) => lower.includes(kw)).length;
  const complexityKeywords =
    keywordHits >= 3 ? 1.0 :
    keywordHits >= 2 ? 0.7 :
    keywordHits >= 1 ? 0.3 : 0;

  // ── Signal 6: Query length ─────────────────────────────────────
  // Longer queries tend to describe more complex tasks
  const wordCount = query.split(/\s+/).length;
  const queryLength =
    wordCount >= 80 ? 1.0 :
    wordCount >= 50 ? 0.7 :
    wordCount >= 30 ? 0.4 :
    wordCount >= 15 ? 0.1 : 0;

  // ── Signal 7: Background execution mode ─────────────────────────
  // Routing already determined this should be background
  const backgroundMode = skillPath.executionMode === "background" ? 1.0 : 0;

  // ── Weighted Score ─────────────────────────────────────────────
  const weights = {
    multiDomain: 0.15,
    highStepBudget: 0.10,
    temporalMarkers: 0.20,
    multiPartGoal: 0.15,
    complexityKeywords: 0.15,
    queryLength: 0.05,
    backgroundMode: 0.20,
  };

  const signals = {
    multiDomain,
    highStepBudget,
    temporalMarkers,
    multiPartGoal,
    complexityKeywords,
    queryLength,
    backgroundMode,
  };

  const score =
    multiDomain * weights.multiDomain +
    highStepBudget * weights.highStepBudget +
    temporalMarkers * weights.temporalMarkers +
    multiPartGoal * weights.multiPartGoal +
    complexityKeywords * weights.complexityKeywords +
    queryLength * weights.queryLength +
    backgroundMode * weights.backgroundMode;

  // ── Determine suggestion ────────────────────────────────────────
  const shouldSuggest = score >= SUGGESTION_THRESHOLD;

  // ── Build human-readable reason ─────────────────────────────────
  const reasons: string[] = [];
  if (backgroundMode > 0) reasons.push("deep research query");
  if (multiDomain >= 0.6) reasons.push(`spans ${domainCount} domains`);
  if (temporalMarkers > 0) reasons.push("involves recurring/scheduled work");
  if (multiPartGoal > 0) reasons.push("has multiple sequential steps");
  if (complexityKeywords >= 0.7) reasons.push("complex multi-step work");
  if (queryLength >= 0.7) reasons.push("detailed request");

  const reason = reasons.length > 0
    ? `This looks like a complex task: ${reasons.join(", ")}.`
    : "This query appears complex enough for a background task.";

  return {
    shouldSuggest,
    score: Math.min(1, Math.max(0, score)),
    reason,
    signals,
  };
}
