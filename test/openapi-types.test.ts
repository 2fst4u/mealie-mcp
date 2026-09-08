import { test } from "node:test";
import assert from "node:assert/strict";
import { HTTP_METHODS } from "../src/openapi-types.js";

test("HTTP_METHODS should contain exactly the expected HTTP methods", () => {
  assert.deepEqual(HTTP_METHODS, ["get", "post", "put", "patch", "delete"]);
});
