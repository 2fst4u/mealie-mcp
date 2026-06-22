# mealie-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for
[Mealie](https://github.com/mealie-recipes/mealie), the self-hosted recipe
manager, meal planner and shopping-list app.

It exposes **every endpoint of the Mealie REST API** as an MCP tool, so an LLM
(Claude, etc.) can read and manage your recipes, meal plans, shopping lists,
cookbooks, households, users and more.

- 🧩 **Complete API coverage** — one tool per Mealie endpoint (~259 tools).
- 🔄 **Auto-adapts to your Mealie version** — on startup it fetches the OpenAPI
  schema from *your* instance, so the tools always match exactly what your
  server supports. A bundled snapshot is used as a fallback if the fetch fails.
- 🚀 **Zero install** — runs straight from `npx`, ideal for MCPHub, Claude
  Desktop, Cursor, and any other MCP client.
- 🔒 **Safe by default options** — read-only mode and per-category include/exclude
  filtering for clients that prefer fewer tools.

---

## Quick start

You need two things:

1. The base URL of your Mealie instance, e.g. `https://mealie.example.com`
2. A Mealie **API token** (see [Getting an API token](#getting-an-api-token))

Run it with `npx`:

```bash
MEALIE_BASE_URL="https://mealie.example.com" \
MEALIE_API_TOKEN="your-long-lived-token" \
npx -y mealie-mcp
```

The server speaks MCP over **stdio**, so you normally won't run it by hand —
your MCP client launches it for you using the config below.

---

## Client configuration

### MCPHub / Claude Desktop / Cursor (generic MCP config)

Add an entry to your client's MCP servers config (for Claude Desktop this is
`claude_desktop_config.json`; MCPHub uses an equivalent `mcpServers` block):

```json
{
  "mcpServers": {
    "mealie": {
      "command": "npx",
      "args": ["-y", "mealie-mcp"],
      "env": {
        "MEALIE_BASE_URL": "https://mealie.example.com",
        "MEALIE_API_TOKEN": "your-long-lived-token"
      }
    }
  }
}
```

That's the only required configuration. Everything else is optional tuning.

---

## Getting an API token

In Mealie:

1. Click your user avatar → **Manage Your Profile**.
2. Open the **API Tokens** section (`/user/profile/api-tokens`).
3. Create a token, give it a name, and copy it.

The token inherits the permissions of the user that created it, so create it
under a user/household with the access you want the LLM to have. To give the
model read-only-ish safety, also see [`MEALIE_READ_ONLY`](#configuration).

---

## Configuration

All configuration is via environment variables.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MEALIE_BASE_URL` | ✅ | — | Base URL of your Mealie instance, e.g. `https://mealie.example.com`. |
| `MEALIE_API_TOKEN` | – | — | Long-lived Mealie API token (sent as `Authorization: Bearer`). Most endpoints need it. `MEALIE_TOKEN` is accepted as an alias. |
| `MEALIE_READ_ONLY` | – | `false` | When `true`, only expose `GET` endpoints. Great for a safe, read-only assistant. |
| `MEALIE_TOOLS` | – | — | Comma-separated **allow-list** of tool names or category prefixes to expose (e.g. `recipe,households_shopping_lists`). Empty = all. |
| `MEALIE_EXCLUDE_TOOLS` | – | — | Comma-separated **deny-list** of tool names or category prefixes to hide (e.g. `admin,groups_seeders`). |
| `MEALIE_USE_BUNDLED_SPEC` | – | `false` | Skip the live OpenAPI fetch and use the snapshot bundled with the package. |
| `MEALIE_OPENAPI_URL` | – | `${MEALIE_BASE_URL}/openapi.json` | Override where the OpenAPI schema is fetched from. |
| `MEALIE_TIMEOUT` | – | `60000` | Per-request timeout in milliseconds. |
| `MEALIE_ACCEPT_LANGUAGE` | – | — | Optional `Accept-Language` header forwarded to Mealie (affects e.g. ingredient parsing locale). |

### Reducing the number of tools

Mealie has ~259 endpoints. Some MCP clients work better with fewer tools.
Use `MEALIE_TOOLS` / `MEALIE_EXCLUDE_TOOLS` with **category prefixes** (the part
before the verb in a tool name) to narrow things down. Examples:

```bash
# Only recipes, meal plans and shopping lists:
MEALIE_TOOLS="recipe,households_mealplans,households_shopping"

# Everything except admin + group seeders:
MEALIE_EXCLUDE_TOOLS="admin,groups_seeders,groups_migrations"

# Read-only recipe browsing assistant:
MEALIE_READ_ONLY=true
MEALIE_TOOLS="recipe,explore"
```

---

## How tools are named

Each tool name is derived from the Mealie OpenAPI tag (category) and operation.
Uniquely-named operations use their bare operation name (e.g. `suggest_recipes`);
operations whose name is reused across resources (the CRUD verbs `get_all`,
`get_one`, `create_one`, `update_one`, `delete_one`, …) are prefixed with their
category to stay unique and to keep them grouped. All names are kept well under
the 64-character tool-name limit. For example:

| Tool | Method & path |
| --- | --- |
| `recipe_crud_get_all` | `GET /api/recipes` |
| `recipe_crud_get_one` | `GET /api/recipes/{slug}` |
| `recipe_crud_create_one` | `POST /api/recipes` |
| `households_shopping_lists_get_all` | `GET /api/households/shopping/lists` |
| `households_mealplans_create_one` | `POST /api/households/mealplans` |
| `app_about_get_app_info` | `GET /api/app/about` |

Each tool's input schema declares its path parameters, query parameters and
(where relevant) a `body` object — all generated directly from Mealie's OpenAPI
schema, so the model gets accurate, fully-typed arguments.

### File uploads

Endpoints that upload files (recipe images, ZIP imports, backups, assets, …)
take their file fields as **absolute paths to local files**, which the server
reads and sends as multipart form data. The tool description tells the model
which fields are file paths.

### Categories

<details>
<summary>All 57 categories</summary>

| Category | Tools |
| --- | --- |
| `admin_about` | 3 |
| `admin_ai_providers` | 4 |
| `admin_backups` | 6 |
| `admin_debug` | 1 |
| `admin_email` | 2 |
| `admin_maintenance` | 5 |
| `admin_manage_groups` | 5 |
| `admin_manage_households` | 5 |
| `admin_manage_users` | 7 |
| `app_about` | 3 |
| `explore_categories` | 2 |
| `explore_cookbooks` | 2 |
| `explore_foods` | 2 |
| `explore_households` | 2 |
| `explore_recipes` | 3 |
| `explore_tags` | 2 |
| `explore_tools` | 2 |
| `groups_ai_provider_settings` | 2 |
| `groups_ai_providers` | 4 |
| `groups_households` | 2 |
| `groups_migrations` | 1 |
| `groups_multi_purpose_labels` | 5 |
| `groups_reports` | 3 |
| `groups_seeders` | 3 |
| `groups_self_service` | 6 |
| `households_cookbooks` | 6 |
| `households_event_notifications` | 6 |
| `households_invitations` | 3 |
| `households_mealplan_rules` | 5 |
| `households_mealplans` | 7 |
| `households_recipe_actions` | 6 |
| `households_self_service` | 7 |
| `households_shopping_list_items` | 8 |
| `households_shopping_lists` | 9 |
| `households_webhooks` | 7 |
| `organizer_categories` | 7 |
| `organizer_tags` | 7 |
| `organizer_tools` | 6 |
| `recipe_bulk_actions` | 8 |
| `recipe_comments` | 6 |
| `recipe_crud` | 23 |
| `recipe_exports` | 2 |
| `recipe_images_and_assets` | 5 |
| `recipe_ingredient_parser` | 2 |
| `recipe_shared` | 2 |
| `recipe_timeline` | 6 |
| `recipes_foods` | 6 |
| `recipes_units` | 6 |
| `shared_recipes` | 4 |
| `users_authentication` | 5 |
| `users_crud` | 6 |
| `users_images` | 1 |
| `users_passwords` | 2 |
| `users_ratings` | 5 |
| `users_registration` | 1 |
| `users_tokens` | 2 |
| `utils` | 1 |

</details>

---

## Development

```bash
git clone https://github.com/2fst4u/mealie-mcp.git
cd mealie-mcp
npm install

npm run build       # compile TypeScript to dist/
npm test            # run the test suite (node:test)
npm run typecheck   # type-check without emitting

# Run from source against a Mealie instance:
MEALIE_BASE_URL="https://demo.mealie.io" npm run dev
```

### Updating the bundled OpenAPI snapshot

The server prefers the live schema from your own instance, but the bundled
snapshot (used as a fallback) can be refreshed from any Mealie instance:

```bash
npm run refresh-spec -- https://demo.mealie.io
```

### Project layout

| Path | Purpose |
| --- | --- |
| `src/index.ts` | Entry point: load config + spec, start stdio server. |
| `src/config.ts` | Environment-variable configuration. |
| `src/openapi-loader.ts` | Fetch live OpenAPI schema with bundled fallback. |
| `src/tools.ts` | Generate one MCP tool per OpenAPI operation. |
| `src/schema.ts` | Build self-contained JSON Schemas (`$ref` → `$defs`). |
| `src/http-client.ts` | Execute requests (JSON / urlencoded / multipart / binary). |
| `src/server.ts` | MCP server wiring (`tools/list`, `tools/call`). |
| `openapi.snapshot.json` | Bundled fallback OpenAPI schema. |

---

## Releases & publishing

This repo ships two GitHub Actions workflows:

- **CI** (`.github/workflows/ci.yml`) — runs type-check, build and tests on every
  pull request (and on non-`main` branch pushes) across Node 18/20/22.
- **Release** (`.github/workflows/release.yml`) — on every push/merge to `main`,
  builds and tests, then creates a GitHub Release `v<version>` (with auto-generated
  notes) and publishes to npm **if that version hasn't been released yet**. To cut
  a release, bump `version` in `package.json` in your PR; merging it ships the release.

### Publishing to npm (Trusted Publishing / OIDC)

The release workflow publishes via npm **Trusted Publishing**, so there is **no
`NPM_TOKEN` secret to store** — GitHub Actions authenticates to npm with a
short-lived OIDC token, and npm generates build provenance automatically.

npm requires a package to exist before you can attach a Trusted Publisher, so
there is a **one-time bootstrap** for the first ever publish:

1. **Publish the first version manually** from your machine (this also claims the
   package name):
   ```bash
   npm install            # ensure deps
   npm login              # your normal npm account + 2FA
   npm publish --access public
   ```
2. **Configure the Trusted Publisher** on npmjs.com: open the package page →
   **Settings** → **Trusted Publisher** → **GitHub Actions**, and enter:
   - **Organization or user:** `2fst4u`
   - **Repository:** `mealie-mcp`
   - **Workflow filename:** `release.yml`
   - **Environment:** *(leave blank)*
3. From then on, **every merge to `main` with a bumped version publishes
   automatically** over OIDC — no tokens, no manual steps.

> Requirements (handled by the workflow): `id-token: write` permission, Node
> ≥ 22.14, and npm ≥ 11.5.1. The publish step safely skips if the version is
> already on npm, so re-runs and the bootstrap version won't cause failures.

---

## License

[MIT](./LICENSE)

This project is an independent client for Mealie and is not affiliated with the
Mealie project.
