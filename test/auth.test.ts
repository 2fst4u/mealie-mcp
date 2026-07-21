import { test } from "node:test";
import assert from "node:assert/strict";
import { createTokenProvider, isRefreshable } from "../src/auth.js";
import type { Config } from "../src/config.js";

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
function stubFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; body: string }> = [];
  let i = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const params = init?.body as URLSearchParams;
    calls.push({ url: String(url), body: params?.toString() ?? "" });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (r.status === -1) {
      throw new Error("Network error");
    }
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      statusText: "",
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
    } as Response;
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("OAuth provider fetches a bearer token and sends the client-credentials grant", async () => {
  const fetchStub = stubFetch([{ body: { access_token: "abc", token_type: "Bearer", expires_in: 3600 } }]);
  try {
    const provider = createTokenProvider(oauthConfig());
    const header = await provider.authHeader();
    assert.equal(header, "Bearer abc");
    assert.equal(fetchStub.calls.length, 1);
    assert.equal(fetchStub.calls[0].url, "https://idp.example.com/token");
    assert.match(fetchStub.calls[0].body, /grant_type=client_credentials/);
    assert.match(fetchStub.calls[0].body, /client_id=id/);
    assert.match(fetchStub.calls[0].body, /scope=mealie/);
    assert.match(fetchStub.calls[0].body, /audience=aud/);
  } finally {
    fetchStub.restore();
  }
});

test("OAuth provider caches the token within its lifetime", async () => {
  const fetchStub = stubFetch([{ body: { access_token: "abc", expires_in: 3600 } }]);
  try {
    const provider = createTokenProvider(oauthConfig());
    await provider.authHeader();
    await provider.authHeader();
    assert.equal(fetchStub.calls.length, 1, "second call should be served from cache");
  } finally {
    fetchStub.restore();
  }
});

test("OAuth provider re-fetches on forceRefresh", async () => {
  const fetchStub = stubFetch([
    { body: { access_token: "abc", expires_in: 3600 } },
    { body: { access_token: "def", expires_in: 3600 } },
  ]);
  try {
    const provider = createTokenProvider(oauthConfig());
    assert.equal(await provider.authHeader(), "Bearer abc");
    assert.equal(await provider.authHeader(true), "Bearer def");
    assert.equal(fetchStub.calls.length, 2);
  } finally {
    fetchStub.restore();
  }
});

test("OAuth provider re-fetches once a token has expired", async () => {
  // expires_in below the safety margin => already expired => never cached.
  const fetchStub = stubFetch([
    { body: { access_token: "abc", expires_in: 1 } },
    { body: { access_token: "def", expires_in: 1 } },
  ]);
  try {
    const provider = createTokenProvider(oauthConfig());
    await provider.authHeader();
    await provider.authHeader();
    assert.equal(fetchStub.calls.length, 2, "expired token should trigger a refetch");
  } finally {
    fetchStub.restore();
  }
});

test("concurrent first calls share a single token fetch", async () => {
  const fetchStub = stubFetch([{ body: { access_token: "abc", expires_in: 3600 } }]);
  try {
    const provider = createTokenProvider(oauthConfig());
    const [a, b] = await Promise.all([provider.authHeader(), provider.authHeader()]);
    assert.equal(a, "Bearer abc");
    assert.equal(b, "Bearer abc");
    assert.equal(fetchStub.calls.length, 1, "parallel calls should not stampede the token endpoint");
  } finally {
    fetchStub.restore();
  }
});

test("OAuth provider surfaces a clear error on a non-2xx token response", async () => {
  const fetchStub = stubFetch([{ status: 401, body: "nope" }]);
  try {
    const provider = createTokenProvider(oauthConfig());
    await assert.rejects(() => provider.authHeader(), /HTTP 401/);
  } finally {
    fetchStub.restore();
  }
});

test("OAuth provider surfaces a clear error when fetch rejects (e.g., network error)", async () => {
  const fetchStub = stubFetch([{ status: -1, body: "" }]);
  try {
    const provider = createTokenProvider(oauthConfig());
    await assert.rejects(() => provider.authHeader(), /OAuth token request to https:\/\/idp\.example\.com\/token failed: Network error/);
  } finally {
    fetchStub.restore();
  }
});

test("static provider returns the bearer token and never fetches", async () => {
  const fetchStub = stubFetch([{ body: {} }]);
  try {
    const provider = createTokenProvider(baseConfig({ token: "static" }));
    assert.equal(await provider.authHeader(true), "Bearer static");
    assert.equal(fetchStub.calls.length, 0);
  } finally {
    fetchStub.restore();
  }
});

test("anonymous provider returns undefined", async () => {
  const provider = createTokenProvider(baseConfig());
  assert.equal(await provider.authHeader(), undefined);
});

test("isRefreshable is true only for OAuth", () => {
  assert.equal(isRefreshable(oauthConfig()), true);
  assert.equal(isRefreshable(baseConfig({ token: "static" })), false);
  assert.equal(isRefreshable(baseConfig()), false);
});
