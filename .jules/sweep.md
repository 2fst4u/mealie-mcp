## 2026-07-12 - Fix explicit any type in clone function
**Learning:** When iterating properties to clone a generic object, it is possible to avoid explicit `any` types and casting by initializing with `const res = {} as T;` and iterating over keys safely. TypeScript handles `for...in` gracefully without requiring `any` when modifying the cloned object if we assert the root empty object correctly.
**Action:** Replaced `const res: any = {};` and `any`-casted value indexer with `const res = {} as T;` and proper property iteration.
