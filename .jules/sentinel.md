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
