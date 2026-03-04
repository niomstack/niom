/**
 * ArtifactManager — manages file artifacts created by the agent.
 *
 * Storage strategy:
 *   1. If a workspace is active → {workspace}/.niom/artifacts/
 *   2. No workspace            → ~/.niom/artifacts/{contextId}/
 *
 * Each context (conversation or task) has its own manifest.json tracking
 * what artifacts were created. Artifacts are real files on disk; the manifest
 * is just the index that links them back to their source context.
 *
 * This is a singleton accessed throughout the sidecar.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync } from "fs";
import { join, basename } from "path";
import { getDataDir } from "../config.js";
import type { Artifact, ArtifactContext, ArtifactManifest } from "./types.js";
import { detectMimeType } from "./types.js";

// ── Constants ──

const MANIFEST_FILE = "manifest.json";

// ── ArtifactManager ──

export class ArtifactManager {
    private static instance: ArtifactManager | null = null;

    private constructor() { }

    static getInstance(): ArtifactManager {
        if (!ArtifactManager.instance) {
            ArtifactManager.instance = new ArtifactManager();
        }
        return ArtifactManager.instance;
    }

    // ═══════════════════════════════════════════════════════════════
    // PATH RESOLUTION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Resolve the artifact directory for a given context.
     *
     * Priority:
     *   1. If context has a workspace → {workspace}/.niom/artifacts/
     *   2. Otherwise                  → ~/.niom/artifacts/{contextId}/
     *
     * Creates the directory if it doesn't exist.
     */
    resolveArtifactDir(context: ArtifactContext): string {
        let dir: string;

        if (context.workspace) {
            // Workspace-bound artifacts — live with the project
            dir = join(context.workspace, ".niom", "artifacts");
        } else {
            // Global artifacts — scoped by context ID
            dir = join(getDataDir(), "artifacts", context.id);
        }

        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        return dir;
    }

    /**
     * Resolve the full path for a new artifact file.
     * Handles deduplication: existing name → name_v2, name_v3, etc.
     */
    resolveArtifactPath(name: string, context: ArtifactContext): string {
        const dir = this.resolveArtifactDir(context);
        let targetPath = join(dir, name);

        if (!existsSync(targetPath)) return targetPath;

        // Dedup: article.md → article_v2.md → article_v3.md
        const dotIdx = name.lastIndexOf(".");
        const stem = dotIdx > 0 ? name.slice(0, dotIdx) : name;
        const ext = dotIdx > 0 ? name.slice(dotIdx) : "";

        let version = 2;
        while (existsSync(targetPath)) {
            targetPath = join(dir, `${stem}_v${version}${ext}`);
            version++;
        }

        return targetPath;
    }

    // ═══════════════════════════════════════════════════════════════
    // REGISTRATION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Register a file as an artifact for a given context.
     *
     * Call this after the agent writes a file to link it to the
     * conversation or task that created it.
     *
     * @param filePath - Absolute path to the file that was created
     * @param context  - The conversation/task context
     * @returns The registered Artifact, or null if the file doesn't exist
     */
    register(filePath: string, context: ArtifactContext): Artifact | null {
        if (!existsSync(filePath)) {
            console.warn(`[artifacts] Cannot register — file not found: ${filePath}`);
            return null;
        }

        const stat = statSync(filePath);
        const name = basename(filePath);

        const artifact: Artifact = {
            id: crypto.randomUUID(),
            name,
            path: filePath,
            mimeType: detectMimeType(name),
            size: stat.size,
            contextType: context.type,
            contextId: context.id,
            createdAt: Date.now(),
        };

        // Add to manifest
        const manifest = this.loadManifest(context);
        manifest.artifacts.push(artifact);
        manifest.updatedAt = Date.now();
        this.saveManifest(context, manifest);

        console.log(`[artifacts] Registered: "${name}" → ${context.type}:${context.id.slice(0, 8)}`);
        return artifact;
    }

    // ═══════════════════════════════════════════════════════════════
    // QUERIES
    // ═══════════════════════════════════════════════════════════════

    /**
     * List all artifacts for a given context.
     */
    list(contextType: "conversation" | "task", contextId: string, workspace?: string): Artifact[] {
        const context: ArtifactContext = { type: contextType, id: contextId, workspace };
        const manifest = this.loadManifest(context);
        return manifest.artifacts;
    }

    /**
     * Get a specific artifact by ID across all contexts.
     * Searches workspace-bound manifests first, then global.
     */
    getById(artifactId: string, contextType: "conversation" | "task", contextId: string, workspace?: string): Artifact | null {
        const artifacts = this.list(contextType, contextId, workspace);
        return artifacts.find(a => a.id === artifactId) || null;
    }

    // ═══════════════════════════════════════════════════════════════
    // CLEANUP
    // ═══════════════════════════════════════════════════════════════

    /**
     * Clean up artifacts for a deleted conversation or task.
     *
     * Rules:
     *   - Non-workspace artifacts (~/.niom/artifacts/{contextId}/) → DELETE files + directory
     *   - Workspace artifacts ({workspace}/.niom/artifacts/)       → KEEP (user's project files)
     *   - Only the manifest entry is removed for workspace artifacts
     *
     * @returns Number of artifact files deleted
     */
    cleanup(contextType: "conversation" | "task", contextId: string): number {
        let deleted = 0;

        // Clean up non-workspace artifacts (those stored in ~/.niom/artifacts/{contextId}/)
        const globalDir = join(getDataDir(), "artifacts", contextId);
        if (existsSync(globalDir)) {
            try {
                // Count artifacts before deleting
                const manifest = this.loadManifest({ type: contextType, id: contextId });
                deleted = manifest.artifacts.length;
                rmSync(globalDir, { recursive: true, force: true });
                console.log(`[artifacts] Cleaned up ${deleted} artifact(s) for ${contextType}:${contextId.slice(0, 8)}`);
            } catch (err: any) {
                console.warn(`[artifacts] Cleanup failed for ${contextId.slice(0, 8)}:`, err.message);
            }
        }

        // Note: workspace artifacts are intentionally NOT deleted.
        // They live in the user's project and should persist even after
        // the conversation/task that created them is removed.

        return deleted;
    }

    // ═══════════════════════════════════════════════════════════════
    // MANIFEST PERSISTENCE
    // ═══════════════════════════════════════════════════════════════

    private getManifestPath(context: ArtifactContext): string {
        const dir = this.resolveArtifactDir(context);
        return join(dir, MANIFEST_FILE);
    }

    private loadManifest(context: ArtifactContext): ArtifactManifest {
        const manifestPath = this.getManifestPath(context);

        if (existsSync(manifestPath)) {
            try {
                const raw = readFileSync(manifestPath, "utf-8");
                return JSON.parse(raw) as ArtifactManifest;
            } catch {
                console.warn(`[artifacts] Corrupt manifest, resetting: ${manifestPath}`);
            }
        }

        // New manifest
        return {
            contextType: context.type,
            contextId: context.id,
            artifacts: [],
            updatedAt: Date.now(),
        };
    }

    private saveManifest(context: ArtifactContext, manifest: ArtifactManifest): void {
        const manifestPath = this.getManifestPath(context);
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    }
}
