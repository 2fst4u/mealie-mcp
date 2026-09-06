import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { TokenProvider } from "./auth.js";
import type { Config } from "./config.js";
import type { OpenApiDocument } from "./openapi-types.js";
import { safeUrl } from "./utils/url.js";

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

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

async function fetchLive(
  url: string,
  timeoutMs: number,
  authorization?: string,
): Promise<OpenApiDocument> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: authorization ? { Accept: "application/json", Authorization: authorization } : { Accept: "application/json" },
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
export async function loadOpenApi(config: Config, auth?: TokenProvider): Promise<LoadedSpec> {
  if (config.useBundledSpec) {
    return { doc: await loadBundled(), source: "bundled" };
  }

  const url = config.openapiUrl ?? `${config.baseUrl}/openapi.json`;
  try {
    const authorization = sameOrigin(config.baseUrl, url)
      ? auth
        ? await auth.authHeader()
        : config.token
          ? `Bearer ${config.token}`
          : undefined
      : undefined;
    const doc = await fetchLive(url, config.timeoutMs, authorization);
    if (!doc?.paths || typeof doc.paths !== "object") {
      throw new Error("response did not contain an OpenAPI `paths` object");
    }
    return { doc, source: "live" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[mealie-mcp] Could not fetch live spec from ${safeUrl(url)} (${reason}); falling back to bundled snapshot.\n`,
    );
    return { doc: await loadBundled(), source: "bundled" };
  }
}
