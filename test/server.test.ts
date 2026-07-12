import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";

test("createServer - unknown tool execution returns error", async () => {
    const config = {} as any;
    const auth = {} as any;
    const tools = [{ name: "my-tool", description: "test tool", inputSchema: { type: "object" } }] as any;

    const server = createServer(config, tools, "1.0", auth);

    const handlers = (server as any)._requestHandlers;
    const callToolHandler = handlers.get("tools/call");

    assert.ok(callToolHandler, "tools/call handler should be registered");

    const result = await callToolHandler(
        { method: "tools/call", params: { name: "invalid-tool", arguments: {} } },
        { isCanceled: false }
    );

    assert.deepEqual(result, {
        content: [{ type: "text", text: "Unknown tool: invalid-tool" }],
        isError: true,
    });
});
