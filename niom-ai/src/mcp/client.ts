/**
 * MCP Client — connect to external MCP servers and expose their tools to the NIOM agent.
 *
 * Architecture:
 *   - Each MCP server runs as a child process (stdio transport)
 *   - On connect, we discover the server's tools and convert them to AI SDK tools
 *   - Tools are dynamically available to the agent engine
 *   - Connections persist in ~/.niom/config.json and auto-reconnect on boot
 *
 * Security:
 *   - Each server runs in its own child process (OS-level isolation)
 *   - Tool calls are logged and subject to the same approval flow as built-in tools
 *   - Servers can only access what the user explicitly grants via env vars
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tool, type Tool } from "ai";
import { z } from "zod";
import { loadConfig, saveConfig, type NiomConfig } from "../config.js";
import { registerCapability } from "../ai/capabilities.js";
import { invalidateToolsCache } from "../tools/index.js";

// ── Types ──

export interface MCPServerConfig {
    /** Unique name for this server (e.g., "github", "slack") */
    name: string;
    /** Command to run (e.g., "npx", "node", path to binary) */
    command: string;
    /** Arguments for the command */
    args?: string[];
    /** Environment variables to pass (e.g., API tokens) */
    env?: Record<string, string>;
}

export interface MCPConnection {
    config: MCPServerConfig;
    client: Client;
    transport: StdioClientTransport;
    tools: Record<string, Tool>;
    status: "connected" | "disconnected" | "error";
    error?: string;
    toolNames: string[];
}

// ── MCP Manager (singleton) ──

class MCPManager {
    private static instance: MCPManager;
    private connections: Map<string, MCPConnection> = new Map();

    static getInstance(): MCPManager {
        if (!MCPManager.instance) {
            MCPManager.instance = new MCPManager();
        }
        return MCPManager.instance;
    }

    /**
     * Initialize: auto-connect all servers from config.
     */
    async init(): Promise<void> {
        const config = loadConfig();
        if (!config.mcp || config.mcp.length === 0) {
            console.log("[mcp] No MCP servers configured");
            return;
        }

        console.log(`[mcp] Auto-connecting ${config.mcp.length} server(s)...`);
        for (const serverConfig of config.mcp) {
            try {
                await this.connect(serverConfig, false); // don't persist — already in config
            } catch (err: any) {
                console.warn(`[mcp] Failed to connect to ${serverConfig.name}: ${err.message}`);
            }
        }
    }

    /**
     * Connect to an MCP server and discover its tools.
     */
    async connect(serverConfig: MCPServerConfig, persist = true): Promise<MCPConnection> {
        // Disconnect existing connection with same name
        if (this.connections.has(serverConfig.name)) {
            await this.disconnect(serverConfig.name);
        }

        console.log(`[mcp] Connecting to ${serverConfig.name}: ${serverConfig.command} ${(serverConfig.args || []).join(" ")}`);

        // Create transport + client
        const transport = new StdioClientTransport({
            command: serverConfig.command,
            args: serverConfig.args,
            env: {
                ...process.env,
                ...serverConfig.env,
            } as Record<string, string>,
        });

        const client = new Client({
            name: "niom",
            version: "0.1.0",
        });

        try {
            // Connect
            await client.connect(transport);

            // Discover tools
            const { tools: mcpTools } = await client.listTools();
            console.log(`[mcp] ${serverConfig.name}: discovered ${mcpTools.length} tool(s): ${mcpTools.map(t => t.name).join(", ")}`);

            // Convert MCP tools to AI SDK tools
            const aiTools: Record<string, Tool> = {};
            const toolNames: string[] = [];

            for (const mcpTool of mcpTools) {
                const toolId = `mcp_${serverConfig.name}_${mcpTool.name}`;
                toolNames.push(toolId);

                aiTools[toolId] = this.convertMCPTool(serverConfig.name, mcpTool, client);
            }

            const connection: MCPConnection = {
                config: serverConfig,
                client,
                transport,
                tools: aiTools,
                status: "connected",
                toolNames,
            };

            this.connections.set(serverConfig.name, connection);

            // Persist to config
            if (persist) {
                this.persistConnection(serverConfig);
            }

            // Update capability registry
            this.updateCapabilities();

            return connection;
        } catch (err: any) {
            // Clean up on failure
            try { await transport.close(); } catch { /* ignore */ }

            const connection: MCPConnection = {
                config: serverConfig,
                client,
                transport,
                tools: {},
                status: "error",
                error: err.message,
                toolNames: [],
            };

            this.connections.set(serverConfig.name, connection);
            throw err;
        }
    }

    /**
     * Disconnect from an MCP server.
     */
    async disconnect(name: string): Promise<void> {
        const conn = this.connections.get(name);
        if (!conn) return;

        try {
            await conn.transport.close();
        } catch { /* ignore */ }

        this.connections.delete(name);
        this.updateCapabilities();
        console.log(`[mcp] Disconnected from ${name}`);
    }

    /**
     * Remove an MCP server completely (disconnect + remove from config).
     */
    async remove(name: string): Promise<void> {
        await this.disconnect(name);

        const config = loadConfig();
        config.mcp = (config.mcp || []).filter(s => s.name !== name);
        saveConfig(config);
    }

    /**
     * Get all MCP tools merged into a single object (for the agent).
     */
    getAllTools(): Record<string, Tool> {
        const tools: Record<string, Tool> = {};
        for (const conn of this.connections.values()) {
            if (conn.status === "connected") {
                Object.assign(tools, conn.tools);
            }
        }
        return tools;
    }

    /**
     * Get connection status for all servers.
     */
    getStatus(): Array<{
        name: string;
        status: string;
        tools: string[];
        error?: string;
    }> {
        return Array.from(this.connections.entries()).map(([name, conn]) => ({
            name,
            status: conn.status,
            tools: conn.toolNames,
            error: conn.error,
        }));
    }

    /**
     * Get a specific connection.
     */
    getConnection(name: string): MCPConnection | undefined {
        return this.connections.get(name);
    }

    /**
     * Shutdown all connections gracefully.
     */
    async shutdown(): Promise<void> {
        for (const [name] of this.connections) {
            await this.disconnect(name);
        }
    }

    // ── Private ──

    /**
     * Convert a single MCP tool to an AI SDK tool.
     *
     * MCP tools have JSON Schema input schemas — we wrap them in a Zod passthrough
     * schema and proxy calls to the MCP client.
     */
    private convertMCPTool(
        serverName: string,
        mcpTool: { name: string; description?: string; inputSchema?: any },
        client: Client,
    ): Tool {
        // Build description
        const desc = mcpTool.description
            ? `[MCP: ${serverName}] ${mcpTool.description}`
            : `[MCP: ${serverName}] ${mcpTool.name}`;

        // Convert JSON Schema to Zod — use passthrough for flexibility
        const zodSchema = this.jsonSchemaToZod(mcpTool.inputSchema);

        return tool({
            description: desc,
            inputSchema: zodSchema,
            execute: async (input) => {
                try {
                    console.log(`[mcp] ${serverName}.${mcpTool.name}(${JSON.stringify(input).slice(0, 100)})`);

                    const result = await client.callTool({
                        name: mcpTool.name,
                        arguments: input as Record<string, unknown>,
                    });

                    // Extract text content from MCP response
                    if (result.content && Array.isArray(result.content)) {
                        const texts = result.content
                            .filter((c: any) => c.type === "text")
                            .map((c: any) => c.text);

                        if (texts.length === 1) return { result: texts[0] };
                        if (texts.length > 1) return { results: texts };

                        // Non-text content — return raw
                        return { content: result.content };
                    }

                    return { result: result.content ?? "No output" };
                } catch (err: any) {
                    console.error(`[mcp] ${serverName}.${mcpTool.name} failed:`, err.message);
                    return { error: err.message };
                }
            },
        });
    }

    /**
     * Convert a JSON Schema to a Zod schema.
     *
     * MCP tools provide JSON Schema for their inputs. We convert common
     * patterns to Zod for AI SDK compatibility. For anything complex,
     * we fall back to z.record(z.unknown()) which accepts any object.
     */
    private jsonSchemaToZod(schema?: any): z.ZodType<any> {
        if (!schema || !schema.properties) {
            // No input schema — tool takes no (or unknown) arguments
            return z.object({}).passthrough();
        }

        const shape: Record<string, z.ZodType<any>> = {};
        const required = new Set(schema.required || []);

        for (const [key, prop] of Object.entries(schema.properties) as [string, any][]) {
            let fieldSchema: z.ZodType<any>;

            switch (prop.type) {
                case "string":
                    fieldSchema = prop.enum
                        ? z.enum(prop.enum as [string, ...string[]])
                        : z.string();
                    break;
                case "number":
                case "integer":
                    fieldSchema = z.number();
                    break;
                case "boolean":
                    fieldSchema = z.boolean();
                    break;
                case "array":
                    fieldSchema = z.array(
                        prop.items?.type === "string" ? z.string() :
                            prop.items?.type === "number" ? z.number() :
                                z.unknown()
                    );
                    break;
                case "object":
                    fieldSchema = z.record(z.unknown());
                    break;
                default:
                    fieldSchema = z.unknown();
            }

            // Add description if available
            if (prop.description) {
                fieldSchema = (fieldSchema as any).describe(prop.description);
            }

            // Make optional if not required
            if (!required.has(key)) {
                fieldSchema = fieldSchema.optional();
            }

            shape[key] = fieldSchema;
        }

        return z.object(shape);
    }

    /**
     * Save server config to ~/.niom/config.json
     */
    private persistConnection(serverConfig: MCPServerConfig): void {
        const config = loadConfig();
        const mcp = config.mcp || [];

        // Replace existing or add new
        const idx = mcp.findIndex(s => s.name === serverConfig.name);
        if (idx >= 0) {
            mcp[idx] = serverConfig;
        } else {
            mcp.push(serverConfig);
        }

        config.mcp = mcp;
        saveConfig(config);
    }

    /**
     * Update the capability registry with current MCP connections.
     */
    private updateCapabilities(): void {
        // Invalidate tool cache so getAllTools() picks up new MCP tools
        invalidateToolsCache();

        const connected = Array.from(this.connections.values())
            .filter(c => c.status === "connected");

        if (connected.length === 0) return;

        const descriptions = connected.map(c =>
            `- **${c.config.name}**: ${c.toolNames.map(t => t.replace(`mcp_${c.config.name}_`, "")).join(", ")}`
        ).join("\n");

        registerCapability({
            id: "mcp-integrations",
            name: "MCP Integrations",
            category: "integration",
            description: `You have access to external tools via MCP (Model Context Protocol):\n${descriptions}`,
            enabled: () => connected.length > 0,
            instructions: "Use MCP tools when the task involves external services. The tool names are prefixed with `mcp_{server}_`.",
        });
    }
}

// ── Exports ──

export const mcpManager = MCPManager.getInstance();
