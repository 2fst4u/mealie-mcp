import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Config } from "./config.js";
import type { OpenApiDocument } from "./openapi-types.js";

export interface LoadedSpec {
  doc: OpenApiDocument;
  source: "live" | "bundled";
}

const here = dirname(fileURLToPath(import.meta.url));
// Bundled snapshot lives at the package root (one level above src/ or dist/).
const SNAPSHOT_PATH = join(here, "..", "openapi.snapshot.json");

async function loadBundled(): Promise<OpenApiDocument> {
  const raw = await readFile(SNAPSHOT_PATH, "utf8");
  return JSON.parse(raw) as OpenApiDocument;
}

async function fetchLive(url: string, timeoutMs: number): Promise<OpenApiDocument> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as OpenApiDocument;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Load the OpenAPI document that drives tool generation.
 *
 * Preference order:
 *  1. If `useBundledSpec` is set, use the snapshot shipped with the package.
 *  2. Otherwise fetch `${baseUrl}/openapi.json` (or `openapiUrl`) so tools match
 *     the exact Mealie version the user runs.
 *  3. On any failure, fall back to the bundled snapshot.
 */
export async function loadOpenApi(config: Config): Promise<LoadedSpec> {
  if (config.useBundledSpec) {
    return { doc: await loadBundled(), source: "bundled" };
  }

  const url = config.openapiUrl ?? `${config.baseUrl}/openapi.json`;
  try {
    const doc = await fetchLive(url, config.timeoutMs);
    if (!doc?.paths || typeof doc.paths !== "object") {
      throw new Error("response did not contain an OpenAPI `paths` object");
    }
    return { doc, source: "live" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[mealie-mcp] Could not fetch live spec from ${url} (${reason}); falling back to bundled snapshot.\n`,
    );
    return { doc: await loadBundled(), source: "bundled" };
  }
}
