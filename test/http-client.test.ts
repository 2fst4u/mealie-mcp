import test from "node:test";
import assert from "node:assert/strict";
import { executeTool } from "../src/http-client.js";
import type { Config } from "../src/config.js";

test("buildUrl escapes string replacements correctly", async () => {
    // We just want to check buildUrl, but it's internal. We can use executeTool to trigger it.
    // By mocking fetch we can see what url it requested.
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    globalThis.fetch = async (url) => {
        requestedUrl = url.toString();
        return new Response("ok");
    };

    try {
        const config: Config = {
            baseUrl: "http://example.com",
            apiToken: undefined,
            oauth: undefined,
            timeoutMs: 1000,
            tools: { allowed: [], denied: [] },
            readOnly: false,
            includeCategories: [],
        };
        const tool = {
            name: "test",
            description: "test",
            method: "get",
            path: "/test/{id}",
            pathParams: ["id"],
            queryParams: [],
            inputSchema: { type: "object" } as any,
        };
        const auth = { authHeader: async () => undefined };

        await executeTool(config, tool as any, { id: "$&" }, auth);

        assert.equal(requestedUrl, "http://example.com/test/%24%26");
    } finally {
        globalThis.fetch = originalFetch;
    }
});
