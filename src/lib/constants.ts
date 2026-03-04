/**
 * constants.ts — Default values and fallbacks.
 *
 * These are compile-time defaults used before the config loads from
 * the Rust backend. All runtime config should come from useConfig().
 *
 * The actual values are read from ~/.niom/config.json via:
 *   Rust (config.rs) → Tauri command → useConfig() hook
 */

export const DEFAULT_SIDECAR_PORT = 9741;

/**
 * @deprecated Use `sidecarUrl` from useConfig() or getSidecarUrl() instead.
 * This exists only as a bootstrap fallback before config loads.
 */
export const SIDECAR_URL = `http://localhost:${DEFAULT_SIDECAR_PORT}`;
