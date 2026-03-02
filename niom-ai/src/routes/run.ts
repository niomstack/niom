import { Hono } from "hono";
import { streamText, createUIMessageStream, createUIMessageStreamResponse, stepCountIs } from "ai";
import { runAgent, getBaseSystemPrompt } from "../ai/agent.js";
import { getModel } from "../ai/providers.js";
import { getAllTools } from "../tools/index.js";
import { buildAgentContext, formatContextPreamble, recordToolUse } from "../ai/context.js";
import { loadConfig } from "../config.js";

const run = new Hono();

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

        if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
            return c.json({ error: "messages array is required" }, 400);
        }

        const config = loadConfig();
        if (!config.gateway_key) {
            return c.json(
                { error: "No AI Gateway key configured", message: "Add your gateway key in Settings" },
                503
            );
        }

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

                    // Run the engine (analyze → route → execute)
                    const result = await runAgent({
                        messages: body.messages,
                        context: body.context,
                    });

                    // Pipe the streamText result into our stream
                    writer.merge(result.toUIMessageStream());
                },
                onError: (error) => {
                    const msg = error instanceof Error ? error.message : String(error);
                    console.error("[run] Stream error:", msg);
                    return msg;
                },
            }),
        });

        return response;
    } catch (err: any) {
        console.error("[run] Error:", err.message || err);
        return c.json({ error: "Agent failed", message: err.message || String(err) }, 500);
    }
});

/**
 * POST /run/approve — Resume agent after tool approval.
 *
 * IMPORTANT: This does NOT re-analyze intent. It directly continues via
 * streamText with the full message history (which includes the approval
 * response). Re-analyzing would create a fresh stream that doesn't know
 * about the original tool-approval-request IDs.
 */
run.post("/run/approve", async (c) => {
    try {
        const body = await c.req.json();

        if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
            return c.json({ error: "messages array is required" }, 400);
        }

        const config = loadConfig();
        if (!config.gateway_key) {
            return c.json(
                { error: "No AI Gateway key configured", message: "Add your gateway key in Settings" },
                503
            );
        }

        const model = getModel(config);
        const ctx = body.context || {};
        const agentContext = buildAgentContext({
            focusFile: ctx.focusFile,
            openFiles: ctx.openFiles,
            cursorLine: ctx.cursorLine,
            cwd: ctx.cwd,
        });
        const contextPreamble = formatContextPreamble(agentContext);

        // Use the canonical base system prompt (shared with the agent engine)
        const systemPrompt = `${getBaseSystemPrompt()}

You're continuing after a tool approval. Continue executing the task naturally.

${contextPreamble}`;

        const response = createUIMessageStreamResponse({
            status: 200,
            headers: {
                "X-Niom-Model": config.model,
                "x-vercel-ai-ui-message-stream": "v1",
            },
            stream: createUIMessageStream({
                execute: async ({ writer }) => {
                    // Direct streamText — no re-analysis, just continue the conversation
                    const result = streamText({
                        model,
                        system: systemPrompt,
                        messages: body.messages,
                        tools: getAllTools(),
                        stopWhen: stepCountIs(15),
                        temperature: 0.4,
                        experimental_context: agentContext,
                        experimental_onToolCallFinish({ toolCall }: { toolCall: { toolName: string } }) {
                            recordToolUse(toolCall.toolName);
                        },
                    });
                    writer.merge(result.toUIMessageStream());
                },
                onError: (error) => {
                    const msg = error instanceof Error ? error.message : String(error);
                    console.error("[run/approve] Stream error:", msg);
                    return msg;
                },
            }),
        });

        return response;
    } catch (err: any) {
        console.error("[run/approve] Error:", err.message || err);
        return c.json({ error: "Approval failed", message: err.message || String(err) }, 500);
    }
});

/**
 * POST /run/sync — Synchronous (non-streaming) for testing.
 * Waits for full response, returns JSON.
 */
run.post("/run/sync", async (c) => {
    try {
        const body = await c.req.json();

        if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
            return c.json({ error: "messages array is required" }, 400);
        }

        const config = loadConfig();
        if (!config.gateway_key) {
            return c.json(
                { error: "No AI Gateway key configured", message: "Add your gateway key in Settings" },
                503
            );
        }

        const result = await runAgent({
            messages: body.messages,
            context: body.context,
        });

        const text = await result.text;
        const steps = await result.steps;

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
        return c.json({ error: "Agent failed", message: err.message || String(err) }, 500);
    }
});

export default run;
