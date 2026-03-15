/**
 * NCF Context Injection — Builds context sections for the system prompt
 *
 * Per OpenViking §4, context is injected in tiers:
 *   - L0 abstracts: Always included (~100 tokens each, ~10 directories = ~1K tokens)
 *   - L1 overviews: Included for query-relevant directories (~500 tokens each)
 *   - L2 content:   Only loaded on-demand by tools (not injected into prompt)
 *
 * This module provides:
 *   1. buildNCFContextPrompt() — Static context from L0 abstracts (always injected)
 *   2. buildQueryContextPrompt() — Query-relevant context via retrieval (per-turn)
 *   3. buildTaskContextPrompt() — Completed task digests for thread awareness (M5a)
 *   4. buildRecallContextPrompt() — Combined task + thread digests for recall mode (M5d)
 */

import { getL0Index, readL0, nodeExists, readL2 } from "./ncf";
import { quickL0Retrieve } from "./retrieval";
import { readTaskDigests } from "../tasks/task-digest";
import { readThreadDigests } from "./thread-digest";
import { listTasks, getTask } from "../tasks/task-store";

// ─── Constants ───────────────────────────────────────────────────────

/** Maximum tokens budget for static L0 context. */
const MAX_L0_CONTEXT_WORDS = 300;

/** Maximum results from query retrieval for prompt injection. */
const MAX_RETRIEVAL_RESULTS = 5;

// ─── Shared L1 Scoring ──────────────────────────────────────────────

/**
 * Score L1 relevance via word overlap between a query and an L0 abstract.
 * Returns a 0–1 score where higher = more relevant.
 * Used by both task and thread context builders.
 */
function scoreL1Relevance(
  l0Text: string,
  queryWords: Set<string>,
): number {
  if (queryWords.size === 0) return 0;
  const l0Words = l0Text.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  let overlap = 0;
  for (const word of l0Words) {
    if (queryWords.has(word)) overlap++;
  }
  return overlap / Math.max(queryWords.size, 3);
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Build the static NCF context section for the system prompt.
 * Always injected regardless of query — gives the model broad awareness.
 *
 * Includes:
 *   - User profile summary (if exists)
 *   - L0 abstracts from key directories
 *   - Project awareness
 */
export function buildNCFContextPrompt(): string {
  const sections: string[] = [];

  // User profile
  const profile = loadProfile();
  if (profile) {
    sections.push(`<user_profile>\n${profile}\n</user_profile>`);
  }

  // User preferences summary
  const preferences = loadPreferencesSummary();
  if (preferences) {
    sections.push(`<user_preferences>\n${preferences}\n</user_preferences>`);
  }

  // Agent patterns (learned behaviors)
  const patterns = loadPatternsSummary();
  if (patterns) {
    sections.push(`<learned_patterns>\n${patterns}\n</learned_patterns>`);
  }

  // Project awareness
  const projects = loadProjectsSummary();
  if (projects) {
    sections.push(`<active_projects>\n${projects}\n</active_projects>`);
  }

  if (sections.length === 0) return "";

  return "\n\n" + sections.join("\n\n");
}

/**
 * Build query-relevant context from NCF retrieval.
 * Called per-turn with the user's latest message for targeted context injection.
 *
 * @param query - The user's message to retrieve context for
 * @returns Context section to append to system prompt, or ""
 */
export async function buildQueryContextPrompt(query: string): Promise<string> {
  if (!query || query.trim().length < 5) return "";

  try {
    // Use quick L0 retrieval (text overlap, no embedding needed)
    const results = quickL0Retrieve(query, MAX_RETRIEVAL_RESULTS);

    if (results.length === 0) return "";

    const contextLines = results
      .filter((r) => r.score > 0.1) // Only include meaningful matches
      .map((r) => `[${r.path}] ${r.abstract}`)
      .join("\n");

    if (!contextLines) return "";

    return `\n\n<relevant_context>
The following context from memory may be relevant to the user's current query:
${contextLines}
</relevant_context>`;
  } catch (error) {
    console.warn("[NCF Injection] Query context retrieval failed:", error);
    return "";
  }
}

// ─── Task Context ────────────────────────────────────────────────────

/** Maximum L0 task digests to inject. */
const MAX_TASK_L0_ENTRIES = 5;

/** Maximum L1 task overviews to inject (only when query-relevant). */
const MAX_TASK_L1_ENTRIES = 2;

/** Minimum text overlap score to inject L1 overview. */
const TASK_L1_THRESHOLD = 0.15;

/**
 * Build task context section for the system prompt.
 *
 * Injects L0 abstracts of completed tasks for the current thread (always).
 * Optionally injects L1 overviews when the user's query is semantically related.
 *
 * Cost: ~150 tokens (5 L0s) + ~400 tokens (2 L1s) = ~550 tokens max.
 *
 * @param threadId - Current thread to scope task retrieval
 * @param query - Optional user query for L1 relevance matching
 * @returns Context section string, or "" if no tasks
 */
export function buildTaskContextPrompt(threadId?: string, query?: string): string {
  try {
    // When threadId is undefined → recall mode → fetch ALL tasks
    const digests = readTaskDigests(threadId);
    if (digests.length === 0) return "";

    // Cap L0 entries
    const l0Entries = digests.slice(0, MAX_TASK_L0_ENTRIES);

    // Build L0 section (always injected)
    const l0Lines = l0Entries.map((d) => `- ${d.l0}`).join("\n");

    let l1Section = "";

    // If we have a query, check which tasks are relevant for L1 injection
    if (query && query.trim().length >= 5) {
      const queryWords = new Set(
        query.toLowerCase().split(/\s+/).filter((w) => w.length > 2),
      );

      const l1Candidates: Array<{ digest: typeof digests[0]; score: number }> = [];

      for (const digest of l0Entries) {
        if (!digest.l1) continue;

        const score = scoreL1Relevance(digest.l0, queryWords);

        if (score >= TASK_L1_THRESHOLD) {
          l1Candidates.push({ digest, score });
        }
      }

      // Sort by relevance and take top N
      l1Candidates.sort((a, b) => b.score - a.score);
      const l1Selected = l1Candidates.slice(0, MAX_TASK_L1_ENTRIES);

      if (l1Selected.length > 0) {
        const l1Lines = l1Selected.map((c) =>
          `<task_detail goal="${c.digest.goal.slice(0, 100)}">
${c.digest.l1}
</task_detail>`
        ).join("\n");

        l1Section = `\n\nDetailed findings from relevant completed tasks:\n${l1Lines}`;
      }
    }

    const scopeLabel = threadId
      ? "The following tasks have been completed in this thread."
      : "The following tasks have been completed across your threads (recall mode).";

    return `\n\n<completed_tasks>
${scopeLabel} Use these findings to inform your responses:
${l0Lines}${l1Section}
Note: For full task deliverables, use the read tool on ~/.niom/context/agent/memories/tasks/<task-id>/deliverable.md
</completed_tasks>`;
  } catch (error) {
    console.warn("[NCF Injection] Task context failed:", error);
    return "";
  }
}

// ─── Active Task Awareness (M6e) ────────────────────────────────────

/** Maximum recent activity entries to include per task. */
const MAX_ACTIVITY_PER_TASK = 5;

/**
 * Build context about actively running/paused tasks for the main agent.
 *
 * When "Task Awareness" is toggled on, this injects a live summary of
 * background tasks so the main conversation agent knows what "minions"
 * are doing and can reference their progress or steer them.
 *
 * @param threadId - Scope to this thread's tasks (or all if undefined)
 * @returns Context block to inject into system prompt, or ""
 */
export function buildActiveTaskContext(threadId?: string): string {
  try {
    // Fetch tasks that are active (running, checkpoint, paused)
    const activeTasks = listTasks({
      threadId,
      status: ["running", "checkpoint", "paused"],
    });

    if (activeTasks.length === 0) return "";

    const taskBlocks: string[] = [];

    for (const meta of activeTasks.slice(0, 5)) {
      // Load full task for activity details
      const task = getTask(meta.id);
      if (!task) continue;

      const statusEmoji = task.status === "running" ? "⚡"
        : task.status === "checkpoint" ? "⏸️"
        : "💤"; // paused

      // Recent activity summary
      const recentActivity = task.activity
        .filter((a) => a.status === "completed")
        .slice(-MAX_ACTIVITY_PER_TASK)
        .map((a) => `    - ${a.toolName}${a.summary ? `: ${a.summary}` : ""}`)
        .join("\n");

      // Latest findings (from the last segment result if available)
      const latestFinding = task.deliverable
        ? task.deliverable.slice(0, 300) + (task.deliverable.length > 300 ? "…" : "")
        : null;

      // Checkpoint info
      const checkpointInfo = task.activeCheckpoint
        ? `  Checkpoint: ${task.activeCheckpoint.summary}`
        : "";

      taskBlocks.push(
        `<task id="${task.id}" status="${statusEmoji} ${task.status}" goal="${task.goal.slice(0, 100)}">\n` +
        `  Tool calls: ${task.toolCallCount} | Tokens: ${task.totalUsage.totalTokens}\n` +
        (checkpointInfo ? checkpointInfo + "\n" : "") +
        (recentActivity ? `  Recent activity:\n${recentActivity}\n` : "") +
        (latestFinding ? `  Latest findings: ${latestFinding}\n` : "") +
        `</task>`
      );
    }

    return `\n\n<active_tasks>
You have ${activeTasks.length} background task${activeTasks.length === 1 ? "" : "s"} running (like minions working for you).
You can reference their progress in conversation, and use the steer_task tool to send guidance to any running task.

${taskBlocks.join("\n\n")}
</active_tasks>`;
  } catch (error) {
    console.warn("[NCF Injection] Active task context failed:", error);
    return "";
  }
}

// ─── Thread Context (M5d) ───────────────────────────────────────────

/** Maximum thread L0 entries to inject. */
const MAX_THREAD_L0_ENTRIES = 10;

/** Maximum thread L1 entries to inject. */
const MAX_THREAD_L1_ENTRIES = 2;

/** L1 relevance threshold for thread digests. */
const THREAD_L1_THRESHOLD = 0.15;

/**
 * Build combined recall context — both tasks AND threads from all threads.
 *
 * This is the single injection point for recall mode. It combines:
 *   - Task digests (L0/L1) from ALL completed tasks
 *   - Thread digests (L0/L1) from ALL other conversations
 *
 * @param currentThreadId - Current thread to exclude from thread digests
 * @param query - Optional user query for L1 relevance matching
 * @returns Context section string, or "" if nothing to recall
 */
export function buildRecallContextPrompt(currentThreadId?: string, query?: string): string {
  const sections: string[] = [];

  // 1. Task knowledge from ALL threads
  const taskSection = buildTaskContextPrompt(undefined, query);
  if (taskSection) {
    sections.push(taskSection);
  }

  // 2. Thread conversation knowledge (excludes current thread)
  const threadSection = buildThreadContextPrompt(currentThreadId, query);
  if (threadSection) {
    sections.push(threadSection);
  }

  return sections.join("");
}

/**
 * Build thread conversation context for the system prompt.
 *
 * Injects L0 abstracts of other thread conversations.
 * Optionally injects L1 overviews when the user's query is relevant.
 *
 * @param excludeThreadId - Current thread to exclude
 * @param query - Optional user query for L1 relevance matching
 * @returns Context section string, or "" if no threads
 */
function buildThreadContextPrompt(excludeThreadId?: string, query?: string): string {
  try {
    const digests = readThreadDigests(excludeThreadId);
    if (digests.length === 0) return "";

    const l0Entries = digests.slice(0, MAX_THREAD_L0_ENTRIES);
    const l0Lines = l0Entries.map((d) => `- ${d.l0}`).join("\n");

    let l1Section = "";

    // If we have a query, check which threads are relevant for L1 injection
    if (query && query.trim().length >= 5) {
      const queryWords = new Set(
        query.toLowerCase().split(/\s+/).filter((w) => w.length > 2),
      );

      const l1Candidates: Array<{ digest: typeof digests[0]; score: number }> = [];

      for (const digest of l0Entries) {
        if (!digest.l1) continue;

        const score = scoreL1Relevance(digest.l0, queryWords);

        if (score >= THREAD_L1_THRESHOLD) {
          l1Candidates.push({ digest, score });
        }
      }

      l1Candidates.sort((a, b) => b.score - a.score);
      const l1Selected = l1Candidates.slice(0, MAX_THREAD_L1_ENTRIES);

      if (l1Selected.length > 0) {
        const l1Lines = l1Selected.map((c) =>
          `<thread_detail title="${c.digest.title.slice(0, 80)}">
${c.digest.l1}
</thread_detail>`
        ).join("\n");

        l1Section = `\n\nDetailed context from relevant past conversations:\n${l1Lines}`;
      }
    }

    return `\n\n<past_conversations>
The following conversations have occurred in other threads. Use these to inform your responses when relevant:
${l0Lines}${l1Section}
</past_conversations>`;
  } catch (error) {
    console.warn("[NCF Injection] Thread context failed:", error);
    return "";
  }
}

// ─── Loaders ─────────────────────────────────────────────────────────

/**
 * Load user profile as a compact summary.
 */
function loadProfile(): string | null {
  if (!nodeExists("user/memories/profile.md")) return null;

  const content = readL2("user/memories/profile.md");
  if (!content) return null;

  // Extract bullet points only (skip headers)
  const lines = content
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .slice(0, 10);

  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * Load user preferences as a compact summary.
 */
function loadPreferencesSummary(): string | null {
  const l0 = readL0("user/memories/preferences");
  if (!l0 || l0 === "User Preferences") return null;
  return l0;
}

/**
 * Load agent learned patterns as a compact summary.
 */
function loadPatternsSummary(): string | null {
  const l0 = readL0("agent/memories/patterns");
  if (!l0 || l0 === "Execution Patterns") return null;
  return l0;
}
/**
 * Load active projects summary from individual project L0 abstracts.
 * Scans the L0 index for entries under "projects/" and combines them.
 */
function loadProjectsSummary(): string | null {
  const index = getL0Index();
  const projectEntries: string[] = [];

  for (const [path, abstract] of Object.entries(index)) {
    if (path.startsWith("projects/") && path !== "projects") {
      projectEntries.push(`- ${abstract}`);
    }
  }

  if (projectEntries.length === 0) return null;
  return projectEntries.join("\n");
}
