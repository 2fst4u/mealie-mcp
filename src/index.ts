#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type Config } from "./config.js";
import { createTokenProvider } from "./auth.js";
import { loadOpenApi } from "./openapi-loader.js";
import { filterTools, generateTools, hiddenCategories, type MealieTool as Tool } from "./tools.js";
import { createServer, SERVER_NAME } from "./server.js";

function log(message: string): void {
  process.stderr.write(`[mealie-mcp] ${message}\n`);
}

/** Category slugs for a log line: biggest first, capped unless debugging. */
function listCategories(categories: string[], debug: boolean): string {
  if (debug || categories.length <= 8) return categories.join(", ");
  return `${categories.slice(0, 8).join(", ")} (+${categories.length - 8} more; MEALIE_DEBUG=true lists them)`;
}

/** Read this package's version from package.json (single source of truth). */
async function readVersion(): Promise<string> {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    return JSON.parse(await readFile(pkgPath, "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Log details about the active authentication configuration. */
function logAuthConfig(config: Config): void {
  if (config.oauth) {
    log("Auth: OAuth2 client credentials (access token fetched from the IdP).");
    if (config.token) log("Note: MEALIE_API_TOKEN is ignored because OAuth is configured.");
  } else if (config.token) {
    log("Auth: static MEALIE_API_TOKEN.");
  } else {
    log("No credentials set — only unauthenticated endpoints will succeed.");
  }
}

/** Log any categories that were hidden due to user filters or read-only mode. */
function logHiddenCategories(allTools: Tool[], config: Config): void {
  const hidden = hiddenCategories(allTools, config);
  if (hidden.filters.length > 0) {
    const vars: string[] = [];
    if (config.include.length > 0) vars.push("MEALIE_TOOLS");
    if (config.exclude.length > 0) vars.push("MEALIE_EXCLUDE_TOOLS");
    log(
      `${vars.join(" / ")} hides ${hidden.filters.length} categories entirely: ${listCategories(hidden.filters, config.debug)}.`,
    );
  }
  if (hidden.readOnly.length > 0) {
    log(
      `MEALIE_READ_ONLY hides ${hidden.readOnly.length} write-only categories: ${listCategories(hidden.readOnly, config.debug)}.`,
    );
  }
}

/** Log summary information about the server, loaded OpenAPI spec, tools, and auth. */
function logStartupSummary(
  version: string,
  config: Config,
  source: string,
  specVersion: string,
  tools: Tool[],
  allTools: Tool[],
): void {
  if (tools.length === 0) {
    log("Warning: no tools matched your include/exclude filters. The server will expose nothing.");
  }

  const categories = new Set<string>(tools.map((t) => t.category));

  log(`${SERVER_NAME} v${version}`);
  log(`Mealie: ${config.baseUrl} | spec: ${source} (${specVersion} version)`);
  log(`Exposing ${tools.length}/${allTools.length} tools across ${categories.size} categories.`);

  logHiddenCategories(allTools, config);
  logAuthConfig(config);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const auth = createTokenProvider(config);

  // The version read and the authenticated spec load are independent, so overlap
  // them. The token provider ensures a permission-scoped live spec is fetched.
  const [version, { doc, source }] = await Promise.all([readVersion(), loadOpenApi(config, auth)]);
  const allTools = generateTools(doc, config.toolNameMax);
  const tools = filterTools(allTools, config);

  logStartupSummary(version, config, source, doc.info?.version ?? "unknown", tools, allTools);

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
