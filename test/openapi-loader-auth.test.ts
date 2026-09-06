import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOpenApi } from "../src/openapi-loader.js";
import { createTokenProvider } from "../src/auth.js";
import { makeConfig } from "./helpers.js";

test("does not forward credentials to a cross-origin OpenAPI override", async () => {
  const original = globalThis.fetch;
  let authorization: string | null = null;
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
    const config = makeConfig({ token: "test-token", openapiUrl: "https://untrusted.example/spec.json" });
    const result = await loadOpenApi(config, createTokenProvider(config));
    assert.equal(result.source, "live");
    assert.equal(authorization, null);
  } finally {
    globalThis.fetch = original;
  }
});
