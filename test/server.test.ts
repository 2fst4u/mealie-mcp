import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";
import type { Config } from "../src/config.js";
import type { MealieTool } from "../src/tools.js";

test("server CallToolRequestSchema handler catches errors from executeTool", async () => {
  const config: Config = { baseUrl: "http://example.com" } as any;
  const tools: MealieTool[] = [{
    name: "test_tool",
    description: "A test tool",
    method: "get",
    path: "/api/test/{id}",
    pathParams: ["id"],
    queryParams: [],
    inputSchema: { type: "object" }
  }];

  const server = createServer(config, tools, "1.0.0", {} as any);

  // Extract the handler registered for tools/call
  const handler = (server as any)._requestHandlers.get("tools/call");
  assert.ok(handler, "Handler for tools/call should be registered");

  // Trigger an error by omitting required path params.
  // executeTool naturally throws: Missing required path parameter: id
  const response = await handler({
    method: "tools/call",
    params: { name: "test_tool", arguments: {} }
  }, {} as any);

  assert.deepEqual(response, {
    content: [{ type: "text", text: "Error executing test_tool: Missing required path parameter: id" }],
    isError: true,
  });
});

test("server ListToolsRequestSchema handler returns tools", async () => {
  const config: Config = { baseUrl: "http://example.com" } as any;
  const tools: MealieTool[] = [{
    name: "test_tool",
    description: "A test tool",
    method: "get",
    path: "/api/test",
    pathParams: [],
    queryParams: [],
    inputSchema: { type: "object", properties: { a: { type: "string" } } }
  }];

  const server = createServer(config, tools, "1.0.0", {} as any);

  const handler = (server as any)._requestHandlers.get("tools/list");
  assert.ok(handler, "Handler for tools/list should be registered");

  const response = await handler({ method: "tools/list", params: {} }, {} as any);

  assert.deepEqual(response, {
    tools: [{
      name: "test_tool",
      description: "A test tool",
      inputSchema: { type: "object", properties: { a: { type: "string" } } }
    }]
  });
});

test("server CallToolRequestSchema handler returns error for unknown tool", async () => {
  const config: Config = { baseUrl: "http://example.com" } as any;
  const tools: MealieTool[] = [];

  const server = createServer(config, tools, "1.0.0", {} as any);

  const handler = (server as any)._requestHandlers.get("tools/call");

  const response = await handler({
    method: "tools/call",
    params: { name: "non_existent", arguments: {} }
  }, {} as any);

  assert.deepEqual(response, {
    content: [{ type: "text", text: "Unknown tool: non_existent" }],
    isError: true,
  });
});
