## 2026-07-12 - Fix explicit any type in clone function
**Learning:** When iterating properties to clone a generic object, it is possible to avoid explicit `any` types and casting by initializing with `const res = {} as T;` and iterating over keys safely. TypeScript handles `for...in` gracefully without requiring `any` when modifying the cloned object if we assert the root empty object correctly.
**Action:** Replaced `const res: any = {};` and `any`-casted value indexer with `const res = {} as T;` and proper property iteration.
## 2026-07-27 - Unused Constants Exposing Exports
**Learning:** In TypeScript/ESM projects, internal constants that are only used within the defining module (like `ADMIN_EXCLUDE` used exclusively to compose `HARD_EXCLUDE`) might unnecessarily be exported, expanding the module's public surface area and triggering dead-code warnings from tools like `knip`.
**Action:** Always verify if an exported constant is imported elsewhere using a workspace-wide grep or tools like `knip`/`ts-prune`. If it's isolated to local use, remove the `export` modifier to cleanly encapsulate it.
