import { Hono } from "hono";
import { z } from "zod";
import { listProviders, getDefaultModel, resetGateway, getGateway } from "../ai/providers.js";
import { loadConfig, saveConfig } from "../config.js";

// ── Request validation (inlined — no need for a separate schemas file) ──

const ConfigureProviderRequest = z.object({
    provider: z.string().optional(),
    model: z.string().optional().describe("Gateway model ID, e.g. 'openai/gpt-4o-mini'"),
    gateway_key: z.string().optional(),
});

const providers = new Hono();

/**
 * GET /providers — List all available providers via the gateway.
 */
providers.get("/providers", (c) => {
    const config = loadConfig();
    const providerList = listProviders();

    return c.json({
        active_model: config.model,
        gateway_configured: !!config.gateway_key,
        providers: providerList,
    });
});

/**
 * GET /models — List all available models from the AI Gateway, grouped by provider.
 */
providers.get("/models", async (c) => {
    try {
        const config = loadConfig();
        if (!config.gateway_key) {
            return c.json({ error: "No AI Gateway key configured" }, 503);
        }

        const gw = getGateway();
        const { models } = await gw.getAvailableModels();

        // Group models by provider (the part before '/')
        const grouped: Record<string, Array<{ id: string; name: string }>> = {};
        for (const model of models) {
            const slash = model.id.indexOf("/");
            const provider = slash > 0 ? model.id.substring(0, slash) : "other";
            if (!grouped[provider]) grouped[provider] = [];
            grouped[provider].push({ id: model.id, name: model.name });
        }

        return c.json({
            active_model: config.model,
            groups: grouped,
            total: models.length,
        });
    } catch (err: any) {
        console.error("[models] Error fetching models:", err.message);
        return c.json({ error: "Failed to fetch models", message: err.message }, 500);
    }
});

/**
 * POST /providers/configure — Update the active model/provider.
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
        const { provider, model, gateway_key } = parsed.data;

        if (gateway_key !== undefined) {
            config.gateway_key = gateway_key;
            resetGateway(); // Re-create gateway with new key
        }

        if (model !== undefined) {
            config.model = model;
            // Extract provider from model ID (e.g., "openai/gpt-4o" → "openai")
            const slash = model.indexOf("/");
            if (slash > 0) {
                config.provider = model.substring(0, slash);
            }
        } else if (provider !== undefined) {
            config.provider = provider;
            config.model = getDefaultModel(provider);
        }

        saveConfig(config);

        return c.json({
            status: "ok",
            model: config.model,
            provider: config.provider,
            message: `Configured: ${config.model}`,
        });
    } catch (err: any) {
        console.error("[providers/configure] Error:", err.message);
        return c.json({ error: "Configuration failed", message: err.message }, 500);
    }
});

/**
 * POST /providers/test — Test the gateway connection by running a quick analysis.
 */
providers.post("/providers/test", async (c) => {
    try {
        const config = loadConfig();

        if (!config.gateway_key) {
            return c.json({
                status: "error",
                message: "No AI Gateway key configured. Add your key in Settings.",
            });
        }

        const { analyzeIntent } = await import("../ai/analyze.js");
        const startTime = Date.now();

        const result = await analyzeIntent("Hello, are you working?", 1);
        const latencyMs = Date.now() - startTime;

        return c.json({
            status: "ok",
            model: config.model,
            latency_ms: latencyMs,
            test_result: `${result.complexity}/${result.taskType}`,
        });
    } catch (err: any) {
        return c.json({
            status: "error",
            message: err.message,
        });
    }
});

export default providers;

