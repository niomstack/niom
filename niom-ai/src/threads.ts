/**
 * Thread persistence — now backed by MemoryStore.
 *
 * Conversations are stored as encrypted files at ~/.niom/memory/conversations/.
 * Listing reads from the master index (O(1)), not by scanning+decrypting all files.
 *
 * Types are defined in the backend and are identical to src/shared/types.ts
 * (the frontend canonical types). They are separate because the backend
 * is a distinct TypeScript project with its own tsconfig.
 */

import { MemoryStore, type ConversationEntry } from "./memory/store.js";

// ── Types (canonical backend copies — identical to src/shared/types.ts) ──

export interface MessageMetadata {
    type?: "response" | "thinking" | "error";
    provider?: string;
    latency_ms?: number;
    toolCalls?: Array<{
        id: string;
        toolName: string;
        input?: any;
        output?: any;
        status: "running" | "complete" | "error";
    }>;
    contentParts?: Array<
        | { type: "text"; start: number; end: number }
        | { type: "tool"; toolCallId: string }
    >;
}

export interface Message {
    id: string;
    role: "user" | "niom" | "system";
    content: string;
    timestamp: number;
    metadata?: MessageMetadata;
}

export type ThreadStatus = "active" | "thinking" | "paused" | "completed" | "failed";

export interface Thread {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    status: ThreadStatus;
    messages: Message[];
}

export interface ThreadSummary {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    status: ThreadStatus;
    messageCount: number;
    lastMessage?: string;
}

// ── Helper: Thread → ConversationEntry ──

function toEntry(thread: Thread): ConversationEntry {
    const lastMsg = [...thread.messages].reverse().find(m => m.role === "niom");
    return {
        id: thread.id,
        title: thread.title,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        status: thread.status,
        messageCount: thread.messages.length,
        lastMessage: lastMsg?.content?.slice(0, 100),
    };
}

// ── Helper ──

function store(): MemoryStore {
    return MemoryStore.getInstance();
}

// ── CRUD ──

/**
 * List all threads (from index — no decryption needed).
 * Returns summaries sorted by most recently updated.
 */
export function listThreads(): ThreadSummary[] {
    const entries = store().list("conversations");
    return (entries as ThreadSummary[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Get a full thread by ID (decrypts from disk).
 */
export function getThread(id: string): Thread | null {
    return store().load<Thread>("conversations", id);
}

/**
 * Save a thread (encrypts to disk + updates index).
 */
export function saveThread(thread: Thread): void {
    store().save("conversations", thread.id, thread, toEntry(thread));
}

/**
 * Delete a thread.
 */
export function deleteThread(id: string): boolean {
    return store().delete("conversations", id);
}

/**
 * Clear all threads.
 */
export function clearAllThreads(): number {
    return store().clearCollection("conversations");
}
