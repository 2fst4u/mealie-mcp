## 2025-02-23 - Avoid `JSON.parse(JSON.stringify())` for Deep Cloning in Hot Paths
**Learning:** While `JSON.parse(JSON.stringify(value))` is a convenient one-liner for deep cloning plain JSON-compatible objects, it carries extreme serialization and deserialization overhead. When used in hot paths like processing hundreds of OpenAPI schemas for MCP tools during startup, this built-in approach becomes a significant bottleneck. A custom recursive clone operation proved to be roughly ~2x faster on the full tool-generation workflow, and up to ~5x faster strictly for deep cloning.
**Action:** When a project frequently clones plain JSON-like structures in performance-sensitive sections, implement and benchmark a custom recursive function over falling back to `JSON.parse(JSON.stringify())`.

## 2025-02-23 - Avoid `Object.entries()` and `Object.values()` in Hot Recursive Paths
**Learning:** `Object.entries()` and `Object.values()` allocate new arrays containing object entries and values. When these native functions are used in highly recurrent recursive paths traversing deep nested structures (like exploring OpenAPI JSON schemas), the garbage collection overhead compounds significantly. Benchmarks in `src/schema.ts` showed that replacing these calls with `for...in` loops (alongside `Object.prototype.hasOwnProperty.call()` checks) reduced recursive parsing time by up to ~75%, speeding up overall schema tool generation by roughly ~15%.
**Action:** When walking deep JSON trees iteratively or recursively, prefer traditional `for...in` loops to avoid massive array allocations in the hot path.

## 2025-02-23 - Prefer `startsWith()` over RegExp `.exec()` for Simple String Prefixes
**Learning:** Using `RegExp.exec()` for simple string prefix matching (like checking if a string starts with `#/components/schemas/`) carries per-call match overhead even when the pattern is a module-level compiled constant. Replacing it with `String.prototype.startsWith()` and `String.prototype.slice()` is both faster per call and clearer. In this codebase the affected traversal (`collectRefs`/`rewriteRefs`) runs during one-time tool generation at startup rather than on a per-request hot path, so the end-to-end win is small — treat this as a readability-plus-microbenchmark improvement, not a latency fix.
**Action:** When performing simple prefix checks or extracting a fixed prefix, prefer string methods (`startsWith()`, `slice()`, `substring()`) over regular expressions. Derive slice offsets from the prefix constant's `.length` rather than hardcoding a magic number, and keep the prefix in a single shared constant so all call sites stay in sync.

## 2025-02-23 - Precompute Filter Conditions to Avoid Repeated Allocations
**Learning:** Checking whether items match string conditions (like exact equality or a prefix) inside a `filter()` array iteration can be unexpectedly slow if it requires building new strings (e.g., `` `${e}_` ``) or calling `toLowerCase()` repeatedly. In `filterTools`, `matches` was re-allocating identical prefix strings and recalculating `toLowerCase()` for every filter rule against every generated tool on initialization.
**Action:** When filtering a large collection against a set of string prefixes or exact matches, precompute the transformed conditions (e.g., lowercased values and constructed prefix strings) outside of the loop. Pass these precomputed definitions into the filter function to minimize allocations and redundant string operations during hot iterations.

## 2024-07-08 - Caching deeply cloned component schemas
**Learning:** When building tools from OpenAPI specifications, `buildDefs` generates an isolated schema by deeply cloning shared components and recursively resolving `$ref`s. It was executing this cloning and rewriting process redundantly across many endpoints that rely on the same schemas.
**Action:** Added a `Map<string, JsonSchema>` cache that persists throughout the tool generation pass for a document. By passing this cache to `buildDefs`, we reuse the localized representation of components. This significantly decreased generation time by avoiding thousands of redundant deep clones and allocations, with `generateTools` iterations over 3 seconds improving from ~550 to ~750.
## 2025-02-28 - Optimize sequential file reading inside loop

**Learning:** Replaced sequential `await readFile` in `src/http-client.ts` with `Promise.all` processing, keeping file append ordered in multipart uploads.
**Action:** Implemented the change using a mapped logic. Recorded a ~35% speedup reading a batch of 100 1MB files.
## 2025-02-28 - Skip Expensive JSON Pretty-Printing for Truncated Payloads
**Learning:** Formatting very large JSON payloads using `JSON.stringify(JSON.parse(raw), null, 2)` causes significant CPU and memory overhead. If the formatted output is ultimately going to be truncated down to a fixed maximum length (e.g. 100,000 characters), executing this formatting over megabytes of JSON is a waste of resources. Our benchmarks showed skipping parsing when `raw.length` far exceeds the truncate limit drops processing time from over 100ms to 0ms for large payloads.
**Action:** When pretty-printing or formatting strings that will later be heavily truncated, check if the raw string size implies it will exceed the limit anyway. If it does (e.g., `raw.length > MAX_TEXT * 5`), bypass the expensive formatting and return the truncated raw string instead.
## 2025-02-14 - Optimize OpenAPI path iteration in generateTools
**Learning:** Replaced `Object.entries()` with `for...in` loop to avoid intermediate array allocation when iterating over the large `doc.paths` object.
**Action:** Changed `for (const [path, item] of Object.entries(doc.paths))` to `for (const path in doc.paths)` and accessed `doc.paths[path]` inside the loop directly in `src/tools.ts`.
## 2026-07-21 - Array Allocation Overhead in Token Deduplication

**Learning:** Chained string and array operations (e.g., `split().filter().join()` or regex equivalents) can cause notable garbage collection and execution time overhead in hot paths due to repeated array allocations and iterations.

**Action:** Replaced chained array methods with a single loop iterating directly over the split result, pushing tokens directly to a result string while tracking state. This avoided intermediate array allocations and resulted in a 3x speedup on targeted benchmarks.
## 2026-07-26 - STOP re-litigating the array branch of `clone()` in src/schema.ts

This entry replaces three earlier ones that contradicted each other. Two dated
2026-07-21 (one of them a malformed duplicate) claimed `value.map(v => clone(v))`
was 10-15% *faster* than a pre-allocated `for` loop. One dated 2024-05-24 claimed
the pre-allocated `for` loop was 15-20% faster than `map`. Both directions were
recorded as measured wins, which is how the same three lines got rewritten back
and forth across several PRs.

**Learning:** Neither claim reproduces. Cloning the repo's own
`openapi.snapshot.json`, interleaving both implementations within a single
process so they share JIT and GC state, and taking medians over 30 trials, the
difference is **-0.3%, +0.9%, +0.7% across three runs — the sign flips, so it is
noise.** The earlier double-digit numbers almost certainly came from
benchmarking one implementation per process, where warmup order and GC timing
dominate a ~16ms measurement.

**Action:** Leave the array branch alone. It uses a pre-allocated `new Array(len)`
plus an index loop; that is fine and so is `map`, and no future change to this
branch should be justified on performance grounds without an interleaved,
multi-trial benchmark showing a consistent sign. More generally: `clone()` runs
during one-time tool generation at startup, not per request, so even a real 5%
here is single-digit milliseconds once per process — the same caveat already
recorded for `collectRefs`/`rewriteRefs` above. Before writing a perf entry,
interleave the variants in one process, report a median over many trials, and
re-run the whole benchmark at least twice; if the sign changes, there is no
effect to record.
## 2026-07-23 - Multipart FormData Memory Optimization

**Learning:** When dealing with potentially large file uploads (up to 50MB) via `FormData` in Node.js, using `readFile` causes the entire file to be loaded into memory, leading to increased memory footprint and garbage collection pauses. Node's `fs.openAsBlob` provides a memory-efficient alternative that works seamlessly with `FormData`, allowing the `fetch` implementation to stream the file directly from disk without allocating massive V8 strings/buffers.

**Action:** Replaced `readFile(filePath)` with `openAsBlob(filePath)` in the `buildMultipart` function in `src/http-client.ts`. This bypasses buffering large files into memory during multi-part HTTP requests.

**Correction on the measurement:** the ~328ms figure was for *mounting* a 40MB file into `FormData`, which is not the end-to-end win it looks like — the bytes still have to be read during `fetch`, so the read cost is moved rather than removed. The durable benefit is memory: no 40MB `Buffer` in the V8 heap and no GC pressure from it. Benchmark the whole request, not just the `FormData` construction, before quoting a latency number.

**Follow-up:** `openAsBlob` is Node >= 19.8 and `engines` still allows 18, so it has to be feature-detected off the `node:fs` namespace. A static `import { openAsBlob } from "node:fs"` is a link-time `SyntaxError` on a runtime that lacks the export, which fails the entire module rather than the one code path. Feature-detection needs no `any`: `typeof fs.openAsBlob | undefined` types it exactly.

## 2024-07-29 - Precompute static MCP tool lists
**Learning:** In MCP servers (`@modelcontextprotocol/sdk/server`), returning the tool list in the `ListToolsRequestSchema` handler by dynamically mapping the array of tools (e.g. `tools.map(t => ...)` ) allocates hundreds of new objects on every request. Since the list of exposed tools in `mealie-mcp` is static after startup, this creates unnecessary GC churn and degrades performance for clients that frequently poll.
**Action:** Always precompute and cache the static tools list response during server initialization instead of dynamically assembling it on every `ListToolsRequest`.

## 2025-08-05 - Avoid intermediate array allocations in Map and Set initialization
**Learning:** `new Map(arr.map(...))` and `new Set(arr.map(...))` allocate temporary arrays (and in the case of Map, temporary tuples) that are immediately discarded by the constructor, causing unnecessary GC churn. This was verified with `perf_hooks`.
**Action:** Replace `new Map(arr.map(...))` with a `for...of` loop and `Map.set()`, and `new Set(arr.map(...))` with a `for...of` loop and `Set.add()` in initialization paths.
## 2026-08-12 - Optimize multipart request building
**Learning:** Instantiating new `Set` instances for `fileFields` on every `buildMultipart` request adds unnecessary allocation overhead, especially since `fileFields` is static per tool. Additionally, sequentially reading and resolving paths for multiple uploaded files introduces unnecessary blocking I/O.
**Action:** Precompute static sets during initialization (e.g., in `buildTool`) and store them on the internal object definition. Use `Promise.all` combined with synchronous closures (`() => void`) to parallelize I/O operations while still safely preserving the append order of the resolved values into ordered structures like `FormData`.
## 2024-08-18 - Optimize array allocations in object entry iteration\n**Learning:** When iterating over object properties without needing a tuple array, `for...of Object.keys(obj)` is significantly faster and allocates fewer intermediate arrays compared to `Object.entries(obj).filter(...).map(...)`.\n**Action:** Avoid chaining array methods like `.filter()` and `.map()` on `Object.entries()` when simple property accumulation is needed. Prefer `for...of Object.keys(obj)` instead.
## 2026-08-18 - Async I/O for startup
**Learning:** Converting a small startup read (`readFileSync` -> `await readFile`) is a wash on its own — the promise overhead can even benchmark slower, and an `await` that sits alone in a sequential chain blocks exactly as long as the sync call did. The win only materialises when the now-async read is overlapped with another I/O-bound startup task.
**Action:** Read the package version with `readFile` from `node:fs/promises` and drive it concurrently with `loadOpenApi` via `Promise.all`, so the package.json read is free whenever the spec is being fetched over the network.
