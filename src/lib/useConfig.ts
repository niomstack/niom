/**
 * useConfig — Central config hook for the NIOM frontend.
 *
 * Fetches the full config from the Rust backend (which reads ~/.niom/config.json)
 * and provides it to all components. Config values are reactive — if saved via
 * `saveConfig`, the local state updates immediately.
 *
 * Usage:
 *   const { config, saveConfig, sidecarUrl } = useConfig();
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SIDECAR_PORT } from "./constants";

// ── Config Schema (mirrors Rust config::NiomConfig) ─────

export interface NiomConfig {
    workspace: string;
    provider_keys: Record<string, string>;
    provider: string;
    model: string;
    sidecar_port: number;
    search: {
        provider: string;
        api_key: string;
    };
    cortex: {
        watch_paths: string[];
        excluded: string[];
        max_events: number;
    };
    mcp: Array<{
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
    }>;
    models?: {
        fast?: string;
        capable?: string;
        vision?: string;
    };
}

// ── Defaults (used before config loads) ─────────────────

const DEFAULT_CONFIG: NiomConfig = {
    workspace: "",
    provider_keys: {},
    provider: "openai",
    model: "gpt-4o-mini",
    sidecar_port: DEFAULT_SIDECAR_PORT,
    search: { provider: "tavily", api_key: "" },
    cortex: {
        watch_paths: [],
        excluded: ["node_modules", ".git", "target", "dist", "__pycache__", ".next", "build"],
        max_events: 1000,
    },
    mcp: [],
};

// ── Module-level cache (shared across all hook instances) ─

let _configCache: NiomConfig | null = null;
let _configPromise: Promise<NiomConfig> | null = null;

/**
 * Get the sidecar URL, usable outside of React components.
 * Falls back to the default port if config hasn't loaded yet.
 */
export function getSidecarUrl(): string {
    const port = _configCache?.sidecar_port ?? DEFAULT_SIDECAR_PORT;
    return `http://localhost:${port}`;
}

// ── Hook ────────────────────────────────────────────────

export function useConfig() {
    const [config, setConfig] = useState<NiomConfig>(_configCache ?? DEFAULT_CONFIG);
    const [loading, setLoading] = useState(!_configCache);

    useEffect(() => {
        // Already cached — no fetch needed
        if (_configCache) {
            setConfig(_configCache);
            setLoading(false);
            return;
        }

        // Deduplicate concurrent fetches
        if (!_configPromise) {
            _configPromise = invoke<NiomConfig>("get_config").then((c) => {
                _configCache = c;
                _configPromise = null;
                return c;
            });
        }

        _configPromise.then((c) => {
            setConfig(c);
            setLoading(false);
        }).catch((err) => {
            console.warn("[useConfig] Failed to load config:", err);
            setLoading(false);
        });
    }, []);

    const saveConfig = useCallback(async (updates: Partial<NiomConfig>) => {
        const merged = { ...config, ...updates };
        try {
            await invoke("save_config", { config: merged });
            _configCache = merged;
            setConfig(merged);
        } catch (err) {
            console.error("[useConfig] Failed to save config:", err);
            throw err;
        }
    }, [config]);

    const sidecarUrl = useMemo(
        () => `http://localhost:${config.sidecar_port}`,
        [config.sidecar_port]
    );

    return { config, loading, saveConfig, sidecarUrl };
}
