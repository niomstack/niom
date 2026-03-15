/**
 * NCF Layer Generator — LLM-Powered L0/L1 Generation
 *
 * Generates .abstract.md (L0, ~100 tokens) and .overview.md (L1, ~2K tokens)
 * from L2 content and/or child L0s.
 *
 * Per OpenViking §3:
 *   - L0 is generated bottom-up: summarize L2 content or aggregate child L0s
 *   - L1 is a structured overview: enough context for an agent to plan
 *   - Uses cheapest available model to keep costs low
 *
 * Two modes:
 *   1. File → L0:  Summarize a single file into ~100 tokens
 *   2. Directory → L0/L1:  Aggregate child L0s into parent abstract + overview
 */

import { generateText } from "ai";
import { resolveModelForMemory } from "../services/chat.service";
import {
  readL2,
  readL0,
  listDir,
  writeL0,
  writeL1,
  isDirectory,
  updateL0IndexEntry,
} from "./ncf";

// ─── Constants ───────────────────────────────────────────────────────

/** Maximum L2 content to send for summarization (characters). */
const MAX_L2_CHARS = 3000;

/** Target L0 length in words. */
const L0_TARGET_WORDS = 30;

/** Target L1 length in words. */
const L1_TARGET_WORDS = 500;

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Generate L0 abstract for a file from its L2 content.
 * The L0 is stored as the parent directory's child summary.
 */
export async function generateFileL0(filePath: string): Promise<string> {
  const content = readL2(filePath);
  if (!content || content.trim().length === 0) return "";

  const truncated = content.slice(0, MAX_L2_CHARS);

  try {
    const model = resolveModelForMemory();
    const result = await generateText({
      model,
      prompt: `Summarize this content in exactly one sentence (~${L0_TARGET_WORDS} words).
The summary must be information-dense and useful for semantic search.
Do NOT start with "This file" or "This document". Jump straight into the content.

Content:
${truncated}

One-sentence summary:`,
      maxOutputTokens: 100,
      temperature: 0,
    });

    return result.text.trim();
  } catch (error) {
    console.warn("[NCF LayerGen] File L0 generation failed:", error);
    return "";
  }
}

/**
 * Generate L0 abstract for a directory from its children's L0s.
 * Aggregates child abstracts into a single parent summary.
 */
export async function generateDirectoryL0(dirPath: string): Promise<string> {
  const children = listDir(dirPath);
  if (children.length === 0) return "";

  // Collect child L0s
  const childAbstracts: string[] = [];
  for (const child of children) {
    if (isDirectory(child)) {
      const l0 = readL0(child);
      if (l0) childAbstracts.push(`[${child.split("/").pop()}] ${l0}`);
    } else {
      // For files, read first line as a quick summary
      const content = readL2(child);
      if (content) {
        const firstLine = content.split("\n").find((l) => l.trim().length > 0) || "";
        childAbstracts.push(`[${child.split("/").pop()}] ${firstLine.slice(0, 100)}`);
      }
    }
  }

  if (childAbstracts.length === 0) return "";

  try {
    const model = resolveModelForMemory();
    const result = await generateText({
      model,
      prompt: `You are summarizing a directory's contents into ONE sentence (~${L0_TARGET_WORDS} words).
This summary will be used for semantic search to decide if this directory is relevant to a query.
Be information-dense. List key topics/categories found in the children.

Directory children:
${childAbstracts.join("\n")}

One-sentence summary:`,
      maxOutputTokens: 100,
      temperature: 0,
    });

    const abstract = result.text.trim();

    // Write to NCF and update L0 index
    writeL0(dirPath, abstract);
    updateL0IndexEntry(dirPath, abstract);

    return abstract;
  } catch (error) {
    console.warn("[NCF LayerGen] Directory L0 generation failed:", error);
    return "";
  }
}

/**
 * Generate L1 overview for a directory from its children's L0s.
 * The L1 is a structured markdown overview (~500 words).
 */
export async function generateDirectoryL1(dirPath: string): Promise<string> {
  const children = listDir(dirPath);
  if (children.length === 0) return "";

  // Collect child L0s with more detail
  const childSummaries: string[] = [];
  for (const child of children) {
    const name = child.split("/").pop() || "";
    if (isDirectory(child)) {
      const l0 = readL0(child);
      childSummaries.push(`- **${name}/**: ${l0 || "(no summary)"}`);
    } else {
      const content = readL2(child);
      if (content) {
        const preview = content.slice(0, 300).replace(/\n/g, " ").trim();
        childSummaries.push(`- **${name}**: ${preview}`);
      }
    }
  }

  if (childSummaries.length === 0) return "";

  try {
    const model = resolveModelForMemory();
    const result = await generateText({
      model,
      prompt: `Generate a structured markdown overview (~${L1_TARGET_WORDS} words) for this directory.
This overview gives an agent enough context to understand the directory's purpose and decide which children to explore.

Format:
# Overview
[2-3 sentence description of the directory's purpose]

## Contents
[Bullet list of children with brief descriptions]

## Key Information
[Most important facts an agent should know from this directory]

Directory path: ${dirPath}
Children:
${childSummaries.join("\n")}

Generate the overview:`,
      maxOutputTokens: 1000,
      temperature: 0.1,
    });

    const overview = result.text.trim();
    writeL1(dirPath, overview);
    return overview;
  } catch (error) {
    console.warn("[NCF LayerGen] Directory L1 generation failed:", error);
    return "";
  }
}

/**
 * Regenerate all layers for a directory and its ancestors.
 * Bottom-up: regenerate the directory's L0/L1, then recursively update parents.
 */
export async function regenerateLayers(dirPath: string): Promise<void> {
  if (!dirPath || dirPath === ".") return;

  try {
    // Regenerate this directory's L0 and L1
    await generateDirectoryL0(dirPath);
    await generateDirectoryL1(dirPath);

    // Propagate up to parent (but not past scope level)
    const parts = dirPath.split("/");
    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join("/");
      // Only regenerate parent L0 (not L1 — too expensive for bulk updates)
      await generateDirectoryL0(parentPath);
    }
  } catch (error) {
    console.warn(`[NCF LayerGen] Layer regeneration failed for ${dirPath}:`, error);
  }
}
