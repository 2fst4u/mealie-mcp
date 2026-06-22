import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "./config.js";
import { executeTool } from "./http-client.js";
import type { MealieTool } from "./tools.js";

export const SERVER_NAME = "mealie-mcp";
export const SERVER_VERSION = "0.1.0";

export function createServer(config: Config, tools: MealieTool[]): Server {
  const byName = new Map(tools.map((t) => [t.name, t]));

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as { type: "object"; [k: string]: unknown },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;
    const tool = byName.get(name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }
    try {
      const result = await executeTool(config, tool, (args ?? {}) as Record<string, unknown>);
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error executing ${name}: ${reason}` }],
        isError: true,
      };
    }
  });

  return server;
}
