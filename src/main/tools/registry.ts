/**
 * Tool Registry
 *
 * Central registry mapping tool names → AI SDK v6 tool definitions.
 * Each tool carries its pack metadata for the Skill Tree to consume.
 *
 * Consolidated primitives:
 *   read    → file + directory reading (auto-detects)
 *   write   → file creation/modification
 *   search  → web search
 *   crawl   → web page content extraction
 *   run     → shell command execution
 *   system  → system info
 *   propose → artifact preview
 */

import { readTool } from "./read";
import { systemInfoTool } from "./system-info";
import { writeFileTool } from "./write-file";
import { runCommandTool } from "./run-command";
import { webSearchTool } from "./web-search";
import { crawlTool } from "./crawl";
import { proposeArtifactTool } from "./propose-artifact";
import { steerTaskTool } from "./steer-task";

// ─── Metadata per tool (for Skill Tree integration) ─────────────────

export interface ToolRegistryEntry {
  /** The AI SDK tool definition (with execute function). `any` due to varying schemas. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: any;
  /** Which domain/pack this tool belongs to */
  domain: string;
  /** Human-readable name for display */
  displayName: string;
  /** Whether this tool is currently implemented and available */
  implemented: boolean;
}

// ─── Registry ────────────────────────────────────────────────────────

/**
 * All registered tools. Keyed by tool name (matching pack declarations).
 *
 * Consolidated from 8 thin tools to 7 broader primitives.
 * The LLM sees fewer, more capable tools — reducing confusion and
 * enabling self-correction within a single tool (e.g. read auto-detects
 * file vs directory).
 */
export const TOOL_REGISTRY: Record<string, ToolRegistryEntry> = {
  // ── OS primitives ──────────────────────────────────────────────
  read: {
    tool: readTool,
    domain: "os",
    displayName: "Read",
    implemented: true,
  },
  write: {
    tool: writeFileTool,
    domain: "os",
    displayName: "Write File",
    implemented: true,
  },
  run: {
    tool: runCommandTool,
    domain: "os",
    displayName: "Run Command",
    implemented: true,
  },
  system: {
    tool: systemInfoTool,
    domain: "os",
    displayName: "System Info",
    implemented: true,
  },
  propose: {
    tool: proposeArtifactTool,
    domain: "os",
    displayName: "Propose Artifact",
    implemented: true,
  },

  // ── Web primitives ─────────────────────────────────────────────
  search: {
    tool: webSearchTool,
    domain: "web",
    displayName: "Web Search",
    implemented: true,
  },
  crawl: {
    tool: crawlTool,
    domain: "web",
    displayName: "Crawl URL",
    implemented: true,
  },

  // ── Task interaction ────────────────────────────────────────────
  steer_task: {
    tool: steerTaskTool,
    domain: "personal",
    displayName: "Steer Task",
    implemented: true,
  },

  // ── Stubs (future) ─────────────────────────────────────────────
  screenshot: {
    tool: null,
    domain: "computer-use",
    displayName: "Screenshot",
    implemented: false,
  },
  deepResearch: {
    tool: null,
    domain: "research",
    displayName: "Deep Research",
    implemented: false,
  },
  notifyUser: {
    tool: null,
    domain: "personal",
    displayName: "Notify User",
    implemented: false,
  },
};

// ─── Legacy Name Aliases ─────────────────────────────────────────────
// Skill packs may still reference old names. Map them to new names.
const LEGACY_ALIASES: Record<string, string> = {
  readFile: "read",
  listDirectory: "read",
  writeFile: "write",
  runCommand: "run",
  systemInfo: "system",
  proposeArtifact: "propose",
  webSearch: "search",
  fetchUrl: "crawl",
};

// ─── Query Functions ─────────────────────────────────────────────────

/**
 * Get only the implemented tools, ready for injection into streamText().
 * Returns a record of name → AI SDK tool definition.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getImplementedTools(): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};
  for (const [name, entry] of Object.entries(TOOL_REGISTRY)) {
    if (entry.implemented && entry.tool) {
      tools[name] = entry.tool;
    }
  }
  return tools;
}

/**
 * Get implemented tools filtered by a list of tool names.
 * Handles legacy name aliases automatically.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getToolsByNames(names: string[]): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};
  const seen = new Set<string>();

  for (const name of names) {
    // Resolve legacy alias
    const resolved = LEGACY_ALIASES[name] || name;
    if (seen.has(resolved)) continue;
    seen.add(resolved);

    const entry = TOOL_REGISTRY[resolved];
    if (entry?.implemented && entry.tool) {
      tools[resolved] = entry.tool;
    }
  }
  return tools;
}

/**
 * Get all implemented tool names.
 */
export function getImplementedToolNames(): string[] {
  return Object.entries(TOOL_REGISTRY)
    .filter(([, entry]) => entry.implemented)
    .map(([name]) => name);
}

/**
 * Get tools for a specific domain.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getToolsByDomain(domain: string): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};
  for (const [name, entry] of Object.entries(TOOL_REGISTRY)) {
    if (entry.domain === domain && entry.implemented && entry.tool) {
      tools[name] = entry.tool;
    }
  }
  return tools;
}
