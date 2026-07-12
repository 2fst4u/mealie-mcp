import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildDefs, localize } from "../src/schema.js";

describe("localize", () => {
  test("returns undefined when schema is undefined", () => {
    assert.equal(localize(undefined), undefined);
  });

  test("deep clones the schema and rewrites #/components/schemas/ refs", () => {
    const input = {
      type: "object",
      properties: {
        user: {
          $ref: "#/components/schemas/User",
        },
      },
    };

    const expected = {
      type: "object",
      properties: {
        user: {
          $ref: "#/$defs/User",
        },
      },
    };

    const result = localize(input);
    assert.deepEqual(result, expected);
    assert.notEqual(result, input); // Ensure it's a clone
    assert.notEqual((result as any).properties, input.properties);
    assert.notEqual((result as any).properties.user, input.properties.user);
  });

  test("handles arrays and nested objects", () => {
    const input = {
      type: "array",
      items: [
        { $ref: "#/components/schemas/Item1" },
        {
          type: "object",
          properties: {
            subItem: { $ref: "#/components/schemas/Item2" }
          }
        }
      ]
    };

    const expected = {
      type: "array",
      items: [
        { $ref: "#/$defs/Item1" },
        {
          type: "object",
          properties: {
            subItem: { $ref: "#/$defs/Item2" }
          }
        }
      ]
    };

    const result = localize(input);
    assert.deepEqual(result, expected);
  });

  test("leaves non-component refs unchanged", () => {
    const input = {
      $ref: "https://example.com/schema.json",
      otherRef: {
        $ref: "#/other/path/Item",
      }
    };

    const result = localize(input);
    assert.deepEqual(result, input);
  });
});

describe("buildDefs", () => {
  test("returns undefined when no roots are provided", () => {
    assert.equal(buildDefs([], {}), undefined);
  });

  test("returns undefined when no references are found", () => {
    const root = { type: "string" };
    assert.equal(buildDefs([root], {}), undefined);
  });

  test("finds and rewrites transitive references", () => {
    const roots = [
      {
        type: "object",
        properties: {
          user: { $ref: "#/components/schemas/User" },
        },
      }
    ];

    const components = {
      User: {
        type: "object",
        properties: {
          address: { $ref: "#/components/schemas/Address" },
        },
      },
      Address: {
        type: "object",
        properties: {
          city: { type: "string" },
        },
      },
      Unrelated: {
        type: "string",
      }
    };

    const expectedDefs = {
      User: {
        type: "object",
        properties: {
          address: { $ref: "#/$defs/Address" },
        },
      },
      Address: {
        type: "object",
        properties: {
          city: { type: "string" },
        },
      },
    };

    const defs = buildDefs(roots, components);
    assert.deepEqual(defs, expectedDefs);
  });

  test("caches localized schemas and uses the cache", () => {
    const roots = [
      { $ref: "#/components/schemas/SharedItem" }
    ];

    const components = {
      SharedItem: { type: "string" }
    };

    const cache = new Map();

    const defs1 = buildDefs(roots, components, cache);
    assert.deepEqual(defs1, { SharedItem: { type: "string" } });
    assert.equal(cache.size, 1);
    assert.ok(cache.has("SharedItem"));

    // Modify component to verify cache is being used, not re-evaluating component
    components.SharedItem = { type: "number" };

    const defs2 = buildDefs(roots, components, cache);
    // Should still be string because it uses the cache
    assert.deepEqual(defs2, { SharedItem: { type: "string" } });

    // Result objects from cache should be exactly the same reference in defs
    assert.equal(defs1?.SharedItem, defs2?.SharedItem);
  });
});
