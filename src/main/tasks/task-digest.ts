/**
 * Task Digest — L0/L1/L2 Memory Nodes for Completed Tasks
 *
 * When a task completes, this module:
 *   1. Extracts a compact L0 abstract (~30 tokens) from the deliverable
 *   2. Extracts a structured L1 overview (~200 tokens) from the deliverable
 *   3. Writes both + full L2 deliverable to NCF as a task memory node
 *
 * Extraction strategy:
 *   - If a model is provided: single LLM call to distill L0+L1 (higher quality)
 *   - Fallback: heuristic extraction (zero cost, instant)
 *
 * These get injected into the agent's context in subsequent conversations
 * so the agent knows what was discovered without re-reading full deliverables.
 *
 * Storage: ~/.niom/context/agent/memories/tasks/<task-id>/
 *   ├── .abstract.md   (L0)
 *   ├── .overview.md    (L1)
 *   ├── .meta.json      (metadata)
 *   └── deliverable.md  (L2 — full text)
 */

import * as fs from "fs";
import * as path from "path";
import { generateText } from "ai";
import type { LanguageModel } from "ai";
import { ensureDir, writeL0, writeL1, writeL2, updateMeta, ncfResolve, updateL0IndexEntry } from "../context/ncf";
import type { Task } from "@/shared/task-types";

// ─── Types ───────────────────────────────────────────────────────────

export interface TaskDigest {
  taskId: string;
  threadId: string;
  goal: string;
  l0: string;
  l1: string;
  completedAt: number;
}

// ─── Constants ───────────────────────────────────────────────────────

const TASKS_MEMORY_PATH = "agent/memories/tasks";

/** Max words for L0 abstract. */
const L0_MAX_WORDS = 50;

/** Max words for L1 overview. */
const L1_MAX_WORDS = 300;

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Write a completed task's digest to the NCF as a memory node.
 * Called by TaskRunner after synthesis completes.
 *
 * @param task - The completed task
 * @param model - Optional LLM for higher-quality distillation
 */
export async function writeTaskDigest(task: Task, model?: LanguageModel): Promise<void> {
  if (!task.deliverable || task.status !== "completed") {
    console.warn("[task-digest] Cannot write digest: task not completed or no deliverable");
    return;
  }

  const ncfPath = `${TASKS_MEMORY_PATH}/${task.id}`;
  const deliverable = task.deliverable;

  // Try LLM distillation first, fall back to heuristic
  let l0: string;
  let l1: string;

  if (model) {
    try {
      const llmResult = await distillWithLLM(task.goal, deliverable, model);
      l0 = llmResult.l0;
      l1 = llmResult.l1;
      console.log(`[task-digest] LLM distillation succeeded for task ${task.id}`);
    } catch (error) {
      console.warn("[task-digest] LLM distillation failed, using heuristic:", error);
      l0 = extractL0(task.goal, deliverable);
      l1 = extractL1(task.goal, deliverable);
    }
  } else {
    l0 = extractL0(task.goal, deliverable);
    l1 = extractL1(task.goal, deliverable);
  }

  // Write to NCF
  ensureDir(ncfPath);
  writeL0(ncfPath, l0);
  writeL1(ncfPath, l1);

  // Write full deliverable as L2
  writeL2(`${ncfPath}/deliverable.md`, deliverable);

  // Write task metadata into .meta.json
  updateMeta(ncfPath, {
    createdAt: task.createdAt,
    layersUpdatedAt: Date.now(),
    source: "task",
    category: "task_result",
    threadId: task.threadId,
    taskGoal: task.goal,
  });

  // Update L0 index for retrieval
  updateL0IndexEntry(ncfPath, l0);

  console.log(`[task-digest] Written digest for task ${task.id} | L0: ${l0.length} chars, L1: ${l1.length} chars`);
}

// ─── LLM Distillation ───────────────────────────────────────────────

/**
 * Use a lightweight LLM call to distill L0 and L1 from the deliverable.
 * Single call, structured output as JSON.
 * Cost: ~500 input tokens + ~200 output tokens.
 */
async function distillWithLLM(
  goal: string,
  deliverable: string,
  model: LanguageModel,
): Promise<{ l0: string; l1: string }> {
  // Cap deliverable to avoid excessive tokens (~4K chars ≈ ~1K tokens)
  const cappedDeliverable = deliverable.length > 4000
    ? deliverable.slice(0, 4000) + "\n\n[...truncated]"
    : deliverable;

  const { text } = await generateText({
    model,
    prompt: `You are a knowledge management system. Given a completed task goal and its deliverable, produce a two-tier summary for future context injection.

Task Goal: "${goal}"

Deliverable:
${cappedDeliverable}

Respond with ONLY valid JSON in this exact format:
{
  "l0": "A single sentence (max 50 words) that captures the task goal and its key findings. Include specific numbers, metrics, or conclusions.",
  "l1": "A structured overview (max 200 words) with the most important findings. Use bullet points. Focus on actionable insights, key data points, and recommendations. Skip meta-commentary."
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

/**
 * Read all task digests, optionally filtered by threadId.
 * Returns compact digest objects (not full deliverables).
 */
export function readTaskDigests(threadId?: string): TaskDigest[] {
  const tasksDir = ncfResolve(TASKS_MEMORY_PATH);
  if (!fs.existsSync(tasksDir)) return [];

  const entries = fs.readdirSync(tasksDir, { withFileTypes: true });
  const digests: TaskDigest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const taskPath = `${TASKS_MEMORY_PATH}/${entry.name}`;
    const metaFile = path.join(tasksDir, entry.name, ".meta.json");

    if (!fs.existsSync(metaFile)) continue;

    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, "utf-8"));

      // Filter by threadId if specified
      if (threadId && meta.threadId !== threadId) continue;

      // Read L0 abstract
      const l0File = path.join(tasksDir, entry.name, ".abstract.md");
      const l0 = fs.existsSync(l0File) ? fs.readFileSync(l0File, "utf-8").trim() : "";

      // Read L1 overview
      const l1File = path.join(tasksDir, entry.name, ".overview.md");
      const l1 = fs.existsSync(l1File) ? fs.readFileSync(l1File, "utf-8").trim() : "";

      if (!l0) continue; // Skip tasks without abstracts

      digests.push({
        taskId: entry.name,
        threadId: meta.threadId || "",
        goal: meta.taskGoal || "",
        l0,
        l1,
        completedAt: meta.createdAt || 0,
      });
    } catch {
      // Skip corrupted entries
    }
  }

  // Most recent first
  digests.sort((a, b) => b.completedAt - a.completedAt);
  return digests;
}

// ─── L0 Extraction (Heuristic) ──────────────────────────────────────

/**
 * Extract a compact L0 abstract from the deliverable.
 *
 * Strategy: goal + first meaningful sentence + key metrics ($ amounts, percentages).
 * Target: ~30 tokens (~50 words).
 */
function extractL0(goal: string, deliverable: string): string {
  const parts: string[] = [];

  // Start with a compressed form of the goal
  const goalShort = goal.length > 80 ? goal.slice(0, 80) + "…" : goal;
  parts.push(`Task: "${goalShort}"`);

  // Extract key metrics from deliverable
  const metrics = extractMetrics(deliverable);
  if (metrics.length > 0) {
    parts.push(`Key findings: ${metrics.slice(0, 4).join(", ")}`);
  }

  // If no metrics, use the first meaningful sentence
  if (metrics.length === 0) {
    const firstSentence = extractFirstMeaningfulSentence(deliverable);
    if (firstSentence) {
      parts.push(firstSentence);
    }
  }

  const result = parts.join(". ");

  // Cap at L0_MAX_WORDS
  const words = result.split(/\s+/);
  if (words.length > L0_MAX_WORDS) {
    return words.slice(0, L0_MAX_WORDS).join(" ") + "…";
  }

  return result;
}

// ─── L1 Extraction (Heuristic) ──────────────────────────────────────

/**
 * Extract a structured L1 overview from the deliverable.
 *
 * Strategy: extract section headings + first bullet/line under each.
 * Target: ~200 tokens (~300 words).
 */
function extractL1(goal: string, deliverable: string): string {
  const lines = deliverable.split("\n");
  const sections: string[] = [];
  let currentHeading = "";
  let bulletsUnderCurrentHeading = 0;
  let totalWords = 0;

  for (const line of lines) {
    if (totalWords >= L1_MAX_WORDS) break;

    const trimmed = line.trim();

    // Detect headings (# or ##)
    const headingMatch = trimmed.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      currentHeading = headingMatch[1];
      bulletsUnderCurrentHeading = 0;
      sections.push(`\n**${currentHeading}**`);
      totalWords += currentHeading.split(/\s+/).length;
      continue;
    }

    // Capture bullets and key lines under headings (max 3 per section)
    if (currentHeading && bulletsUnderCurrentHeading < 3) {
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.match(/^\d+\.\s/)) {
        sections.push(trimmed);
        bulletsUnderCurrentHeading++;
        totalWords += trimmed.split(/\s+/).length;
      } else if (trimmed.length > 20 && trimmed.includes("**") && bulletsUnderCurrentHeading === 0) {
        // Bold key findings that aren't bullets
        sections.push(`- ${trimmed}`);
        bulletsUnderCurrentHeading++;
        totalWords += trimmed.split(/\s+/).length;
      }
    }
  }

  if (sections.length === 0) {
    // Fallback: first 300 words of deliverable
    const words = deliverable.split(/\s+/);
    return words.slice(0, L1_MAX_WORDS).join(" ") + (words.length > L1_MAX_WORDS ? "…" : "");
  }

  return `Task: "${goal}"\n${sections.join("\n")}`;
}

// ─── Metric Extraction ──────────────────────────────────────────────

/**
 * Extract notable metrics from text — dollar amounts, percentages,
 * multipliers, and other numeric highlights.
 */
function extractMetrics(text: string): string[] {
  const metrics: string[] = [];
  const seen = new Set<string>();

  // Dollar amounts: $17B, $500K, $1.2M
  const dollarPattern = /\$[\d,.]+\s*[BKMGT]?\b/gi;
  for (const match of text.matchAll(dollarPattern)) {
    if (!seen.has(match[0])) {
      seen.add(match[0]);
      // Try to get context: "X market" or "X opportunity"
      const contextMatch = text.slice(Math.max(0, match.index! - 30), match.index! + match[0].length + 30);
      const shortContext = contextMatch.replace(/[^\w\s$%,.]/g, "").trim();
      metrics.push(shortContext.length < 60 ? shortContext : match[0]);
    }
  }

  // Percentages: 10.5%, 12.1% CAGR
  const pctPattern = /\d+\.?\d*%\s*(?:CAGR|growth|increase|decrease|reduction|improvement)?/gi;
  for (const match of text.matchAll(pctPattern)) {
    const val = match[0].trim();
    if (!seen.has(val)) {
      seen.add(val);
      metrics.push(val);
    }
  }

  // Multipliers: 10-100x, 5x faster
  const multPattern = /\d+-?\d*x\s+\w+/gi;
  for (const match of text.matchAll(multPattern)) {
    const val = match[0].trim();
    if (!seen.has(val)) {
      seen.add(val);
      metrics.push(val);
    }
  }

  return metrics.slice(0, 6);
}

/**
 * Extract the first meaningful sentence from text.
 * Skips headers, empty lines, and very short lines.
 */
function extractFirstMeaningfulSentence(text: string): string | null {
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip headers, empty lines, short lines
    if (!trimmed || trimmed.startsWith("#") || trimmed.length < 30) continue;
    // Skip bullet lists
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) continue;

    // Extract first sentence
    const sentenceEnd = trimmed.search(/[.!?]\s|[.!?]$/);
    if (sentenceEnd > 0) {
      return trimmed.slice(0, sentenceEnd + 1);
    }
    // If no sentence end found, return the whole line (capped)
    return trimmed.length > 150 ? trimmed.slice(0, 150) + "…" : trimmed;
  }
  return null;
}
