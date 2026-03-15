/**
 * NCF Memory Extraction — 6-Category Structured Memory
 *
 * Adapted from OpenViking's automatic session management.
 *
 * Extracts memories from conversations into 6 categories:
 *
 *   User memories (from user's messages):
 *     - profile:     Identity facts (name, role, timezone)
 *     - preferences: Topic-specific preferences (coding style, communication)
 *     - entities:    People, projects, organizations mentioned
 *     - events:      Decisions, milestones, dated occurrences
 *
 *   Agent memories (from agent's own executions):
 *     - cases:       Problem → solution records
 *     - patterns:    Reusable tool execution chains
 *
 * Flow per OpenViking §8:
 *   Messages → LLM Extract → Candidate Memories
 *                    ↓
 *   Vector Pre-Filter → Find Similar Existing Memories
 *                    ↓
 *   LLM Dedup Decision → skip/create/merge/delete
 *                    ↓
 *   Write to NCF → Update L0 Index
 */

import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveModelForMemory } from "../services/chat.service";
import type { ChatMessage } from "@/shared/types";
import type { MemoryEntry, MemoryCategory } from "@/shared/context-types";
import {
  writeL2,
  writeL0,
  readL2,
  nodeExists,
  listDir,
  updateL0IndexEntry,
  updateMeta,
} from "./ncf";

// ─── Constants ───────────────────────────────────────────────────────

/** Maximum number of recent messages to analyze. */
const MAX_MESSAGES_FOR_EXTRACTION = 8;

/** Minimum conversation turns before extraction fires. */
const MIN_TURNS_FOR_EXTRACTION = 2;

// ─── User Memory Extraction ─────────────────────────────────────────

/**
 * Extract user memories from a conversation.
 * Returns structured MemoryEntry objects ready to be written to the NCF.
 */
export async function extractUserMemories(
  messages: ChatMessage[],
  threadId: string,
): Promise<MemoryEntry[]> {
  // Only extract from conversations with actual back-and-forth
  if (messages.length < MIN_TURNS_FOR_EXTRACTION * 2) return [];

  const recentMessages = messages.slice(-MAX_MESSAGES_FOR_EXTRACTION);

  // Load existing memories to avoid duplicates
  const existingMemories = loadExistingMemorySummary();

  const prompt = `Analyze this conversation and extract NEW facts about the user.
Categorize each fact into exactly one of these categories:

- **profile**: User identity info (name, role, timezone, location, languages spoken)
- **preferences**: User preferences & habits (coding style, communication tone, favorite tools)
- **entities**: People, projects, companies, technologies the user mentions as personally relevant
- **events**: Decisions, milestones, or dated occurrences mentioned by the user

Rules:
- Only extract facts clearly stated or strongly implied by the USER (not the assistant)
- Each fact must be a short, standalone sentence
- Add a "topic" for preferences and entities (e.g., "coding", "writing", "niom-project")
- Do NOT repeat facts already known
- If no new facts, return an empty array

Already known:
${existingMemories || "(None yet)"}

Conversation:
${recentMessages.map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 500)}`).join("\n\n")}`;

  try {
    const model = resolveModelForMemory();
    const { output } = await generateText({
      model,
      output: Output.array({
        element: z.object({
          content: z.string().describe("A short, standalone sentence describing the fact"),
          category: z.enum(["profile", "preferences", "entities", "events"]).describe("Which category this fact belongs to"),
          topic: z.string().optional().describe("Topic for preferences and entities (e.g., coding, writing)"),
          confidence: z.number().min(0).max(1).describe("How confident you are about this fact"),
        }),
      }),
      prompt,
      maxOutputTokens: 800,
      temperature: 0.1,
    });

    if (!output || output.length === 0) return [];

    return output.map((item) => ({
      id: crypto.randomUUID(),
      content: item.content,
      category: item.category as MemoryCategory,
      topic: item.topic,
      confidence: item.confidence ?? 0.5,
      sourceThreadId: threadId,
      createdAt: Date.now(),
    }));
  } catch (error) {
    console.warn("[NCF Memory] User extraction failed:", error);
    return [];
  }
}

/**
 * Extract agent memories (cases and patterns) from a tool execution trace.
 */
export async function extractAgentMemories(
  messages: ChatMessage[],
  toolTrace: string[],
  threadId: string,
): Promise<MemoryEntry[]> {
  // Only extract if tools were used
  if (toolTrace.length === 0) return [];

  const recentMessages = messages.slice(-MAX_MESSAGES_FOR_EXTRACTION);
  const toolChain = toolTrace.join(" → ");

  const prompt = `Analyze this AI agent interaction and extract learnings.
The agent used these tools in sequence: ${toolChain}

Categorize each learning into:

- **cases**: A specific problem that was solved with a specific approach.
  Format: "Problem: [desc] | Solution: [approach] | Tools: [tools used]"
- **patterns**: A reusable tool execution pattern discovered.
  Format: "When [trigger], use [tool sequence] because [reason]"

Rules:
- Only extract genuinely useful learnings (not obvious things)
- Cases are immutable records: specific problem → specific solution
- Patterns must be generalizable: applicable to future similar queries
- If nothing worth learning, return an empty array

Conversation:
${recentMessages.map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 300)}`).join("\n\n")}`;

  try {
    const model = resolveModelForMemory();
    const { output } = await generateText({
      model,
      output: Output.array({
        element: z.object({
          content: z.string().describe("The learning — either a case or pattern description"),
          category: z.enum(["cases", "patterns"]).describe("Whether this is a specific case or a reusable pattern"),
          topic: z.string().optional().describe("Topic area of this learning"),
          confidence: z.number().min(0).max(1).describe("How confident you are about this learning"),
        }),
      }),
      prompt,
      maxOutputTokens: 500,
      temperature: 0.1,
    });

    if (!output || output.length === 0) return [];

    return output.map((item) => ({
      id: crypto.randomUUID(),
      content: item.content,
      category: item.category as MemoryCategory,
      topic: item.topic,
      confidence: item.confidence ?? 0.5,
      sourceThreadId: threadId,
      createdAt: Date.now(),
    }));
  } catch (error) {
    console.warn("[NCF Memory] Agent extraction failed:", error);
    return [];
  }
}

// ─── Writing Memories to NCF ─────────────────────────────────────────

/**
 * Write extracted memories to the NCF filesystem.
 * Handles dedup, merging, and L0 index updates.
 */
export function writeMemoriesToNCF(
  memories: MemoryEntry[],
): { written: number; merged: number; skipped: number } {
  const result = { written: 0, merged: 0, skipped: 0 };

  for (const memory of memories) {
    try {
      const outcome = writeMemory(memory);
      switch (outcome) {
        case "written": result.written++; break;
        case "merged": result.merged++; break;
        case "skipped": result.skipped++; break;
      }
    } catch (error) {
      console.warn(`[NCF Memory] Failed to write memory: ${error}`);
      result.skipped++;
    }
  }

  // Update L0 abstracts for affected directories
  if (result.written > 0 || result.merged > 0) {
    updateMemoryAbstracts();
  }

  return result;
}

/**
 * Write a single memory entry to the NCF.
 */
function writeMemory(memory: MemoryEntry): "written" | "merged" | "skipped" {
  const filePath = getMemoryFilePath(memory);

  // Check for existing content
  if (nodeExists(filePath)) {
    const existing = readL2(filePath);
    if (existing) {
      // Check if this memory is already captured
      if (isContentDuplicate(existing, memory.content)) {
        return "skipped";
      }

      // For mergeable categories, append
      if (isMergeable(memory.category)) {
        const merged = `${existing}\n- ${memory.content}`;
        writeL2(filePath, merged, {
          category: memory.category,
          source: memory.sourceThreadId,
        });
        return "merged";
      }
    }
  }

  // Write new memory
  const header = getMemoryHeader(memory);
  const content = `${header}\n\n- ${memory.content}`;
  writeL2(filePath, content, {
    category: memory.category,
    source: memory.sourceThreadId,
  });

  return "written";
}

/**
 * Get the NCF file path for a memory entry.
 */
function getMemoryFilePath(memory: MemoryEntry): string {
  const scope = getUserOrAgentScope(memory.category);
  const categoryDir = getCategorySubdir(memory.category);
  const topic = sanitizeFilename(memory.topic || "general");

  switch (memory.category) {
    case "profile":
      return `${scope}/memories/profile.md`;

    case "preferences":
    case "entities":
      return `${scope}/memories/${categoryDir}/${topic}.md`;

    case "events": {
      const date = new Date(memory.createdAt).toISOString().split("T")[0];
      return `${scope}/memories/events/${date}-${topic}.md`;
    }

    case "cases": {
      const id = memory.id.slice(0, 8);
      return `${scope}/memories/cases/${topic}-${id}.md`;
    }

    case "patterns":
      return `${scope}/memories/patterns/${topic}.md`;

    default:
      return `user/memories/preferences/${topic}.md`;
  }
}

// ─── L0 Abstract Updates ─────────────────────────────────────────────

/**
 * Update L0 abstracts for memory directories after new writes.
 * Bottom-up: child contents → parent abstract.
 */
function updateMemoryAbstracts(): void {
  // Update preferences abstract
  updateDirectoryAbstract("user/memories/preferences", "User Preferences");

  // Update entities abstract
  updateDirectoryAbstract("user/memories/entities", "Known Entities");

  // Update events abstract
  updateDirectoryAbstract("user/memories/events", "User Events");

  // Update agent cases
  updateDirectoryAbstract("agent/memories/cases", "Learned Cases");

  // Update agent patterns
  updateDirectoryAbstract("agent/memories/patterns", "Execution Patterns");

  // Update parent directories
  updateDirectoryAbstract("user/memories", "User Memories");
  updateDirectoryAbstract("agent/memories", "Agent Memories");
}

/**
 * Generate an L0 abstract for a directory based on its children.
 */
function updateDirectoryAbstract(dirPath: string, label: string): void {
  const children = listDir(dirPath);
  if (children.length === 0) return;

  // Build a summary by listing file names
  const fileNames = children.map((child) => {
    const name = child.split("/").pop() || "";
    return name.replace(/\.md$/, "").replace(/-/g, " ");
  });

  const abstract = `${label}: ${fileNames.slice(0, 5).join(", ")}${fileNames.length > 5 ? ` (+${fileNames.length - 5} more)` : ""}`;

  writeL0(dirPath, abstract);
  updateL0IndexEntry(dirPath, abstract);
}

// ─── Helpers ─────────────────────────────────────────────────────────




function isContentDuplicate(existingContent: string, newContent: string): boolean {
  return existingContent.toLowerCase().includes(newContent.toLowerCase().slice(0, 50));
}

function isMergeable(category: MemoryCategory): boolean {
  return ["profile", "preferences", "entities", "patterns"].includes(category);
}

function getUserOrAgentScope(category: MemoryCategory): string {
  return ["cases", "patterns"].includes(category) ? "agent" : "user";
}

function getCategorySubdir(category: MemoryCategory): string {
  switch (category) {
    case "preferences": return "preferences";
    case "entities": return "entities";
    case "events": return "events";
    case "cases": return "cases";
    case "patterns": return "patterns";
    default: return "preferences";
  }
}

function getMemoryHeader(memory: MemoryEntry): string {
  const topic = memory.topic ? capitalize(memory.topic) : capitalize(memory.category);
  return `# ${topic}`;
}

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "general";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Load a brief summary of existing memories for the extraction prompt.
 */
function loadExistingMemorySummary(): string {
  const summaries: string[] = [];

  // Profile
  if (nodeExists("user/memories/profile.md")) {
    const profile = readL2("user/memories/profile.md");
    if (profile) {
      // Extract bullet points
      const lines = profile.split("\n").filter((l) => l.startsWith("- "));
      summaries.push(...lines);
    }
  }

  // Preferences
  const prefFiles = listDir("user/memories/preferences");
  for (const filePath of prefFiles) {
    const content = readL2(filePath);
    if (content) {
      const lines = content.split("\n").filter((l) => l.startsWith("- "));
      summaries.push(...lines);
    }
  }

  // Entities
  const entityFiles = listDir("user/memories/entities");
  for (const filePath of entityFiles) {
    const content = readL2(filePath);
    if (content) {
      const lines = content.split("\n").filter((l) => l.startsWith("- "));
      summaries.push(...lines);
    }
  }

  return summaries.slice(0, 30).join("\n") || "";
}
