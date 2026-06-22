#!/usr/bin/env node
// Refresh the bundled OpenAPI snapshot from a live Mealie instance.
// Usage: node scripts/refresh-spec.mjs [https://demo.mealie.io]
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const base = (process.argv[2] || "https://demo.mealie.io").replace(/\/+$/, "");
const url = `${base}/openapi.json`;
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "openapi.snapshot.json");

console.error(`Fetching ${url} ...`);
const res = await fetch(url);
if (!res.ok) {
  console.error(`Failed: HTTP ${res.status}`);
  process.exit(1);
}
const spec = await res.json();
await writeFile(out, JSON.stringify(spec, null, 0) + "\n");
const ops = Object.values(spec.paths).reduce(
  (n, item) => n + Object.keys(item).filter((m) => ["get", "post", "put", "patch", "delete"].includes(m)).length,
  0,
);
console.error(`Wrote ${out}`);
console.error(`Mealie version: ${spec.info?.version} | paths: ${Object.keys(spec.paths).length} | operations: ${ops}`);
