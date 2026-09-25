## 2024-05-24 - Documenting accepted environment variable aliases
**Learning:** Some environment variables have undocumented accepted aliases (like `MEALIE_TOKEN` for `MEALIE_API_TOKEN`) in the code that are missed in `.env.example`, causing confusion for users.
**Action:** Ensure that any aliases supported in `config.ts` are also explicitly mentioned in `.env.example`.
## 2026-09-03 - Documenting category slug examples
**Learning:** The `README.md` example for `MEALIE_TOOLS` filtering used `households_shopping`, which is an incomplete prefix and not a valid category slug. This ambiguity could cause confusion since the actual categories are `households_shopping_lists` and `households_shopping_list_items`.
**Action:** Ensure any examples showing category slugs use exact, valid categories (e.g. `households_shopping_lists`) that match the OpenAPI snapshot.
## 2026-09-25 - Category filters match by prefix
**Learning:** `MEALIE_TOOLS` / `MEALIE_EXCLUDE_TOOLS` entries match a category exactly *or* as a `_`-bounded prefix (`matches()` in `src/tools.ts`, covered by `test/tools.test.ts`). The `recipe` and `explore` examples are deliberate: they select every `recipe_*` / `explore_*` category. Rewriting them to a single exact slug silently narrows what the example exposes.
**Action:** Before "correcting" a filter example, check `matches()`; document the prefix behaviour rather than removing it from the examples.
