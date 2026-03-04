import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

// ── Config Schema ────────────────────────────────────────────────

export interface NiomConfig {
    // ── Workspace ──
    /** Default working directory for all file/shell operations */
    workspace: string;

    // ── AI Provider ──
    /** Per-provider API keys */
    provider_keys: Record<string, string>;
    /** Active provider slug: openai, google, anthropic, groq, mistral, xai */
    provider: string;
    /** Model ID (native format, e.g. "gpt-4o-mini", "claude-sonnet-4-20250514") */
    model: string;

    // ── Sidecar ──
    sidecar_port: number;

    // ── Search ──
    search: {
        provider: string;
        api_key: string;
    };

    // ── MCP Servers ──
    mcp: Array<{
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
    }>;

    // ── Multi-model routing overrides ──
    /** Override model for each role: capable, vision, extraction */
    models?: Partial<Record<"capable" | "vision" | "extraction", string>>;
}

// ── Defaults ─────────────────────────────────────────────────────

const DEFAULT_CONFIG: NiomConfig = {
    workspace: homedir(),
    provider_keys: {},
    provider: "openai",
    model: "gpt-4o-mini",
    sidecar_port: 9741,
    search: {
        provider: "duckduckgo",
        api_key: "",
    },
    mcp: [],
};

// ── Paths ────────────────────────────────────────────────────────

/**
 * ~/.niom/ — the NIOM data directory
 */
export function getDataDir(): string {
    return join(homedir(), ".niom");
}

function getConfigPath(): string {
    return join(getDataDir(), "config.json");
}

// ── Config Cache ─────────────────────────────────────────────────

let _cachedConfig: NiomConfig | null = null;

// ── Load / Save ──────────────────────────────────────────────────

/**
 * Load config from ~/.niom/config.json.
 *
 * Cached in memory — reads disk only once.
 * Call `invalidateConfig()` to force re-read, or
 * `saveConfig()` which updates the cache directly.
 */
export function loadConfig(): NiomConfig {
    if (_cachedConfig) return _cachedConfig;

    const configPath = getConfigPath();
    const dataDir = getDataDir();

    if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
    }

    let config: NiomConfig;
    if (!existsSync(configPath)) {
        writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
        console.log(`[config] Created default config at ${configPath}`);
        config = { ...DEFAULT_CONFIG };
    } else {
        try {
            const raw = readFileSync(configPath, "utf-8");
            const parsed = JSON.parse(raw);
            // Deep merge nested objects
            config = {
                ...DEFAULT_CONFIG,
                ...parsed,
                provider_keys: { ...DEFAULT_CONFIG.provider_keys, ...parsed.provider_keys },
                search: { ...DEFAULT_CONFIG.search, ...parsed.search },
            };
        } catch (err) {
            console.warn(`[config] Failed to parse config, using defaults:`, err);
            config = { ...DEFAULT_CONFIG };
        }
    }

    // Resolve workspace to an absolute path
    config.workspace = resolve(config.workspace);

    _cachedConfig = config;
    return config;
}

/**
 * Invalidate the config cache. Next `loadConfig()` will re-read from disk.
 */
export function invalidateConfig(): void {
    _cachedConfig = null;
}

/**
 * Save config to ~/.niom/config.json
 */
export function saveConfig(config: NiomConfig): void {
    const configPath = getConfigPath();
    const dataDir = getDataDir();

    if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    _cachedConfig = config; // Update cache immediately
    console.log(`[config] Saved config to ${configPath}`);
}

/**
 * Get the resolved workspace path from the current config.
 * This is the base directory for all file/shell operations.
 */
export function getWorkspace(): string {
    return loadConfig().workspace;
}
