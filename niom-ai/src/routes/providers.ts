import { Hono } from "hono";
import { z } from "zod";
import { listProviders, getDefaultModel, getConfiguredProviders, getProviderInfo } from "../ai/providers.js";
import { loadConfig, saveConfig } from "../config.js";

// ── Request validation ──

const ConfigureProviderRequest = z.object({
    provider: z.string().optional(),
    model: z.string().optional().describe("Native model ID, e.g. 'gpt-4o-mini'"),
    provider_key: z.string().optional().describe("API key for the provider"),
    provider_name: z.string().optional().describe("Which provider the key is for"),
});

const providers = new Hono();

/**
 * GET /providers — List all available providers with their model catalogs.
 */
providers.get("/providers", (c) => {
    const config = loadConfig();
    const providerList = listProviders();
    const configured = getConfiguredProviders(config);

    return c.json({
        active_provider: config.provider,
        active_model: config.model,
        configured_providers: configured,
        providers: providerList.map((p) => ({
            ...p,
            configured: configured.includes(p.name),
        })),
    });
});

/**
 * GET /models — List all available models, grouped by provider.
 * Uses static catalog — no external API call needed.
 */
providers.get("/models", (c) => {
    const config = loadConfig();
    const allProviders = listProviders();
    const configured = getConfiguredProviders(config);

    const groups: Record<string, Array<{ id: string; name: string }>> = {};
    for (const p of allProviders) {
        groups[p.name] = p.models;
    }

    return c.json({
        active_model: `${config.provider}/${config.model}`,
        active_provider: config.provider,
        configured_providers: configured,
        groups,
        total: allProviders.reduce((sum, p) => sum + p.models.length, 0),
    });
});

/**
 * POST /providers/configure — Update provider, model, or API key.
 */
providers.post("/providers/configure", async (c) => {
    try {
        const body = await c.req.json();
        const parsed = ConfigureProviderRequest.safeParse(body);

        if (!parsed.success) {
            return c.json(
                { error: "Invalid request", details: parsed.error.flatten() },
                400
            );
        }

        const config = loadConfig();
        const { provider, model, provider_key, provider_name } = parsed.data;

        // Save provider API key
        if (provider_key !== undefined && provider_name) {
            if (!config.provider_keys) config.provider_keys = {};
            config.provider_keys[provider_name] = provider_key;
        }

        // Update active model
        if (model !== undefined) {
            config.model = model;
            // If provider is also specified, update it
            if (provider) {
                config.provider = provider;
            }
        } else if (provider !== undefined) {
            config.provider = provider;
            config.model = getDefaultModel(provider);
        }

        saveConfig(config);

        return c.json({
            status: "ok",
            provider: config.provider,
            model: config.model,
            message: `Configured: ${config.provider}/${config.model}`,
        });
    } catch (err: any) {
        console.error("[providers/configure] Error:", err.message);
        return c.json({ error: "Configuration failed", message: err.message }, 500);
    }
});

/**
 * POST /providers/test — Test the connection by running a quick inference.
 */
providers.post("/providers/test", async (c) => {
    try {
        const config = loadConfig();
        const body = await c.req.json().catch(() => ({}));
        const testModel = body.model || config.model;
        const testProvider = body.provider || config.provider;

        const apiKey = config.provider_keys?.[testProvider];
        if (!apiKey) {
            return c.json({
                status: "error",
                message: `No API key configured for ${testProvider}. Add your key in Settings.`,
            });
        }

        // Test using a quick generateText call + Skill Tree readiness
        const { generateText } = await import("ai");
        const { getModel } = await import("../ai/providers.js");
        const { SkillPathResolver } = await import("../skills/traversal.js");
        const startTime = Date.now();

        // Check Skill Tree readiness
        const resolver = SkillPathResolver.getInstance();
        const path = await resolver.resolve("Hello, are you working?");

        // Quick LLM test
        const model = getModel(config);
        const result = await generateText({
            model,
            prompt: "Reply with exactly: OK",
            temperature: 0,
        });
        const latencyMs = Date.now() - startTime;

        return c.json({
            status: "ok",
            provider: testProvider,
            model: testModel,
            latency_ms: latencyMs,
            test_result: `${path.executionMode}/${path.primaryDomain} | LLM: ${result.text?.slice(0, 10)}`,
            skill_tree_ready: resolver.isReady(),
        });
    } catch (err: any) {
        return c.json({
            status: "error",
            message: err.message,
        });
    }
});

export default providers;
