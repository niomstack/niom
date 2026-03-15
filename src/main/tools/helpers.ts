/**
 * Tool Helpers — SkillResult Builders
 *
 * Factory functions for creating standardized SkillResult envelopes.
 * Every tool uses these to ensure consistent structure for model validation.
 */

import type { SkillResult, SkillResultMetadata } from "@/shared/skill-types";

/**
 * Create a successful SkillResult.
 */
export function success<T>(
  data: T,
  summary: string,
  metadata: Partial<SkillResultMetadata> & { domain: string },
  options?: { confidence?: number; suggestions?: string[] },
): SkillResult<T> {
  return {
    status: "success",
    data,
    summary,
    confidence: options?.confidence ?? 1.0,
    suggestions: options?.suggestions,
    metadata: {
      duration: 0,
      ...metadata,
    },
  };
}

/**
 * Create an error SkillResult.
 */
export function error(
  summary: string,
  metadata: Partial<SkillResultMetadata> & { domain: string },
): SkillResult<null> {
  return {
    status: "error",
    data: null,
    summary,
    confidence: 0,
    metadata: {
      duration: 0,
      ...metadata,
    },
  };
}

/**
 * Create a partial (truncated) SkillResult.
 */
export function partial<T>(
  data: T,
  summary: string,
  metadata: Partial<SkillResultMetadata> & { domain: string; truncated: true },
  options?: { confidence?: number; suggestions?: string[] },
): SkillResult<T> {
  return {
    status: "partial",
    data,
    summary,
    confidence: options?.confidence ?? 0.7,
    suggestions: options?.suggestions,
    metadata: {
      duration: 0,
      ...metadata,
    },
  };
}

/**
 * Wrap a tool's execute function with timing instrumentation.
 * Automatically sets `metadata.duration` in the returned SkillResult.
 */
export async function timed<T>(
  fn: () => Promise<SkillResult<T>>,
): Promise<SkillResult<T>> {
  const start = performance.now();
  const result = await fn();
  result.metadata.duration = Math.round(performance.now() - start);
  return result;
}

/**
 * Validate that a path is within allowed boundaries (no traversal attacks).
 * Returns the resolved absolute path or null if invalid.
 */
export function validatePath(inputPath: string, baseDir: string): string | null {
  const path = require("path");
  const resolved = path.resolve(baseDir, inputPath);

  // Ensure the resolved path is within the base directory
  if (!resolved.startsWith(baseDir)) {
    return null;
  }

  return resolved;
}

/** Get the user's home directory. */
export function getHomeDir(): string {
  return require("os").homedir();
}
