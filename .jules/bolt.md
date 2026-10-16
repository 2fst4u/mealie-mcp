## 2024-05-24 - URL.canParse Double-Parsing De-optimization

**Learning:** While `URL.canParse(urlStr)` is useful for safely checking if a URL is valid without the overhead of a `try/catch` throwing an error for *invalid* URLs, pairing it with `new URL(urlStr)` immediately after creates a double-evaluation penalty for *valid* URLs (the happy path). The engine parses the string once to validate, and again to instantiate the object.

**Action:** When the instantiated `URL` object is required for further processing, use a `try { new URL(urlStr) } catch { ... }` block instead of `URL.canParse()` followed by `new URL()`. Only use `URL.canParse()` for pure boolean validation where the object itself is discarded.
