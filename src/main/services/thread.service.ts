/**
 * Thread Service — Thread persistence and CRUD.
 *
 * Stores threads as individual JSON files under ~/.niom/threads/<id>.json.
 * Provides metadata-only listing for sidebar performance.
 * Includes LLM-powered title generation for descriptive thread names.
 */

import * as fs from "fs";
import * as path from "path";
import { generateText } from "ai";
import type { LanguageModel } from "ai";
import { PATHS } from "./config.service";
import type { Thread, ThreadMeta } from "@/shared/types";

// ─── CRUD ────────────────────────────────────────────────────────────

/** List all threads as metadata (no messages — fast for sidebar). Sorted by most recent first. */
export function listThreads(): ThreadMeta[] {
  const threadsDir = PATHS.THREADS_DIR;

  if (!fs.existsSync(threadsDir)) return [];

  const files = fs.readdirSync(threadsDir).filter((f) => f.endsWith(".json"));
  const metas: ThreadMeta[] = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(threadsDir, file), "utf-8");
      const thread = JSON.parse(raw) as Thread;
      metas.push({
        id: thread.id,
        title: thread.title,
        defaultModel: thread.defaultModel,
        messageCount: thread.messages.length,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        pinned: thread.pinned,
      });
    } catch {
      // Skip corrupted thread files silently
      console.warn(`[threads] Skipping corrupted thread file: ${file}`);
    }
  }

  // Pinned first, then by most recently updated
  metas.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.updatedAt - a.updatedAt;
  });

  return metas;
}

/** Get a full thread by ID (with messages). */
export function getThread(id: string): Thread | null {
  const filePath = threadPath(id);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Thread;
  } catch {
    console.warn(`[threads] Failed to read thread: ${id}`);
    return null;
  }
}

/** Save a thread (create or update). */
export function saveThread(thread: Thread): void {
  thread.updatedAt = Date.now();

  // Auto-generate title from first user message if empty (heuristic — fast)
  if (!thread.title || thread.title === "New Chat") {
    thread.title = generateThreadTitle(thread);
  }

  const filePath = threadPath(thread.id);
  fs.writeFileSync(filePath, JSON.stringify(thread, null, 2));
}

/** Delete a thread by ID. */
export function deleteThread(id: string): void {
  const filePath = threadPath(id);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function threadPath(id: string): string {
  // Sanitize ID to prevent path traversal
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(PATHS.THREADS_DIR, `${safeId}.json`);
}

/** Generate a short title from the first user message (heuristic — instant). */
function generateThreadTitle(thread: Thread): string {
  const firstUserMessage = thread.messages.find((m) => m.role === "user");
  if (!firstUserMessage) return "New Chat";

  const text = firstUserMessage.content.trim();

  // If it's a short message, use it directly
  if (text.length <= 50) return text;

  // Truncate at word boundary
  const truncated = text.slice(0, 50);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + "…";
}

// ─── LLM Title Generation ───────────────────────────────────────────

/**
 * Generate a descriptive thread title using an LLM.
 * Uses the first few messages to produce a concise 3-7 word title.
 * Returns null if it can't generate (caller should keep heuristic title).
 */
export async function generateLLMTitle(
  thread: Thread,
  model: LanguageModel,
): Promise<string | null> {
  // Need at least 2 messages for meaningful context
  if (thread.messages.length < 2) return null;

  // Use first 4 messages max (enough context, minimal tokens)
  const contextMessages = thread.messages.slice(0, 4);
  const transcript = contextMessages
    .map((m) => {
      const content = typeof m.content === "string"
        ? m.content
        : (m.parts?.find((p: any) => p.type === "text") as any)?.text || "";
      const truncated = content.length > 200 ? content.slice(0, 200) + "…" : content;
      return `${m.role}: ${truncated}`;
    })
    .join("\n");

  try {
    const { text } = await generateText({
      model,
      system: "Generate a concise thread title (3-7 words) that captures the topic. No quotes, no periods, no prefixes. Just the title. Examples: 'Debugging React Router Issues', 'Market Research for SaaS', 'Setting Up CI Pipeline'.",
      prompt: transcript,
      maxOutputTokens: 20,
    });

    const title = text.trim().replace(/^["']|["']$/g, "").replace(/\.$/, "");

    // Validate: reasonable length, not empty
    if (title.length >= 3 && title.length <= 80) {
      return title;
    }

    return null;
  } catch (error) {
    console.warn("[threads] LLM title generation failed:", error);
    return null;
  }
}
