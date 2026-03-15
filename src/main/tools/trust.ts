/**
 * Persistent Trust Store
 *
 * Tracks approved tool call patterns across sessions.
 * When a user approves a tool call, we extract a "trust pattern" —
 * a normalized representation of what was approved — and store it.
 *
 * On subsequent calls (even across restarts), tools can check `isTrusted()`
 * to skip approval for actions matching previously-approved patterns.
 *
 * Security model:
 *   - Path-scoped: approving a write to ~/projects/foo doesn't trust ~/
 *   - Scoped by tool name: approving `write` doesn't trust `run`
 *   - Commands are never auto-trusted (too dangerous)
 *   - Patterns expire after a configurable TTL (7 days default)
 *   - Maximum trust entries (prevents unbounded growth)
 *   - Persisted to ~/.niom/trust.json — survives restarts
 */

import * as path from "path";
import * as fs from "fs";
import { PATHS } from "../services/config.service";

/** How long a trust pattern remains valid (ms). Default: 7 days. */
const TRUST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum trust entries across sessions. */
const MAX_TRUST_ENTRIES = 100;

/** Path to the persisted trust file. */
const TRUST_PATH = path.join(PATHS.NIOM_DIR, "trust.json");

// ─── Types ───────────────────────────────────────────────────────────

interface TrustEntry {
  /** Tool name (e.g., "write") */
  tool: string;
  /** Normalized directory scope — approvals trust this dir and children */
  dirScope: string;
  /** When this trust was granted (epoch ms) */
  grantedAt: number;
  /** When this trust was last used (epoch ms) */
  lastUsedAt: number;
  /** How many times this trust has been used */
  hitCount: number;
}

// ─── Trust Store (loaded from disk on init) ──────────────────────────

let trustStore: TrustEntry[] = [];
let loaded = false;

/**
 * Load trust entries from disk. Called once on app startup.
 */
export function loadTrustStore(): void {
  if (loaded) return;
  loaded = true;

  try {
    if (fs.existsSync(TRUST_PATH)) {
      const raw = fs.readFileSync(TRUST_PATH, "utf-8");
      const entries = JSON.parse(raw) as TrustEntry[];

      // Filter out expired entries on load
      const now = Date.now();
      trustStore = entries.filter((e) => now - e.grantedAt < TRUST_TTL_MS);

      console.log(`[Trust] Loaded ${trustStore.length} persistent entries (${entries.length - trustStore.length} expired)`);
    }
  } catch (err) {
    console.warn("[Trust] Failed to load trust store, starting fresh:", err);
    trustStore = [];
  }
}

/**
 * Save trust entries to disk. Called after mutations.
 */
function saveTrustStore(): void {
  try {
    fs.writeFileSync(TRUST_PATH, JSON.stringify(trustStore, null, 2));
  } catch (err) {
    console.warn("[Trust] Failed to save trust store:", err);
  }
}

/**
 * Record a trust approval. Called when the user approves a tool call.
 * Extracts a trust pattern from the tool's input args and persists it.
 */
export function grantTrust(toolName: string, input: unknown): void {
  loadTrustStore(); // Ensure loaded

  // Never auto-trust commands — too risky
  if (toolName === "run" || toolName === "runCommand") return;

  const dirScope = extractDirScope(toolName, input);
  if (!dirScope) return;

  // Check if we already have this pattern
  const existing = trustStore.find(
    (e) => e.tool === toolName && e.dirScope === dirScope,
  );

  if (existing) {
    // Refresh the TTL and update usage
    existing.grantedAt = Date.now();
    existing.lastUsedAt = Date.now();
    saveTrustStore();
    return;
  }

  // Evict oldest if at capacity
  if (trustStore.length >= MAX_TRUST_ENTRIES) {
    trustStore.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    trustStore.shift();
  }

  trustStore.push({
    tool: toolName,
    dirScope,
    grantedAt: Date.now(),
    lastUsedAt: Date.now(),
    hitCount: 0,
  });

  saveTrustStore();
  console.log(`[Trust] Granted + persisted: ${toolName} in ${dirScope}`);
}

/**
 * Check if a tool call is trusted (should skip approval).
 */
export function isTrusted(toolName: string, input: unknown): boolean {
  loadTrustStore(); // Ensure loaded

  // Commands are never auto-trusted
  if (toolName === "run" || toolName === "runCommand") return false;

  const dirScope = extractDirScope(toolName, input);
  if (!dirScope) return false;

  const now = Date.now();

  // Find a matching, non-expired trust entry
  const match = trustStore.find((e) => {
    if (e.tool !== toolName) return false;
    if (now - e.grantedAt > TRUST_TTL_MS) return false;
    // Check if the action's dir is within the trusted scope
    return isWithinScope(dirScope, e.dirScope);
  });

  if (match) {
    match.hitCount++;
    match.lastUsedAt = now;
    // Debounce saves — only write every 10 hits to avoid excessive I/O
    if (match.hitCount % 10 === 0) {
      saveTrustStore();
    }
    return true;
  }

  return false;
}

/**
 * Clear all trust entries. Called on explicit user action.
 */
export function clearTrust(): void {
  trustStore.length = 0;
  saveTrustStore();
  console.log("[Trust] Cleared all entries");
}

/**
 * Get current trust entries (for debugging / UI).
 */
export function getTrustEntries(): readonly TrustEntry[] {
  loadTrustStore();
  return trustStore;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Extract the directory scope from a tool's input args.
 * Returns the parent directory of the target path.
 */
function extractDirScope(toolName: string, input: unknown): string | null {
  const i = input as Record<string, unknown>;
  if (!i) return null;

  // write, read — have a `path` field
  if (typeof i.path === "string") {
    const resolved = path.resolve(String(i.path));
    // Trust the parent directory (not the exact file)
    return path.dirname(resolved);
  }

  return null;
}

/**
 * Check if a directory is within a trusted scope.
 * e.g., ~/projects/fragments/src is within ~/projects/fragments
 */
function isWithinScope(actionDir: string, trustedDir: string): boolean {
  const normalizedAction = path.resolve(actionDir) + path.sep;
  const normalizedTrusted = path.resolve(trustedDir) + path.sep;
  return normalizedAction.startsWith(normalizedTrusted) || normalizedAction === normalizedTrusted;
}
