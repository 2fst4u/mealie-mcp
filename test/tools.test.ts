import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateTools, filterTools, type MealieTool } from "../src/tools.js";
import type { Config } from "../src/config.js";
import type { OpenApiDocument } from "../src/openapi-types.js";

const here = dirname(fileURLToPath(import.meta.url));
const snapshotPath = join(here, "..", "openapi.snapshot.json");

async function loadSnapshot(): Promise<OpenApiDocument> {
  return JSON.parse(await readFile(snapshotPath, "utf8")) as OpenApiDocument;
}

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

/** Collect every $ref string anywhere within a JSON value. */
function collectRefs(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "$ref" && typeof value === "string") out.push(value);
    else collectRefs(value, out);
  }
}

test("generates one valid tool per operation", async () => {
  const doc = await loadSnapshot();
  const tools = generateTools(doc);

  assert.ok(tools.length > 200, `expected >200 tools, got ${tools.length}`);

  const names = new Set<string>();
  for (const t of tools) {
    assert.match(t.name, /^[a-zA-Z0-9_-]{1,64}$/, `invalid tool name: ${t.name}`);
    // Stay comfortably under the 64-char limit so clients that prefix the
    // server name (e.g. remote connectors) don't overflow it.
    assert.ok(t.name.length <= 60, `tool name too long (${t.name.length}): ${t.name}`);
    assert.ok(!names.has(t.name), `duplicate tool name: ${t.name}`);
    names.add(t.name);
    assert.equal((t.inputSchema as { type?: string }).type, "object", `${t.name} schema not object`);
    assert.ok(t.description.length > 0, `${t.name} has empty description`);
  }
});

test("every tool input schema is self-contained ($defs closure)", async () => {
  const doc = await loadSnapshot();
  const tools = generateTools(doc);

  for (const t of tools) {
    const refs: string[] = [];
    collectRefs(t.inputSchema, refs);
    const defs = (t.inputSchema as { $defs?: Record<string, unknown> }).$defs ?? {};
    for (const ref of refs) {
      assert.ok(
        ref.startsWith("#/$defs/"),
        `${t.name} has unresolved component ref: ${ref}`,
      );
      const name = ref.slice("#/$defs/".length);
      assert.ok(name in defs, `${t.name} references missing $def: ${name}`);
    }
  }
});

test("detects multipart file fields", async () => {
  const doc = await loadSnapshot();
  const tools = generateTools(doc);
  const byPath = (p: string, m: string) =>
    tools.find((t) => t.path === p && t.method === m) as MealieTool;

  assert.deepEqual(byPath("/api/recipes/{slug}/image", "put").body?.fileFields, ["image"]);
  assert.deepEqual(byPath("/api/recipes/create/image", "post").body?.fileFields, ["images"]);
  assert.deepEqual(byPath("/api/recipes/{slug}/assets", "post").body?.fileFields, ["file"]);
});

test("detects array-valued query params", async () => {
  const doc = await loadSnapshot();
  const tools = generateTools(doc);
  const getRecipes = tools.find((t) => t.path === "/api/recipes" && t.method === "get") as MealieTool;
  const arrayParams = getRecipes.queryParams.filter((q) => q.isArray).map((q) => q.name);
  assert.ok(arrayParams.includes("categories"));
  assert.ok(arrayParams.includes("tags"));
});

test("path params are required in the input schema", async () => {
  const doc = await loadSnapshot();
  const tools = generateTools(doc);
  const getOne = tools.find((t) => t.path === "/api/recipes/{slug}" && t.method === "get") as MealieTool;
  assert.ok(getOne.pathParams.includes("slug"));
  const required = (getOne.inputSchema as { required?: string[] }).required ?? [];
  assert.ok(required.includes("slug"));
});

test("readOnly filter keeps only GET tools", async () => {
  const doc = await loadSnapshot();
  const tools = generateTools(doc);
  const filtered = filterTools(tools, baseConfig({ readOnly: true }));
  assert.ok(filtered.length > 0);
  assert.ok(filtered.every((t) => t.method === "get"));
});

test("include filter matches by category prefix and exact name", async () => {
  const doc = await loadSnapshot();
  const tools = generateTools(doc);

  const byCategory = filterTools(tools, baseConfig({ include: ["recipe_crud"] }));
  assert.ok(byCategory.length > 0);
  assert.ok(byCategory.every((t) => t.category === "recipe_crud"));

  const byPrefix = filterTools(tools, baseConfig({ include: ["households"] }));
  assert.ok(byPrefix.length > 0);
  assert.ok(byPrefix.every((t) => t.category.startsWith("households")));

  const exactName = byCategory[0].name;
  const single = filterTools(tools, baseConfig({ include: [exactName] }));
  assert.ok(single.some((t) => t.name === exactName));
});

test("exclude filter removes matching tools", async () => {
  const doc = await loadSnapshot();
  const tools = generateTools(doc);
  const filtered = filterTools(tools, baseConfig({ exclude: ["admin"] }));
  assert.ok(filtered.every((t) => !t.category.startsWith("admin")));
  assert.ok(filtered.length < tools.length);
});
