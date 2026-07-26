import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const entrypoint = join(__dirname, "..", "src", "index.ts");

function runIndex(envOverrides: Record<string, string>): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync("node", ["--import", "tsx", entrypoint], {
    env: {
      ...process.env,
      ...envOverrides,
    },
    encoding: "utf8",
    input: "", // sends EOF to stdin
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status,
  };
}

test("index.ts executes successfully (happy path) and logs no credentials", () => {
  const { stderr, status } = runIndex({
    MEALIE_BASE_URL: "http://localhost",
  });
  assert.equal(status, 0);
  assert.ok(stderr.includes("[mealie-mcp] Server ready on stdio."));
  assert.ok(stderr.includes("[mealie-mcp] No credentials set — only unauthenticated endpoints will succeed."));
});

test("index.ts logs OAuth authentication", () => {
  const { stderr, status } = runIndex({
    MEALIE_BASE_URL: "http://localhost",
    MEALIE_OAUTH_TOKEN_URL: "http://localhost/token",
    MEALIE_OAUTH_CLIENT_ID: "client",
    MEALIE_OAUTH_CLIENT_SECRET: "secret",
  });
  assert.equal(status, 0);
  assert.ok(stderr.includes("[mealie-mcp] Auth: OAuth2 client credentials"));
});

test("index.ts logs static token authentication", () => {
  const { stderr, status } = runIndex({
    MEALIE_BASE_URL: "http://localhost",
    MEALIE_API_TOKEN: "super-secret-token",
  });
  assert.equal(status, 0);
  assert.ok(stderr.includes("[mealie-mcp] Auth: static MEALIE_API_TOKEN."));
});

test("index.ts handles fatal errors and exits with 1", () => {
  const { stderr, status } = runIndex({
    // MEALIE_BASE_URL is required, omitting it will throw an error in loadConfig
    MEALIE_BASE_URL: "",
  });
  assert.equal(status, 1);
  assert.ok(stderr.includes("[mealie-mcp] Fatal: MEALIE_BASE_URL is required"));
});

test("index.ts logs a warning if no tools match the filters", () => {
  const { stderr, status } = runIndex({
    MEALIE_BASE_URL: "http://localhost",
    MEALIE_TOOLS: "non-existent-tool-12345",
  });
  assert.equal(status, 0);
  assert.ok(stderr.includes("[mealie-mcp] Warning: no tools matched your include/exclude filters. The server will expose nothing."));
});
