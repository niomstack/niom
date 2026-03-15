/**
 * Project Scanner — Auto-detect workspaces at startup
 *
 * Scans common project directories to find workspace roots and index them
 * into the NCF. Also provides a utility to detect projects from file paths
 * encountered during tool calls.
 *
 * Two strategies:
 *   1. Startup scan: look under ~/projects, ~/code, ~/dev, ~/Desktop, ~/Documents
 *   2. On-demand: detect project root from any file path a tool touches
 */

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { detectProject } from "./project";

// ─── Constants ───────────────────────────────────────────────────────

/** Directories to scan for project roots (relative to home). */
const SCAN_DIRS = [
  "projects",
  "code",
  "dev",
  "work",
  "src",
  "Desktop",
  "Documents",
];

/** Files that indicate a directory is a project root. */
const ROOT_INDICATORS = [
  "package.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "Gemfile",
  "build.gradle",
  "pom.xml",
  "CMakeLists.txt",
  ".git",
];

/** Maximum scan depth within each scan directory. */
const MAX_SCAN_DEPTH = 2;

/** Cache of already-detected project roots to avoid redundant detection. */
const detectedRoots = new Set<string>();

// ─── Startup Scan ────────────────────────────────────────────────────

/**
 * Scan common directories for project roots and index them.
 * Called once at app startup — runs async to not block the window.
 */
export async function scanForProjects(): Promise<void> {
  const home = app.getPath("home");
  const projectRoots: string[] = [];

  for (const dir of SCAN_DIRS) {
    const scanPath = path.join(home, dir);
    if (!fs.existsSync(scanPath)) continue;

    try {
      const stat = fs.statSync(scanPath);
      if (!stat.isDirectory()) continue;

      // Check if the scan dir itself is a project
      if (isProjectRoot(scanPath)) {
        projectRoots.push(scanPath);
        continue;
      }

      // Scan children (depth 1)
      const children = fs.readdirSync(scanPath);
      for (const child of children) {
        const childPath = path.join(scanPath, child);
        try {
          const childStat = fs.statSync(childPath);
          if (!childStat.isDirectory()) continue;
          if (child.startsWith(".")) continue; // Skip hidden dirs

          if (isProjectRoot(childPath)) {
            projectRoots.push(childPath);
          } else if (MAX_SCAN_DEPTH >= 2) {
            // Check grandchildren (depth 2) — monorepo packages
            const grandchildren = fs.readdirSync(childPath)
              .slice(0, 20); // Cap to avoid huge dirs
            for (const gc of grandchildren) {
              const gcPath = path.join(childPath, gc);
              try {
                const gcStat = fs.statSync(gcPath);
                if (gcStat.isDirectory() && !gc.startsWith(".") && isProjectRoot(gcPath)) {
                  projectRoots.push(gcPath);
                }
              } catch {
                // Skip inaccessible dirs
              }
            }
          }
        } catch {
          // Skip inaccessible dirs
        }
      }
    } catch {
      // Skip inaccessible dirs
    }
  }

  // Index all found projects
  let indexed = 0;
  for (const root of projectRoots) {
    try {
      const result = await detectProject(root);
      if (result) {
        detectedRoots.add(root);
        indexed++;
      }
    } catch (err) {
      console.warn(`[ProjectScanner] Failed to index ${root}:`, err);
    }
  }

  if (indexed > 0) {
    console.log(`[ProjectScanner] Indexed ${indexed} projects from ${projectRoots.length} roots`);
  }
}

// ─── On-Demand Detection ─────────────────────────────────────────────

/**
 * Detect the project root from a file path encountered during a tool call.
 * Walks up the directory tree looking for project root indicators.
 * If found and not already indexed, triggers project detection.
 *
 * @param filePath - Absolute path to a file the agent is working with
 * @returns The detected project root, or null
 */
export async function detectProjectFromPath(filePath: string): Promise<string | null> {
  const root = findProjectRoot(filePath);
  if (!root) return null;

  // Already detected in this session
  if (detectedRoots.has(root)) return root;

  // New project — detect and index
  try {
    const result = await detectProject(root);
    if (result) {
      detectedRoots.add(root);
      console.log(`[ProjectScanner] Auto-detected project: ${result.name} at ${root}`);
      return root;
    }
  } catch (err) {
    console.warn(`[ProjectScanner] On-demand detection failed for ${root}:`, err);
  }

  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Check if a directory is a project root.
 */
function isProjectRoot(dirPath: string): boolean {
  for (const indicator of ROOT_INDICATORS) {
    if (fs.existsSync(path.join(dirPath, indicator))) {
      return true;
    }
  }
  return false;
}

/**
 * Walk up the directory tree to find the nearest project root.
 */
function findProjectRoot(filePath: string): string | null {
  let current = path.dirname(filePath);
  const home = app.getPath("home");

  // Don't go above home directory
  while (current !== "/" && current.startsWith(home)) {
    if (isProjectRoot(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break; // Reached root
    current = parent;
  }

  return null;
}
