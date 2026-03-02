import { createGatewayProvider, type GatewayModelId, type GatewayProvider } from "@ai-sdk/gateway";
import type { LanguageModel } from "ai";
import { loadConfig, type NiomConfig } from "../config.js";

// ─── Gateway Setup ───────────────────────────────────────

let _gateway: GatewayProvider | null = null;

/**
 * Get or create the AI Gateway provider.
 * Uses gateway_key from ~/.niom/config.json.
 */
export function getGateway(config?: NiomConfig): GatewayProvider {
    const cfg = config ?? loadConfig();
    const apiKey = cfg.gateway_key;

    if (!apiKey) {
        throw new Error("No AI Gateway key configured. Add your key in Settings.");
    }

    // Re-create if key changed or first call
    if (!_gateway) {
        _gateway = createGatewayProvider({ apiKey });
    }

    return _gateway;
}

// ─── Provider Info ───────────────────────────────────────

export type ProviderName = "openai" | "anthropic" | "google" | "groq" | "mistral" | "xai" | "perplexity";

export interface ProviderInfo {
    name: ProviderName;
    default_model: string;
    description: string;
}

const PROVIDERS: Record<ProviderName, ProviderInfo> = {
    openai: { name: "openai", default_model: "openai/gpt-4o-mini", description: "OpenAI (GPT-4o, GPT-4.1, o3, o4-mini)" },
    anthropic: { name: "anthropic", default_model: "anthropic/claude-4-sonnet-20250514", description: "Anthropic (Claude 4 Sonnet, Opus, Haiku)" },
    google: { name: "google", default_model: "vertex/gemini-2.0-flash-001", description: "Google (Gemini 2.0 Flash, Pro)" },
    groq: { name: "groq", default_model: "groq/llama-3.3-70b-versatile", description: "Groq (Llama 3.3, Llama 4 Scout — ultra-fast)" },
    mistral: { name: "mistral", default_model: "mistral/mistral-small", description: "Mistral (Small, Large, Codestral)" },
    xai: { name: "xai", default_model: "xai/grok-3-fast-beta", description: "xAI (Grok 3, Grok 3 Mini)" },
    perplexity: { name: "perplexity", default_model: "perplexity/sonar", description: "Perplexity (Sonar, Sonar Pro — with search)" },
};

// ─── Model Roles ─────────────────────────────────────────
//
// Multi-model routing: different tasks use different model tiers.
//
//   fast      → Intent analysis, evaluation, planning (cheap, sub-second)
//   capable   → Main execution, complex reasoning (user's selected model)
//   vision    → Screenshot analysis, UI understanding (must support images)
//

export type ModelRole = "fast" | "capable" | "vision";

/**
 * Default model IDs for each role.
 * These are the fallbacks when the user hasn't configured overrides.
 *
 * The "capable" role always uses the user's selected model.
 */
const DEFAULT_ROLE_MODELS: Record<ModelRole, string> = {
    fast: "google/gemini-2.0-flash-001",        // Fast + supports structured outputs (json_schema)
    capable: "",                                 // User's selected model (filled at runtime)
    vision: "openai/gpt-4o",                    // Best vision support
};

// ─── Get Model Instance ──────────────────────────────────

/**
 * Create a language model via the AI Gateway.
 * Model ID format: "provider/model" (e.g., "google/gemini-2.5-flash", "openai/gpt-4o-mini")
 */
export function getModel(config?: NiomConfig): LanguageModel {
    const cfg = config ?? loadConfig();
    const gw = getGateway(cfg);
    return gw(cfg.model as GatewayModelId) as unknown as LanguageModel;
}

/**
 * Get a model for a specific role in the reasoning pipeline.
 *
 * This is the core of multi-model routing:
 *   - fast:    cheap model for analysis, evaluation, task planning
 *   - capable: user's selected model for main execution
 *   - vision:  vision-capable model for screenshot analysis
 *
 * Users can override each role in config.models:
 *   { "fast": "groq/llama-3.3-70b", "vision": "anthropic/claude-4-sonnet" }
 */
export function getModelForRole(role: ModelRole, config?: NiomConfig): LanguageModel {
    const cfg = config ?? loadConfig();
    const gw = getGateway(cfg);

    // Check for user overrides in config
    const overrides = cfg.models;

    let modelId: string;

    if (overrides?.[role]) {
        // User has explicitly configured this role
        modelId = overrides[role]!;
    } else if (role === "capable") {
        // Capable always uses the user's primary model selection
        modelId = cfg.model;
    } else {
        // Use the default for this role
        modelId = DEFAULT_ROLE_MODELS[role];
    }

    console.log(`[providers] ${role} → ${modelId}`);
    return gw(modelId as GatewayModelId) as unknown as LanguageModel;
}

/**
 * List all available providers.
 */
export function listProviders(): ProviderInfo[] {
    return Object.values(PROVIDERS);
}

/**
 * Get a provider's default model.
 */
export function getDefaultModel(provider: string): string {
    return (PROVIDERS as Record<string, ProviderInfo>)[provider]?.default_model ?? "openai/gpt-4o-mini";
}

/**
 * Invalidate the cached gateway (e.g., after key change).
 */
export function resetGateway(): void {
    _gateway = null;
}

