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
## 2025-02-14 - Fix Uncaught Exception on Null JSON from OAuth Provider
**Vulnerability:** A `TypeError` uncaught exception could occur if the JSON parsed from the OAuth Token Provider response was `null` (e.g. from a raw text body of "null") or a primitive, crashing the server because the code immediately tried to access `.access_token` on the result.
**Learning:** `JSON.parse` does not always return an object. Valid JSON primitives like `"null"` parse to `null`, meaning property access will throw a fatal `TypeError`.
**Prevention:** Always check that the parsed JSON result is a truthy object (e.g. `!parsed || typeof parsed !== 'object'`) before accessing properties on it when handling external or untrusted data sources.
