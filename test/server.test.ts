import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../src/server.js";
import type { Config } from "../src/config.js";
import type { MealieTool } from "../src/tools.js";

test("createServer - unknown tool returns error", async () => {
  // Capture handlers when setRequestHandler is called
  const handlers = new Map<any, Function>();

  mock.method(Server.prototype, "setRequestHandler", (schema: any, handler: Function) => {
    handlers.set(schema, handler);
  });

  const config: Config = {
    baseUrl: "https://mealie.example.com",
    useBundledSpec: false,
    readOnly: false,
    include: [],
    exclude: [],
    timeoutMs: 60000,
  };

  const tools: MealieTool[] = [];
  const version = "1.0.0";
  const auth = { getToken: async () => undefined };

  // This will call setRequestHandler
  createServer(config, tools, version, auth);

  const callToolHandler = handlers.get(CallToolRequestSchema);
  assert.ok(callToolHandler, "CallToolRequestSchema handler should be registered");

  // Call the handler with an unknown tool
  const request = {
    params: {
      name: "nonexistent_tool",
      arguments: {},
    }
  };

  const result = await callToolHandler(request);

  assert.deepEqual(result, {
    content: [{ type: "text", text: "Unknown tool: nonexistent_tool" }],
    isError: true,
  });

  mock.restoreAll();
});
