/**
 * MCP routes — HTTP endpoints for managing MCP server connections.
 *
 * POST /mcp/connect     — connect to an MCP server
 * DELETE /mcp/:name     — disconnect + remove an MCP server
 * GET  /mcp/servers     — list all MCP connections and their tools
 */

import { Hono } from "hono";
import { mcpManager, type MCPServerConfig } from "../mcp/client.js";

const mcp = new Hono();

/**
 * POST /mcp/connect — connect to an MCP server
 *
 * Body: { name, command, args?, env? }
 */
mcp.post("/mcp/connect", async (c) => {
    try {
        const body = await c.req.json<MCPServerConfig>();

        if (!body.name || !body.command) {
            return c.json({ error: "name and command are required" }, 400);
        }

        const conn = await mcpManager.connect(body);

        return c.json({
            status: "connected",
            name: body.name,
            tools: conn.toolNames,
            toolCount: conn.toolNames.length,
        });
    } catch (err: any) {
        return c.json({
            status: "error",
            error: err.message,
        }, 500);
    }
});

/**
 * DELETE /mcp/:name — disconnect and remove an MCP server
 */
mcp.delete("/mcp/:name", async (c) => {
    const name = c.req.param("name");
    await mcpManager.remove(name);
    return c.json({ status: "removed", name });
});

/**
 * GET /mcp/servers — list all MCP connections and their status
 */
mcp.get("/mcp/servers", (c) => {
    return c.json({
        servers: mcpManager.getStatus(),
    });
});

export default mcp;
