/**
 * Memory & Context IPC Handlers
 *
 * Exposes NCF operations to the renderer for the Settings Overhaul:
 * - Memory browser (list, read, search)
 * - Memory CRUD (edit, delete)
 * - NCF stats dashboard
 * - Memory export/import
 */

import { ipcMain } from "electron";
import {
  readL2,
  writeL2,
  removeNode,
  listDir,
  getNCFStats,
  getL0Index,
  buildL0Index,
  readMeta,
  readL0,
  nodeExists,
  ncfResolve,
} from "../context/ncf";
import type { MemoryCategory } from "@/shared/context-types";
import * as fs from "fs";
import * as path from "path";

// ─── Types ───────────────────────────────────────────────────────────

/** A memory item for the renderer-side browser. */
interface MemoryItem {
  /** Relative NCF path (e.g., "user/memories/preferences/coding.md") */
  path: string;
  /** Display name derived from the filename */
  name: string;
  /** Memory category */
  category: MemoryCategory;
  /** User or agent scope */
  scope: "user" | "agent";
  /** L0 abstract preview (~100 tokens) */
  abstract: string;
  /** Full L2 content */
  content: string;
  /** File size in bytes */
  size: number;
  /** Last modified timestamp */
  updatedAt: number;
  /** Created timestamp */
  createdAt: number;
}

/** NCF stats for the dashboard. */
interface NCFStatsPayload {
  nodeCount: number;
  memoryCounts: Record<string, number>;
  totalMemories: number;
  projectCount: number;
  sessionCount: number;
  l0IndexSize: number;
}

// ─── Memory Category Paths ───────────────────────────────────────────

const MEMORY_CATEGORY_PATHS: Record<MemoryCategory, string> = {
  profile: "user/memories",           // profile.md is a single file
  preferences: "user/memories/preferences",
  entities: "user/memories/entities",
  events: "user/memories/events",
  cases: "agent/memories/cases",
  patterns: "agent/memories/patterns",
};

const CATEGORY_SCOPE: Record<MemoryCategory, "user" | "agent"> = {
  profile: "user",
  preferences: "user",
  entities: "user",
  events: "user",
  cases: "agent",
  patterns: "agent",
};

// ─── Helpers ─────────────────────────────────────────────────────────

/** Get all memory items from a category directory. */
function getMemoriesForCategory(category: MemoryCategory): MemoryItem[] {
  const basePath = MEMORY_CATEGORY_PATHS[category];
  const items: MemoryItem[] = [];

  if (category === "profile") {
    // Profile is a single file, not a directory
    const profilePath = "user/memories/profile.md";
    if (nodeExists(profilePath)) {
      const content = readL2(profilePath) || "";
      const absPath = ncfResolve(profilePath);
      const stat = fs.statSync(absPath);
      items.push({
        path: profilePath,
        name: "Profile",
        category: "profile",
        scope: "user",
        abstract: readL0("user/memories") || "User profile information",
        content,
        size: stat.size,
        updatedAt: stat.mtimeMs,
        createdAt: stat.birthtimeMs,
      });
    }
    return items;
  }

  // List all files in the category directory
  const children = listDir(basePath);
  for (const childPath of children) {
    const absPath = ncfResolve(childPath);
    if (!fs.existsSync(absPath)) continue;

    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) continue; // Skip subdirectories

    const content = readL2(childPath) || "";
    const fileName = path.basename(childPath, path.extname(childPath));
    const displayName = fileName
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    items.push({
      path: childPath,
      name: displayName,
      category,
      scope: CATEGORY_SCOPE[category],
      abstract: content.slice(0, 200).replace(/\n/g, " ").trim(),
      content,
      size: stat.size,
      updatedAt: stat.mtimeMs,
      createdAt: stat.birthtimeMs,
    });
  }

  // Sort by most recently updated
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items;
}

// ─── Register IPC ────────────────────────────────────────────────────

export function registerMemoryIpc(): void {
  /**
   * Get all memories grouped by category.
   */
  ipcMain.handle("memory:list", async (): Promise<Record<MemoryCategory, MemoryItem[]>> => {
    const categories: MemoryCategory[] = ["profile", "preferences", "entities", "events", "cases", "patterns"];
    const grouped: Record<string, MemoryItem[]> = {};

    for (const cat of categories) {
      grouped[cat] = getMemoriesForCategory(cat);
    }

    return grouped as Record<MemoryCategory, MemoryItem[]>;
  });

  /**
   * Get a single memory by path.
   */
  ipcMain.handle("memory:get", async (_event, memoryPath: string): Promise<MemoryItem | null> => {
    if (!nodeExists(memoryPath)) return null;

    const absPath = ncfResolve(memoryPath);
    const stat = fs.statSync(absPath);
    const content = readL2(memoryPath) || "";

    // Derive category from path
    const parts = memoryPath.split("/");
    let category: MemoryCategory = "preferences";
    if (parts.includes("profile.md")) category = "profile";
    else if (parts.includes("preferences")) category = "preferences";
    else if (parts.includes("entities")) category = "entities";
    else if (parts.includes("events")) category = "events";
    else if (parts.includes("cases")) category = "cases";
    else if (parts.includes("patterns")) category = "patterns";

    const fileName = path.basename(memoryPath, path.extname(memoryPath));

    return {
      path: memoryPath,
      name: fileName.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      category,
      scope: CATEGORY_SCOPE[category],
      abstract: content.slice(0, 200).replace(/\n/g, " ").trim(),
      content,
      size: stat.size,
      updatedAt: stat.mtimeMs,
      createdAt: stat.birthtimeMs,
    };
  });

  /**
   * Update a memory's content.
   */
  ipcMain.handle("memory:update", async (_event, memoryPath: string, content: string): Promise<boolean> => {
    try {
      writeL2(memoryPath, content, { layersUpdatedAt: Date.now() });
      return true;
    } catch (e) {
      console.error("[memory] Failed to update:", e);
      return false;
    }
  });

  /**
   * Delete a memory.
   */
  ipcMain.handle("memory:delete", async (_event, memoryPath: string): Promise<boolean> => {
    try {
      removeNode(memoryPath);
      return true;
    } catch (e) {
      console.error("[memory] Failed to delete:", e);
      return false;
    }
  });

  /**
   * Get NCF stats for the dashboard.
   */
  ipcMain.handle("memory:stats", async (): Promise<NCFStatsPayload> => {
    const stats = getNCFStats();
    const totalMemories = Object.values(stats.memoryCounts).reduce((sum, n) => sum + n, 0);

    return {
      nodeCount: stats.nodeCount,
      memoryCounts: stats.memoryCounts,
      totalMemories,
      projectCount: stats.projectCount,
      sessionCount: stats.sessionCount,
      l0IndexSize: stats.l0IndexSize,
    };
  });

  /**
   * Export all memories as JSON.
   */
  ipcMain.handle("memory:export", async (): Promise<{ memories: MemoryItem[]; exportedAt: number }> => {
    const categories: MemoryCategory[] = ["profile", "preferences", "entities", "events", "cases", "patterns"];
    const allMemories: MemoryItem[] = [];

    for (const cat of categories) {
      allMemories.push(...getMemoriesForCategory(cat));
    }

    return {
      memories: allMemories,
      exportedAt: Date.now(),
    };
  });
  /**
   * Import memories from a backup JSON.
   */
  ipcMain.handle(
    "memory:import",
    async (
      _event,
      data: { memories: MemoryItem[]; exportedAt?: number },
    ): Promise<{ imported: number; skipped: number }> => {
      if (!data?.memories || !Array.isArray(data.memories)) {
        throw new Error("Invalid import format: expected { memories: [...] }");
      }

      let imported = 0;
      let skipped = 0;

      for (const mem of data.memories) {
        try {
          if (!mem.path || !mem.content) {
            skipped++;
            continue;
          }
          // Write content to NCF at the original path
          writeL2(mem.path, mem.content);
          imported++;
        } catch {
          skipped++;
        }
      }

      // Rebuild L0 index after import
      buildL0Index();

      return { imported, skipped };
    },
  );

  /**
   * List all detected projects from the NCF.
   */
  ipcMain.handle("memory:projects", async () => {
    const projectsDir = ncfResolve("projects");
    if (!fs.existsSync(projectsDir)) return [];

    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    const projects: Array<{
      hash: string;
      name: string;
      rootPath: string;
      techStack: Array<{ name: string; version?: string; detectedFrom: string }>;
      conventions: string[];
      analyzedAt: number;
    }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const contextPath = path.join(projectsDir, entry.name, "context.json");
      if (!fs.existsSync(contextPath)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(contextPath, "utf-8"));
        projects.push({
          hash: entry.name,
          name: data.name || entry.name,
          rootPath: data.rootPath || "",
          techStack: data.techStack || [],
          conventions: data.conventions || [],
          analyzedAt: data.analyzedAt || 0,
        });
      } catch {
        // Skip corrupted project entries
      }
    }

    return projects;
  });

  console.log("[ipc] Memory handlers registered");
}
