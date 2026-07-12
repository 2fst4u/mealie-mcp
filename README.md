# mealie-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for
[Mealie](https://github.com/mealie-recipes/mealie), the self-hosted recipe
manager, meal planner and shopping-list app.

It exposes **every endpoint of the Mealie REST API** as an MCP tool, so an LLM
(Claude, etc.) can read and manage your recipes, meal plans, shopping lists,
cookbooks, households, users and more.

- 🧩 **Broad API coverage, sane baseline** — one tool per Mealie endpoint,
  trimmed to a safe baseline (~211 of ~259) so clients aren't overwhelmed and
  risky endpoints aren't reachable.
- 🔄 **Auto-adapts to your Mealie version** — on startup it fetches the OpenAPI
  schema from *your* instance, so the tools always match exactly what your
  server supports. A bundled snapshot is used as a fallback if the fetch fails.
- 🚀 **Zero install** — runs straight from `npx`, ideal for MCPHub, Claude
  Desktop, Cursor, and any other MCP client.
- 🔒 **Safe by default** — admin/server-ops endpoints are never exposed, plus
  read-only mode and per-category include/exclude filtering to narrow further.
- 🔑 **Flexible auth** — a static API token, or an OAuth2 client-credentials flow
  that fetches and refreshes access tokens for you.

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
| `MEALIE_API_TOKEN` | – | — | Long-lived Mealie API token (sent as `Authorization: Bearer`). Most endpoints need it. `MEALIE_TOKEN` is accepted as an alias. Ignored when OAuth is configured. |
| `MEALIE_OAUTH_TOKEN_URL` | – | — | IdP token endpoint. Setting this (plus client id/secret) enables the OAuth2 **client-credentials** flow, which takes precedence over `MEALIE_API_TOKEN`. See [Authenticating with OAuth](#authenticating-with-oauth-client-credentials). |
| `MEALIE_OAUTH_CLIENT_ID` | – | — | OAuth client id (required for the OAuth flow). |
| `MEALIE_OAUTH_CLIENT_SECRET` | – | — | OAuth client secret (required for the OAuth flow). |
| `MEALIE_OAUTH_SCOPE` | – | — | Optional space-delimited OAuth scopes. |
| `MEALIE_OAUTH_AUDIENCE` | – | — | Optional OAuth audience (some IdPs, e.g. Auth0, need it to mint a Mealie-targeted token). |
| `MEALIE_READ_ONLY` | – | `false` | When `true`, only expose `GET` endpoints. Great for a safe, read-only assistant. |
| `MEALIE_TOOLS` | – | — | Comma-separated **allow-list** of tool names or category slugs to expose (e.g. `recipe,households_shopping_lists`). Empty = the full safe baseline. |
| `MEALIE_EXCLUDE_TOOLS` | – | — | Comma-separated **deny-list** of tool names or category slugs to hide further (e.g. `groups_seeders,groups_migrations`). Applied on top of the always-on baseline trim. |
| `MEALIE_USE_BUNDLED_SPEC` | – | `false` | Skip the live OpenAPI fetch and use the snapshot bundled with the package. |
| `MEALIE_OPENAPI_URL` | – | `${MEALIE_BASE_URL}/openapi.json` | Override where the OpenAPI schema is fetched from. |
| `MEALIE_TOOL_NAME_MAX` | – | `50` | Max length of generated tool names (clamped to 16–64). Lower it if your MCP client prefixes tool names (e.g. `mcp__<server>__<tool>`) and the combined name exceeds the 64-char API limit. |
| `MEALIE_TIMEOUT` | – | `60000` | Per-request timeout in milliseconds. |
| `MEALIE_RETRIES` | – | `2` | Extra attempts for idempotent (`GET`) requests that hit a network error or a retryable status (`429`/`5xx`), with exponential backoff (clamped to 0–5). Non-`GET` methods are never retried automatically. Set `0` to disable. |
| `MEALIE_DEBUG` | – | `false` | When `true`, log each outgoing request (method, path, response status) to stderr. Useful for troubleshooting from your MCP client. |
| `MEALIE_ACCEPT_LANGUAGE` | – | — | Optional `Accept-Language` header forwarded to Mealie (affects e.g. ingredient parsing locale). |

> **Note:** Only path and query parameters are exposed as tool inputs. The few Mealie
> endpoints that read a custom request header or cookie are not driven through those
> parameters — `Accept-Language` is forwarded via `MEALIE_ACCEPT_LANGUAGE`, and
> authentication is handled globally.

### Authenticating with OAuth (client credentials)

By default the server authenticates with a static `MEALIE_API_TOKEN`. As an
alternative — useful for headless/machine-to-machine setups — it can obtain an
access token from your identity provider using the **OAuth2 client-credentials
grant**, then send it as the `Authorization: Bearer` credential and refresh it
automatically (proactively before expiry, and reactively on a `401`).

```bash
MEALIE_OAUTH_TOKEN_URL="https://idp.example.com/oauth/token"
MEALIE_OAUTH_CLIENT_ID="your-client-id"
MEALIE_OAUTH_CLIENT_SECRET="your-client-secret"
# Optional, IdP-dependent:
MEALIE_OAUTH_SCOPE="mealie"
MEALIE_OAUTH_AUDIENCE="https://mealie.example.com"
```

When these are set, OAuth **takes precedence** and `MEALIE_API_TOKEN` is ignored.

> **Precondition:** your Mealie must be a version that validates IdP-issued
> access tokens as bearer tokens (via the provider's JWKS). The client sends
> the credentials in the request body (`client_secret_post`). If your IdP
> requires HTTP Basic client auth instead, open an issue.

### The safe baseline (≈211 of 259 endpoints)

Mealie exposes ~259 endpoints, but the server ships a **safe baseline of ~211**
so clients aren't overwhelmed and risky endpoints aren't reachable at all. Two
groups are **permanently excluded** — they can't be re-enabled by configuration:

- **Admin / server-ops** endpoints (backups, maintenance, multi-tenant
  user/group/household management, debug, email config, AI providers). These are
  powerful, rarely what a recipe assistant needs, and a security footgun, so the
  server never exposes them. Manage your instance through Mealie's own UI/API.
- Endpoints with little value to an LLM: password-reset and registration flows,
  the docker healthcheck route, the SSE *stream* duplicates of plain-JSON
  recipe-import endpoints, and zip/file download routes that return opaque bytes.
  (The `Users: Authentication` category is kept, since the server can
  authenticate via OAuth.)

You can **narrow further** from this baseline — but not widen past it — with
`MEALIE_TOOLS` / `MEALIE_EXCLUDE_TOOLS` using **category slugs** (or exact tool
names). Examples:

```bash
# Only recipes, meal plans and shopping lists:
MEALIE_TOOLS="recipe,households_mealplans,households_shopping"

# Baseline, but also drop group seeders + migrations:
MEALIE_EXCLUDE_TOOLS="groups_seeders,groups_migrations"

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

### Troubleshooting: "name: String should have at most 64 characters"

Some MCP clients/hubs (e.g. MCPHub, remote connectors) prefix every tool name
with the server name — `mcp__<server>__<tool>` — and the **combined** string
must stay within the API's 64-character limit. If you hit this error:

1. Keep the server's name/alias short (`mealie` is ideal).
2. Lower the tool-name cap, e.g. `MEALIE_TOOL_NAME_MAX=30`, until it fits.
3. The error is global — Claude rejects the *whole* tool list if **any** tool
   (from **any** server) is too long, so the culprit may be a different server.

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
| `src/auth.ts` | Resolve the `Authorization` header (static token or OAuth client credentials). |
| `src/openapi-loader.ts` | Fetch live OpenAPI schema with bundled fallback. |
| `src/tools.ts` | Generate one MCP tool per OpenAPI operation; built-in trimming. |
| `src/schema.ts` | Build self-contained JSON Schemas (`$ref` → `$defs`). |
| `src/http-client.ts` | Execute requests (JSON / urlencoded / multipart / binary). |
| `src/server.ts` | MCP server wiring (`tools/list`, `tools/call`). |
| `openapi.snapshot.json` | Bundled fallback OpenAPI schema. |

---

## Releases & publishing

This repo ships two GitHub Actions workflows:

- **CI** (`.github/workflows/ci.yml`) — runs type-check, build and tests on every
  pull request (and on non-`main` branch pushes) across Node 18/20/22.
- **Release** (`.github/workflows/release.yml`) — on every push/merge to `main` that touches source files,
  builds and tests, auto-bumps the patch version, creates a GitHub Release `v<version>` (with auto-generated
  notes), and publishes to npm.

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
3. From then on, **every merge to `main` that touches source files auto-bumps the patch version and publishes
   automatically** over OIDC — no tokens, no manual steps.

> Requirements (handled by the workflow): `id-token: write` permission, Node
> ≥ 22.14, and npm ≥ 11.5.1. The publish step safely skips if the version is
> already on npm, so re-runs and the bootstrap version won't cause failures.

---

## License

[MIT](./LICENSE)

This project is an independent client for Mealie and is not affiliated with the
Mealie project.
