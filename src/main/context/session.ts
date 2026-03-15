/**
 * NCF Session Commit — Thread Archival & Memory Extraction
 *
 * Per OpenViking §8, on thread completion:
 *   1. Archive messages as compressed session file
 *   2. LLM-generate structured summary → .abstract.md + .overview.md
 *   3. Extract candidate memories (user + agent)
 *   4. Write to NCF + update L0 index
 *
 * Sessions are stored under sessions/<threadId>/
 * with .abstract.md, .overview.md, and messages.json.
 */

import { generateText, Output } from "ai";
import { z } from "zod";
import { resolveModelForMemory } from "../services/chat.service";
import type { ChatMessage } from "@/shared/types";
import type { SessionCommitResult } from "@/shared/context-types";
import {
  ensureDir,
  writeL0,
  writeL1,
  writeL2,
  updateL0IndexEntry,
  updateMeta,
} from "./ncf";
import {
  extractUserMemories,
  extractAgentMemories,
  writeMemoriesToNCF,
} from "./memory-extractor";
import { regenerateLayers } from "./layer-generator";

// ─── Constants ───────────────────────────────────────────────────────

/** Minimum messages for a session to be worth archiving. */
const MIN_MESSAGES_FOR_COMMIT = 4;

/** Maximum messages to include in the summary prompt. */
const MAX_MESSAGES_FOR_SUMMARY = 20;

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Commit a thread session to the NCF.
 *
 * Called after a thread reaches a natural conclusion or on explicit user action.
 * This is the main entry point for session archival.
 *
 * @param threadId - The thread's unique ID
 * @param messages - Full message history
 * @param toolTrace - Tool names used during the session (for agent memory)
 * @returns Commit result with statistics
 */
export async function commitSession(
  threadId: string,
  messages: ChatMessage[],
  toolTrace: string[] = [],
): Promise<SessionCommitResult> {
  if (messages.length < MIN_MESSAGES_FOR_COMMIT) {
    return {
      status: "skipped",
      memoriesExtracted: 0,
      memoriesUpdated: 0,
      memoriesDeleted: 0,
      archived: false,
    };
  }

  const sessionPath = `sessions/${threadId}`;

  try {
    // 1. Ensure session directory exists
    ensureDir(sessionPath);

    // 2. Archive messages as JSON
    const archiveContent = JSON.stringify(
      messages.map((m) => ({
        role: m.role,
        content: m.content.slice(0, 2000), // Truncate very long messages
        createdAt: m.createdAt,
      })),
      null,
      2,
    );
    writeL2(`${sessionPath}/messages.json`, archiveContent);

    // 3. Generate session summary (L0 + L1)
    const { abstract, overview } = await generateSessionSummary(messages);

    if (abstract) {
      writeL0(sessionPath, abstract);
      updateL0IndexEntry(sessionPath, abstract);
    }

    if (overview) {
      writeL1(sessionPath, overview);
    }

    // Update metadata
    updateMeta(sessionPath, {
      source: threadId,
      l2WordCount: archiveContent.split(/\s+/).length,
    });

    // 4. Extract memories (parallel: user + agent)
    const [userMemories, agentMemories] = await Promise.all([
      extractUserMemories(messages, threadId),
      extractAgentMemories(messages, toolTrace, threadId),
    ]);

    const allMemories = [...userMemories, ...agentMemories];
    let memoriesWritten = 0;
    let memoriesMerged = 0;

    if (allMemories.length > 0) {
      const result = writeMemoriesToNCF(allMemories);
      memoriesWritten = result.written;
      memoriesMerged = result.merged;
    }

    // 5. Regenerate parent L0/L1 for the sessions directory
    await regenerateLayers("sessions").catch(() => {});

    console.log(
      `[NCF Session] Committed session ${threadId}: ` +
      `${messages.length} msgs archived, ${allMemories.length} memories extracted`,
    );

    return {
      status: "committed",
      memoriesExtracted: memoriesWritten,
      memoriesUpdated: memoriesMerged,
      memoriesDeleted: 0,
      archived: true,
    };
  } catch (error) {
    console.error(`[NCF Session] Commit failed for ${threadId}:`, error);
    return {
      status: "error",
      memoriesExtracted: 0,
      memoriesUpdated: 0,
      memoriesDeleted: 0,
      archived: false,
      error: String(error),
    };
  }
}

// ─── Summary Generation ──────────────────────────────────────────────

/**
 * Generate L0 abstract and L1 overview from a conversation.
 */
async function generateSessionSummary(
  messages: ChatMessage[],
): Promise<{ abstract: string; overview: string }> {
  // Take a representative sample of messages
  const sample = messages.length > MAX_MESSAGES_FOR_SUMMARY
    ? [
        ...messages.slice(0, 3),                                      // First few
        ...messages.slice(Math.floor(messages.length / 2) - 1, Math.floor(messages.length / 2) + 2),  // Middle
        ...messages.slice(-5),                                         // Last few
      ]
    : messages;

  const conversationText = sample
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 400)}`)
    .join("\n\n");

  try {
    const model = resolveModelForMemory();

    const { output } = await generateText({
      model,
      output: Output.object({
        schema: z.object({
          abstract: z.string().describe("One sentence (~30 words), information-dense summary for semantic search. Must capture the main topic and outcome. No filler words."),
          overview: z.string().describe("Structured markdown overview (~200 words). Include: session summary, topics discussed, key outcomes, and tools used."),
        }),
      }),
      prompt: `Analyze this conversation and produce a summary.

Conversation (${messages.length} messages):
${conversationText}`,
      maxOutputTokens: 600,
      temperature: 0.1,
    });

    return {
      abstract: output?.abstract ?? "",
      overview: output?.overview ?? "",
    };
  } catch (error) {
    console.warn("[NCF Session] Summary generation failed:", error);
    return { abstract: "", overview: "" };
  }
}
