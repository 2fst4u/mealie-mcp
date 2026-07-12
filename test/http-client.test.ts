import { test } from "node:test";
import assert from "node:assert/strict";
import { executeTool } from "../src/http-client.js";
import type { Config } from "../src/config.js";
import type { MealieTool } from "../src/tools.js";
import type { TokenProvider } from "../src/auth.js";

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    baseUrl: "https://mealie.example.com",
    useBundledSpec: false,
    readOnly: false,
    include: [],
    exclude: [],
    timeoutMs: 60_000,
    ...overrides,
  };
}

const oauthConfig = (overrides: Partial<Config> = {}): Config =>
  baseConfig({
    oauth: {
      tokenUrl: "https://idp.example.com/token",
      clientId: "id",
      clientSecret: "secret",
      scope: "mealie",
      audience: "aud",
    },
    ...overrides,
  });

/** Install a fake global fetch that returns the given token responses in order. */
function stubFetch(responses: Array<{ status?: number; headers?: Record<string, string>; body: unknown }>) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  let i = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const params = init?.body as URLSearchParams;
    const headers = init?.headers as Record<string, string>;
    calls.push({ url: String(url), headers, body: params?.toString() ?? "" });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      statusText: "",
      headers: new Headers(r.headers ?? { "content-type": "application/json" }),
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
    } as Response;
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

class MockTokenProvider implements TokenProvider {
  constructor(private tokens: string[]) {}

  async authHeader(forceRefresh?: boolean): Promise<string | undefined> {
    if (forceRefresh) {
      this.tokens.shift();
    }
    return this.tokens[0] ? `Bearer ${this.tokens[0]}` : undefined;
  }
}

const dummyTool: MealieTool = {
  name: "get_recipes",
  description: "Get all recipes",
  method: "get",
  path: "/api/recipes",
  pathParams: [],
  queryParams: [],
  inputSchema: { type: "object", properties: {} }
};

test("retries request when it receives a 401 and config is refreshable", async () => {
  const fetchStub = stubFetch([
    { status: 401, body: { error: "unauthorized" } }, // First request fails with 401
    { status: 200, body: { items: ["recipe 1"] } },   // Second request succeeds
  ]);

  try {
    const config = oauthConfig(); // isRefreshable will be true
    const tokenProvider = new MockTokenProvider(["token1", "token2"]);

    const result = await executeTool(config, dummyTool, {}, tokenProvider);

    assert.equal(fetchStub.calls.length, 2, "Should have made 2 requests");
    assert.equal(fetchStub.calls[0].headers["Authorization"], "Bearer token1");
    assert.equal(fetchStub.calls[1].headers["Authorization"], "Bearer token2", "Should have forced a refresh and used new token");

    // Result should be the successful second response
    assert.equal(result.isError, undefined);
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "text");
    assert.match((result.content[0] as { text: string }).text, /recipe 1/);
  } finally {
    fetchStub.restore();
  }
});

test("returns error if second request after 401 also fails", async () => {
  const fetchStub = stubFetch([
    { status: 401, body: { error: "unauthorized" } }, // First request fails with 401
    { status: 401, body: { error: "unauthorized still" } }, // Second request also fails with 401
  ]);

  try {
    const config = oauthConfig(); // isRefreshable will be true
    const tokenProvider = new MockTokenProvider(["token1", "token2"]);

    const result = await executeTool(config, dummyTool, {}, tokenProvider);

    assert.equal(fetchStub.calls.length, 2, "Should have made 2 requests");

    // Result should be the 401 error
    assert.equal(result.isError, true);
    assert.equal(result.content.length, 1);
    assert.match((result.content[0] as { text: string }).text, /HTTP 401/);
    assert.match((result.content[0] as { text: string }).text, /unauthorized still/);
  } finally {
    fetchStub.restore();
  }
});

test("does not retry if config is not refreshable", async () => {
  const fetchStub = stubFetch([
    { status: 401, body: { error: "unauthorized" } }, // First request fails with 401
    { status: 200, body: { items: ["recipe 1"] } },   // This should not be reached
  ]);

  try {
    const config = baseConfig({ token: "static_token" }); // isRefreshable will be false
    const tokenProvider = new MockTokenProvider(["token1", "token2"]);

    const result = await executeTool(config, dummyTool, {}, tokenProvider);

    assert.equal(fetchStub.calls.length, 1, "Should have made only 1 request");

    // Result should be the 401 error
    assert.equal(result.isError, true);
    assert.equal(result.content.length, 1);
    assert.match((result.content[0] as { text: string }).text, /HTTP 401/);
    assert.match((result.content[0] as { text: string }).text, /unauthorized/);
  } finally {
    fetchStub.restore();
  }
});
