/**
 * Shared types between NIOM frontend and backend.
 *
 * Single source of truth — both sides import from here.
 */

// ── Messages ──

export type MessageType = "response" | "thinking" | "error";

export interface MessageMetadata {
    type?: MessageType;
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

// ── Threads / Conversations ──

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

// ── Brain / Memory ──

export interface BrainData {
    facts: string[];
    preferences: Record<string, string>;
    patterns: string[];
    updatedAt: number;
}
