/**
 * useThreads — Thread state management for NIOM.
 *
 * Threads are stored as encrypted files on the sidecar at ~/.niom/memory/conversations/.
 * This hook keeps an in-memory cache and syncs mutations to the sidecar.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { Message, MessageMetadata, MessageType, Thread, ThreadStatus, ThreadSummary } from "../shared/types.js";

export type { Message, MessageMetadata, MessageType, Thread, ThreadStatus, ThreadSummary };

const SIDECAR_URL = "http://localhost:3001";

// ── Constants ──

const MAX_THREADS = 50;
const MAX_MESSAGES_PER_THREAD = 200;

// ── Sidecar API ──

async function fetchThreadSummaries(): Promise<Thread[]> {
    const res = await fetch(`${SIDECAR_URL}/threads`);
    if (!res.ok) return [];
    const { threads: summaries } = await res.json();
    // Summaries from the index are lightweight — no need to fetch full threads
    // Convert to Thread shape (messages left empty — loaded on demand)
    return summaries.map((s: any) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        status: s.status || "active",
        messages: [],
        _messageCount: s.messageCount || 0,
    }));
}

async function fetchFullThread(id: string): Promise<Thread | null> {
    const r = await fetch(`${SIDECAR_URL}/threads/${id}`);
    if (!r.ok) return null;
    return r.json();
}

async function saveToServer(thread: Thread): Promise<void> {
    await fetch(`${SIDECAR_URL}/threads/${thread.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(thread),
    });
}

async function deleteFromServer(id: string): Promise<void> {
    await fetch(`${SIDECAR_URL}/threads/${id}`, { method: "DELETE" });
}

async function clearServer(): Promise<void> {
    await fetch(`${SIDECAR_URL}/threads`, { method: "DELETE" });
}

// ── Helpers ──

function generateTitle(content: string): string {
    const clean = content.trim();
    if (!clean) return "New thread";
    const title = clean.charAt(0).toUpperCase() + clean.slice(1);
    return title.length > 50 ? title.slice(0, 50) + "…" : title;
}

// ── Hook ──

export function useThreads() {
    const [threads, setThreads] = useState<Thread[]>([]);
    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const saveQueueRef = useRef<Map<string, Thread>>(new Map());
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Load summaries from sidecar on mount ──
    useEffect(() => {
        let cancelled = false;
        fetchThreadSummaries().then(t => { if (!cancelled) setThreads(t); });
        return () => { cancelled = true; };
    }, []);

    // ── Load full thread data when activeThreadId changes ──
    useEffect(() => {
        if (!activeThreadId) return;
        const thread = threads.find(t => t.id === activeThreadId);
        // Only fetch if we have a stub (empty messages from summary)
        if (thread && thread.messages.length === 0) {
            fetchFullThread(activeThreadId).then(full => {
                if (full) {
                    setThreads(prev => prev.map(t => t.id === full.id ? full : t));
                }
            });
        }
    }, [activeThreadId]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Batched save (debounced) ──
    const flushSaves = useCallback(() => {
        const queue = saveQueueRef.current;
        if (queue.size === 0) return;
        const batch = Array.from(queue.values());
        queue.clear();
        batch.forEach(t => saveToServer(t).catch(e => console.warn(`[threads] save failed:`, e)));
    }, []);

    const debouncedSave = useCallback((thread: Thread) => {
        saveQueueRef.current.set(thread.id, thread);
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(flushSaves, 500);
    }, [flushSaves]);

    const immediateSave = useCallback((thread: Thread) => {
        saveQueueRef.current.delete(thread.id);
        saveToServer(thread).catch(e => console.warn(`[threads] save failed:`, e));
    }, []);

    // ── Derived ──

    const activeThread = activeThreadId
        ? threads.find(t => t.id === activeThreadId) ?? null
        : null;

    // ── CRUD ──

    const createThread = useCallback((query: string): Thread => {
        const now = Date.now();
        const thread: Thread = {
            id: crypto.randomUUID(),
            title: generateTitle(query),
            createdAt: now,
            updatedAt: now,
            status: "thinking",
            messages: [{ id: crypto.randomUUID(), role: "user", content: query, timestamp: now }],
        };
        setThreads(prev => [thread, ...prev].slice(0, MAX_THREADS));
        setActiveThreadId(thread.id);
        immediateSave(thread);
        return thread;
    }, [immediateSave]);

    const addMessage = useCallback((threadId: string, message: Omit<Message, "id" | "timestamp">): Message => {
        const full: Message = { ...message, id: crypto.randomUUID(), timestamp: Date.now() };
        setThreads(prev => prev.map(t => {
            if (t.id !== threadId) return t;
            const updated = { ...t, messages: [...t.messages, full].slice(-MAX_MESSAGES_PER_THREAD), updatedAt: Date.now() };
            debouncedSave(updated);
            return updated;
        }));
        return full;
    }, [debouncedSave]);

    const updateMessage = useCallback((threadId: string, messageId: string, updates: Partial<Message>) => {
        setThreads(prev => prev.map(t => {
            if (t.id !== threadId) return t;
            const updated = { ...t, messages: t.messages.map(m => m.id === messageId ? { ...m, ...updates } : m), updatedAt: Date.now() };
            debouncedSave(updated);
            return updated;
        }));
    }, [debouncedSave]);

    const updateThread = useCallback((threadId: string, updates: Partial<Omit<Thread, "id" | "messages">>) => {
        setThreads(prev => prev.map(t => {
            if (t.id !== threadId) return t;
            const updated = { ...t, ...updates, updatedAt: Date.now() };
            debouncedSave(updated);
            return updated;
        }));
    }, [debouncedSave]);

    const setThreadMessages = useCallback((threadId: string, newMessages: Message[]) => {
        setThreads(prev => prev.map(t => {
            if (t.id !== threadId) return t;
            const updated = { ...t, messages: newMessages, updatedAt: Date.now() };
            debouncedSave(updated);
            return updated;
        }));
    }, [debouncedSave]);

    const deleteThread = useCallback((threadId: string) => {
        setThreads(prev => prev.filter(t => t.id !== threadId));
        deleteFromServer(threadId);
        if (activeThreadId === threadId) setActiveThreadId(null);
    }, [activeThreadId]);

    const clearAllThreads = useCallback(() => {
        setThreads([]);
        setActiveThreadId(null);
        clearServer();
    }, []);

    const viewThread = useCallback((threadId: string) => {
        setActiveThreadId(threadId);
    }, []);

    const goHome = useCallback(() => {
        flushSaves();
        setActiveThreadId(null);
    }, [flushSaves]);

    const getLastResponse = useCallback((threadId: string): Message | null => {
        const thread = threads.find(t => t.id === threadId);
        if (!thread) return null;
        for (let i = thread.messages.length - 1; i >= 0; i--) {
            if (thread.messages[i].role === "niom") return thread.messages[i];
        }
        return null;
    }, [threads]);

    // ── Title Generation ──

    const titledThreadsRef = useRef<Set<string>>(new Set());

    const requestTitleGeneration = useCallback(async (threadId: string) => {
        const thread = threads.find(t => t.id === threadId);
        if (!thread || thread.messages.length < 2) return;

        const summary = thread.messages.slice(-6).map(m => `${m.role}: ${m.content.slice(0, 100)}`).join("\n");
        try {
            const res = await fetch(`${SIDECAR_URL}/run/sync`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: [{ role: "user", content: `Generate a short title (max 6 words, no quotes) for this conversation:\n${summary}` }] }),
            });
            if (!res.ok) return;
            const data = await res.json();
            const title = (data.text || "").trim().replace(/^"|"$/g, "");
            if (title && title.length > 0 && title.length < 60) {
                setThreads(prev => prev.map(t => {
                    if (t.id !== threadId) return t;
                    const updated = { ...t, title, updatedAt: Date.now() };
                    immediateSave(updated);
                    return updated;
                }));
                titledThreadsRef.current.add(threadId);
            }
        } catch (e) {
            console.warn("Title generation failed:", e);
        }
    }, [threads, immediateSave]);

    const shouldRegenerateTitle = useCallback((threadId: string): boolean => {
        const thread = threads.find(t => t.id === threadId);
        if (!thread) return false;
        const msgCount = thread.messages.length;
        const hasAiTitle = titledThreadsRef.current.has(threadId);

        if (!hasAiTitle && msgCount >= 2) return true;
        if (hasAiTitle && msgCount >= 4 && msgCount % 8 === 0) return true;
        if (hasAiTitle && thread.messages.length >= 4) {
            const duration = thread.messages[thread.messages.length - 1].timestamp - thread.messages[0].timestamp;
            const since = Date.now() - thread.updatedAt;
            if (duration > 15 * 60 * 1000 && since > 10 * 60 * 1000) return true;
        }
        return false;
    }, [threads]);

    return {
        threads, activeThread, activeThreadId,
        createThread, deleteThread, clearAllThreads, viewThread, goHome,
        addMessage, updateMessage, updateThread, setThreadMessages,
        getLastResponse, setActiveThreadId, requestTitleGeneration, shouldRegenerateTitle,
    };
}
