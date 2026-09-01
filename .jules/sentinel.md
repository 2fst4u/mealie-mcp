## 2025-02-23 - AbortController Timeout Missing Body Read
**Vulnerability:** Slow Loris DoS attack surface. The timeout for fetching data (`timeoutMs`) was implemented via `AbortController` and `setTimeout`. However, the `clearTimeout` was called in a `finally` block immediately after the `fetch` API returned a `Response` object (i.e. once the headers arrived). The actual body reading (`await readBody(res)`) occurred *after* the `finally` block, leaving it unprotected by the timeout.
**Learning:** `fetch` returning a `Response` does not mean the entire body has been downloaded. The network stream is still open and actively being read during `.text()`, `.json()`, `.arrayBuffer()`, etc. Calling `clearTimeout` too early disables the timeout for the potentially slow or malicious body transmission phase.
**Prevention:** Always ensure that body reading operations (`res.text()`, `res.json()`, `readBody(res)`, etc.) are awaited *inside* the `try` block that is guarded by the `AbortController`'s timeout, so that the timeout covers the entire request lifecycle.

## 2025-02-23 - Stack Trace Leakage in Unhandled Rejections
**Vulnerability:** Unhandled Promise Rejections expose internal stack traces. When an uncaught exception occurred in `src/index.ts`, the application would write the complete `err.stack` to standard error, potentially leaking implementation details and internal path information in the hosting environment (especially problematic for an MCP server that may send stderr to a client).
**Learning:** Standard output and standard error are direct communication channels for MCP servers. Emitting un-sanitized internal errors directly over these channels leaks internal application state.
**Prevention:** Catch all root-level exceptions and limit logging to sanitised error messages (`err.message` or `String(err)`) instead of raw stack traces.

## 2025-02-18 - Information Exposure through Error Logging

**Vulnerability:**
The `src/auth.ts` file logged the first 500 characters of the raw response text from the OAuth token endpoint when an error occurred (`!res.ok`). If the upstream identity provider returned sensitive data (like tokens, internal configurations, or PII) in its error responses, this information could be inadvertently logged or exposed to the user/client via the error message.

**Learning:**
Never include untrusted or potentially sensitive response bodies directly in error messages or logs, especially when interfacing with external authentication providers. The HTTP status code and status text are typically sufficient for diagnosing issues without risking information exposure.

**Prevention:**
Ensure error handling logic only includes safe, sanitized, or strictly controlled data. Omit raw response payloads from error messages unless the payload format is strictly known and guaranteed to be safe.

## 2025-02-23 - File Upload Denial of Service (DoS)
**Vulnerability:** Arbitrary file reading vulnerability that could lead to DoS. The application read files dynamically based on paths provided for multipart uploads. It lacked checks to determine if the provided path pointed to a regular file or a character device like `/dev/urandom`, or if the file was exceptionally large. Reading from a continuous stream device or an extremely large file into memory would exhaust system memory, crashing the service.
**Learning:** Never trust a file path provided in a request for upload without validating the file's metadata first. Naively reading any path provided to `fs.promises.readFile` can trap the process in a potentially infinite or memory-exhausting read operation.
**Prevention:** Always use `fs.promises.stat(filePath)` to verify `stats.isFile()` is true and that `stats.size` is within acceptable bounds (e.g. 50MB) before attempting to read the file contents into memory.
## 2026-07-21 - Prototype Pollution in deep clone
**Vulnerability:** Prototype pollution in deep clone function when iterating over object keys without filtering dangerous keys.
**Learning:** The `clone` function iterates over all properties (including `__proto__`, `constructor`, and `prototype`) leading to prototype pollution when deeply cloning an object parsed from user input.
**Prevention:** Add a guard to skip keys: `if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;` when deeply cloning objects via `for...in`.

## 2026-07-26 - Upload path allowlist: a lexical path check is not a boundary
**Vulnerability:** Multipart upload tools take a local path chosen by the model, so a prompt-injection payload in untrusted recipe text can ask for `~/.ssh/id_rsa` instead of a photo. `MEALIE_ALLOWED_UPLOAD_DIRS` now bounds which directories uploads may read from.

**Learning:** The obvious implementation is wrong in a way that looks right. `path.resolve()` is purely lexical — it normalizes `..` and makes the path absolute, but it does not follow symlinks, while `stat`/`readFile`/`openAsBlob` all do. So a symlink *inside* an allowed directory pointing anywhere on the box passes a `resolve()`-plus-`startsWith()` check and is then read in full. A first version of this control shipped exactly that and was demonstrably bypassed by `ln -s /etc/passwd allowed/innocent.png`. Checking one path and reading another is the bug; they must be the same path.

**Prevention:**
- Resolve with `fs.promises.realpath()`, not `path.resolve()`, and then **read from the realpath you validated** — never re-open the caller's original string, or a swap between check and read reopens the hole.
- Realpath the allowlist entries too, or a legitimately symlinked allowed directory is refused.
- Compare with a trailing `path.sep` on both sides (`(real + sep).startsWith(dir + sep)`), otherwise `/srv/uploads-evil` satisfies an allowlist of `/srv/uploads`.
- Fail closed. If the allowlist is configured but no entry resolves, refuse everything; a typo must never silently widen the boundary back to unrestricted.
- Test the bypass, not just the happy path. A test that only checks "file in allowed dir works, file in other dir fails" passes against the vulnerable implementation.

## 2024-05-24 - Secure by Default Local File Uploads
**Vulnerability:** Arbitrary local file read through MCP tools when upload directories are not configured (unrestricted by default).
**Learning:** Defaulting configurations to 'unrestricted' when empty allows for accidental exposure of local filesystem out-of-the-box, increasing risk of Local File Inclusion / Arbitrary File Read.
**Prevention:** Always 'fail closed'. By default, sensitive features like local filesystem access should be disabled (refuse all) until explicitly enabled via a strictly-configured allowlist.

## 2026-08-01 - Sanitize outbound multipart filenames
**Vulnerability:** The multipart filename sent to Mealie was `basename(filePath)` verbatim. `basename()` strips directory components, so this is not a traversal hole on its own, but it does forward whatever else the on-disk name contains — control characters, quotes, and characters that are illegal in a filename on the receiving end.
**Learning:** Path containment and filename safety are separate concerns. The allowlist and `realpath()` check decide *which file* may be read; they say nothing about whether the *name* is safe to hand to another system that may write it to disk or echo it into a header.
**Prevention:** Sanitize the name at the boundary: replace control characters and `<>:"/\|?*` with underscores, and fall back to `upload.bin` when the result is empty or only dots. Sanitize on the way out, in addition to (not instead of) validating the path on the way in.
## 2024-10-31 - Duck-typed Blob for Node 18 Streaming Uploads
**Vulnerability:** When processing file uploads, reading an entire file into memory using `fs.readFile` (e.g. allocating a 50MB buffer in the V8 heap) can lead to rapid memory exhaustion or Out-of-Memory (OOM) crashes, especially under concurrent requests.
**Learning:** Node 18 supports native `fetch` (via Undici) which can stream files via Web Streams, but it doesn't natively expose `File` or `openAsBlob`. You can duck-type a `Blob` for `FormData` to consume by providing an object with `stream()` returning `Readable.toWeb(fs.createReadStream(path))`, along with `type`, `size`, `[Symbol.toStringTag]`, `arrayBuffer()`, and `slice()`.
**Prevention:** Instead of reading files fully into memory before upload, always leverage streaming constructs (like Web Streams via `Readable.toWeb()`) for HTTP requests. Fallbacks for missing native file-streaming APIs (like `openAsBlob`) should use duck-typed stream-backed Blob representations instead of `readFile()`.
## 2024-05-18 - Prevent Host-Spoofing via Unsafe URL Concatenation
**Vulnerability:** Constructing a URL by simply concatenating a base URL string and an attacker-controlled path string (e.g., `const url = new URL(config.baseUrl + path)`) is vulnerable to host-spoofing and SSRF. If the base URL does not end in a slash, and the attacker provides a path starting with `@` (e.g., `@evil.com`), the resulting string `https://example.com@evil.com` is parsed with `evil.com` as the host.
**Learning:** The URL constructor's two-argument form (`new URL(path, base)`) is the standard, secure way to resolve relative paths against a base URL.
**Prevention:** Always use `new URL(path, base)`. To ensure the base path isn't mistakenly overridden by a leading slash in the relative path, strip leading slashes from the path (e.g., `path.replace(/^\/+/, "")`) and ensure the base URL ends with a trailing slash (e.g., `config.baseUrl + "/"`).

## 2026-08-02 - URL Sanitization in Error Messages
**Vulnerability:** Logging raw external URLs in error messages can leak sensitive information like query parameters or inline credentials.
**Learning:** Constructing a sanitized URL from `new URL(url).origin` and `pathname` ensures potentially sensitive query strings or fragments are safely stripped out.
**Prevention:** Sanitize external URLs (e.g., extracting only the origin and pathname via `new URL()`) before including them in error messages to prevent leaking sensitive query parameters or credentials.
## 2025-02-14 - Fix Uncaught Exception on Null JSON from OAuth Provider
**Vulnerability:** A `TypeError` uncaught exception could occur if the JSON parsed from the OAuth Token Provider response was `null` (e.g. from a raw text body of "null") or a primitive, crashing the server because the code immediately tried to access `.access_token` on the result.
**Learning:** `JSON.parse` does not always return an object. Valid JSON primitives like `"null"` parse to `null`, meaning property access will throw a fatal `TypeError`.
**Prevention:** Always check that the parsed JSON result is a truthy object (e.g. `!parsed || typeof parsed !== 'object'`) before accessing properties on it when handling external or untrusted data sources.
## 2025-01-20 - URL Query String Information Disclosure in Error Messages
**Vulnerability:** When a network request to an external API (like fetching an OpenAPI spec or making a tool call) failed, the original complete URL (including sensitive query parameters or basic auth) was included in the error message returned to the user or logged to stderr.
**Learning:** Exposing external URLs directly in error messages can inadvertently leak sensitive information, such as API keys passed via query parameters or basic authentication credentials included in the URL string.
**Prevention:** Always sanitize external URLs before including them in logs or error messages by parsing them via `new URL()` and extracting only the `origin` and `pathname`, explicitly excluding query parameters, hashes, and authentication info.

## 2025-02-23 - URL Query String Information Disclosure in Error Messages Fallback
**Vulnerability:** When a URL fails to parse via `new URL()` (e.g. malformed or invalid structure), the fallback mechanism in `safeUrl` returned the original un-sanitized string. If this malformed URL contained sensitive query parameters or inline credentials (e.g., `invalid-url?secret=123`), the fallback would leak them into logs or error messages.
**Learning:** Returning the raw input when sanitization fails defeats the purpose of the sanitization function, as attackers or configuration errors can result in invalid formats that still contain secrets.
**Prevention:** If URL sanitization fails to parse the string, it must fail securely by returning a generic placeholder (like `"<invalid url>"`) rather than echoing the potentially sensitive raw input back to the user or logs.
## 2025-02-14 - Fix SSRF via OpenAPI Path Injection

**Vulnerability:**
The HTTP client constructed request URLs by passing an untrusted OpenAPI path into `new URL(path, base)`. The Node.js URL constructor resolves absolute URLs (e.g. `https://evil.com/api`) and protocol-relative URLs (e.g. `//evil.com/api`) by dropping the origin from the `base` entirely. This caused Server-Side Request Forgery (SSRF) and host spoofing, allowing an attacker or an AI model to redirect HTTP requests to arbitrary domains.

**Learning:**
When safely constructing URLs by combining a base URL and a relative path using `new URL(path, base)`, ensuring the base URL ends with a trailing slash and removing leading slashes from the path is not enough to secure the constructed URL. If the input path can be an absolute or protocol-relative URL, it will silently override the base origin.

**Prevention:**
To prevent SSRF and ensure the requested endpoint remains locked to the correct base API server, always assert that the origin of the fully constructed URL strictly matches the base URL's origin:
```typescript
const url = new URL(path, base);
if (url.origin !== new URL(base).origin) {
  throw new Error("SSRF attack detected: URL origin mismatch");
}
```

## 2024-05-24 - SSRF Bypass via Protocol-Relative URLs Using Backslashes
**Vulnerability:** Node.js `new URL()` converts backslashes (`\`) to forward slashes (`/`), allowing `\\evil.com` to be parsed as the protocol-relative URL `//evil.com`.
**Learning:** Stripping only leading forward slashes (`^\/+`) from an untrusted path before resolving it against a base URL fails to prevent an attacker from supplying backslashes to construct a protocol-relative path, bypassing SSRF protection.
**Prevention:** Strip both leading forward slashes and backslashes (e.g., using `replace(/^[\\\/]+/, "")`) from untrusted paths before appending them to a base URL.
