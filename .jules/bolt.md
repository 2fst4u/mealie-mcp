## 2024-05-24 - URL.canParse Double-Parsing De-optimization

**Learning:** While `URL.canParse(urlStr)` is useful for safely checking if a URL is valid without the overhead of a `try/catch` throwing an error for *invalid* URLs, pairing it with `new URL(urlStr)` immediately after creates a double-evaluation penalty for *valid* URLs (the happy path). The engine parses the string once to validate, and again to instantiate the object.

**Action:** When the instantiated `URL` object is required for further processing, use a `try { new URL(urlStr) } catch { ... }` block instead of `URL.canParse()` followed by `new URL()`. Only use `URL.canParse()` for pure boolean validation where the object itself is discarded.

## 2025-05-24 - Avoiding intermediate array allocations in Set initialization

**Learning:** Constructing a Set using `new Set(array.map(x => x.prop))` creates an intermediate array in memory that must be allocated and garbage collected. Populating the Set directly using a `for...of` loop avoids the intermediate array allocation and improves execution speed by ~26.6% over 1,000,000 iterations for 250+ items.

**Action:** Use a direct `for...of` loop when populating a `Set` from object properties instead of `new Set(items.map(i => i.prop))`.
