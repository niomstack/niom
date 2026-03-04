/**
 * Skill Pack type definitions.
 *
 * A Skill Pack is a domain-specific bundle that transforms NIOM's
 * general-purpose agent into a domain expert. Each pack contains:
 *   - A system prompt fragment (personality + instructions)
 *   - A subset of tools relevant to the domain
 *   - An evaluation rubric for quality assessment
 *   - Optional few-shot examples
 *
 * Follows Anthropic's Agent Skills specification format:
 *   SKILL.md = YAML frontmatter + markdown body
 */

import type { Tool } from "ai";

// ── Domain Types ──

export type SkillDomain =
    | "code"
    | "research"
    | "business"
    | "creative"
    | "personal"
    | "general";

export const SKILL_DOMAINS: SkillDomain[] = [
    "code",
    "research",
    "business",
    "creative",
    "personal",
    "general",
];

// ── Skill Pack ──

export interface SkillPack {
    /** Unique skill pack ID (e.g., "code", "research") */
    id: string;
    /** Human-readable name (e.g., "Code", "Research") */
    name: string;
    /** Short description of what this pack does */
    description: string;
    /** Primary domain this pack serves */
    domain: SkillDomain;
    /** System prompt fragment — personality + behavioral instructions (markdown) */
    systemPrompt: string;
    /** Tool IDs this pack uses (subset of all available tools) */
    toolIds: string[];
    /** Quality evaluation rubric (used by evaluate-refine loop) */
    evalRubric?: string;
    /** Few-shot examples for the model */
    examples?: string[];
    /** Whether this pack is currently enabled */
    enabled: boolean;
    /** Source: built-in vs user-installed */
    source: "builtin" | "installed";
    /** File path to the SKILL.md (if loaded from disk) */
    path?: string;
}

// ── Resolved Skill Pack (with actual tool instances) ──

export interface ResolvedSkillPack extends SkillPack {
    /** Resolved tool instances (populated by the router) */
    tools: Record<string, Tool>;
}

// ── SKILL.md Manifest (parsed from YAML frontmatter) ──

export interface SkillManifest {
    name: string;
    description: string;
    domain: SkillDomain;
    toolIds: string[];
    evalRubric?: string;
}
