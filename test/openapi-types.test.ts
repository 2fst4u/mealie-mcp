import { test } from "node:test";
import assert from "node:assert/strict";
import { HTTP_METHODS, HttpMethod, OpenApiDocument } from "../src/openapi-types.js";

test("HTTP_METHODS contains expected HTTP methods", () => {
  assert.deepEqual(HTTP_METHODS, ["get", "post", "put", "patch", "delete"]);
});

test("Types can be imported and used", () => {
  const method: HttpMethod = "get";
  assert.equal(method, "get");

  const doc: OpenApiDocument = {
    openapi: "3.1.0",
    info: { title: "Test", version: "1.0.0" },
    paths: {}
  };
  assert.equal(doc.openapi, "3.1.0");
});
