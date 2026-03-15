/**
 * Post-Routing Validation — Two-Tier Validation for Edge Cases
 *
 * Per research paper §3.5:
 *
 *   Tier 1: Schedule Signal Detector
 *     - Regex-based temporal pattern matching (~0ms)
 *     - Detects recurring/scheduled queries: "every day", "remind me", etc.
 *     - Overrides executionMode to "background" and sets isRecurring=true
 *
 *   Tier 2: Intent Validator (LLM-based disambiguation)
 *     - Conditional LLM call for ambiguous queries
 *     - Fires when top-2 domains are within 0.1 of each other
 *     - Uses cheapest available model with structured output
 *     - Expected to fire on <20% of requests
 */

import { generateText, Output } from "ai";
import { z } from "zod";
import type { SkillPath } from "@/shared/skill-types";
import { resolveModelForMemory } from "../services/chat.service";
import { PACK_BY_DOMAIN } from "./builtin-packs";

// ─── Tier 1: Schedule Signal Detector ───────────────────────────────

/**
 * Temporal patterns that indicate a recurring/scheduled task.
 * Each pattern group is ordered by specificity.
 */
const SCHEDULE_PATTERNS: RegExp[] = [
  // Explicit recurrence
  /\bevery\s+(day|week|month|hour|morning|evening|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(daily|weekly|monthly|hourly|nightly)\b/i,
  /\b(each|every)\s+\d+\s+(minutes?|hours?|days?|weeks?)\b/i,
  /\b(at|every)\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/i,

  // Reminder / notification triggers
  /\bremind\s+me\b/i,
  /\bnotify\s+me\b/i,
  /\balert\s+me\b/i,
  /\blet\s+me\s+know\b/i,
  /\bping\s+me\b/i,

  // Scheduling verbs
  /\bschedule\s+(a|an|this|the|my)\b/i,
  /\bset\s+(a|an)\s+(reminder|alarm|timer|notification)\b/i,
  /\bcron\s+job\b/i,
  /\bautomate\s+(this|the)\b/i,

  // Time-relative patterns
  /\bin\s+\d+\s+(minutes?|hours?|days?|weeks?)\b/i,
  /\b(tomorrow|tonight|next\s+week|next\s+month)\b/i,

  // Recurring intent patterns
  /\bkeep\s+(checking|monitoring|watching|tracking)\b/i,
  /\bmonitor\s+(this|the|my)\b/i,
  /\bwatch\s+(for|this)\b/i,
  /\bcheck\s+(on|for)\s+.*\s+(regularly|periodically)\b/i,
];

/**
 * Detect schedule/recurring signals in the user's query.
 *
 * Returns:
 *   - null if no schedule signal detected
 *   - A description of the detected pattern if found
 *
 * Performance: Pure regex, ~0ms on typical queries.
 */
export function detectScheduleSignal(query: string): string | null {
  for (const pattern of SCHEDULE_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}

// ─── Tier 2: Intent Validator (LLM Disambiguation) ──────────────────

/** Schema for the structured LLM response. */
const intentValidationSchema = z.object({
  primaryDomain: z.string().describe(
    "The most appropriate domain for this query. Must be one of the provided domain options.",
  ),
  confidence: z.number().min(0).max(1).describe(
    "How confident you are in this classification (0.0-1.0).",
  ),
  reasoning: z.string().describe(
    "Brief explanation of why this domain was chosen over the alternative.",
  ),
});

/**
 * Check if the routing result is ambiguous enough to warrant
 * a secondary LLM validation call.
 *
 * Criteria (per paper §3.5):
 *   - Top-2 domain scores are within 0.1 of each other
 *   - OR query has multiple clauses (compound intent)
 *
 * Returns true if the intent validator should fire.
 */
export function isAmbiguousRouting(
  topDomainScores: Array<{ domain: string; score: number }>,
  query: string,
): boolean {
  if (topDomainScores.length < 2) return false;

  // Check if top-2 scores are within 0.1
  const scoreDiff = Math.abs(topDomainScores[0].score - topDomainScores[1].score);
  const isCloseScores = scoreDiff < 0.1;

  // Check for multi-clause queries (simple heuristic)
  const hasMultipleClauses =
    (query.includes(" and ") && query.length > 40) ||
    (query.includes(" then ") && query.length > 30) ||
    (query.split(/[.!?]/).filter((s) => s.trim().length > 10).length > 1);

  // Fire intent validator when scores are close OR query is complex with close scores
  // Slightly more permissive than before — close scores alone are enough
  return isCloseScores || (hasMultipleClauses && scoreDiff < 0.15);
}

/**
 * LLM-based intent validator for ambiguous routing.
 *
 * Uses the cheapest available model with structured output to disambiguate
 * when the embedding-based routing can't decide between top-2 domains.
 *
 * Expected to fire on <20% of requests. ~200ms latency.
 *
 * @param path - Current resolved SkillPath
 * @param query - User's query text
 * @param topDomains - Top-2+ domain candidates with scores
 * @returns Updated SkillPath with potentially corrected domain
 */
export async function validateIntentWithLLM(
  path: SkillPath,
  query: string,
  topDomains: Array<{ domain: string; score: number }>,
): Promise<SkillPath> {
  try {
    const model = resolveModelForMemory();
    const candidates = topDomains.slice(0, 3);

    // Build domain descriptions for the prompt
    const domainDescriptions = candidates
      .map((d) => {
        const pack = PACK_BY_DOMAIN[d.domain];
        const tools = pack?.tools?.map((t) => t.name).join(", ") || "general tools";
        return `- **${d.domain}** (score: ${d.score.toFixed(2)}): ${pack?.description || "General domain"}. Tools: ${tools}`;
      })
      .join("\n");

    const { output } = await generateText({
      model,
      output: Output.object({ schema: intentValidationSchema }),
      prompt: `You are a query classifier. Given a user query and candidate domains, determine which domain best fits the query's primary intent.

User query: "${query}"

Candidate domains (ranked by embedding similarity):
${domainDescriptions}

Choose the most appropriate domain. Consider:
1. What is the user's PRIMARY intent? (ignore secondary intents)
2. Which domain's tools would be most useful?
3. If the query involves code/files, "code" or "os" is likely correct.
4. If the query asks for information, "research" or "web" may be better.
5. If it's about creative writing/content, "creative" fits.`,
      maxOutputTokens: 150,
      temperature: 0,
    });

    if (!output?.primaryDomain) {
      return path; // Fallback to original routing
    }

    const resolvedDomain = output.primaryDomain.toLowerCase();

    // Only override if the LLM chose a different domain than the embedding router
    if (resolvedDomain !== path.primaryDomain) {
      // Verify the LLM's choice is actually one of our candidates
      const isValidDomain = candidates.some((d) => d.domain === resolvedDomain);
      if (!isValidDomain) {
        console.log(`[PostRouting T2] LLM suggested "${resolvedDomain}" but it's not a candidate. Keeping ${path.primaryDomain}`);
        return path;
      }

      console.log(
        `[PostRouting T2] LLM override: ${path.primaryDomain} → ${resolvedDomain} ` +
        `(confidence: ${output.confidence.toFixed(2)}, reason: "${output.reasoning}")`,
      );

      // Update the domain and its tools/prompts
      const pack = PACK_BY_DOMAIN[resolvedDomain];
      const newTools = pack?.tools?.map((t) => t.name) || path.tools;

      // Merge: keep some of the original tools but lead with the corrected domain's
      const mergedTools = [...new Set([...newTools, ...path.tools])].slice(0, 8);

      const systemPromptFragments = [
        pack?.systemPrompt,
        ...path.systemPromptFragments,
      ].filter(Boolean) as string[];

      return {
        ...path,
        primaryDomain: resolvedDomain,
        secondaryDomains: [
          path.primaryDomain, // Old primary becomes secondary
          ...path.secondaryDomains.filter((d) => d !== resolvedDomain),
        ],
        tools: mergedTools,
        systemPromptFragments,
        confidence: output.confidence,
      };
    }

    // LLM agrees with embedding router — boost confidence
    return {
      ...path,
      confidence: Math.min(1, Math.max(path.confidence, output.confidence)),
    };
  } catch (error) {
    console.warn("[PostRouting T2] Intent validation failed, keeping original routing:", error);
    return path; // Non-blocking — always fall back to embedding routing
  }
}

// ─── Combined Post-Routing Validation ───────────────────────────────

/**
 * Apply both tiers of post-routing validation to a SkillPath.
 *
 * This is called after the SkillPath is resolved but before
 * it's returned to the chat service.
 *
 * @param path - The resolved SkillPath
 * @param query - Original user query
 * @param domainScores - Domain scores for ambiguity detection
 * @returns Updated SkillPath (may be mutated by schedule detection or LLM override)
 */
export async function applyPostRoutingValidation(
  path: SkillPath,
  query: string,
  domainScores?: Array<{ domain: string; score: number }>,
): Promise<SkillPath> {
  // ── Tier 1: Schedule Signal Detection ──────────────────────────
  const scheduleMatch = detectScheduleSignal(query);
  if (scheduleMatch) {
    console.log(
      `[PostRouting] Schedule signal detected: "${scheduleMatch}" → overriding to background mode`,
    );
    return {
      ...path,
      executionMode: "background",
      isRecurring: true,
      stepBudget: Math.max(path.stepBudget, 15), // Background tasks need more steps
    };
  }

  // ── Tier 2: LLM Intent Validation (for ambiguous routing) ─────
  if (domainScores && isAmbiguousRouting(domainScores, query)) {
    console.log(
      `[PostRouting] Ambiguous routing detected (top-2 within 0.1). ` +
      `Domains: ${domainScores.slice(0, 2).map((d) => `${d.domain}:${d.score.toFixed(2)}`).join(" vs ")}. ` +
      `Firing Tier 2 LLM validation...`,
    );
    return validateIntentWithLLM(path, query, domainScores);
  }

  return path;
}
