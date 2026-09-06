import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOpenApi } from "../src/openapi-loader.js";
import { makeConfig } from "./helpers.js";

test("uses the supplied token provider for same-origin live OpenAPI requests", async () => {
  const original = globalThis.fetch;
  let authorization: string | null = null;
  let providerCalls = 0;
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    authorization = new Headers(init?.headers).get("authorization");
    return {
      ok: true,
      status: 200,
      statusText: "",
      json: async () => ({ paths: { "/live": {} }, info: { title: "Live" } }),
    } as Response;
  }) as typeof fetch;

  try {
    await loadOpenApi(makeConfig({ token: "static-token" }), {
      authHeader: async () => {
        providerCalls += 1;
        return "Bearer oauth-token";
      },
    });
    assert.equal(providerCalls, 1);
    assert.equal(authorization, "Bearer oauth-token");
  } finally {
    globalThis.fetch = original;
  }
});
