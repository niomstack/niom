/**
 * Skill Path Resolver — Hierarchical DAG Traversal
 *
 * Implements the three-phase routing pipeline from the research paper §3.3:
 *
 *   Phase A (install-time):  Done in graph.ts — embed exemplars, build DAG
 *   Phase B (type-time):     THIS FILE — embed query → traverse → SkillPath
 *   Phase C (send-time):     Done in chat.service.ts — inject tools + prompts
 *
 * Algorithm (per paper Algorithm 1):
 *   1. Greeting/trivial detection → fallback to general pack
 *   2. Cache check → return cached SkillPath if fresh
 *   3. Embed user query
 *   4. Score domains (max-similarity across exemplar embeddings)
 *   5. Select top-K domains + OS guarantee + web injection rules
 *   6. Score tools within selected domains
 *   7. Apply tiered adaptive cutoff (primitive: μ, intent: μ + 0.25σ)
 *   8. Clamp tool count to [MIN_TOOLS, MAX_TOOLS]
 *   9. Build SkillPath with system prompt fragments
 *   10. Cache and return
 */

import type {
  SkillPath,
  SkillNode,
  ExecutionMode,
} from "@/shared/skill-types";
import { skillGraph } from "./graph";
import {
  embed,
  maxSimilarity,
  cosineSimilarity,
} from "./embeddings";
import { BUILTIN_PACKS, PACK_BY_DOMAIN } from "./builtin-packs";
import { applyPostRoutingValidation } from "./post-routing";

// ─── Constants ───────────────────────────────────────────────────────

/** Max domains to consider (top-K). */
const MAX_DOMAINS = 3;

/** Tools returned: [MIN, MAX] range after cutoff. */
const MIN_TOOLS = 3;
const MAX_TOOLS = 8;

/** Adaptive cutoff constant for intent domains (per paper §3.3). */
const INTENT_CUTOFF_SIGMA = 0.25;

/** Cache TTL in milliseconds (30 seconds). */
const CACHE_TTL = 30_000;

/** Maximum cache entries. */
const CACHE_MAX_SIZE = 50;

/** Minimum domain score to consider (absolute floor). */
const MIN_DOMAIN_SCORE = 0.15;

/** Greeting / trivial query patterns. */
const GREETING_PATTERNS = [
  /^(hi|hello|hey|yo|sup|hola|howdy|greetings)[\s!.?]*$/i,
  /^(thanks|thank you|thx|ty|cheers)[\s!.?]*$/i,
  /^(yes|no|yeah|nah|yep|nope|ok|okay|sure|alright)[\s!.?]*$/i,
  /^(bye|goodbye|see ya|later|cya)[\s!.?]*$/i,
  /^(what can you do|help|what are you)[\s!.?]*$/i,
  /^.{0,3}$/,  // Very short queries (1-3 chars)
];

/** Domains that automatically inject Web tools when they're primary. */
const WEB_INJECTION_DOMAINS = new Set(["research", "business", "creative"]);

// ─── Cache ───────────────────────────────────────────────────────────

interface CacheEntry {
  path: SkillPath;
  timestamp: number;
}

const pathCache = new Map<string, CacheEntry>();

function getCachedPath(query: string): SkillPath | null {
  const entry = pathCache.get(query);
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    pathCache.delete(query);
    return null;
  }

  return entry.path;
}

function setCachedPath(query: string, path: SkillPath): void {
  // Evict oldest if at capacity
  if (pathCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = pathCache.keys().next().value;
    if (oldestKey !== undefined) {
      pathCache.delete(oldestKey);
    }
  }
  pathCache.set(query, { path, timestamp: Date.now() });
}

// ─── Domain Scoring ──────────────────────────────────────────────────

interface DomainScore {
  domainId: string;
  domain: string;
  score: number;
  negativeScore: number;
  netScore: number;
  tier: "primitive" | "intent" | "fallback";
}

/**
 * Score all domains against the query embedding using max-similarity
 * over exemplar embeddings (paper §3.3 — two-level exemplar matching).
 *
 * Also computes negative scores for contrastive filtering.
 */
function scoreDomains(queryEmb: number[]): DomainScore[] {
  const domainNodes = skillGraph.getDomainNodes();
  const scores: DomainScore[] = [];

  for (const node of domainNodes) {
    if (!node.enabled) continue;

    const pack = PACK_BY_DOMAIN[node.name];
    if (!pack) continue;

    // Max-sim over exemplar embeddings (paper's key insight)
    let score = 0;
    if (node.exemplarEmbeddings && node.exemplarEmbeddings.length > 0) {
      score = maxSimilarity(queryEmb, node.exemplarEmbeddings);
    } else if (node.embedding.some((v) => v !== 0)) {
      score = cosineSimilarity(queryEmb, node.embedding);
    }

    // Negative exemplar scoring (contrastive)
    let negativeScore = 0;
    if (node.negativeExemplarEmbeddings && node.negativeExemplarEmbeddings.length > 0) {
      negativeScore = maxSimilarity(queryEmb, node.negativeExemplarEmbeddings);
    }

    // Net score penalizes false matches
    const netScore = score - (negativeScore * 0.3);

    scores.push({
      domainId: node.id,
      domain: node.name,
      score,
      negativeScore,
      netScore,
      tier: pack.tier,
    });
  }

  // Sort by net score descending
  scores.sort((a, b) => b.netScore - a.netScore);
  return scores;
}

// ─── Tool Scoring ────────────────────────────────────────────────────

interface ToolScore {
  toolId: string;
  toolName: string;
  score: number;
  negativeScore: number;
  netScore: number;
  domain: string;
}

/**
 * Score tools within selected domains against the query embedding.
 * Uses max-similarity over tool exemplar embeddings.
 */
function scoreTools(queryEmb: number[], selectedDomainIds: string[]): ToolScore[] {
  const scores: ToolScore[] = [];
  const seenTools = new Set<string>();

  for (const domainId of selectedDomainIds) {
    const children = skillGraph.getChildren(domainId);

    for (const toolNode of children) {
      if (toolNode.type !== "tool") continue;
      if (!toolNode.enabled) continue;
      if (!toolNode.toolName) continue;
      if (seenTools.has(toolNode.toolName)) continue;
      seenTools.add(toolNode.toolName);

      // Max-sim over tool exemplar embeddings
      let score = 0;
      if (toolNode.exemplarEmbeddings && toolNode.exemplarEmbeddings.length > 0) {
        score = maxSimilarity(queryEmb, toolNode.exemplarEmbeddings);
      } else if (toolNode.embedding.some((v) => v !== 0)) {
        score = cosineSimilarity(queryEmb, toolNode.embedding);
      }

      // Negative exemplar scoring
      let negativeScore = 0;
      if (toolNode.negativeExemplarEmbeddings && toolNode.negativeExemplarEmbeddings.length > 0) {
        negativeScore = maxSimilarity(queryEmb, toolNode.negativeExemplarEmbeddings);
      }

      const netScore = score - (negativeScore * 0.3);

      scores.push({
        toolId: toolNode.id,
        toolName: toolNode.toolName,
        score,
        negativeScore,
        netScore,
        domain: toolNode.packId || "unknown",
      });
    }
  }

  // Sort by net score descending
  scores.sort((a, b) => b.netScore - a.netScore);
  return scores;
}

// ─── Adaptive Cutoff ────────────────────────────────────────────────

/**
 * Apply tiered adaptive cutoff to tool scores.
 *
 * Per paper §3.3:
 * - Primitive domains: relaxed cutoff (μ)
 * - Intent domains: strict cutoff (μ + 0.25σ)
 *
 * Result is clamped to [MIN_TOOLS, MAX_TOOLS].
 */
function applyCutoff(toolScores: ToolScore[]): ToolScore[] {
  if (toolScores.length <= MIN_TOOLS) return toolScores;

  // Compute mean and standard deviation of net scores
  const scores = toolScores.map((t) => t.netScore);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
  const sigma = Math.sqrt(variance);

  // Apply tiered cutoff
  const selected: ToolScore[] = [];

  for (const tool of toolScores) {
    const pack = PACK_BY_DOMAIN[tool.domain];
    const isPrimitive = pack?.tier === "primitive";

    // Primitive: relaxed (μ), Intent: strict (μ + 0.25σ)
    const cutoff = isPrimitive ? mean : mean + INTENT_CUTOFF_SIGMA * sigma;

    if (tool.netScore >= cutoff || selected.length < MIN_TOOLS) {
      selected.push(tool);
    }
  }

  // Clamp to MAX_TOOLS
  return selected.slice(0, MAX_TOOLS);
}

// ─── Execution Mode Detection ────────────────────────────────────────

/**
 * Determine execution mode from the query and primary domain.
 *
 * - "stream": interactive conversation (default)
 * - "generate": one-shot generation (e.g., "write a function")
 * - "background": async tasks (e.g., "research X and report back")
 */
function detectExecutionMode(query: string, primaryDomain: string): ExecutionMode {
  const lower = query.toLowerCase();

  // Background mode triggers
  if (
    primaryDomain === "research" &&
    (lower.includes("research") || lower.includes("investigate") || lower.includes("deep dive"))
  ) {
    return "background";
  }

  // Generate mode triggers
  if (
    lower.startsWith("write ") ||
    lower.startsWith("create ") ||
    lower.startsWith("generate ") ||
    lower.startsWith("draft ")
  ) {
    return "generate";
  }

  return "stream";
}

/**
 * Determine step budget based on execution mode and domain.
 */
function getStepBudget(mode: ExecutionMode, primaryDomain: string): number {
  switch (mode) {
    case "background":
      return 25;
    case "generate":
      return 10;
    case "stream":
      // Code and research get more steps for multi-tool workflows
      if (primaryDomain === "code" || primaryDomain === "research") return 20;
      return 15;
  }
}

// ─── Greeting Detection ──────────────────────────────────────────────

function isGreeting(query: string): boolean {
  return GREETING_PATTERNS.some((pattern) => pattern.test(query.trim()));
}

// ─── Goal Extraction ─────────────────────────────────────────────────

/**
 * Extract a concise goal from the user's query.
 * This is a simple heuristic — the model refines it during execution.
 */
function extractGoal(query: string): string {
  // Remove filler words
  const cleaned = query
    .replace(/^(can you|could you|please|i want you to|i need you to|help me)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  // Truncate to 100 chars
  return cleaned.length > 100 ? cleaned.slice(0, 100) + "..." : cleaned;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Resolve a user query to a SkillPath.
 *
 * This is the Phase B (type-time) traversal — called as the user types
 * or when a message is sent. Results are cached for 30 seconds.
 *
 * @param query - The user's message text
 * @returns A SkillPath with focused tools, domains, and system prompts
 */
export async function resolveSkillPath(query: string): Promise<SkillPath> {
  // 1. Greeting detection → fallback to general
  if (isGreeting(query)) {
    return buildFallbackPath(query);
  }

  // 2. Cache check
  const cached = getCachedPath(query);
  if (cached) {
    return cached;
  }

  // 3. Check if graph is ready
  const domainNodes = skillGraph.getDomainNodes();
  if (domainNodes.length === 0) {
    // Graph not built yet — return fallback with all tools
    console.warn("[Resolver] Graph not ready, using fallback");
    return buildFallbackPath(query);
  }

  // 4. Embed the user query
  const queryEmb = await embed(query);

  // 5. Score domains
  const domainScores = scoreDomains(queryEmb);

  // 6. Select top-K domains + apply guarantees
  const selectedDomains = selectDomains(domainScores);

  // 7. Score tools within selected domains
  const toolScores = scoreTools(
    queryEmb,
    selectedDomains.map((d) => d.domainId),
  );

  // 8. Apply adaptive cutoff
  const selectedTools = applyCutoff(toolScores);

  // 9. Build the SkillPath
  const primaryDomain = selectedDomains[0]?.domain || "general";
  const secondaryDomains = selectedDomains
    .slice(1)
    .map((d) => d.domain)
    .filter((d) => d !== primaryDomain);

  const executionMode = detectExecutionMode(query, primaryDomain);
  const stepBudget = getStepBudget(executionMode, primaryDomain);

  // Collect system prompt fragments from selected domains
  const systemPromptFragments: string[] = [];
  for (const domain of selectedDomains) {
    const pack = PACK_BY_DOMAIN[domain.domain];
    if (pack?.systemPrompt) {
      systemPromptFragments.push(pack.systemPrompt);
    }
  }

  // Compute overall confidence (average of top domain scores)
  const confidence = selectedDomains.length > 0
    ? selectedDomains.reduce((sum, d) => sum + d.netScore, 0) / selectedDomains.length
    : 0;

  const skillPath: SkillPath = {
    tools: selectedTools.map((t) => t.toolName),
    primaryDomain,
    secondaryDomains,
    executionMode,
    stepBudget,
    confidence: Math.min(1, Math.max(0, confidence)),
    systemPromptFragments,
    isRecurring: false,
    goal: extractGoal(query),
  };

  // 10. Post-routing validation (Tier 1: schedule detection, Tier 2: LLM disambiguation)
  const validatedPath = await applyPostRoutingValidation(
    skillPath,
    query,
    domainScores.map((d) => ({ domain: d.domain, score: d.netScore })),
  );

  // 11. Cache and return
  setCachedPath(query, validatedPath);

  console.log(
    `[Resolver] "${query.slice(0, 40)}..." → ${validatedPath.primaryDomain}` +
    (validatedPath.secondaryDomains.length > 0 ? ` + ${validatedPath.secondaryDomains.join(", ")}` : "") +
    ` | ${validatedPath.tools.length} tools | conf=${validatedPath.confidence.toFixed(2)} | mode=${validatedPath.executionMode}` +
    (validatedPath.isRecurring ? " [recurring]" : ""),
  );

  return validatedPath;
}

// ─── Domain Selection with Guarantees ────────────────────────────────

/**
 * Select domains from scored list with guarantees:
 * - Take top-K domains that score above MIN_DOMAIN_SCORE
 * - OS is always included (primitive guarantee)
 * - Web is injected when primary is research/business/creative
 */
function selectDomains(scores: DomainScore[]): DomainScore[] {
  const selected: DomainScore[] = [];
  const selectedNames = new Set<string>();

  // Take top-K scoring domains
  for (const score of scores) {
    if (selected.length >= MAX_DOMAINS) break;
    if (score.netScore < MIN_DOMAIN_SCORE && selected.length > 0) break;
    if (score.tier === "fallback") continue; // Don't select general as a domain

    selected.push(score);
    selectedNames.add(score.domain);
  }

  // Guarantee: OS always included
  if (!selectedNames.has("os")) {
    const osScore = scores.find((s) => s.domain === "os");
    if (osScore) {
      selected.push(osScore);
      selectedNames.add("os");
    }
  }

  // Guarantee: Web injected for research/business/creative
  const primaryDomain = selected[0]?.domain;
  if (primaryDomain && WEB_INJECTION_DOMAINS.has(primaryDomain) && !selectedNames.has("web")) {
    const webScore = scores.find((s) => s.domain === "web");
    if (webScore) {
      selected.push(webScore);
      selectedNames.add("web");
    }
  }

  return selected;
}

// ─── Fallback Path ───────────────────────────────────────────────────

/**
 * Build a fallback SkillPath for greetings, trivial queries,
 * or when the graph isn't ready.
 */
function buildFallbackPath(query: string): SkillPath {
  // Include all implemented tools from OS pack at minimum
  const osPack = PACK_BY_DOMAIN["os"];
  const tools = osPack ? osPack.tools.map((t) => t.name) : [];

  return {
    tools,
    primaryDomain: "general",
    secondaryDomains: [],
    executionMode: "stream",
    stepBudget: 3,
    confidence: 0,
    systemPromptFragments: [
      PACK_BY_DOMAIN["general"]?.systemPrompt || "",
    ].filter(Boolean),
    isRecurring: false,
    goal: extractGoal(query),
  };
}

// ─── Lifecycle ───────────────────────────────────────────────────────

/** Clear the path resolution cache. */
export function clearPathCache(): void {
  pathCache.clear();
}

/** Get cache statistics. */
export function getPathCacheStats(): { size: number; maxSize: number; ttlMs: number } {
  return { size: pathCache.size, maxSize: CACHE_MAX_SIZE, ttlMs: CACHE_TTL };
}

/**
 * Get a human-readable routing label for UI display.
 * e.g., "🧠 Code" or "🧠 Research + Web"
 */
export function getRoutingLabel(path: SkillPath): string {
  const primary = capitalize(path.primaryDomain);
  if (path.secondaryDomains.length === 0) {
    return `🧠 ${primary}`;
  }
  const secondary = path.secondaryDomains.map(capitalize).join(" + ");
  return `🧠 ${primary} + ${secondary}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
