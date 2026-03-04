/**
 * Artifact Routes — API endpoints for querying and serving artifacts.
 *
 * GET /artifacts?contextType=conversation|task&contextId=xxx     — list artifacts
 * GET /artifacts/:id/content?contextType=...&contextId=...       — serve artifact content
 */

import { Hono } from "hono";
import { readFileSync, existsSync } from "fs";
import { ArtifactManager } from "../artifacts/index.js";
import { detectMimeType } from "../artifacts/types.js";

const app = new Hono();
const manager = () => ArtifactManager.getInstance();

// ── List artifacts for a context ──

app.get("/artifacts", (c) => {
    const contextType = c.req.query("contextType") as "conversation" | "task" | undefined;
    const contextId = c.req.query("contextId");
    const workspace = c.req.query("workspace");

    if (!contextType || !contextId) {
        return c.json({ error: "contextType and contextId are required" }, 400);
    }

    if (contextType !== "conversation" && contextType !== "task") {
        return c.json({ error: "contextType must be 'conversation' or 'task'" }, 400);
    }

    const artifacts = manager().list(contextType, contextId, workspace || undefined);
    return c.json({ contextType, contextId, artifacts });
});

// ── Serve artifact content (for preview) ──

app.get("/artifacts/:id/content", (c) => {
    const artifactId = c.req.param("id");
    const contextType = c.req.query("contextType") as "conversation" | "task" | undefined;
    const contextId = c.req.query("contextId");
    const workspace = c.req.query("workspace");

    if (!contextType || !contextId) {
        return c.json({ error: "contextType and contextId are required" }, 400);
    }

    const artifact = manager().getById(artifactId, contextType, contextId, workspace || undefined);
    if (!artifact) {
        return c.json({ error: "Artifact not found" }, 404);
    }

    if (!existsSync(artifact.path)) {
        return c.json({ error: "Artifact file no longer exists on disk" }, 404);
    }

    // For text-based artifacts, return content as text
    const mime = detectMimeType(artifact.name);
    if (mime.startsWith("text/") || mime === "application/json" || mime === "application/yaml" || mime === "application/toml") {
        try {
            const content = readFileSync(artifact.path, "utf-8");
            return c.json({
                artifact,
                content,
                truncated: content.length > 50_000,
                ...(content.length > 50_000 ? { content: content.slice(0, 50_000) } : {}),
            });
        } catch (err: any) {
            return c.json({ error: `Failed to read artifact: ${err.message}` }, 500);
        }
    }

    // For binary artifacts, just return metadata + path
    return c.json({
        artifact,
        content: null,
        binary: true,
        message: "Binary artifacts cannot be previewed inline. Use the file path to open.",
    });
});

export default app;
