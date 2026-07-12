import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDefs, localize, COMPONENT_REF_PREFIX } from "../src/schema.js";
import type { JsonSchema } from "../src/openapi-types.js";

test("localize handles undefined", () => {
  assert.equal(localize(undefined), undefined);
});

test("localize deep clones a schema without refs", () => {
  const schema: JsonSchema = { type: "string", example: "test" };
  const localized = localize(schema);
  assert.deepEqual(localized, schema);
  assert.notEqual(localized, schema); // Should be a deep clone
});

test("localize rewrites component refs to $defs", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: {
      user: { $ref: `${COMPONENT_REF_PREFIX}User` },
      group: { $ref: `${COMPONENT_REF_PREFIX}Group` },
    },
  };

  const expected: JsonSchema = {
    type: "object",
    properties: {
      user: { $ref: "#/$defs/User" },
      group: { $ref: "#/$defs/Group" },
    },
  };

  const localized = localize(schema);
  assert.deepEqual(localized, expected);
});

test("localize handles arrays of refs", () => {
  const schema: JsonSchema = {
    type: "array",
    items: {
      anyOf: [
        { $ref: `${COMPONENT_REF_PREFIX}Dog` },
        { $ref: `${COMPONENT_REF_PREFIX}Cat` },
      ],
    },
  };

  const expected: JsonSchema = {
    type: "array",
    items: {
      anyOf: [
        { $ref: "#/$defs/Dog" },
        { $ref: "#/$defs/Cat" },
      ],
    },
  };

  const localized = localize(schema);
  assert.deepEqual(localized, expected);
});

test("buildDefs returns undefined if no components referenced", () => {
  const roots: JsonSchema[] = [{ type: "string" }, { type: "number" }];
  const components: Record<string, JsonSchema> = {
    User: { type: "object" },
  };

  const defs = buildDefs(roots, components);
  assert.equal(defs, undefined);
});

test("buildDefs returns undefined if roots array is empty", () => {
  const defs = buildDefs([], {});
  assert.equal(defs, undefined);
});

test("buildDefs ignores undefined roots", () => {
  const roots = [undefined];
  const defs = buildDefs(roots, {});
  assert.equal(defs, undefined);
});

test("buildDefs collects and rewrites a single ref", () => {
  const roots: JsonSchema[] = [
    { $ref: `${COMPONENT_REF_PREFIX}User` },
  ];
  const components: Record<string, JsonSchema> = {
    User: { type: "object", properties: { id: { type: "integer" } } },
  };

  const expectedDefs = {
    User: { type: "object", properties: { id: { type: "integer" } } },
  };

  const defs = buildDefs(roots, components);
  assert.deepEqual(defs, expectedDefs);
});

test("buildDefs follows transitive refs", () => {
  const roots: JsonSchema[] = [
    { $ref: `${COMPONENT_REF_PREFIX}User` },
  ];
  const components: Record<string, JsonSchema> = {
    User: {
      type: "object",
      properties: { profile: { $ref: `${COMPONENT_REF_PREFIX}Profile` } },
    },
    Profile: { type: "string" },
  };

  const expectedDefs = {
    User: {
      type: "object",
      properties: { profile: { $ref: "#/$defs/Profile" } },
    },
    Profile: { type: "string" },
  };

  const defs = buildDefs(roots, components);
  assert.deepEqual(defs, expectedDefs);
});

test("buildDefs handles circular refs without infinite loops", () => {
  const roots: JsonSchema[] = [
    { $ref: `${COMPONENT_REF_PREFIX}Node` },
  ];
  const components: Record<string, JsonSchema> = {
    Node: {
      type: "object",
      properties: {
        next: { $ref: `${COMPONENT_REF_PREFIX}Node` }, // circular
      },
    },
  };

  const expectedDefs = {
    Node: {
      type: "object",
      properties: {
        next: { $ref: "#/$defs/Node" },
      },
    },
  };

  const defs = buildDefs(roots, components);
  assert.deepEqual(defs, expectedDefs);
});

test("buildDefs misses missing components without throwing", () => {
  const roots: JsonSchema[] = [
    { $ref: `${COMPONENT_REF_PREFIX}DoesNotExist` },
  ];
  const components: Record<string, JsonSchema> = {}; // Empty

  // The code currently creates an empty defs obj and skips missing components.
  // Wait, looking at code: `if (!schema) continue;`
  // So it returns an empty object {} if seen.size > 0 but none are found.
  const defs = buildDefs(roots, components);
  assert.deepEqual(defs, {});
});

test("buildDefs uses the cache", () => {
  const roots: JsonSchema[] = [
    { $ref: `${COMPONENT_REF_PREFIX}A` },
    { $ref: `${COMPONENT_REF_PREFIX}B` },
  ];

  const cachedA = { type: "string", description: "from cache" };
  const cache = new Map<string, JsonSchema>();
  cache.set("A", cachedA);

  const components: Record<string, JsonSchema> = {
    A: { type: "string", description: "from components" }, // Should be ignored in favor of cache
    B: { type: "number", description: "from components" },
  };

  const defs = buildDefs(roots, components, cache);

  assert.equal(defs?.A, cachedA); // Object reference should be exactly the cached one
  assert.deepEqual(defs?.B, { type: "number", description: "from components" }); // newly cloned
  assert.equal(cache.get("B"), defs?.B); // added to cache
});
