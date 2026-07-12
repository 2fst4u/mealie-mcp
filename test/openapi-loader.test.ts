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

/** Install a fake global fetch that throws the given error. */
function stubFetchError(error: Error) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw error;
  };
  return { restore: () => (globalThis.fetch = original) };
}

test("loadOpenApi falls back to bundled snapshot and logs warning when fetch fails", async () => {
  const fetchStub = stubFetchError(new Error("Network failure"));

  const originalStderrWrite = process.stderr.write;
  let stderrOutput = "";
  process.stderr.write = (str: string | Uint8Array) => {
    stderrOutput += str.toString();
    return true;
  };

  try {
    const config = baseConfig();
    const result = await loadOpenApi(config);

    assert.equal(result.source, "bundled");
    assert.ok(result.doc.paths, "Should load valid bundled doc");
    assert.match(
      stderrOutput,
      /\[mealie-mcp\] Could not fetch live spec from https:\/\/mealie\.example\.com\/openapi\.json \(Network failure\); falling back to bundled snapshot\./
    );
  } finally {
    fetchStub.restore();
    process.stderr.write = originalStderrWrite;
  }
});
