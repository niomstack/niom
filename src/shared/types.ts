// ─── Chat ────────────────────────────────────────────────────────────

import type { UIMessage } from "ai";

/**
 * NIOM's persisted message type — extends AI SDK v6's UIMessage with
 * persistence-specific fields (content for search, createdAt, model).
 *
 * `parts` comes from UIMessage — the SDK's native format for text,
 * tool invocations, reasoning, sources, etc.
 *
 * `content` is a denormalized text field for fast search and context
 * building (memory extraction, session summaries) without having to
 * iterate parts every time.
 */
export interface NiomMessage extends UIMessage {
  /** Denormalized text content extracted from parts — for search and context */
  content: string;
  /** Model used for this specific message (enables mid-conversation switching) */
  model?: string;
  /** Timestamp */
  createdAt: number;
}

/**
 * @deprecated Use NiomMessage instead. Kept temporarily for migration.
 */
export type ChatMessage = NiomMessage;

/**
 * Extract the full text content from a UIMessage's parts array.
 * Used when building NiomMessage.content or when context code needs text.
 */
export function getTextFromParts(message: UIMessage): string {
  if (!message.parts || message.parts.length === 0) return "";
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("");
}

export interface Thread {
  id: string;
  title: string;
  messages: NiomMessage[];
  /** Default model for this thread (can be overridden per-message) */
  defaultModel: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  /** Whether LLM has already generated a title for this thread */
  llmTitleGenerated?: boolean;
}

/** Metadata-only thread listing (no messages — for sidebar performance) */
export interface ThreadMeta {
  id: string;
  title: string;
  defaultModel: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
}

// ─── Config ──────────────────────────────────────────────────────────

export interface ModelProvider {
  id: "openai" | "anthropic" | "google" | "ollama";
  name: string;
  enabled: boolean;
  /** Base URL override (primarily for Ollama or custom endpoints) */
  baseUrl?: string;
}

/** Available model definition */
export interface ModelOption {
  id: string;
  name: string;
  providerId: ModelProvider["id"];
}

export interface NiomConfig {
  providers: ModelProvider[];
  defaultModel: string;
  ollamaUrl: string;
  theme: "dark" | "light";
  /** Whether the user has completed the first-run onboarding wizard */
  onboardingComplete?: boolean;
}

/** The full model ID format: "provider:model" e.g. "anthropic:claude-sonnet-4-20250514" */
export type ModelId = `${ModelProvider["id"]}:${string}`;

// ─── IPC Event Payloads ──────────────────────────────────────────────

export interface ChatErrorPayload {
  threadId: string;
  error: string;
}

/** Payload sent from main → renderer when NCF extracts new memories. */
export interface MemoryUpdatePayload {
  newFacts: number;
  totalFacts: number;
}
