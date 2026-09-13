import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildDescription,
  buildHeadline,
  buildKeywords,
  isGenericName,
  resourceNoun,
  singularize,
} from "../src/description.js";
import { generateTools } from "../src/tools.js";
import type { OpenApiDocument } from "../src/openapi-types.js";

const here = dirname(fileURLToPath(import.meta.url));

async function loadSnapshot(): Promise<OpenApiDocument> {
  return JSON.parse(await readFile(join(here, "..", "openapi.snapshot.json"), "utf8")) as OpenApiDocument;
}

test("singularize handles the plural shapes REST paths use", () => {
  assert.equal(singularize("recipes"), "recipe");
  assert.equal(singularize("categories"), "category");
  assert.equal(singularize("boxes"), "box");
  assert.equal(singularize("foods"), "food");
  assert.equal(singularize("timeline"), "timeline");
  assert.equal(singularize("css"), "css");
});

test("resourceNoun names the resource a path acts on", () => {
  assert.deepEqual(resourceNoun("/api/recipes/{slug}"), {
    plural: "recipes",
    singular: "recipe",
    isPlural: true,
    actionVerb: undefined,
  });
  // Compound words Mealie writes as one token are split for readers and search.
  assert.equal(resourceNoun("/api/households/mealplans").plural, "meal plans");
  // A weak trailing segment borrows the one before it.
  assert.equal(resourceNoun("/api/households/shopping/items/{item_id}").singular, "shopping item");
  // Action and lookup-key segments are skipped, and name the verb instead.
  assert.equal(resourceNoun("/api/recipes/create/zip").singular, "recipe");
  assert.equal(resourceNoun("/api/recipes/{slug}/duplicate").actionVerb, "Duplicate");
  assert.equal(resourceNoun("/api/organizers/categories/slug/{category_slug}").singular, "category");
});

test("headline names the action and resource even when the summary does not", () => {
  const patch = buildHeadline({ summary: "Patch One", tags: ["Recipe: CRUD"] }, "/api/recipes/{slug}", "patch");
  assert.equal(patch, "Patch One — Recipe: CRUD. Partially update recipe.");

  const list = buildHeadline({ summary: "Get All", tags: ["Households: Mealplans"] }, "/api/households/mealplans", "get");
  assert.equal(list, "Get All — Households: Mealplans. List meal plans.");

  // A GET on a singleton path reads one record, so it is not phrased as a list.
  assert.equal(buildHeadline({}, "/api/app/about", "get"), "Get about.");
});

test("keywords cover the tool name and every synonym of its method", () => {
  const keywords = buildKeywords(
    { summary: "Patch One", tags: ["Recipe: CRUD"] },
    "/api/recipes/{slug}",
    "patch",
    "recipe_crud_patch_one",
    "recipe_crud",
  );

  for (const expected of [
    "recipe_crud_patch_one",
    "recipe crud patch one",
    "update recipe",
    "edit recipe",
    "modify recipe",
    "patch recipe",
    "recipe crud",
    "write",
    "mealie",
  ]) {
    assert.ok(keywords.includes(expected), `missing keyword: ${expected}`);
  }
  assert.equal(new Set(keywords).size, keywords.length, "keywords contain duplicates");
});

test("read-only operations are not labelled as writes", () => {
  const keywords = buildKeywords({}, "/api/recipes", "get", "recipe_crud_get_all", "recipe_crud");
  assert.ok(keywords.includes("read-only"));
  assert.ok(!keywords.includes("write"));
});

test("description keeps the route line and never drops the keywords", () => {
  const op = { summary: "Patch One", description: "Updates a recipe by existing slug and data.", tags: ["Recipe: CRUD"] };
  const text = buildDescription(op, "/api/recipes/{slug}", "patch", "recipe_crud_patch_one", "recipe_crud");
  const lines = text.split("\n");

  assert.equal(lines[1], "[PATCH /api/recipes/{slug}]");
  assert.equal(lines[2], "Updates a recipe by existing slug and data.");
  assert.ok(lines[3]?.startsWith("Keywords: "));
});

test("an overlong spec description is truncated, not the keyword line", () => {
  const op = { summary: "Patch One", description: "x".repeat(5000), tags: ["Recipe: CRUD"] };
  const text = buildDescription(op, "/api/recipes/{slug}", "patch", "recipe_crud_patch_one", "recipe_crud");

  assert.ok(text.length <= 2000, `description too long: ${text.length}`);
  assert.ok(text.split("\n").pop()?.startsWith("Keywords: "));
  assert.ok(text.includes("update recipe"));
});

test("a deprecated operation still says so first", () => {
  const text = buildDescription({ summary: "Get All", deprecated: true }, "/api/recipes", "get", "x", "y");
  assert.ok(text.startsWith("(DEPRECATED) "));
});

test("isGenericName flags names made only of CRUD boilerplate", () => {
  assert.ok(isGenericName("patch_one"));
  assert.ok(isGenericName("create_many"));
  assert.ok(isGenericName("test_one"));
  assert.ok(!isGenericName("suggest_recipes"));
  assert.ok(!isGenericName("parse_ingredient"));
  assert.ok(!isGenericName(""));
});

test("generated tools are findable by resource and action", async () => {
  const tools = generateTools(await loadSnapshot());
  const find = (name: string) => tools.find((t) => t.name === name);

  // Names that were pure CRUD boilerplate now carry their category, so a search
  // for the resource reaches them by name as well as by description.
  assert.ok(find("recipe_crud_patch_one"), "recipe_crud_patch_one missing");
  assert.ok(!find("patch_one"), "bare patch_one should no longer exist");

  // Every write tool for a resource mentions that resource and an update verb.
  for (const name of ["recipe_crud_patch_one", "recipe_crud_update_one"]) {
    const description = find(name)!.description.toLowerCase();
    assert.ok(description.includes("update recipe"), `${name} not findable by "update recipe"`);
    assert.ok(description.includes(name), `${name} does not mention its own name`);
  }

  // Meal plans are searchable as two words even though the path spells them as one.
  const mealplans = find("households_mealplans_get_all")!.description.toLowerCase();
  assert.ok(mealplans.includes("meal plan"), "meal plan tools not findable as two words");
});
