import { test } from "node:test";
import assert from "node:assert/strict";
import { executeTool } from "../src/http-client.js";
import type { Config } from "../src/config.js";
import type { MealieTool } from "../src/tools.js";
import type { TokenProvider } from "../src/auth.js";

function baseConfig(): Config {
  return {
    baseUrl: "https://mealie.example.com",
    useBundledSpec: false,
    readOnly: false,
    include: [],
    exclude: [],
    timeoutMs: 60_000,
    toolNameMax: 64,
  };
}

const dummyAuth: TokenProvider = {
  authHeader: async () => undefined,
};

const dummyTool: MealieTool = {
  name: "dummy",
  description: "dummy tool",
  method: "get",
  path: "/api/dummy",
  category: "dummy",
  pathParams: [],
  queryParams: [],
  inputSchema: { type: "object" },
};

function stubFetchReject(errorToThrow: unknown) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw errorToThrow;
  };
  return { restore: () => (globalThis.fetch = original) };
}

test("executeTool handles fetch rejecting with an Error instance", async () => {
  const stub = stubFetchReject(new Error("Network connection lost"));
  try {
    const result = await executeTool(baseConfig(), dummyTool, {}, dummyAuth);
    assert.equal(result.isError, true);
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "text");
    assert.match(
      (result.content[0] as { type: "text"; text: string }).text,
      /Request to GET https:\/\/mealie\.example\.com\/api\/dummy failed: Network connection lost/
    );
  } finally {
    stub.restore();
  }
});

test("executeTool handles fetch rejecting with a primitive string", async () => {
  const stub = stubFetchReject("Unknown string error");
  try {
    const result = await executeTool(baseConfig(), dummyTool, {}, dummyAuth);
    assert.equal(result.isError, true);
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "text");
    assert.match(
      (result.content[0] as { type: "text"; text: string }).text,
      /Request to GET https:\/\/mealie\.example\.com\/api\/dummy failed: Unknown string error/
    );
  } finally {
    stub.restore();
  }
});
