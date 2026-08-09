## 2026-07-12 - Fix explicit any type in clone function
**Learning:** When iterating properties to clone a generic object, it is possible to avoid explicit `any` types and casting by initializing with `const res = {} as T;` and iterating over keys safely. TypeScript handles `for...in` gracefully without requiring `any` when modifying the cloned object if we assert the root empty object correctly.
**Action:** Replaced `const res: any = {};` and `any`-casted value indexer with `const res = {} as T;` and proper property iteration.
## 2026-07-27 - Unused Constants Exposing Exports
**Learning:** In TypeScript/ESM projects, internal constants that are only used within the defining module (like `ADMIN_EXCLUDE` used exclusively to compose `HARD_EXCLUDE`) might unnecessarily be exported, expanding the module's public surface area and triggering dead-code warnings from tools like `knip`.
**Action:** Always verify if an exported constant is imported elsewhere using a workspace-wide grep or tools like `knip`/`ts-prune`. If it's isolated to local use, remove the `export` modifier to cleanly encapsulate it.
## 2026-08-01 - Explicit return types on multi-field helper functions
**Learning:** Helpers like `processParams` in `src/tools.ts` return a five-field object that callers destructure. Relying on inference leaves the contract implicit, so an accidental rename or dropped field only surfaces at the call site rather than at the function itself.
**Action:** Annotate the return type explicitly on helpers whose result shape is part of their contract, so the compiler pins the shape where it is defined.
## 2026-08-16 - Unused Types/Interfaces Exposing Exports
**Learning:** Similarly to unused constant exports, in TypeScript projects, internal types and interfaces (like `OperationBody` in `src/tools.ts`) might unnecessarily be exported, expanding the module's public surface area and triggering dead-code warnings from tools like `knip`.
**Action:** Always verify if an exported type/interface is imported elsewhere. If it's isolated to local use, remove the `export` modifier to cleanly encapsulate it.
## 2026-08-02 - Extract tool name resolution logic
**Learning:** When dealing with duplicate name resolution loops, it is cleaner to extract the loop into a separate function that operates on the specific entry.
**Action:** Extracted the name generation and loop logic from buildTools into a resolveToolName function.
## 2024-05-18 - Avoid repeated array iterations in tool filtering\n\n**What:** Refactored `FilterCondition` to use a single object `FilterConditions` containing a `Set` for exact string matches (which provides O(1) lookups) and a string array for prefix matches.\n**Why:** During filter evaluation, `matches()` was continually iterating over every user-specified condition. Consolidating the conditions into a single Set prevents repeating the loop structure for exact matches, leading to better readability and potentially slight performance improvements for setups with large include/exclude lists.
