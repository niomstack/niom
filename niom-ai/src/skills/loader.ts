/**
 * Skill Pack Loader — parses SKILL.md files into SkillPack objects.
 *
 * SKILL.md format (Anthropic Agent Skills spec):
 *   ---
 *   name: Code
 *   description: Software development...
 *   domain: code
 *   toolIds:
 *     - readFile
 *     - writeFile
 *   evalRubric: "Code compiles..."
 *   ---
 *   [markdown body = system prompt]
 *
 * Built-in packs:  src/skills/packs/{domain}/SKILL.md
 * Installed packs: ~/.niom/skills/{domain}/SKILL.md
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { SkillPack, SkillDomain, SkillManifest } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── YAML Frontmatter Parser (lightweight, no dependency) ──

function parseFrontmatter(content: string): { manifest: SkillManifest; body: string } {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) {
        throw new Error("SKILL.md must have YAML frontmatter delimited by ---");
    }

    const yaml = match[1];
    const body = match[2].trim();

    // Simple YAML parser for our flat schema + toolIds array
    const manifest: Record<string, unknown> = {};
    let currentKey = "";
    let inArray = false;
    const arrayItems: string[] = [];

    for (const line of yaml.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        // Array item: "  - value"
        if (inArray && trimmed.startsWith("- ")) {
            arrayItems.push(trimmed.slice(2).trim());
            continue;
        }

        // If we were building an array and hit a non-array line, flush it
        if (inArray) {
            manifest[currentKey] = [...arrayItems];
            arrayItems.length = 0;
            inArray = false;
        }

        // Key-value pair: "key: value" or "key:"
        const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
        if (kvMatch) {
            currentKey = kvMatch[1];
            const value = kvMatch[2].trim();

            if (value === "") {
                // Next lines might be array items
                inArray = true;
            } else {
                // Strip surrounding quotes if present
                manifest[currentKey] = value.replace(/^["']|["']$/g, "");
            }
        }
    }

    // Flush final array if we ended inside one
    if (inArray && arrayItems.length > 0) {
        manifest[currentKey] = [...arrayItems];
    }

    // Validate required fields
    if (!manifest.name || !manifest.domain) {
        throw new Error("SKILL.md must have 'name' and 'domain' in frontmatter");
    }

    return {
        manifest: {
            name: manifest.name as string,
            description: (manifest.description as string) || "",
            domain: manifest.domain as SkillDomain,
            toolIds: (manifest.toolIds as string[]) || [],
            evalRubric: manifest.evalRubric as string | undefined,
        },
        body,
    };
}

// ── Load a single SKILL.md ──

export function loadSkillFile(filePath: string, source: "builtin" | "installed"): SkillPack {
    if (!existsSync(filePath)) {
        throw new Error(`SKILL.md not found: ${filePath}`);
    }

    const content = readFileSync(filePath, "utf-8");
    const { manifest, body } = parseFrontmatter(content);

    return {
        id: manifest.domain === "general" ? "general" : manifest.name.toLowerCase().replace(/\s+/g, "-"),
        name: manifest.name,
        description: manifest.description,
        domain: manifest.domain,
        systemPrompt: body,
        toolIds: manifest.toolIds,
        evalRubric: manifest.evalRubric,
        enabled: true,
        source,
        path: filePath,
    };
}

// ── Load all built-in packs ──

export function loadBuiltinPacks(): SkillPack[] {
    // Try __dirname/packs first (works in dev with tsx)
    // If not found, try resolving relative to the source tree
    // (handles tsup builds where .md files aren't copied to dist/)
    let packsDir = join(__dirname, "packs");

    if (!existsSync(packsDir)) {
        // Fallback: look in src/skills/packs relative to project root
        const projectRoot = join(__dirname, "..", "..");
        const srcPacks = join(projectRoot, "src", "skills", "packs");
        if (existsSync(srcPacks)) {
            packsDir = srcPacks;
        }
    }

    const packs: SkillPack[] = [];

    if (!existsSync(packsDir)) {
        console.warn(`[Skills] Built-in packs directory not found: ${packsDir}`);
        return packs;
    }

    for (const entry of readdirSync(packsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillFile = join(packsDir, entry.name, "SKILL.md");
        if (!existsSync(skillFile)) continue;

        try {
            const pack = loadSkillFile(skillFile, "builtin");
            packs.push(pack);
            console.log(`[Skills] Loaded built-in pack: ${pack.name} (${pack.domain})`);
        } catch (err) {
            console.error(`[Skills] Failed to load ${skillFile}:`, err);
        }
    }

    return packs;
}

// ── Load user-installed packs ──

export function loadInstalledPacks(skillsDir: string): SkillPack[] {
    const packs: SkillPack[] = [];

    if (!existsSync(skillsDir)) return packs;

    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillFile = join(skillsDir, entry.name, "SKILL.md");
        if (!existsSync(skillFile)) continue;

        try {
            const pack = loadSkillFile(skillFile, "installed");
            packs.push(pack);
            console.log(`[Skills] Loaded installed pack: ${pack.name} (${pack.domain})`);
        } catch (err) {
            console.error(`[Skills] Failed to load ${skillFile}:`, err);
        }
    }

    return packs;
}
