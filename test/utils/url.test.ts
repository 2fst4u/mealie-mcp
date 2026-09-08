import { test } from "node:test";
import assert from "node:assert/strict";
import { safeUrl } from "../../src/utils/url.js";

test("safeUrl strips query parameters and fragments", () => {
  assert.equal(safeUrl("https://example.com/path?foo=bar#baz"), "https://example.com/path");
});

test("safeUrl strips credentials", () => {
  assert.equal(safeUrl("https://user:pass@example.com/path"), "https://example.com/path");
});

test("safeUrl handles root paths", () => {
  assert.equal(safeUrl("http://localhost:3000/"), "http://localhost:3000/");
});

test("safeUrl returns <invalid url> for malformed strings", () => {
  assert.equal(safeUrl("not-a-url"), "<invalid url>");
});
