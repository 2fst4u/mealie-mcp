import { test } from "node:test";
import assert from "node:assert/strict";
import { safeUrl } from "../src/utils/url.js";

test("safeUrl returns origin and pathname for valid URL", () => {
  assert.equal(safeUrl("https://example.com/api/v1/test"), "https://example.com/api/v1/test");
});

test("safeUrl strips query parameters and hashes", () => {
  assert.equal(safeUrl("https://example.com/api/v1/test?q=hello&foo=bar"), "https://example.com/api/v1/test");
  assert.equal(safeUrl("https://example.com/api/v1/test#hash123"), "https://example.com/api/v1/test");
  assert.equal(safeUrl("https://example.com/api/v1/test?q=hello#hash123"), "https://example.com/api/v1/test");
});

test("safeUrl removes credentials (username/password)", () => {
  assert.equal(safeUrl("https://user:pass@example.com/api/v1/test"), "https://example.com/api/v1/test");
  assert.equal(safeUrl("https://user@example.com/api/v1/test"), "https://example.com/api/v1/test");
});

test("safeUrl preserves port numbers", () => {
  assert.equal(safeUrl("http://localhost:8080/api/v1/test"), "http://localhost:8080/api/v1/test");
  assert.equal(safeUrl("https://example.com:8443/api/v1/test"), "https://example.com:8443/api/v1/test");
});

test("safeUrl returns fallback for invalid URL strings", () => {
  assert.equal(safeUrl("not-a-valid-url"), "<invalid url>");
  assert.equal(safeUrl(""), "<invalid url>");
  // Malformed URL that would throw in `new URL()`
  assert.equal(safeUrl("http://:80"), "<invalid url>");
});
