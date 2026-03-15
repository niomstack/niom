/**
 * Config Service — Secure configuration management.
 *
 * - Non-sensitive config (theme, default model, provider list) → ~/.niom/config.json
 * - API keys → encrypted via Electron safeStorage → ~/.niom/keys.enc (JSON encrypted per-key)
 * - Directory structure created on first run
 */

import { app, safeStorage } from "electron";
import * as fs from "fs";
import * as path from "path";
import type { NiomConfig, ModelProvider } from "@/shared/types";

// ─── Paths ───────────────────────────────────────────────────────────

const NIOM_DIR = path.join(app.getPath("home"), ".niom");
const CONFIG_PATH = path.join(NIOM_DIR, "config.json");
const KEYS_PATH = path.join(NIOM_DIR, "keys.enc");
const THREADS_DIR = path.join(NIOM_DIR, "threads");
const CONTEXT_DIR = path.join(NIOM_DIR, "context");
const USER_CONTEXT_DIR = path.join(CONTEXT_DIR, "user");
const PROJECTS_CONTEXT_DIR = path.join(CONTEXT_DIR, "projects");
const LOGS_DIR = path.join(NIOM_DIR, "logs");

const DRAFTS_DIR = path.join(NIOM_DIR, "drafts");

export const PATHS = {
  NIOM_DIR,
  CONFIG_PATH,
  KEYS_PATH,
  THREADS_DIR,
  CONTEXT_DIR,
  USER_CONTEXT_DIR,
  PROJECTS_CONTEXT_DIR,
  DRAFTS_DIR,
  LOGS_DIR,
} as const;

// ─── Defaults ────────────────────────────────────────────────────────

const DEFAULT_CONFIG: NiomConfig = {
  providers: [
    { id: "anthropic", name: "Anthropic", enabled: false },
    { id: "openai", name: "OpenAI", enabled: false },
    { id: "google", name: "Google", enabled: false },
    { id: "ollama", name: "Ollama (Local)", enabled: false, baseUrl: "http://localhost:11434" },
  ],
  defaultModel: "anthropic:claude-sonnet-4-20250514",
  ollamaUrl: "http://localhost:11434",
  theme: "dark",
};

// ─── In-memory cache ─────────────────────────────────────────────────

let cachedConfig: NiomConfig | null = null;
let cachedKeys: Record<string, string> = {};

// ─── Directory Initialization ────────────────────────────────────────

/** Create the ~/.niom/ directory tree on first run. */
export function initDataDirectories(): void {
  const dirs = [
    NIOM_DIR,
    THREADS_DIR,
    CONTEXT_DIR,
    USER_CONTEXT_DIR,
    PROJECTS_CONTEXT_DIR,
    DRAFTS_DIR,
    LOGS_DIR,
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// ─── Config (non-sensitive) ──────────────────────────────────────────

export function getConfig(): NiomConfig {
  if (cachedConfig) return cachedConfig;

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      const saved = JSON.parse(raw) as Partial<NiomConfig>;

      // Merge with defaults to handle new fields added in updates
      cachedConfig = {
        ...DEFAULT_CONFIG,
        ...saved,
        providers: DEFAULT_CONFIG.providers.map((defaultProvider) => {
          const savedProvider = saved.providers?.find((p) => p.id === defaultProvider.id);
          return savedProvider ? { ...defaultProvider, ...savedProvider } : { ...defaultProvider };
        }),
      };
    } else {
      cachedConfig = { ...DEFAULT_CONFIG, providers: DEFAULT_CONFIG.providers.map((p) => ({ ...p })) };
      saveConfigToDisk(cachedConfig);
    }
  } catch {
    cachedConfig = { ...DEFAULT_CONFIG, providers: DEFAULT_CONFIG.providers.map((p) => ({ ...p })) };
  }

  return cachedConfig;
}

export function setConfig(updates: Partial<NiomConfig>): void {
  const current = getConfig();
  cachedConfig = { ...current, ...updates };

  // If providers are updated, merge carefully
  if (updates.providers) {
    cachedConfig.providers = DEFAULT_CONFIG.providers.map((defaultProvider) => {
      const updated = updates.providers?.find((p) => p.id === defaultProvider.id);
      const existing = current.providers.find((p) => p.id === defaultProvider.id);
      return updated ? { ...defaultProvider, ...existing, ...updated } : existing ?? { ...defaultProvider };
    });
  }

  saveConfigToDisk(cachedConfig);
}

function saveConfigToDisk(config: NiomConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ─── API Keys (encrypted) ───────────────────────────────────────────

function loadKeys(): Record<string, string> {
  if (Object.keys(cachedKeys).length > 0) return cachedKeys;

  try {
    if (fs.existsSync(KEYS_PATH) && safeStorage.isEncryptionAvailable()) {
      const encrypted = fs.readFileSync(KEYS_PATH);
      const decrypted = safeStorage.decryptString(encrypted);
      cachedKeys = JSON.parse(decrypted);
    }
  } catch {
    cachedKeys = {};
  }

  return cachedKeys;
}

function saveKeys(keys: Record<string, string>): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: save as plain JSON if encryption is unavailable (e.g., Linux without keyring)
    fs.writeFileSync(KEYS_PATH, JSON.stringify(keys));
    return;
  }

  const encrypted = safeStorage.encryptString(JSON.stringify(keys));
  fs.writeFileSync(KEYS_PATH, encrypted);
}

export function getApiKey(providerId: string): string | null {
  const keys = loadKeys();
  return keys[providerId] ?? null;
}

export function setApiKey(providerId: string, key: string): void {
  const keys = loadKeys();

  if (key.trim() === "") {
    delete keys[providerId];
  } else {
    keys[providerId] = key.trim();
  }

  cachedKeys = keys;
  saveKeys(keys);

  // Auto-enable the provider when a key is set
  const config = getConfig();
  const provider = config.providers.find((p) => p.id === providerId);
  if (provider && key.trim() !== "") {
    provider.enabled = true;
    saveConfigToDisk(config);
  }
}

/** Returns config with API key availability flags (never exposes actual keys to renderer). */
export function getConfigForRenderer(): NiomConfig & { hasKeys: Record<string, boolean> } {
  const config = getConfig();
  const keys = loadKeys();

  return {
    ...config,
    hasKeys: {
      anthropic: !!keys["anthropic"],
      openai: !!keys["openai"],
      google: !!keys["google"],
      ollama: true, // Ollama doesn't need a key
    },
  };
}
