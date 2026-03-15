/**
 * Thread Digest — L0/L1 Memory Nodes for Conversations
 *
 * When a user navigates away from a thread, this module:
 *   1. Extracts a compact L0 abstract (~30 tokens) from the conversation
 *   2. Extracts a structured L1 overview (~200 tokens) of key topics/decisions
 *   3. Writes both to NCF as a thread memory node
 *
 * Extraction strategy:
 *   - If a model is provided: single LLM call to distill L0+L1 (higher quality)
 *   - Fallback: heuristic extraction (zero cost, instant)
 *
 * These get injected into the agent's context when recall mode is active,
 * giving the agent awareness of conversations from other threads.
 *
 * Storage: ~/.niom/context/agent/memories/threads/<thread-id>/
 *   ├── .abstract.md   (L0)
 *   ├── .overview.md    (L1)
 *   └── .meta.json      (metadata)
 */

import * as fs from "fs";
import { generateText } from "ai";
import type { LanguageModel } from "ai";
import { ensureDir, writeL0, writeL1, updateMeta, ncfResolve, updateL0IndexEntry } from "./ncf";
import type { Thread } from "@/shared/types";

// ─── Types ───────────────────────────────────────────────────────────

export interface ThreadDigest {
  threadId: string;
  title: string;
  l0: string;
  l1: string;
  messageCount: number;
  updatedAt: number;
}

// ─── Constants ───────────────────────────────────────────────────────

const THREADS_MEMORY_PATH = "agent/memories/threads";

/** Minimum messages before a thread is worth digesting. */
const MIN_MESSAGES_FOR_DIGEST = 3;

/** Max conversation characters to feed to LLM (~2K tokens). */
const MAX_CONVERSATION_CHARS = 6000;

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Write or update a thread's digest in the NCF.
 * Called when user navigates away from a thread.
 *
 * Skips threads that are too short (< 3 messages) or haven't changed
 * since the last digest.
 *
 * @param thread - The thread to digest
 * @param model - Optional LLM for higher-quality distillation
 */
export async function writeThreadDigest(thread: Thread, model?: LanguageModel): Promise<void> {
  // Skip trivial threads
  if (thread.messages.length < MIN_MESSAGES_FOR_DIGEST) {
    return;
  }

  const ncfPath = `${THREADS_MEMORY_PATH}/${thread.id}`;
  const metaFile = ncfResolve(ncfPath, ".meta.json");

  // Check if digest is stale — skip if thread hasn't been updated since last digest
  if (fs.existsSync(metaFile)) {
    try {
      const existingMeta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
      if (existingMeta.threadUpdatedAt >= thread.updatedAt) {
        return; // Already up to date
      }
    } catch {
      // Corrupted meta, re-digest
    }
  }

  // Build a lightweight conversation transcript for extraction
  const transcript = buildTranscript(thread);

  // Try LLM distillation first, fall back to heuristic
  let l0: string;
  let l1: string;

  if (model) {
    try {
      const llmResult = await distillThreadWithLLM(thread.title, transcript, model);
      l0 = llmResult.l0;
      l1 = llmResult.l1;
      console.log(`[thread-digest] LLM distillation succeeded for thread ${thread.id}`);
    } catch (error) {
      console.warn("[thread-digest] LLM distillation failed, using heuristic:", error);
      l0 = extractL0(thread);
      l1 = extractL1(thread);
    }
  } else {
    l0 = extractL0(thread);
    l1 = extractL1(thread);
  }

  // Write to NCF
  ensureDir(ncfPath);
  writeL0(ncfPath, l0);
  writeL1(ncfPath, l1);

  // Write metadata
  updateMeta(ncfPath, {
    createdAt: thread.createdAt,
    layersUpdatedAt: Date.now(),
    source: "thread",
    category: "conversation",
    threadTitle: thread.title,
    messageCount: thread.messages.length,
    threadUpdatedAt: thread.updatedAt,
  });

  // Update L0 index for retrieval
  updateL0IndexEntry(ncfPath, l0);

  console.log(`[thread-digest] Written digest for thread "${thread.title}" (${thread.id}) | L0: ${l0.length} chars, L1: ${l1.length} chars`);
}

// ─── Read Digests ───────────────────────────────────────────────────

/**
 * Read all thread digests, optionally excluding a specific threadId.
 * Returns compact digest objects for context injection.
 *
 * @param excludeThreadId - Thread to exclude (current thread — already has full context)
 */
export function readThreadDigests(excludeThreadId?: string): ThreadDigest[] {
  const threadsDir = ncfResolve(THREADS_MEMORY_PATH);
  if (!fs.existsSync(threadsDir)) return [];

  const entries = fs.readdirSync(threadsDir, { withFileTypes: true });
  const digests: ThreadDigest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    // Skip the current thread — it already has full conversation context
    if (excludeThreadId && entry.name === excludeThreadId) continue;

    const metaFile = ncfResolve(THREADS_MEMORY_PATH, entry.name, ".meta.json");

    if (!fs.existsSync(metaFile)) continue;

    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));

      // Read L0 abstract
      const l0File = ncfResolve(THREADS_MEMORY_PATH, entry.name, ".abstract.md");
      const l0 = fs.existsSync(l0File) ? fs.readFileSync(l0File, "utf-8").trim() : "";

      // Read L1 overview
      const l1File = ncfResolve(THREADS_MEMORY_PATH, entry.name, ".overview.md");
      const l1 = fs.existsSync(l1File) ? fs.readFileSync(l1File, "utf-8").trim() : "";

      if (!l0) continue; // Skip threads without abstracts

      digests.push({
        threadId: entry.name,
        title: meta.threadTitle || "",
        l0,
        l1,
        messageCount: meta.messageCount || 0,
        updatedAt: meta.layersUpdatedAt || 0,
      });
    } catch {
      // Skip corrupted entries
    }
  }

  // Most recent first
  digests.sort((a, b) => b.updatedAt - a.updatedAt);
  return digests;
}

// ─── LLM Distillation ───────────────────────────────────────────────

/**
 * Use a lightweight LLM call to distill L0 and L1 from a conversation.
 * Single call, structured output as JSON.
 */
async function distillThreadWithLLM(
  title: string,
  transcript: string,
  model: LanguageModel,
): Promise<{ l0: string; l1: string }> {
  const { text } = await generateText({
    model,
    prompt: `You are a knowledge management system. Given a conversation thread title and transcript, produce a two-tier summary for future context injection into other conversations.

Thread: "${title}"

Transcript:
${transcript}

Respond with ONLY valid JSON in this exact format:
{
  "l0": "A single sentence (max 40 words) that captures what was discussed and any key decisions, discoveries, or outcomes.",
  "l1": "A structured overview (max 150 words) with the most important topics covered, decisions made, code artifacts created, and open questions. Use bullet points. Skip meta-commentary."
}`,
    temperature: 0.1,
    maxOutputTokens: 400,
  });

  // Parse the JSON response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("LLM response did not contain valid JSON");
  }

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.l0 || !parsed.l1) {
    throw new Error("LLM response missing l0 or l1 fields");
  }

  return { l0: parsed.l0, l1: parsed.l1 };
}

// ─── Transcript Builder ─────────────────────────────────────────────

/**
 * Build a compact transcript from a thread's messages.
 * Prioritizes recent messages within a character budget.
 */
function buildTranscript(thread: Thread): string {
  const lines: string[] = [];
  let totalChars = 0;

  // Build from the END — most recent messages are most important
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const msg = thread.messages[i];
    const role = msg.role === "user" ? "User" : "Assistant";
    let content = msg.content;

    // Truncate individual messages that are too long
    if (content.length > 800) {
      content = content.slice(0, 800) + " [...]";
    }

    const line = `${role}: ${content}`;
    totalChars += line.length;

    if (totalChars > MAX_CONVERSATION_CHARS) break;
    lines.unshift(line);
  }

  if (lines.length < thread.messages.length) {
    return `[${thread.messages.length - lines.length} earlier messages omitted]\n\n` + lines.join("\n\n");
  }

  return lines.join("\n\n");
}

// ─── L0 Heuristic Extraction ────────────────────────────────────────

/**
 * Extract L0 abstract from a thread using heuristics.
 * Strategy: title + first user message intent + last assistant summary.
 */
function extractL0(thread: Thread): string {
  const parts: string[] = [];

  // Thread title
  const title = thread.title.length > 60
    ? thread.title.slice(0, 60) + "…"
    : thread.title;
  parts.push(`Thread: "${title}"`);

  // Last assistant message — often contains the conclusion
  const lastAssistant = [...thread.messages].reverse().find((m) => m.role === "assistant");
  if (lastAssistant) {
    // Extract first sentence of last assistant response
    const firstSentence = lastAssistant.content
      .split(/[.!?]\s/)[0]
      ?.trim()
      .slice(0, 100);
    if (firstSentence && firstSentence.length > 10) {
      parts.push(firstSentence);
    }
  }

  return parts.join(" — ");
}

// ─── L1 Heuristic Extraction ────────────────────────────────────────

/**
 * Extract L1 overview from a thread using heuristics.
 * Strategy: Extract user intents + assistant key points.
 */
function extractL1(thread: Thread): string {
  const points: string[] = [];

  // Extract key topics from user messages
  const userMessages = thread.messages.filter((m) => m.role === "user");
  for (const msg of userMessages.slice(0, 5)) {
    const content = msg.content.trim();
    if (content.length < 10) continue;

    // Take first line or first sentence
    const firstLine = content.split("\n")[0].trim();
    if (firstLine.length > 120) {
      points.push(`- User asked: "${firstLine.slice(0, 120)}…"`);
    } else {
      points.push(`- User asked: "${firstLine}"`);
    }
  }

  // Extract key conclusions from assistant messages
  const assistantMessages = thread.messages.filter((m) => m.role === "assistant");
  const lastFew = assistantMessages.slice(-3);

  for (const msg of lastFew) {
    // Look for bullet points, headers, or key findings
    const lines = msg.content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      // Capture markdown headers and bullet points with substance
      if ((trimmed.startsWith("##") || trimmed.startsWith("- ") || trimmed.startsWith("* ")) && trimmed.length > 15) {
        const clean = trimmed.replace(/^[#*\- ]+/, "").trim();
        if (clean.length > 10 && points.length < 8) {
          points.push(`- ${clean.slice(0, 120)}`);
        }
      }
    }
  }

  if (points.length === 0) return "";
  return points.slice(0, 8).join("\n");
}
