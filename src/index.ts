#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { loadOpenApi } from "./openapi-loader.js";
import { filterTools, generateTools } from "./tools.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

function log(message: string): void {
  process.stderr.write(`[mealie-mcp] ${message}\n`);
}

async function main(): Promise<void> {
  const config = loadConfig();

  const { doc, source } = await loadOpenApi(config);
  const allTools = generateTools(doc);
  const tools = filterTools(allTools, config);

  if (tools.length === 0) {
    log("Warning: no tools matched your include/exclude filters. The server will expose nothing.");
  }

  const categories = new Set(tools.map((t) => t.category));
  log(`${SERVER_NAME} v${SERVER_VERSION}`);
  log(`Mealie: ${config.baseUrl} | spec: ${source} (${doc.info?.version ?? "unknown"} version)`);
  log(`Exposing ${tools.length}/${allTools.length} tools across ${categories.size} categories.`);
  if (!config.token) {
    log("No MEALIE_API_TOKEN set — only unauthenticated endpoints will succeed.");
  }

  const server = createServer(config, tools);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Server ready on stdio.");
}

main().catch((err) => {
  const reason = err instanceof Error ? err.stack || err.message : String(err);
  process.stderr.write(`[mealie-mcp] Fatal: ${reason}\n`);
  process.exit(1);
});
