/**
 * Marketplace Adapter — integrates with Skills.sh and MCP Registry.
 *
 * ZERO EXTERNAL DEPENDENCIES — all downloads are pure HTTP fetches.
 * NIOM handles everything internally so users never need Node.js, npx,
 * or any other toolchain installed on their machine.
 *
 *   1. Skills.sh (Vercel) — SKILL.md files in the Anthropic format
 *      - Same format NIOM already uses (YAML frontmatter + markdown body)
 *      - Download via HTTP: Skills.sh API → GitHub raw → GitHub API fallback
 *      - No CLI or subprocess required
 *
 *   2. MCP Registry (Official) — Model Context Protocol servers
 *      - JSON metadata for MCP server connections
 *      - Auto-connects via mcpManager
 *      - Tools automatically indexed into the skill graph
 *
 * Install Flow:
 *   1. User clicks Install in UI
 *   2. Backend fetches SKILL.md content via HTTP (multiple fallback strategies)
 *   3. Writes to ~/.niom/skills/<name>/SKILL.md
 *   4. Parses + registers in pack registry
 *   5. Re-indexes skill tree graph
 *   6. Returns success with progress updates
 */

import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { loadSkillFile } from "./loader.js";
import { registerPack } from "./registry.js";
import { mcpManager } from "../mcp/client.js";

// ── Types ──

export interface MarketplaceResult {
    id: string;
    name: string;
    description: string;
    source: "skills.sh" | "mcp";
    /** For skills.sh: owner/repo format */
    identifier: string;
    /** Downloads or installs count */
    installs?: number;
    /** Author or publisher */
    author?: string;
    /** Whether this is already installed */
    installed: boolean;
}

export interface InstalledCommunitySkill {
    id: string;
    name: string;
    description: string;
    domain: string;
    source: "skills.sh" | "mcp";
    /** When it was installed */
    installedAt: string;
    /** Original identifier used to install */
    identifier: string;
}

export interface InstallResult {
    success: boolean;
    id: string;
    name: string;
    message: string;
    /** Step-by-step progress log */
    steps: InstallStep[];
}

export interface InstallStep {
    step: string;
    status: "pending" | "running" | "done" | "skipped" | "failed";
    detail?: string;
}

/** Callback for real-time progress updates during install */
export type ProgressCallback = (step: InstallStep) => void;

// ── Paths ──

function getSkillsDir(): string {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return join(home, ".niom", "skills");
}

function getManifestPath(): string {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return join(home, ".niom", "marketplace-manifest.json");
}

// ── Manifest (track installed marketplace items) ──

interface Manifest {
    installed: InstalledCommunitySkill[];
}

function loadManifest(): Manifest {
    try {
        const path = getManifestPath();
        if (existsSync(path)) {
            return JSON.parse(readFileSync(path, "utf-8"));
        }
    } catch { /* ignore */ }
    return { installed: [] };
}

function saveManifest(manifest: Manifest): void {
    const path = getManifestPath();
    const dir = join(path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(manifest, null, 2));
}

// ── Search ──

/**
 * Search both Skills.sh and MCP Registry in parallel.
 */
export async function searchMarketplace(query: string): Promise<MarketplaceResult[]> {
    const manifest = loadManifest();
    const installedIds = new Set(manifest.installed.map(s => s.id));

    const [skillsResults, mcpResults] = await Promise.allSettled([
        searchSkillsSh(query, installedIds),
        searchMCPRegistry(query, installedIds),
    ]);

    const results: MarketplaceResult[] = [];

    if (skillsResults.status === "fulfilled") {
        results.push(...skillsResults.value);
    }
    if (mcpResults.status === "fulfilled") {
        results.push(...mcpResults.value);
    }

    return results;
}

// ── Featured Skills ──

const FEATURED_QUERIES = ["github", "database", "web", "slack", "ai", "file"];

let _featuredCache: { results: MarketplaceResult[]; ts: number } | null = null;
const FEATURED_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Return a curated selection of featured skills from both registries.
 * Uses multiple discovery queries to give users a sense of what's available.
 */
export async function getFeaturedSkills(): Promise<MarketplaceResult[]> {
    // Return cached results if fresh
    if (_featuredCache && Date.now() - _featuredCache.ts < FEATURED_CACHE_TTL) {
        return _featuredCache.results;
    }

    const manifest = loadManifest();
    const installedIds = new Set(manifest.installed.map(s => s.id));

    // Search multiple queries in parallel for variety
    const allSettled = await Promise.allSettled(
        FEATURED_QUERIES.map(q => Promise.allSettled([
            searchSkillsSh(q, installedIds),
            searchMCPRegistry(q, installedIds),
        ]))
    );

    const seen = new Set<string>();
    const results: MarketplaceResult[] = [];

    for (const batch of allSettled) {
        if (batch.status !== "fulfilled") continue;
        for (const source of batch.value) {
            if (source.status !== "fulfilled") continue;
            for (const item of source.value) {
                if (!seen.has(item.id)) {
                    seen.add(item.id);
                    results.push(item);
                }
            }
        }
    }

    // Shuffle for variety and cap at 24
    const shuffled = results.sort(() => Math.random() - 0.5).slice(0, 24);

    _featuredCache = { results: shuffled, ts: Date.now() };
    return shuffled;
}

/**
 * Search Skills.sh for agent skills.
 *
 * Skills.sh hosts SKILL.md files in the same format NIOM uses.
 * We query their API and return normalized results.
 */
async function searchSkillsSh(query: string, installedIds: Set<string>): Promise<MarketplaceResult[]> {
    try {
        // Skills.sh registry — search via their API
        // API returns: { skills: [{ id, skillId, name, installs, source }] }
        const url = `https://skills.sh/api/search?q=${encodeURIComponent(query)}&limit=20`;
        const response = await fetch(url, {
            headers: { "Accept": "application/json" },
            signal: AbortSignal.timeout(8000),
        });

        if (!response.ok) {
            console.warn(`[marketplace] Skills.sh returned ${response.status}`);
            return [];
        }

        const data = await response.json() as any;
        const skills = data.skills || data.results || [];

        if (!Array.isArray(skills)) return [];

        return skills.slice(0, 15).map((skill: any) => {
            const id = `skills.sh:${skill.id || skill.skillId || skill.name}`;
            // Skills.sh search API doesn't return description,
            // use source (owner/repo) as a subtitle
            const source = skill.source || "";
            const author = source ? source.split("/")[0] : "";
            return {
                id,
                name: skill.skillId || skill.name || "Unnamed",
                description: skill.description || (source ? `From ${source}` : ""),
                source: "skills.sh" as const,
                identifier: skill.id || skill.skillId || "",
                installs: skill.installs || 0,
                author,
                installed: installedIds.has(id),
            };
        });
    } catch (err: any) {
        console.warn("[marketplace] Skills.sh search failed:", err.message);
        return [];
    }
}

/**
 * Search the official MCP Registry for MCP servers.
 */
async function searchMCPRegistry(query: string, installedIds: Set<string>): Promise<MarketplaceResult[]> {
    try {
        // Official MCP Registry — v0.1 API
        // GET /v0.1/servers?search=<query>&limit=15
        // Response: { servers: [{ server: { name, description, ... }, _meta: {...} }] }
        const url = `https://registry.modelcontextprotocol.io/v0.1/servers?search=${encodeURIComponent(query)}&limit=15`;
        const response = await fetch(url, {
            headers: { "Accept": "application/json" },
            signal: AbortSignal.timeout(8000),
        });

        if (!response.ok) {
            console.warn(`[marketplace] MCP Registry returned ${response.status}`);
            return [];
        }

        const data = await response.json() as any;
        const entries = data.servers || [];

        if (!Array.isArray(entries)) return [];

        return entries.slice(0, 10).map((entry: any) => {
            // Each entry has { server: {...}, _meta: {...} }
            const server = entry.server || entry;
            const name = server.name || "Unnamed";
            const id = `mcp:${name}`;
            // Extract author from name (format: namespace/server-name)
            const nameParts = name.split("/");
            const author = nameParts.length > 1 ? nameParts[0] : "";
            const displayName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : name;
            return {
                id,
                name: displayName,
                description: server.description || "",
                source: "mcp" as const,
                identifier: name,
                installs: 0,
                author,
                installed: installedIds.has(id),
            };
        });
    } catch (err: any) {
        console.warn("[marketplace] MCP Registry search failed:", err.message);
        return [];
    }
}

// ── Install ──

/**
 * Install a community skill or MCP server.
 * All downloads happen via pure HTTP — no external tools required.
 */
export async function installMarketplaceSkill(
    source: string,
    identifier: string,
    config?: any,
    onProgress?: ProgressCallback,
): Promise<InstallResult> {
    if (source === "skills.sh") {
        return installFromSkillsSh(identifier, onProgress);
    } else if (source === "mcp") {
        return installMCPServer(identifier, config, onProgress);
    }
    return { success: false, id: "", name: "", message: `Unknown source: ${source}`, steps: [] };
}

/**
 * Install a skill from Skills.sh — PURE HTTP, zero external dependencies.
 *
 * Strategy (cascading fallbacks):
 *   1. Skills.sh API: GET /api/skill/<identifier> → returns SKILL.md content
 *   2. GitHub Raw: fetch raw SKILL.md from github.com/<owner>/<repo>/main/SKILL.md
 *   3. GitHub API: list repo contents → find SKILL.md → download
 *   4. GitHub API: if skills/ directory exists → find skill folder → download SKILL.md
 *
 * No npx, no Node.js, no CLI — all HTTP.
 */
async function installFromSkillsSh(
    identifier: string,
    onProgress?: ProgressCallback,
): Promise<InstallResult> {
    const skillsDir = getSkillsDir();
    const safeName = identifier.replace(/[/\\]/g, "-").replace(/[^a-zA-Z0-9-_]/g, "");
    const targetDir = join(skillsDir, safeName);
    const steps: InstallStep[] = [];

    const report = (step: string, status: InstallStep["status"], detail?: string) => {
        const entry: InstallStep = { step, status, detail };
        steps.push(entry);
        onProgress?.(entry);
        if (status === "running") console.log(`[marketplace] ${step}: ${detail || "..."}`);
    };

    try {
        // Create target directory
        report("Prepare", "running", "Creating skill directory");
        if (!existsSync(targetDir)) {
            mkdirSync(targetDir, { recursive: true });
        }
        report("Prepare", "done", targetDir);

        let skillContent: string | null = null;

        // ── Strategy 1: Skills.sh API ──
        report("Fetch from Skills.sh", "running", `GET /api/skill/${identifier}`);
        try {
            const apiUrl = `https://skills.sh/api/skill/${identifier}`;
            const response = await fetch(apiUrl, {
                signal: AbortSignal.timeout(10000),
            });
            if (response.ok) {
                const data = await response.json() as any;
                skillContent = data.content || data.skill?.content || null;
                if (skillContent) {
                    report("Fetch from Skills.sh", "done", `Downloaded ${skillContent.length} bytes`);
                } else {
                    report("Fetch from Skills.sh", "skipped", "API returned no content");
                }
            } else {
                report("Fetch from Skills.sh", "skipped", `HTTP ${response.status}`);
            }
        } catch {
            report("Fetch from Skills.sh", "skipped", "API unreachable");
        }

        // ── Strategy 2: GitHub Raw (direct SKILL.md) ──
        if (!skillContent && identifier.includes("/")) {
            const [owner, repo, ...pathParts] = identifier.split("/");

            // Try root SKILL.md first
            report("Fetch from GitHub", "running", `Trying ${owner}/${repo}/SKILL.md`);
            try {
                const skillPath = pathParts.length > 0 ? pathParts.join("/") : "SKILL.md";
                const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${skillPath}`;
                const response = await fetch(rawUrl, {
                    signal: AbortSignal.timeout(10000),
                });
                if (response.ok) {
                    skillContent = await response.text();
                    report("Fetch from GitHub", "done", `Downloaded ${skillContent.length} bytes from raw`);
                } else {
                    report("Fetch from GitHub", "skipped", `HTTP ${response.status}`);
                }
            } catch {
                report("Fetch from GitHub", "skipped", "Raw fetch failed");
            }

            // ── Strategy 3: GitHub API — browse repo for SKILL.md files ──
            if (!skillContent) {
                report("Browse GitHub repo", "running", `Searching ${owner}/${repo} for SKILL.md`);
                try {
                    skillContent = await findSkillMdInRepo(owner, repo);
                    if (skillContent) {
                        report("Browse GitHub repo", "done", `Found and downloaded ${skillContent.length} bytes`);
                    } else {
                        report("Browse GitHub repo", "skipped", "No SKILL.md found in repo");
                    }
                } catch {
                    report("Browse GitHub repo", "skipped", "API request failed");
                }
            }
        }

        if (!skillContent) {
            // Clean up empty directory
            rmSync(targetDir, { recursive: true, force: true });
            report("Install", "failed", "Could not download skill content from any source");
            return {
                success: false,
                id: `skills.sh:${safeName}`,
                name: safeName,
                message: "Could not download skill content. Check the identifier and try again.",
                steps,
            };
        }

        // Write SKILL.md
        report("Save", "running", "Writing SKILL.md to disk");
        const skillPath = join(targetDir, "SKILL.md");
        writeFileSync(skillPath, skillContent, "utf-8");
        report("Save", "done", skillPath);

        // Load and register the pack
        report("Register", "running", "Parsing and registering skill pack");
        try {
            const pack = loadSkillFile(skillPath, "installed");
            registerPack(pack);
            report("Register", "done", `${pack.name} (${pack.domain})`);

            console.log(`[marketplace] Installed skill: ${pack.name} (${pack.domain})`);

            // Track in manifest
            const manifest = loadManifest();
            manifest.installed.push({
                id: `skills.sh:${safeName}`,
                name: pack.name,
                description: pack.description,
                domain: pack.domain,
                source: "skills.sh",
                installedAt: new Date().toISOString(),
                identifier,
            });
            saveManifest(manifest);
            report("Manifest", "done", "Tracked in marketplace manifest");

            return {
                success: true,
                id: `skills.sh:${safeName}`,
                name: pack.name,
                message: `Installed "${pack.name}" skill pack (domain: ${pack.domain})`,
                steps,
            };
        } catch (err: any) {
            report("Register", "failed", err.message);
            return {
                success: false,
                id: `skills.sh:${safeName}`,
                name: safeName,
                message: `Skill downloaded but failed to parse: ${err.message}`,
                steps,
            };
        }
    } catch (err: any) {
        report("Install", "failed", err.message);
        return {
            success: false,
            id: `skills.sh:${safeName}`,
            name: safeName,
            message: err.message,
            steps,
        };
    }
}

/**
 * Search a GitHub repo for SKILL.md files using the GitHub API.
 * No authentication required for public repos (rate limited to 60/hr).
 *
 * Checks:
 *   1. Root SKILL.md
 *   2. skills/ directory → first SKILL.md found
 *   3. .agent/skills/ directory (alternative convention)
 */
async function findSkillMdInRepo(owner: string, repo: string): Promise<string | null> {
    const ghApi = `https://api.github.com/repos/${owner}/${repo}/contents`;

    // Check common locations
    const paths = [
        "SKILL.md",
        "skills",
        ".agent/skills",
        ".agents/skills",
    ];

    for (const path of paths) {
        try {
            const response = await fetch(`${ghApi}/${path}`, {
                headers: {
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": "NIOM-Marketplace/1.0",
                },
                signal: AbortSignal.timeout(8000),
            });

            if (!response.ok) continue;

            const data = await response.json() as any;

            // If it's a file (SKILL.md at root)
            if (data.type === "file" && data.download_url) {
                const fileResp = await fetch(data.download_url, {
                    signal: AbortSignal.timeout(10000),
                });
                if (fileResp.ok) return await fileResp.text();
            }

            // If it's a directory, look for SKILL.md inside
            if (Array.isArray(data)) {
                const skillFile = data.find((f: any) =>
                    f.name === "SKILL.md" || f.name === "skill.md"
                );
                if (skillFile?.download_url) {
                    const fileResp = await fetch(skillFile.download_url, {
                        signal: AbortSignal.timeout(10000),
                    });
                    if (fileResp.ok) return await fileResp.text();
                }

                // Check subdirectories (skill folders)
                const dirs = data.filter((f: any) => f.type === "dir");
                for (const dir of dirs.slice(0, 5)) {
                    const subResp = await fetch(`${ghApi}/${path}/${dir.name}`, {
                        headers: {
                            "Accept": "application/vnd.github.v3+json",
                            "User-Agent": "NIOM-Marketplace/1.0",
                        },
                        signal: AbortSignal.timeout(5000),
                    });
                    if (!subResp.ok) continue;
                    const subData = await subResp.json() as any;
                    if (Array.isArray(subData)) {
                        const sub = subData.find((f: any) =>
                            f.name === "SKILL.md" || f.name === "skill.md"
                        );
                        if (sub?.download_url) {
                            const fileResp = await fetch(sub.download_url, {
                                signal: AbortSignal.timeout(10000),
                            });
                            if (fileResp.ok) return await fileResp.text();
                        }
                    }
                }
            }
        } catch {
            continue;
        }
    }

    return null;
}

/**
 * Install an MCP server from the registry.
 */
async function installMCPServer(identifier: string, config?: any, onProgress?: ProgressCallback): Promise<InstallResult> {
    const steps: InstallStep[] = [];
    const report = (step: string, status: InstallStep["status"], detail?: string) => {
        const entry: InstallStep = { step, status, detail };
        steps.push(entry);
        onProgress?.(entry);
        if (status === "running") console.log(`[marketplace] ${step}: ${detail || "..."}`);
    };

    try {
        // Fetch server metadata from the MCP Registry (v0.1 API)
        let serverConfig = config;
        if (!serverConfig) {
            const encodedName = encodeURIComponent(identifier);
            report("Fetch metadata", "running", `GET /v0.1/servers/${encodedName}/versions/latest`);
            try {
                const response = await fetch(
                    `https://registry.modelcontextprotocol.io/v0.1/servers/${encodedName}/versions/latest`,
                    { signal: AbortSignal.timeout(10000) },
                );
                if (!response.ok) {
                    report("Fetch metadata", "failed", `HTTP ${response.status}`);
                    return {
                        success: false,
                        id: `mcp:${identifier}`,
                        name: identifier,
                        message: `MCP server metadata not found: ${identifier} (HTTP ${response.status})`,
                        steps,
                    };
                }
                const data = await response.json() as any;
                // v0.1 API wraps in { server: {...}, _meta: {...} }
                serverConfig = data.server || data;
                report("Fetch metadata", "done", `Got config for ${serverConfig.name || identifier}`);
            } catch (err: any) {
                report("Fetch metadata", "failed", err.message || "Network error");
                return {
                    success: false,
                    id: `mcp:${identifier}`,
                    name: identifier,
                    message: `Could not fetch MCP server metadata: ${err.message}`,
                    steps,
                };
            }
        }

        const serverName = serverConfig.name || identifier;

        // Check if the server has a local command (packages with stdio transport)
        let command: string | undefined;
        let args: string[] = [];

        // Try legacy format first
        command = serverConfig.command || serverConfig.runtime?.command;
        args = serverConfig.args || serverConfig.runtime?.args || [];

        // Try v0.1 packages format
        if (!command && serverConfig.packages) {
            const pkg = Array.isArray(serverConfig.packages)
                ? serverConfig.packages[0]
                : serverConfig.packages;
            if (pkg?.runtimeHint) {
                command = pkg.runtimeHint; // e.g., "npx"
                args = [];
                // Build args from packageArguments
                if (pkg.packageArguments) {
                    for (const arg of pkg.packageArguments) {
                        if (arg.value) args.push(arg.value);
                    }
                }
                // Prepend the package identifier as first arg for npx/pip etc.
                if (pkg.identifier) {
                    args = [pkg.identifier, ...args];
                }
            }
        }

        // If the server only has remote transport (Smithery, etc.), we can't run it locally
        if (!command) {
            const hasRemotes = serverConfig.remotes && serverConfig.remotes.length > 0;
            if (hasRemotes) {
                const remoteUrl = serverConfig.remotes[0]?.url || "unknown";
                report("Connect", "skipped", `This MCP server uses remote transport (${remoteUrl})`);
                return {
                    success: false,
                    id: `mcp:${identifier}`,
                    name: serverName,
                    message: `"${serverName}" requires remote transport and can't be installed locally. It would need API keys and a Smithery account.`,
                    steps,
                };
            }

            report("Connect", "failed", "No runnable command found in server config");
            return {
                success: false,
                id: `mcp:${identifier}`,
                name: serverName,
                message: "No command found in server metadata. MCP servers require a command to run locally.",
                steps,
            };
        }

        report("Connect", "running", `Starting ${serverName} (${command} ${args.join(" ")})`);
        await mcpManager.connect({
            name: serverName,
            command,
            args,
            ...(serverConfig.env ? { env: serverConfig.env } : {}),
        });
        report("Connect", "done", `Server ${serverName} connected`);

        // Track in manifest
        report("Manifest", "running", "Tracking installation");
        const manifest = loadManifest();
        manifest.installed.push({
            id: `mcp:${identifier}`,
            name: serverName,
            description: serverConfig.description || "",
            domain: "general",
            source: "mcp",
            installedAt: new Date().toISOString(),
            identifier,
        });
        saveManifest(manifest);
        report("Manifest", "done", "Saved to marketplace manifest");

        console.log(`[marketplace] Connected MCP server: ${serverName}`);

        return {
            success: true,
            id: `mcp:${identifier}`,
            name: serverName,
            message: `Connected MCP server "${serverName}"`,
            steps,
        };
    } catch (err: any) {
        report("Connect", "failed", err.message);
        return {
            success: false,
            id: `mcp:${identifier}`,
            name: identifier,
            message: err.message,
            steps,
        };
    }
}

// ── Uninstall ──

/**
 * Uninstall a community skill or MCP server.
 */
export async function uninstallMarketplaceSkill(id: string): Promise<InstallResult> {
    const manifest = loadManifest();
    const entry = manifest.installed.find(s => s.id === id);

    if (!entry) {
        return { success: false, id, name: "", message: `Not found: ${id}`, steps: [] };
    }

    if (entry.source === "skills.sh") {
        // Remove the skill directory
        const safeName = entry.identifier.replace(/[/\\]/g, "-").replace(/[^a-zA-Z0-9-_]/g, "");
        const targetDir = join(getSkillsDir(), safeName);
        if (existsSync(targetDir)) {
            rmSync(targetDir, { recursive: true, force: true });
        }
    } else if (entry.source === "mcp") {
        // Disconnect MCP server
        try {
            await mcpManager.disconnect(entry.name);
        } catch {
            // May already be disconnected
        }
    }

    // Remove from manifest
    manifest.installed = manifest.installed.filter(s => s.id !== id);
    saveManifest(manifest);

    console.log(`[marketplace] Uninstalled: ${entry.name} (${entry.source})`);

    return {
        success: true,
        id,
        name: entry.name,
        message: `Uninstalled "${entry.name}"`,
        steps: [{ step: "Uninstall", status: "done", detail: `Removed ${entry.name}` }],
    };
}

// ── Query ──

/**
 * Get all installed community skills (from the manifest).
 */
export function getInstalledCommunitySkills(): InstalledCommunitySkill[] {
    return loadManifest().installed;
}
