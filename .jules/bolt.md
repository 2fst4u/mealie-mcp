## 2024-05-24 - URL.canParse Double-Parsing De-optimization

**Learning:** While `URL.canParse(urlStr)` is useful for safely checking if a URL is valid without the overhead of a `try/catch` throwing an error for *invalid* URLs, pairing it with `new URL(urlStr)` immediately after creates a double-evaluation penalty for *valid* URLs (the happy path). The engine parses the string once to validate, and again to instantiate the object.

**Action:** When the instantiated `URL` object is required for further processing, use a `try { new URL(urlStr) } catch { ... }` block instead of `URL.canParse()` followed by `new URL()`. Only use `URL.canParse()` for pure boolean validation where the object itself is discarded.

## 2026-03-29 - Pre-allocated Array and Early Exit in Async Directory Resolution

**Learning:** Using `dirs.map(async ...)` with `Promise.all` and `.filter(...)` allocates three intermediate arrays and creates async state-machine closures per element. For empty arrays, returning `[]` immediately avoids all allocations and microtask overhead. For non-empty arrays, pre-allocating the promise array and filtering non-undefined values with `for` loops eliminates `.map` and `.filter` allocations.

**Action:** In `resolveAllowedDirs`, check `dirs.length === 0` early and use explicit index loops over pre-allocated arrays instead of `.map()` and `.filter()`.
