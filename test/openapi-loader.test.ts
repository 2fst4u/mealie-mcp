import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOpenApi } from "../src/openapi-loader.js";
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

/** Install a fake global fetch that returns the given token responses in order. */
function stubFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; signal?: AbortSignal }> = [];
  let i = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), signal: init?.signal });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (r.status === -1) {
        throw new Error("Network error");
    }
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      statusText: "",
      json: async () => (typeof r.body === "string" ? JSON.parse(r.body) : r.body),
    } as Response;
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

function stubStderr() {
  const logs: string[] = [];
  const original = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array, cbOrEncoding?: any, cb?: any) => {
    logs.push(chunk.toString());
    if (typeof cbOrEncoding === "function") cbOrEncoding();
    else if (typeof cb === "function") cb();
    return true;
  }) as typeof process.stderr.write;
  return { logs, restore: () => (process.stderr.write = original) };
}

// Just skip checking the doc entirely for the bundled ones,
// because asserting against the huge default openapi.snapshot.json takes forever.
// Alternatively, we can just check if it contains a paths object.

test("uses the bundled spec directly when useBundledSpec is true", async () => {
  const result = await loadOpenApi(baseConfig({ useBundledSpec: true }));
  assert.equal(result.source, "bundled");
  assert.ok(result.doc.paths, "should contain paths object");
});

test("uses the live spec from ${baseUrl}/openapi.json when the fetch succeeds and contains paths", async () => {
  const liveSpec = { paths: { "/live": {} }, info: { title: "Live" } };
  const fetchStub = stubFetch([{ body: liveSpec }]);
  try {
    const result = await loadOpenApi(baseConfig());
    assert.equal(result.source, "live");
    assert.deepEqual(result.doc as unknown, liveSpec);
    assert.equal(fetchStub.calls.length, 1);
    assert.equal(fetchStub.calls[0].url, "https://mealie.example.com/openapi.json");
  } finally {
    fetchStub.restore();
  }
});

test("uses openapiUrl if explicitly provided in the config", async () => {
  const liveSpec = { paths: { "/live": {} } };
  const fetchStub = stubFetch([{ body: liveSpec }]);
  try {
    const result = await loadOpenApi(baseConfig({ openapiUrl: "https://custom.example.com/spec.json" }));
    assert.equal(result.source, "live");
    assert.deepEqual(result.doc as unknown, liveSpec);
    assert.equal(fetchStub.calls.length, 1);
    assert.equal(fetchStub.calls[0].url, "https://custom.example.com/spec.json");
  } finally {
    fetchStub.restore();
  }
});

test("gracefully falls back to the bundled spec if fetch returns a non-200 HTTP status code", async () => {
  const fetchStub = stubFetch([{ status: 404, body: "Not Found" }]);
  const stderrStub = stubStderr();
  try {
    const result = await loadOpenApi(baseConfig());
    assert.equal(result.source, "bundled");
    assert.ok(result.doc.paths, "should contain paths object");
    assert.equal(fetchStub.calls.length, 1);
    assert.equal(stderrStub.logs.length, 1);
    assert.match(stderrStub.logs[0], /Could not fetch live spec/);
    assert.match(stderrStub.logs[0], /HTTP 404/);
  } finally {
    fetchStub.restore();
    stderrStub.restore();
  }
});

test("gracefully falls back to the bundled spec if the fetched JSON is missing a paths object", async () => {
  const fetchStub = stubFetch([{ body: { info: { title: "Invalid" } } }]);
  const stderrStub = stubStderr();
  try {
    const result = await loadOpenApi(baseConfig());
    assert.equal(result.source, "bundled");
    assert.ok(result.doc.paths, "should contain paths object");
    assert.equal(fetchStub.calls.length, 1);
    assert.equal(stderrStub.logs.length, 1);
    assert.match(stderrStub.logs[0], /Could not fetch live spec/);
    assert.match(stderrStub.logs[0], /response did not contain an OpenAPI `paths` object/);
  } finally {
    fetchStub.restore();
    stderrStub.restore();
  }
});

test("gracefully falls back to the bundled spec if the fetch promise rejects (e.g., network error)", async () => {
  const fetchStub = stubFetch([{ status: -1, body: "" }]);
  const stderrStub = stubStderr();
  try {
    const result = await loadOpenApi(baseConfig());
    assert.equal(result.source, "bundled");
    assert.ok(result.doc.paths, "should contain paths object");
    assert.equal(fetchStub.calls.length, 1);
    assert.equal(stderrStub.logs.length, 1);
    assert.match(stderrStub.logs[0], /Could not fetch live spec/);
    assert.match(stderrStub.logs[0], /Network error/);
  } finally {
    fetchStub.restore();
    stderrStub.restore();
  }
});

test("passes an AbortSignal to fetch to enforce the configured timeout", async () => {
  const liveSpec = { paths: { "/live": {} } };
  const fetchStub = stubFetch([{ body: liveSpec }]);
  try {
    await loadOpenApi(baseConfig({ timeoutMs: 1234 }));
    assert.equal(fetchStub.calls.length, 1);
    const signal = fetchStub.calls[0].signal;
    assert.ok(signal, "fetch should be called with an AbortSignal");
    assert.ok(signal instanceof AbortSignal, "signal should be an instance of AbortSignal");
  } finally {
    fetchStub.restore();
  }
});
