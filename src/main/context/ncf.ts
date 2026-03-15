/**
 * NIOM Context Filesystem (NCF) — Core Module
 *
 * The virtual filesystem that manages all agent context.
 * Adapted from OpenViking's "filesystem management paradigm".
 *
 * Every directory in the NCF has:
 *   - .abstract.md  (L0: ~100 tokens, for vector search)
 *   - .overview.md  (L1: ~2K tokens, for planning/context)
 *   - .meta.json    (metadata: timestamps, source, category)
 *
 * All paths are relative to ~/.niom/context/
 */

import * as fs from "fs";
import * as path from "path";
import { PATHS } from "../services/config.service";
import {
  LAYER_FILES,
  type ContextScope,
  type ContextMeta,
  type ContextNode,
  type L0IndexEntry,
} from "@/shared/context-types";

// ─── Constants ───────────────────────────────────────────────────────

/** Root of the NCF on disk. */
const NCF_ROOT = () => PATHS.CONTEXT_DIR;

/** Default content for empty L0/L1 files. */
const EMPTY_L0 = "(No abstract yet — will be generated after first interaction.)";
const EMPTY_L1 = "# Overview\n\n(No overview yet — will be generated after first interaction.)";

// ─── Directory Structure ─────────────────────────────────────────────

/**
 * The initial NCF directory skeleton.
 * Created on first run or migration.
 */
const NCF_SKELETON: string[] = [
  "user",
  "user/memories",
  "user/memories/preferences",
  "user/memories/entities",
  "user/memories/events",
  "agent",
  "agent/memories",
  "agent/memories/cases",
  "agent/memories/patterns",
  "agent/memories/tasks",
  "agent/memories/threads",
  "agent/instructions",
  "projects",
  "sessions",
];

// ─── Path Utilities ──────────────────────────────────────────────────

/** Resolve a relative NCF path to an absolute filesystem path. */
export function ncfResolve(...segments: string[]): string {
  return path.join(NCF_ROOT(), ...segments);
}

/** Get the relative NCF path from an absolute path. */
export function ncfRelative(absolutePath: string): string {
  return path.relative(NCF_ROOT(), absolutePath);
}

/** Get the L0 abstract file path for a directory. */
export function l0Path(dirPath: string): string {
  return path.join(ncfResolve(dirPath), LAYER_FILES.L0);
}

/** Get the L1 overview file path for a directory. */
export function l1Path(dirPath: string): string {
  return path.join(ncfResolve(dirPath), LAYER_FILES.L1);
}

/** Get the metadata file path for a directory. */
export function metaPath(dirPath: string): string {
  return path.join(ncfResolve(dirPath), LAYER_FILES.META);
}

// ─── Core CRUD Operations ────────────────────────────────────────────

/**
 * Ensure a directory exists in the NCF, creating it with
 * empty L0/L1 files if needed.
 */
export function ensureDir(relativePath: string): void {
  const absDir = ncfResolve(relativePath);
  if (!fs.existsSync(absDir)) {
    fs.mkdirSync(absDir, { recursive: true });
  }

  // Create L0 if missing
  const absL0 = path.join(absDir, LAYER_FILES.L0);
  if (!fs.existsSync(absL0)) {
    fs.writeFileSync(absL0, EMPTY_L0, "utf-8");
  }

  // Create L1 if missing
  const absL1 = path.join(absDir, LAYER_FILES.L1);
  if (!fs.existsSync(absL1)) {
    fs.writeFileSync(absL1, EMPTY_L1, "utf-8");
  }

  // Create .meta.json if missing
  const absMeta = path.join(absDir, LAYER_FILES.META);
  if (!fs.existsSync(absMeta)) {
    const meta: ContextMeta = {
      createdAt: Date.now(),
      layersUpdatedAt: 0,
    };
    fs.writeFileSync(absMeta, JSON.stringify(meta, null, 2), "utf-8");
  }
}

/**
 * Read the L0 abstract for a directory or file.
 */
export function readL0(relativePath: string): string {
  const absL0 = l0Path(relativePath);
  if (!fs.existsSync(absL0)) return "";
  return fs.readFileSync(absL0, "utf-8").trim();
}

/**
 * Read the L1 overview for a directory or file.
 */
export function readL1(relativePath: string): string {
  const absL1 = l1Path(relativePath);
  if (!fs.existsSync(absL1)) return "";
  return fs.readFileSync(absL1, "utf-8").trim();
}

/**
 * Read L2 content — a specific file within the NCF.
 * Returns null if the file doesn't exist.
 */
export function readL2(relativePath: string): string | null {
  const absPath = ncfResolve(relativePath);
  if (!fs.existsSync(absPath)) return null;
  return fs.readFileSync(absPath, "utf-8");
}

/**
 * Write L0 abstract for a directory.
 */
export function writeL0(relativePath: string, content: string): void {
  ensureDir(relativePath);
  fs.writeFileSync(l0Path(relativePath), content, "utf-8");
  updateMeta(relativePath, { layersUpdatedAt: Date.now() });
}

/**
 * Write L1 overview for a directory.
 */
export function writeL1(relativePath: string, content: string): void {
  ensureDir(relativePath);
  fs.writeFileSync(l1Path(relativePath), content, "utf-8");
  updateMeta(relativePath, { layersUpdatedAt: Date.now() });
}

/**
 * Write L2 content — a file within the NCF.
 * Creates parent directories if needed.
 */
export function writeL2(relativePath: string, content: string, meta?: Partial<ContextMeta>): void {
  const absPath = ncfResolve(relativePath);
  const dir = path.dirname(absPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(absPath, content, "utf-8");

  // Update parent directory meta
  const parentRelPath = ncfRelative(dir);
  if (meta) {
    updateMeta(parentRelPath, meta);
  }
}

/**
 * Delete a file or directory from the NCF.
 */
export function removeNode(relativePath: string): void {
  const absPath = ncfResolve(relativePath);
  if (!fs.existsSync(absPath)) return;

  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    fs.rmSync(absPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(absPath);
  }
}

/**
 * List children of an NCF directory.
 * Returns relative paths (not absolute).
 * Filters out .abstract.md, .overview.md, .meta.json, .relations.json
 */
export function listDir(relativePath: string): string[] {
  const absDir = ncfResolve(relativePath);
  if (!fs.existsSync(absDir)) return [];

  const entries = fs.readdirSync(absDir);
  const hiddenFiles: Set<string> = new Set(Object.values(LAYER_FILES));

  return entries
    .filter((entry) => !hiddenFiles.has(entry) && !entry.startsWith("."))
    .map((entry) => path.join(relativePath, entry));
}

/**
 * Check if a path exists in the NCF.
 */
export function nodeExists(relativePath: string): boolean {
  return fs.existsSync(ncfResolve(relativePath));
}

/**
 * Check if a path is a directory.
 */
export function isDirectory(relativePath: string): boolean {
  const absPath = ncfResolve(relativePath);
  if (!fs.existsSync(absPath)) return false;
  return fs.statSync(absPath).isDirectory();
}

// ─── Metadata Operations ─────────────────────────────────────────────

/**
 * Read metadata for a directory.
 */
export function readMeta(relativePath: string): ContextMeta | null {
  const absPath = metaPath(relativePath);
  if (!fs.existsSync(absPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(absPath, "utf-8")) as ContextMeta;
  } catch {
    return null;
  }
}

/**
 * Update metadata for a directory (partial merge).
 */
export function updateMeta(relativePath: string, updates: Partial<ContextMeta>): void {
  const existing = readMeta(relativePath) || {
    createdAt: Date.now(),
    layersUpdatedAt: 0,
  };

  const merged: ContextMeta = { ...existing, ...updates };
  const absPath = metaPath(relativePath);

  // Ensure directory exists
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(absPath, JSON.stringify(merged, null, 2), "utf-8");
}

// ─── L0 Index (In-Memory) ───────────────────────────────────────────

/** In-memory index of all L0 abstracts for fast vector search. */
let l0Index: L0IndexEntry[] = [];

/**
 * Build the in-memory L0 index by scanning all NCF directories.
 * Called on startup after initialization.
 */
export function buildL0Index(): L0IndexEntry[] {
  l0Index = [];
  const root = NCF_ROOT();

  if (!fs.existsSync(root)) return l0Index;

  function scanDir(dirPath: string, scope: ContextScope): void {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue; // Skip hidden files
      if (!entry.isDirectory()) continue;

      const absPath = path.join(dirPath, entry.name);
      const relPath = ncfRelative(absPath);
      const l0File = path.join(absPath, LAYER_FILES.L0);

      if (fs.existsSync(l0File)) {
        const abstract = fs.readFileSync(l0File, "utf-8").trim();
        if (abstract && abstract !== EMPTY_L0) {
          const meta = readMeta(relPath);
          l0Index.push({
            path: relPath,
            abstract,
            embedding: [], // Will be populated by embedding pipeline
            scope,
            updatedAt: meta?.layersUpdatedAt || Date.now(),
          });
        }
      }

      // Recurse into subdirectories
      scanDir(absPath, scope);
    }
  }

  // Scan each scope
  const scopes: ContextScope[] = ["user", "agent", "projects", "sessions"];
  for (const scope of scopes) {
    const scopeDir = ncfResolve(scope);
    if (fs.existsSync(scopeDir)) {
      // Add the scope-level L0
      const scopeL0 = path.join(scopeDir, LAYER_FILES.L0);
      if (fs.existsSync(scopeL0)) {
        const abstract = fs.readFileSync(scopeL0, "utf-8").trim();
        if (abstract && abstract !== EMPTY_L0) {
          l0Index.push({
            path: scope,
            abstract,
            embedding: [],
            scope,
            updatedAt: Date.now(),
          });
        }
      }
      scanDir(scopeDir, scope);
    }
  }

  console.log(`[NCF] L0 index built: ${l0Index.length} entries`);
  return l0Index;
}

/**
 * Get the current L0 index (call buildL0Index first).
 */
export function getL0Index(): L0IndexEntry[] {
  return l0Index;
}

/**
 * Update a single entry in the L0 index.
 */
export function updateL0IndexEntry(entryPath: string, abstract: string, embedding?: number[]): void {
  const existing = l0Index.findIndex((e) => e.path === entryPath);
  const scope = entryPath.split("/")[0] as ContextScope;

  if (existing >= 0) {
    l0Index[existing].abstract = abstract;
    l0Index[existing].updatedAt = Date.now();
    if (embedding) l0Index[existing].embedding = embedding;
  } else {
    l0Index.push({
      path: entryPath,
      abstract,
      embedding: embedding || [],
      scope,
      updatedAt: Date.now(),
    });
  }
}

// ─── NCF Initialization ─────────────────────────────────────────────

/**
 * Initialize the NCF directory structure.
 * Creates the skeleton directories with empty L0/L1 files.
 * Safe to call multiple times (idempotent).
 */
export function initializeNCF(): void {
  // Ensure root exists
  const root = NCF_ROOT();
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }

  // Create skeleton
  for (const dir of NCF_SKELETON) {
    ensureDir(dir);
  }

  // Write scope-level default abstracts if they're still empty defaults
  const defaultAbstracts: Record<string, string> = {
    user: "User identity, preferences, and memories.",
    agent: "Agent operational context: skills, learned patterns, instructions.",
    projects: "Workspace-scoped project context: tech stacks, conventions.",
    sessions: "Archived conversation sessions with structured summaries.",
    "user/memories": "User memories organized by category: profile, preferences, entities, events.",
    "agent/memories": "Agent-learned knowledge: problem→solution cases and reusable execution patterns.",
  };

  for (const [dir, abstract] of Object.entries(defaultAbstracts)) {
    const currentL0 = readL0(dir);
    if (!currentL0 || currentL0 === EMPTY_L0) {
      writeL0(dir, abstract);
    }
  }

  console.log("[NCF] Directory structure initialized");
}

// ─── Context Node Builder ────────────────────────────────────────────

/**
 * Build a ContextNode from an NCF path.
 */
export function getContextNode(relativePath: string): ContextNode | null {
  const absPath = ncfResolve(relativePath);
  if (!fs.existsSync(absPath)) return null;

  const stat = fs.statSync(absPath);
  const scope = relativePath.split("/")[0] as ContextScope;
  const meta = isDirectory(relativePath) ? readMeta(relativePath) : null;

  return {
    path: relativePath,
    type: stat.isDirectory() ? "directory" : "file",
    scope,
    abstract: stat.isDirectory() ? readL0(relativePath) : "",
    updatedAt: meta?.layersUpdatedAt || stat.mtimeMs,
    createdAt: meta?.createdAt || stat.birthtimeMs,
  };
}

/**
 * Get all children of a directory as ContextNodes.
 */
export function getChildren(relativePath: string): ContextNode[] {
  const children = listDir(relativePath);
  const nodes: ContextNode[] = [];

  for (const childPath of children) {
    const node = getContextNode(childPath);
    if (node) nodes.push(node);
  }

  return nodes;
}

// ─── NCF Stats ───────────────────────────────────────────────────────

/**
 * Get statistics about the NCF for status bar display.
 */
export function getNCFStats(): {
  nodeCount: number;
  memoryCounts: Record<string, number>;
  projectCount: number;
  sessionCount: number;
  l0IndexSize: number;
} {
  const countFiles = (dir: string): number => {
    const absDir = ncfResolve(dir);
    if (!fs.existsSync(absDir)) return 0;

    let count = 0;
    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        count += countFiles(path.join(dir, entry.name));
      } else {
        count++;
      }
    }
    return count;
  };

  return {
    nodeCount: l0Index.length,
    memoryCounts: {
      preferences: countFiles("user/memories/preferences"),
      entities: countFiles("user/memories/entities"),
      events: countFiles("user/memories/events"),
      cases: countFiles("agent/memories/cases"),
      patterns: countFiles("agent/memories/patterns"),
      profile: nodeExists("user/memories/profile.md") ? 1 : 0,
    },
    projectCount: listDir("projects").length,
    sessionCount: listDir("sessions").length,
    l0IndexSize: l0Index.length,
  };
}
