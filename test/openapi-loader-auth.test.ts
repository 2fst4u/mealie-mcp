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

test("logs an error and fetches spec unauthenticated when TokenProvider.authHeader throws an Error", async () => {
  const originalFetch = globalThis.fetch;
  const originalStderr = process.stderr.write;
  let authorization: string | null = null;
  const logs: string[] = [];

  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    authorization = new Headers(init?.headers).get("authorization");
    return {
      ok: true,
      status: 200,
      statusText: "",
      json: async () => ({ paths: { "/live": {} }, info: { title: "Live" } }),
    } as Response;
  }) as typeof fetch;

  process.stderr.write = ((chunk: string | Uint8Array, cbOrEncoding?: any, cb?: any) => {
    logs.push(chunk.toString());
    if (typeof cbOrEncoding === "function") cbOrEncoding();
    else if (typeof cb === "function") cb();
    return true;
  }) as typeof process.stderr.write;

  try {
    const config = makeConfig({ token: "test-token" });
    const failingAuth = {
      authHeader: async () => {
        throw new Error("Token failure");
      },
    };
    const result = await loadOpenApi(config, failingAuth);
    assert.equal(result.source, "live");
    assert.equal(authorization, null);
    assert.equal(logs.length, 1);
    assert.match(
      logs[0],
      /\[mealie-mcp\] Could not obtain a credential \(Token failure\); fetching the spec unauthenticated\. API calls will fail until this is fixed\./,
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.stderr.write = originalStderr;
  }
});

test("logs an error and fetches spec unauthenticated when TokenProvider.authHeader throws a non-Error value", async () => {
  const originalFetch = globalThis.fetch;
  const originalStderr = process.stderr.write;
  let authorization: string | null = null;
  const logs: string[] = [];

  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    authorization = new Headers(init?.headers).get("authorization");
    return {
      ok: true,
      status: 200,
      statusText: "",
      json: async () => ({ paths: { "/live": {} }, info: { title: "Live" } }),
    } as Response;
  }) as typeof fetch;

  process.stderr.write = ((chunk: string | Uint8Array, cbOrEncoding?: any, cb?: any) => {
    logs.push(chunk.toString());
    if (typeof cbOrEncoding === "function") cbOrEncoding();
    else if (typeof cb === "function") cb();
    return true;
  }) as typeof process.stderr.write;

  try {
    const config = makeConfig({ token: "test-token" });
    const failingAuth = {
      authHeader: async () => {
        throw "String token failure";
      },
    };
    const result = await loadOpenApi(config, failingAuth);
    assert.equal(result.source, "live");
    assert.equal(authorization, null);
    assert.equal(logs.length, 1);
    assert.match(
      logs[0],
      /\[mealie-mcp\] Could not obtain a credential \(String token failure\); fetching the spec unauthenticated\. API calls will fail until this is fixed\./,
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.stderr.write = originalStderr;
  }
});
