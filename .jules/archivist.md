## 2024-05-24 - Documenting accepted environment variable aliases
**Learning:** Some environment variables have undocumented accepted aliases (like `MEALIE_TOKEN` for `MEALIE_API_TOKEN`) in the code that are missed in `.env.example`, causing confusion for users.
**Action:** Ensure that any aliases supported in `config.ts` are also explicitly mentioned in `.env.example`.
