## 2024-05-24 - Documenting accepted environment variable aliases
**Learning:** Some environment variables have undocumented accepted aliases (like `MEALIE_TOKEN` for `MEALIE_API_TOKEN`) in the code that are missed in `.env.example`, causing confusion for users.
**Action:** Ensure that any aliases supported in `config.ts` are also explicitly mentioned in `.env.example`.
## 2026-09-03 - Documenting category slug examples
**Learning:** The `README.md` example for `MEALIE_TOOLS` filtering used `households_shopping`, which is an incomplete prefix and not a valid category slug. This ambiguity could cause confusion since the actual categories are `households_shopping_lists` and `households_shopping_list_items`.
**Action:** Ensure any examples showing category slugs use exact, valid categories (e.g. `households_shopping_lists`) that match the OpenAPI snapshot.
