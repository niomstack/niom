/**
 * useArtifacts — hook for fetching artifacts linked to a conversation or task.
 *
 * Usage:
 *   const { artifacts, loading, refresh } = useArtifacts("conversation", threadId);
 *   const { artifacts, loading, refresh } = useArtifacts("task", taskId);
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { getSidecarUrl } from "../lib/useConfig";

// ── Types ──

export interface Artifact {
    id: string;
    name: string;
    path: string;
    mimeType: string;
    size: number;
    contextType: "conversation" | "task";
    contextId: string;
    createdAt: number;
}

// ── Hook ──

export function useArtifacts(
    contextType: "conversation" | "task",
    contextId: string | undefined,
    workspace?: string,
) {
    const [artifacts, setArtifacts] = useState<Artifact[]>([]);
    const [loading, setLoading] = useState(false);
    const prevKeyRef = useRef<string>("");

    const fetchArtifacts = useCallback(async () => {
        if (!contextId) {
            setArtifacts([]);
            return;
        }

        setLoading(true);
        try {
            const params = new URLSearchParams({
                contextType,
                contextId,
                ...(workspace ? { workspace } : {}),
            });
            const res = await fetch(`${getSidecarUrl()}/artifacts?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setArtifacts(data.artifacts || []);
        } catch (err) {
            console.warn("[artifacts] Fetch failed:", err);
            setArtifacts([]);
        } finally {
            setLoading(false);
        }
    }, [contextType, contextId, workspace]);

    // Auto-fetch when context changes
    useEffect(() => {
        const key = `${contextType}:${contextId}`;
        if (key !== prevKeyRef.current) {
            prevKeyRef.current = key;
            fetchArtifacts();
        }
    }, [contextType, contextId, fetchArtifacts]);

    return { artifacts, loading, refresh: fetchArtifacts };
}

// ── Helpers ──

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function getFileIcon(mimeType: string): string {
    if (mimeType.startsWith("text/markdown")) return "📝";
    if (mimeType.startsWith("text/typescript") || mimeType.startsWith("text/javascript")) return "📜";
    if (mimeType.startsWith("text/x-python")) return "🐍";
    if (mimeType.startsWith("text/html") || mimeType.startsWith("text/css")) return "🌐";
    if (mimeType === "application/json") return "📋";
    if (mimeType.startsWith("image/")) return "🖼️";
    if (mimeType === "application/pdf") return "📄";
    if (mimeType.startsWith("text/")) return "📃";
    return "📎";
}
