/**
 * Chat Service — AI SDK v6 model resolution & system prompt.
 *
 * Handles multi-provider model routing and system prompt construction.
 * The actual streaming, tool loops, and approval are handled by
 * ToolLoopAgent in agent.ts.
 *
 * This file provides:
 *   - resolveModel(modelId) — parses "provider:model" and returns LanguageModel
 *   - buildSystemPrompt() — constructs the base system prompt
 *   - ChatServiceError — typed error class with user-friendly messages
 */

import { generateId } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { getApiKey, getConfig } from "./config.service";
import { buildNCFContextPrompt } from "@/main/context/injection";

// ─── Provider Cache ──────────────────────────────────────────────────
// Providers are stateless factories — safe to cache per API key.

const providerCache = new Map<string, ReturnType<typeof createOpenAI | typeof createAnthropic | typeof createGoogleGenerativeAI>>();

function clearProviderCache(): void {
  providerCache.clear();
}

// ─── Model Resolution ────────────────────────────────────────────────

/**
 * Parse a model ID string into provider + model name.
 * Format: "provider:model" e.g. "anthropic:claude-sonnet-4-20250514"
 */
function parseModelId(modelId: string): { providerId: string; modelName: string } {
  const colonIndex = modelId.indexOf(":");
  if (colonIndex === -1) {
    throw new ChatServiceError(
      `Invalid model ID format: "${modelId}". Expected "provider:model" (e.g. "anthropic:claude-sonnet-4-20250514")`,
      "INVALID_MODEL_ID",
    );
  }
  return {
    providerId: modelId.slice(0, colonIndex),
    modelName: modelId.slice(colonIndex + 1),
  };
}

/**
 * Resolve a model ID to an AI SDK LanguageModel instance.
 * Caches provider instances per API key for reuse.
 */
export function resolveModel(modelId: string): LanguageModel {
  const { providerId, modelName } = parseModelId(modelId);

  const key = getApiKey(providerId);
  const config = getConfig();

  const cacheKey = `${providerId}:${key || ""}`;

  let provider = providerCache.get(cacheKey);

  if (!provider) {
    switch (providerId) {
      case "openai":
        if (!key) throw new ChatServiceError("OpenAI API key not configured. Please add it in Settings.", "MISSING_API_KEY");
        provider = createOpenAI({ apiKey: key });
        break;

      case "anthropic":
        if (!key) throw new ChatServiceError("Anthropic API key not configured. Please add it in Settings.", "MISSING_API_KEY");
        provider = createAnthropic({ apiKey: key });
        break;

      case "google":
        if (!key) throw new ChatServiceError("Google AI API key not configured. Please add it in Settings.", "MISSING_API_KEY");
        provider = createGoogleGenerativeAI({ apiKey: key });
        break;

      case "ollama": {
        const ollamaUrl = config.ollamaUrl || "http://localhost:11434/v1";
        provider = createOpenAI({
          baseURL: ollamaUrl,
          apiKey: "ollama", // Ollama doesn't need a real key
        });
        break;
      }

      default:
        throw new ChatServiceError(
          `Unknown provider "${providerId}". Supported: openai, anthropic, google, ollama`,
          "UNKNOWN_PROVIDER",
        );
    }

    providerCache.set(cacheKey, provider);
  }

  return provider(modelName) as LanguageModel;
}

/**
 * Resolve the default model for background tasks (memory extraction, session summaries).
 * Uses the user's configured default model.
 */
export function resolveModelForMemory(): LanguageModel {
  const config = getConfig();
  return resolveModel(config.defaultModel);
}

// ─── System Prompt ───────────────────────────────────────────────────

/**
 * Build the base system prompt for NIOM.
 * This is used by the ToolLoopAgent in agent.ts.
 */
export function buildSystemPrompt(): string {
  let prompt = `You are NIOM — a personal AI assistant running natively on the user's computer.
You have direct access to the filesystem, terminal, and web via tools.
You are direct, concise, and action-oriented.

## Core Behavior
- When the user asks you to do something, DO IT. Don't ask for confirmation unless the task is genuinely ambiguous.
- When the user agrees to proceed ("yes", "do it", "let's go", "sounds good"), act IMMEDIATELY. Never re-ask.
- Execute first, then summarize what you did. Don't narrate what you're about to do in detail.
- Keep responses concise. Avoid repeating information the user already knows.
- When you don't know something, say so honestly.

## File Operations
- For creating new files or making significant changes, use \`proposeArtifact\` to stage a preview. The user will see a rich preview card and can review, edit, then apply. This is preferred over writing code in markdown.
- For small, targeted edits (adding a line, fixing a typo, updating a config value), use \`writeFile\` directly.
- NEVER output large code blocks in your response text when you could use \`proposeArtifact\` instead. The user gets a much better experience with the preview card.
- When proposing multiple files, propose them all in sequence, then write a brief summary. Don't explain each file's contents — the preview cards already show them.

## Code Style
- Write clean, well-documented code.
- Follow the project's existing conventions when detected.

## Tool Output Self-Correction
Your tools return structured results with \`status\`, \`summary\`, and \`suggestions\` fields. Use these for self-correction:
- **status: "error"** — The tool failed. Read the \`summary\` for what went wrong. Common patterns:
  - Path was a directory when you expected a file → re-run \`read\` with the directory path
  - File not found → check the path, try listing the parent directory first
  - Permission denied → inform the user
  - Command failed → examine the error output, adjust the command, retry
- **status: "partial"** — The tool succeeded but results are incomplete (e.g., file was truncated, output hit size limit). The \`summary\` explains what was truncated.
- **suggestions[]** — An array of recommended next tools or actions. Follow these when available — they encode learned patterns.
- DO NOT repeat the exact same tool call that just failed. Adjust the args based on the error.
- Maximum 3 retries for any single logical operation before explaining the issue to the user.`;

  // Inject NCF structured context (profile, preferences, patterns, projects)
  prompt += buildNCFContextPrompt();

  return prompt;
}

// ─── Error Types ─────────────────────────────────────────────────────

export type ChatErrorCode =
  | "INVALID_MODEL_ID"
  | "MISSING_API_KEY"
  | "UNKNOWN_PROVIDER"
  | "PROVIDER_ERROR"
  | "NETWORK_ERROR"
  | "RATE_LIMIT"
  | "CONTEXT_LENGTH"
  | "UNKNOWN";

export class ChatServiceError extends Error {
  public readonly code: ChatErrorCode;

  constructor(message: string, code: ChatErrorCode) {
    super(message);
    this.name = "ChatServiceError";
    this.code = code;
  }

  /** Create a ChatServiceError from an unknown thrown value */
  static fromUnknown(error: unknown): ChatServiceError {
    if (error instanceof ChatServiceError) return error;

    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      // Classify common provider errors
      if (message.includes("401") || message.includes("unauthorized") || message.includes("invalid api key")) {
        return new ChatServiceError(`Authentication failed. Please check your API key. (${error.message})`, "MISSING_API_KEY");
      }
      if (message.includes("429") || message.includes("rate limit") || message.includes("too many requests")) {
        return new ChatServiceError(`Rate limited. Please wait a moment and try again. (${error.message})`, "RATE_LIMIT");
      }
      if (message.includes("context length") || message.includes("maximum") || message.includes("too long") || message.includes("token")) {
        return new ChatServiceError(`Message too long for this model. Try a shorter conversation or switch models. (${error.message})`, "CONTEXT_LENGTH");
      }
      if (message.includes("econnrefused") || message.includes("fetch failed") || message.includes("network")) {
        return new ChatServiceError(`Could not connect to the model provider. Check your internet connection. (${error.message})`, "NETWORK_ERROR");
      }

      return new ChatServiceError(error.message, "PROVIDER_ERROR");
    }

    return new ChatServiceError(String(error), "UNKNOWN");
  }

  /** User-friendly error message for the renderer */
  toUserMessage(): string {
    switch (this.code) {
      case "MISSING_API_KEY":
        return "API key missing or invalid. Please update it in Settings.";
      case "UNKNOWN_PROVIDER":
        return "Unknown model provider. Please select a valid model.";
      case "INVALID_MODEL_ID":
        return "Invalid model selection. Please pick a model from the dropdown.";
      case "RATE_LIMIT":
        return "Rate limited by the provider. Please wait a moment.";
      case "CONTEXT_LENGTH":
        return "Conversation too long for this model. Try starting a new thread.";
      case "NETWORK_ERROR":
        return "Connection failed. Check your internet or Ollama status.";
      case "PROVIDER_ERROR":
        return `Model error: ${this.message}`;
      default:
        return `Something went wrong: ${this.message}`;
    }
  }
}

export { clearProviderCache, generateId };
