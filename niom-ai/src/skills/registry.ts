/**
 * Skill Pack Registry — in-memory store of all loaded skill packs.
 *
 * Singleton registry initialized at startup. Provides:
 *   - Domain-based lookup for the intent router
 *   - Enable/disable management
 *   - Access to all loaded packs for the Skill Tree UI
 */

import { join } from "path";
import { loadBuiltinPacks, loadInstalledPacks } from "./loader.js";
import type { SkillPack, SkillDomain } from "./types.js";

// ── Registry State ──

const packs: Map<string, SkillPack> = new Map();
let _initialized = false;

// ── Registration ──

export function registerPack(pack: SkillPack): void {
    packs.set(pack.id, pack);
}

// ── Lookup ──

/**
 * Get a skill pack by ID.
 */
export function getPack(id: string): SkillPack | undefined {
    return packs.get(id);
}

/**
 * Get the primary skill pack for a domain.
 * Falls back to "general" if no pack exists for the domain.
 */
export function getPackForDomain(domain: SkillDomain): SkillPack {
    // First: find an enabled pack matching this domain exactly
    for (const pack of packs.values()) {
        if (pack.domain === domain && pack.enabled) {
            return pack;
        }
    }

    // Fallback: return the general pack
    const general = packs.get("general");
    if (general) return general;

    // Last resort: return a minimal pack (should never happen if init ran)
    return {
        id: "general",
        name: "General",
        description: "General-purpose fallback",
        domain: "general",
        systemPrompt: "You are NIOM, a helpful personal AI assistant.",
        toolIds: [],
        enabled: true,
        source: "builtin",
    };
}

/**
 * Get all skill packs for a domain (including disabled).
 */
export function getPacksByDomain(domain: SkillDomain): SkillPack[] {
    return Array.from(packs.values()).filter((p) => p.domain === domain);
}

/**
 * Get all enabled skill packs.
 */
export function getEnabledPacks(): SkillPack[] {
    return Array.from(packs.values()).filter((p) => p.enabled);
}

/**
 * Get all registered skill packs.
 */
export function getAllPacks(): SkillPack[] {
    return Array.from(packs.values());
}

// ── Management ──

/**
 * Enable or disable a skill pack.
 */
export function setPackEnabled(id: string, enabled: boolean): boolean {
    const pack = packs.get(id);
    if (!pack) return false;
    pack.enabled = enabled;
    return true;
}

// ── Initialization ──

/**
 * Initialize the registry with all built-in and installed packs.
 * Call once at sidecar startup.
 */
export function initializeSkillPacks(): void {
    if (_initialized) return;

    // Load built-in packs from src/skills/packs/
    const builtins = loadBuiltinPacks();
    for (const pack of builtins) {
        registerPack(pack);
    }

    // Load user-installed packs from ~/.niom/skills/
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const installedDir = join(homeDir, ".niom", "skills");
    const installed = loadInstalledPacks(installedDir);
    for (const pack of installed) {
        registerPack(pack);
    }

    _initialized = true;
    console.log(
        `[Skills] Registry initialized: ${packs.size} packs ` +
        `(${builtins.length} built-in, ${installed.length} installed)`
    );
}

/**
 * Check if the registry has been initialized.
 */
export function isInitialized(): boolean {
    return _initialized;
}
