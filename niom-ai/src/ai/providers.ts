/**
 * providers.ts — Direct provider registry.
 *
 * Each provider is configured with the user's own API key from
 * ~/.niom/config.json → provider_keys.{provider}
 *
 * No Vercel AI Gateway dependency — users bring their own keys.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";
import { loadConfig, type NiomConfig } from "../config.js";

// ─── Provider Registry ────────────────────────────────────

export type ProviderName = "openai" | "anthropic" | "google" | "groq" | "mistral" | "xai";

export interface ProviderInfo {
    name: ProviderName;
    label: string;
    description: string;
    keyPlaceholder: string;
    keyPrefix: string;
    defaultModel: string;
    models: Array<{ id: string; name: string }>;
}

/**
 * Provider catalog — all supported providers with their model lists.
 * Models are listed statically so we don't need a gateway API call.
 */
const PROVIDERS: Record<ProviderName, ProviderInfo> = {
    openai: {
        name: "openai",
        label: "OpenAI",
        description: "GPT-4.1, GPT-4o, o3, o4-mini",
        keyPlaceholder: "sk-...",
        keyPrefix: "sk-",
        defaultModel: "gpt-4o-mini",
        models: [
            { id: "gpt-4.1", name: "GPT-4.1" },
            { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
            { id: "gpt-4.1-nano", name: "GPT-4.1 Nano" },
            { id: "gpt-4o", name: "GPT-4o" },
            { id: "gpt-4o-mini", name: "GPT-4o Mini" },
            { id: "o3", name: "o3" },
            { id: "o3-mini", name: "o3 Mini" },
            { id: "o4-mini", name: "o4 Mini" },
        ],
    },
    anthropic: {
        name: "anthropic",
        label: "Anthropic",
        description: "Claude Opus 4, Sonnet 4, Haiku 3.5",
        keyPlaceholder: "sk-ant-...",
        keyPrefix: "sk-ant-",
        defaultModel: "claude-sonnet-4-20250514",
        models: [
            { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
            { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
            { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
        ],
    },
    google: {
        name: "google",
        label: "Google",
        description: "Gemini 2.5 Pro, Flash, Flash Lite",
        keyPlaceholder: "AIza...",
        keyPrefix: "AIza",
        defaultModel: "gemini-2.5-flash",
        models: [
            { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
            { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
            { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
            { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite" },
        ],
    },
    groq: {
        name: "groq",
        label: "Groq",
        description: "Llama 4 Scout, Llama 3.3 — ultra-fast",
        keyPlaceholder: "gsk_...",
        keyPrefix: "gsk_",
        defaultModel: "llama-3.3-70b-versatile",
        models: [
            { id: "meta-llama/llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout 17B" },
            { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
            { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B" },
            { id: "gemma2-9b-it", name: "Gemma 2 9B" },
            { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B" },
        ],
    },
    mistral: {
        name: "mistral",
        label: "Mistral",
        description: "Mistral Large, Small, Codestral",
        keyPlaceholder: "...",
        keyPrefix: "",
        defaultModel: "mistral-small-latest",
        models: [
            { id: "mistral-large-latest", name: "Mistral Large" },
            { id: "mistral-small-latest", name: "Mistral Small" },
            { id: "codestral-latest", name: "Codestral" },
            { id: "mistral-medium-latest", name: "Mistral Medium" },
        ],
    },
    xai: {
        name: "xai",
        label: "xAI",
        description: "Grok 3, Grok 3 Mini",
        keyPlaceholder: "xai-...",
        keyPrefix: "xai-",
        defaultModel: "grok-3-fast-beta",
        models: [
            { id: "grok-3-beta", name: "Grok 3" },
            { id: "grok-3-fast-beta", name: "Grok 3 Fast" },
            { id: "grok-3-mini-beta", name: "Grok 3 Mini" },
            { id: "grok-3-mini-fast-beta", name: "Grok 3 Mini Fast" },
        ],
    },
};

// ─── Provider Factory ─────────────────────────────────────

/**
 * Create a language model instance for the given provider + model ID.
 * Uses the user's API key from config.provider_keys.
 */
function createProviderModel(provider: ProviderName, modelId: string, apiKey: string): LanguageModel {
    switch (provider) {
        case "openai": {
            const openai = createOpenAI({ apiKey });
            return openai(modelId) as LanguageModel;
        }
        case "anthropic": {
            const anthropic = createAnthropic({ apiKey });
            return anthropic(modelId) as LanguageModel;
        }
        case "google": {
            const google = createGoogleGenerativeAI({ apiKey });
            return google(modelId) as LanguageModel;
        }
        case "groq": {
            const groq = createGroq({ apiKey });
            return groq(modelId) as LanguageModel;
        }
        case "mistral": {
            const mistral = createMistral({ apiKey });
            return mistral(modelId) as LanguageModel;
        }
        case "xai": {
            const xai = createXai({ apiKey });
            return xai(modelId) as LanguageModel;
        }
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
}

// ─── Model Roles ─────────────────────────────────────────

export type ModelRole = "extraction" | "capable" | "vision";

/**
 * Default models for each role (provider/model format for role routing).
 */
const DEFAULT_ROLE_MODELS: Record<ModelRole, { provider: ProviderName; model: string }> = {
    extraction: { provider: "google", model: "gemini-2.0-flash" },
    capable: { provider: "openai", model: "gpt-4o-mini" }, // overridden by user's selection
    vision: { provider: "openai", model: "gpt-4o" },
};

// ─── Public API ──────────────────────────────────────────

/**
 * Get the primary language model (user's selected model).
 */
export function getModel(config?: NiomConfig): LanguageModel {
    const cfg = config ?? loadConfig();
    const provider = cfg.provider as ProviderName;
    const apiKey = cfg.provider_keys?.[provider];

    if (!apiKey) {
        throw new Error(
            `No API key configured for ${provider}. Add your key in Settings → AI Models.`
        );
    }

    return createProviderModel(provider, cfg.model, apiKey);
}

/**
 * Get a model for a specific role in the reasoning pipeline.
 */
export function getModelForRole(role: ModelRole, config?: NiomConfig): LanguageModel {
    const cfg = config ?? loadConfig();

    // Check for user overrides in config.models
    const overrides = cfg.models;
    let provider: ProviderName;
    let modelId: string;

    if (overrides?.[role]) {
        // User has explicitly configured this role (format: "provider/model")
        const override = overrides[role]!;
        const slash = override.indexOf("/");
        if (slash > 0) {
            provider = override.substring(0, slash) as ProviderName;
            modelId = override.substring(slash + 1);
        } else {
            // Bare model ID — use the current provider
            provider = cfg.provider as ProviderName;
            modelId = override;
        }
    } else if (role === "capable") {
        // Capable always uses the user's primary model selection
        provider = cfg.provider as ProviderName;
        modelId = cfg.model;
    } else {
        // Use the default for this role
        const def = DEFAULT_ROLE_MODELS[role];
        provider = def.provider;
        modelId = def.model;
    }

    const apiKey = cfg.provider_keys?.[provider];
    if (!apiKey) {
        // Fall back to the user's primary provider if role provider has no key
        const fallbackProvider = cfg.provider as ProviderName;
        const fallbackKey = cfg.provider_keys?.[fallbackProvider];
        if (fallbackKey) {
            console.log(`[providers] ${role} → ${fallbackProvider}/${cfg.model} (fallback, no ${provider} key)`);
            return createProviderModel(fallbackProvider, cfg.model, fallbackKey);
        }
        throw new Error(`No API key for ${provider}. Configure it in Settings.`);
    }

    console.log(`[providers] ${role} → ${provider}/${modelId}`);
    return createProviderModel(provider, modelId, apiKey);
}

/**
 * List all available providers with their model catalogs.
 */
export function listProviders(): ProviderInfo[] {
    return Object.values(PROVIDERS);
}

/**
 * Get a provider's info by name.
 */
export function getProviderInfo(name: string): ProviderInfo | undefined {
    return (PROVIDERS as Record<string, ProviderInfo>)[name];
}

/**
 * Get a provider's default model.
 */
export function getDefaultModel(provider: string): string {
    return (PROVIDERS as Record<string, ProviderInfo>)[provider]?.defaultModel ?? "gpt-4o-mini";
}

/**
 * Check which providers have keys configured.
 */
export function getConfiguredProviders(config?: NiomConfig): ProviderName[] {
    const cfg = config ?? loadConfig();
    const keys = cfg.provider_keys ?? {};
    return Object.entries(keys)
        .filter(([, key]) => !!key)
        .map(([name]) => name as ProviderName);
}
