import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("throws when MEALIE_BASE_URL is missing", () => {
  assert.throws(() => loadConfig({} as NodeJS.ProcessEnv), /MEALIE_BASE_URL is required/);
});

test("strips trailing slashes from base url", () => {
  const cfg = loadConfig({ MEALIE_BASE_URL: "https://mealie.example.com///" } as NodeJS.ProcessEnv);
  assert.equal(cfg.baseUrl, "https://mealie.example.com");
});

test("parses token, with MEALIE_TOKEN fallback", () => {
  const a = loadConfig({ MEALIE_BASE_URL: "https://x", MEALIE_API_TOKEN: "abc" } as NodeJS.ProcessEnv);
  assert.equal(a.token, "abc");
  const b = loadConfig({ MEALIE_BASE_URL: "https://x", MEALIE_TOKEN: "fallback" } as NodeJS.ProcessEnv);
  assert.equal(b.token, "fallback");
});

test("parses boolean and list options", () => {
  const cfg = loadConfig({
    MEALIE_BASE_URL: "https://x",
    MEALIE_READ_ONLY: "true",
    MEALIE_USE_BUNDLED_SPEC: "1",
    MEALIE_TOOLS: "recipe_crud, households , ",
    MEALIE_EXCLUDE_TOOLS: "admin",
  } as NodeJS.ProcessEnv);
  assert.equal(cfg.readOnly, true);
  assert.equal(cfg.useBundledSpec, true);
  assert.deepEqual(cfg.include, ["recipe_crud", "households"]);
  assert.deepEqual(cfg.exclude, ["admin"]);
});

test("defaults timeout and rejects non-numeric", () => {
  const a = loadConfig({ MEALIE_BASE_URL: "https://x" } as NodeJS.ProcessEnv);
  assert.equal(a.timeoutMs, 60_000);
  const b = loadConfig({ MEALIE_BASE_URL: "https://x", MEALIE_TIMEOUT: "5000" } as NodeJS.ProcessEnv);
  assert.equal(b.timeoutMs, 5000);
  const c = loadConfig({ MEALIE_BASE_URL: "https://x", MEALIE_TIMEOUT: "abc" } as NodeJS.ProcessEnv);
  assert.equal(c.timeoutMs, 60_000);
});
