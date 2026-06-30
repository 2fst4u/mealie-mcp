#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createTokenProvider } from "./auth.js";
import { loadOpenApi } from "./openapi-loader.js";
import { filterTools, generateTools } from "./tools.js";
import { createServer, SERVER_NAME } from "./server.js";

function log(message: string): void {
  process.stderr.write(`[mealie-mcp] ${message}\n`);
}

/** Read this package's version from package.json (single source of truth). */
function readVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const version = readVersion();

  const { doc, source } = await loadOpenApi(config);
  const allTools = generateTools(doc, config.toolNameMax);
  const tools = filterTools(allTools, config);

  if (tools.length === 0) {
    log("Warning: no tools matched your include/exclude filters. The server will expose nothing.");
  }

  const categories = new Set(tools.map((t) => t.category));
  log(`${SERVER_NAME} v${version}`);
  log(`Mealie: ${config.baseUrl} | spec: ${source} (${doc.info?.version ?? "unknown"} version)`);
  log(`Exposing ${tools.length}/${allTools.length} tools across ${categories.size} categories.`);
  if (config.oauth) {
    log("Auth: OAuth2 client credentials (access token fetched from the IdP).");
    if (config.token) log("Note: MEALIE_API_TOKEN is ignored because OAuth is configured.");
  } else if (config.token) {
    log("Auth: static MEALIE_API_TOKEN.");
  } else {
    log("No credentials set — only unauthenticated endpoints will succeed.");
  }

  const auth = createTokenProvider(config);
  const server = createServer(config, tools, version, auth);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Server ready on stdio.");
}

main().catch((err) => {
  // SECURITY: Do not leak stack traces in error output to prevent exposing internals
  const reason = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[mealie-mcp] Fatal: ${reason}\n`);
  process.exit(1);
});
