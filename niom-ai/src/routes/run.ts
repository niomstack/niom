import { Hono } from "hono";
import type { Context } from "hono";
import { streamText, createUIMessageStream, createUIMessageStreamResponse, stepCountIs, type ModelMessage } from "ai";
import { runAgent, getBaseSystemPrompt } from "../ai/agent.js";
import { getModel } from "../ai/providers.js";
import { getAllTools } from "../tools/index.js";
import { buildAgentContext, formatContextPreamble, recordToolUse, flushToolUsageToSkillTree } from "../ai/context.js";
import { loadConfig, type NiomConfig } from "../config.js";
import { sanitizeMessages } from "../ai/sanitize.js";
import { logger } from "../ai/logger.js";

const run = new Hono();

// ── Shared request validation ─────────────────────────────
// Extracts & validates messages, loads config, checks API key.
// Returns null on success (sets messages + config), or an error Response.

interface ValidatedRequest {
    messages: ModelMessage[];
    config: NiomConfig;
    body: Record<string, unknown>;
}

function validateRunRequest(c: Context, body: Record<string, unknown>): ValidatedRequest | Response {
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        return c.json({ error: "messages array is required" }, 400);
    }

    const config = loadConfig();
    if (!config.provider_keys?.[config.provider]) {
        return c.json(
            { error: "No API key configured", message: `Add your ${config.provider} API key in Settings` },
            503
        );
    }

    const messages = sanitizeMessages(body.messages);

    return { messages, config, body };
}

/**
 * POST /run — The single entry point for all AI interactions.
 *
 * Uses a custom UIMessageStream so the SSE connection opens immediately
 * (no dead loader). The analyze phase emits a reasoning event, then the
 * main streamText result is piped through the same stream.
 */
run.post("/run", async (c) => {
    try {
        const body = await c.req.json();
        const validated = validateRunRequest(c, body);
        if (validated instanceof Response) return validated;
        const { messages, config } = validated;

        logger.request("start", { threadId: body.threadId, messageCount: messages.length, model: config.model });

        // Start SSE immediately — the engine runs inside the stream writer
        const response = createUIMessageStreamResponse({
            status: 200,
            headers: {
                "X-Niom-Model": config.model,
                "x-vercel-ai-ui-message-stream": "v1",
            },
            stream: createUIMessageStream({
                execute: async ({ writer }) => {
                    // Signal that the engine is thinking (frontend sees this immediately)
                    writer.write({ type: "reasoning-start", id: "analyze" });
                    writer.write({ type: "reasoning-delta", id: "analyze", delta: "Analyzing intent..." });
                    writer.write({ type: "reasoning-end", id: "analyze" });

                    // Run the engine (route → execute)
                    const result = await runAgent({
                        messages,
                        threadId: body.threadId,
                        context: body.context,
                        onProgress: (status) => {
                            writer.write({ type: "reasoning-start", id: "progress" });
                            writer.write({ type: "reasoning-delta", id: "progress", delta: status });
                            writer.write({ type: "reasoning-end", id: "progress" });
                        },
                    });

                    // Pipe the streamText result into our stream
                    writer.merge(result.toUIMessageStream());

                    // Record tool usage for Skill Tree edge learning (fire-and-forget)
                    flushToolUsageToSkillTree().catch(() => { });
                    logger.request("complete", { threadId: body.threadId });
                },
                onError: (error) => {
                    const msg = error instanceof Error ? error.message : String(error);
                    console.error("[run] Stream error:", msg);
                    logger.request("error", { threadId: body.threadId, error: msg });
                    return msg;
                },
            }),
        });

        return response;
    } catch (err: any) {
        console.error("[run] Error:", err.message || err);
        logger.error("request", `Run failed: ${err.message}`, { stack: err.stack?.slice(0, 500) });
        return c.json({ error: "Agent failed", message: err.message || String(err) }, 500);
    }
});

/**
 * POST /run/confirm — Resume agent after tool confirmation.
 *
 * IMPORTANT: This does NOT re-analyze intent. It directly continues via
 * streamText with the full message history (which includes the confirmation
 * response). Re-analyzing would create a fresh stream that doesn't know
 * about the original tool-approval-request IDs.
 */
run.post("/run/confirm", async (c) => {
    try {
        const body = await c.req.json();
        const validated = validateRunRequest(c, body);
        if (validated instanceof Response) return validated;
        const { messages, config } = validated;

        logger.request("start", { type: "confirm", messageCount: messages.length });

        const model = getModel(config);
        const ctx = body.context || {};
        const agentContext = buildAgentContext({
            focusFile: ctx.focusFile,
            openFiles: ctx.openFiles,
            cursorLine: ctx.cursorLine,
            cwd: ctx.cwd,
        });
        const contextPreamble = formatContextPreamble(agentContext);

        const systemPrompt = `${getBaseSystemPrompt()}

You're continuing after a tool confirmation. Continue executing the task naturally.

${contextPreamble}`;

        const response = createUIMessageStreamResponse({
            status: 200,
            headers: {
                "X-Niom-Model": config.model,
                "x-vercel-ai-ui-message-stream": "v1",
            },
            stream: createUIMessageStream({
                execute: async ({ writer }) => {
                    const result = streamText({
                        model,
                        system: systemPrompt,
                        messages,
                        tools: getAllTools(),
                        stopWhen: stepCountIs(15),
                        temperature: 0.4,
                        experimental_context: agentContext,
                        experimental_onToolCallFinish({ toolCall }: { toolCall: { toolName: string } }) {
                            recordToolUse(toolCall.toolName);
                            logger.toolCall("complete", toolCall.toolName);
                        },
                    });
                    writer.merge(result.toUIMessageStream());
                    flushToolUsageToSkillTree().catch(() => { });
                    logger.request("complete", { type: "confirm" });
                },
                onError: (error) => {
                    const msg = error instanceof Error ? error.message : String(error);
                    console.error("[run/confirm] Stream error:", msg);
                    logger.request("error", { type: "confirm", error: msg });
                    return msg;
                },
            }),
        });

        return response;
    } catch (err: any) {
        console.error("[run/confirm] Error:", err.message || err);
        logger.error("request", `Confirm failed: ${err.message}`, { stack: err.stack?.slice(0, 500) });
        return c.json({ error: "Confirmation failed", message: err.message || String(err) }, 500);
    }
});

/**
 * POST /run/sync — Synchronous (non-streaming) for testing.
 * Waits for full response, returns JSON.
 */
run.post("/run/sync", async (c) => {
    try {
        const body = await c.req.json();
        const validated = validateRunRequest(c, body);
        if (validated instanceof Response) return validated;
        const { messages, config } = validated;

        logger.request("start", { type: "sync", messageCount: messages.length, model: config.model });

        const result = await runAgent({
            messages,
            context: body.context,
        });

        const text = await result.text;
        const steps = await result.steps;

        logger.request("complete", { type: "sync" });

        return c.json({
            text,
            steps: steps.map((step: any) => ({
                text: step.text,
                toolCalls: step.toolCalls,
                toolResults: step.toolResults,
            })),
            metadata: {
                model: config.model,
            },
        });
    } catch (err: any) {
        console.error("[run/sync] Error:", err.message || err);
        logger.error("request", `Sync run failed: ${err.message}`, { stack: err.stack?.slice(0, 500) });
        return c.json({ error: "Agent failed", message: err.message || String(err) }, 500);
    }
});

export default run;
