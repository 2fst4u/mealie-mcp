## 2024-05-24 - URL.canParse Double-Parsing De-optimization

**Learning:** While `URL.canParse(urlStr)` is useful for safely checking if a URL is valid without the overhead of a `try/catch` throwing an error for *invalid* URLs, pairing it with `new URL(urlStr)` immediately after creates a double-evaluation penalty for *valid* URLs (the happy path). The engine parses the string once to validate, and again to instantiate the object.

**Action:** When the instantiated `URL` object is required for further processing, use a `try { new URL(urlStr) } catch { ... }` block instead of `URL.canParse()` followed by `new URL()`. Only use `URL.canParse()` for pure boolean validation where the object itself is discarded.

## 2024-05-25 - String Concatenation vs Array Join Performance

**Learning:** When building short strings composed of a known, small number of segments, using inline string concatenation (`+`) is significantly faster (up to ~12x in microbenchmarks) in Node.js/V8 compared to constructing an array and calling `.join()`. The array allocation and method call overhead dominates in these hot paths.

**Action:** Prefer string concatenation (`a + b + c`) over array joining (`[a, b, c].join()`) when dynamically constructing small, fixed-structure strings, especially in frequently called functions like description or key generators.
