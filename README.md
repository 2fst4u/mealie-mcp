# mealie-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for
[Mealie](https://github.com/mealie-recipes/mealie), the self-hosted recipe
manager, meal planner and shopping-list app.

It turns the Mealie REST API into MCP tools, one per endpoint, so an LLM can
read and manage your recipes, meal plans, shopping lists, cookbooks, households
and users.

- Admin and server-ops endpoints, plus a few that are no use to a model, are
  never exposed. That leaves about 211 of Mealie's ~259 endpoints. You can
  narrow this further with a read-only mode and include/exclude filters.
- Tools are generated at startup from your own instance's OpenAPI schema, so
  they match the Mealie version you run. A bundled snapshot is used if the
  fetch fails.
- It runs from `npx` with nothing to install, over stdio.
- It authenticates with a static API token or an OAuth2 client-credentials flow
  that fetches and refreshes access tokens itself.

---

## Quick start

You need three things:

1. **Node.js 22+** installed on your machine
2. The base URL of your Mealie instance, e.g. `https://mealie.example.com`
3. A Mealie **API token** (see [Getting an API token](#getting-an-api-token))

Run it with `npx`:

```bash
MEALIE_BASE_URL="https://mealie.example.com" \
MEALIE_API_TOKEN="your-long-lived-token" \
npx -y mealie-mcp
```

The server speaks MCP over stdio only, so you normally won't run it by hand.
Your MCP client launches it using the config below.

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

`MEALIE_BASE_URL` is the only required setting, and almost every endpoint also
needs a token.

---

## Getting an API token

In Mealie:

1. Click your user avatar → **Manage Your Profile**.
2. Open the **API Tokens** section (`/user/profile/api-tokens`).
3. Create a token, give it a name, and copy it.

The token has the permissions of the user that created it, so create it under
a user and household with the access you want the LLM to have. To stop the
model changing anything, also set [`MEALIE_READ_ONLY`](#configuration).

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
| `MEALIE_READ_ONLY` | – | `false` | When `true`, only expose `GET` endpoints. |
| `MEALIE_TOOLS` | – | — | Comma-separated **allow-list** of tool names or category slugs to expose (e.g. `recipe,households_shopping_lists`). Empty = the full safe baseline. |
| `MEALIE_EXCLUDE_TOOLS` | – | — | Comma-separated **deny-list** of tool names or category slugs to hide further (e.g. `groups_seeders,groups_migrations`). Applied on top of the always-on baseline trim. |
| `MEALIE_USE_BUNDLED_SPEC` | – | `false` | Skip the live OpenAPI fetch and use the snapshot bundled with the package. |
| `MEALIE_OPENAPI_URL` | – | `${MEALIE_BASE_URL}/openapi.json` | Override where the OpenAPI schema is fetched from. |
| `MEALIE_TOOL_NAME_MAX` | – | `50` | Max length of generated tool names (clamped to 16–64). Lower it if your MCP client prefixes tool names (e.g. `mcp__<server>__<tool>`) and the combined name exceeds the 64-char API limit. |
| `MEALIE_TIMEOUT` | – | `60000` | Per-request timeout in milliseconds. |
| `MEALIE_RETRIES` | – | `2` | Extra attempts for idempotent (`GET`) requests that hit a network error or a retryable status (`429`/`5xx`), with exponential backoff (clamped to 0–5). Non-`GET` methods are never retried automatically. Set `0` to disable. |
| `MEALIE_DEBUG` | – | `false` | When `true`, log each outgoing request (method, path, response status) to stderr. Useful for troubleshooting from your MCP client. |
| `MEALIE_ACCEPT_LANGUAGE` | – | — | Optional `Accept-Language` header forwarded to Mealie (affects e.g. ingredient parsing locale). |
| `MEALIE_ALLOWED_UPLOAD_DIRS` | – | — | Comma-separated directories that file uploads may read from. Unset (the default) means uploads are disabled. See [Restricting file uploads](#restricting-file-uploads). |

Tool inputs cover path parameters, query parameters and the request body. The
few Mealie endpoints that read a custom request header or cookie don't take it
as a tool argument: `Accept-Language` comes from `MEALIE_ACCEPT_LANGUAGE`, and
authentication is handled by the server.

### Restricting file uploads

A handful of Mealie endpoints take a file, such as recipe images, recipe assets
and ZIP imports. For those, the tool argument is an absolute path on the
machine running this server. The server reads the file (up to 50 MB) and sends
it to Mealie as multipart form data.

That means anything the server process can read, a tool call can upload. Since
the tool call is chosen by a model, and models read recipe pages and other
untrusted text, a prompt-injection payload can in principle ask for a path you
never intended, such as `~/.ssh/id_rsa` instead of a photo of dinner.

`MEALIE_ALLOWED_UPLOAD_DIRS` bounds that. Set it to a comma-separated list of
directories, and any upload resolving outside all of them is refused:

```bash
MEALIE_ALLOWED_UPLOAD_DIRS="/home/me/Pictures/recipes,/srv/mealie/imports"
```

Paths are compared after symlinks are resolved on both sides, so a symlink
inside an allowed directory cannot point out of it, a symlinked allowed
directory still works, and `/srv/mealie/imports-scratch` is not treated as
being inside `/srv/mealie/imports`. If the variable is set but none of its
directories exist, every upload is refused rather than silently falling back to
unrestricted.

Leaving it unset disables all uploads, so you must set it to use the upload
tools. If you never upload files, consider dropping
those tools entirely with `MEALIE_EXCLUDE_TOOLS`, or run the server read-only
with `MEALIE_READ_ONLY=true`.

### Authenticating with OAuth (client credentials)

By default the server authenticates with a static `MEALIE_API_TOKEN`. For
machine-to-machine setups it can instead get an access token from your identity
provider with the OAuth2 client-credentials grant. It sends that token as the
`Authorization: Bearer` credential and refreshes it shortly before it expires,
or after a `401`.

```bash
MEALIE_OAUTH_TOKEN_URL="https://idp.example.com/oauth/token"
MEALIE_OAUTH_CLIENT_ID="your-client-id"
MEALIE_OAUTH_CLIENT_SECRET="your-client-secret"
# Optional, IdP-dependent:
MEALIE_OAUTH_SCOPE="mealie"
MEALIE_OAUTH_AUDIENCE="https://mealie.example.com"
```

When the token URL, client id and client secret are all set, OAuth takes
precedence and `MEALIE_API_TOKEN` is ignored. If any of the three is missing,
OAuth is treated as not configured.

> **Precondition:** your Mealie must be a version that validates IdP-issued
> access tokens as bearer tokens (via the provider's JWKS). The client sends
> the credentials in the request body (`client_secret_post`). If your IdP
> requires HTTP Basic client auth instead, open an issue.

### The safe baseline (≈211 of 259 endpoints)

Mealie has about 259 endpoints. The server exposes about 211 of them, so
clients get a smaller tool list and risky endpoints can't be reached. Two
groups are always excluded and can't be re-enabled by configuration:

- **Admin / server-ops** endpoints (backups, maintenance, multi-tenant
  user/group/household management, debug, email config, AI providers). These are
  powerful, rarely what a recipe assistant needs, and a security footgun, so the
  server never exposes them. Manage your instance through Mealie's own UI/API.
- Endpoints with little value to an LLM: password-reset and registration flows,
  the docker healthcheck route, the SSE *stream* duplicates of plain-JSON
  recipe-import endpoints, and zip/file download routes that return opaque bytes.
  (The `Users: Authentication` category is kept, since the server can
  authenticate via OAuth.)

You can narrow this baseline, but not widen it, with `MEALIE_TOOLS` and
`MEALIE_EXCLUDE_TOOLS`, using category slugs or exact tool names. An entry also matches every category it prefixes at a `_` boundary, so
`recipe` covers all the `recipe_*` categories (`recipe_crud`, `recipe_comments`,
`recipe_timeline`, …) and `explore` all the `explore_*` ones. Examples:

```bash
# Only recipes, meal plans and shopping lists:
MEALIE_TOOLS="recipe,households_mealplans,households_shopping_lists"

# Baseline, but also drop group seeders + migrations:
MEALIE_EXCLUDE_TOOLS="groups_seeders,groups_migrations"

# Read-only recipe browsing assistant:
MEALIE_READ_ONLY=true
MEALIE_TOOLS="recipe,explore"
```

On startup the server logs any category your settings hide completely, so you
can tell which setting removed a missing tool. With the first example above:

```text
[mealie-mcp] Exposing 64/259 tools across 10 categories.
[mealie-mcp] MEALIE_TOOLS hides 35 categories entirely: households_shopping_list_items, ... (+27 more; MEALIE_DEBUG=true lists them).
```

---

## How tools are named

Each tool name is derived from the Mealie OpenAPI tag (category) and operation.
Operations with a unique name use it as-is (e.g. `get_todays_meals`).
Operations whose name appears more than once in the spec (`get_all`, `get_one`,
`create_one`, `suggest_recipes`, …) are prefixed with their category. Names are
capped at `MEALIE_TOOL_NAME_MAX` characters (50 by default). For example:

| Tool | Method & path |
| --- | --- |
| `recipe_crud_get_all` | `GET /api/recipes` |
| `recipe_crud_get_one` | `GET /api/recipes/{slug}` |
| `recipe_crud_create_one` | `POST /api/recipes` |
| `households_shopping_lists_get_all` | `GET /api/households/shopping/lists` |
| `households_mealplans_create_one` | `POST /api/households/mealplans` |
| `app_about_get_app_info` | `GET /api/app/about` |

Each tool's input schema declares its path parameters, query parameters and,
where relevant, a `body` object, all generated from Mealie's OpenAPI schema.

## How tools are described

Mealie's spec is generated by FastAPI, so most operations carry only a
title-cased summary (`Patch One`, `Get All`) and often no description at all.
That is too little text for a model, or a hub's tool-search index, to match a
query like "update recipe" against, so each description is rebuilt from the
tag, the path and the HTTP method.

```text
Patch One — Recipe: CRUD. Partially update recipe.
[PATCH /api/recipes/{slug}]
Updates a recipe by existing slug and data.
Keywords: patch_one, patch one, patch recipe, update recipe, edit recipe,
modify recipe, change recipe, write recipe, recipe, recipes, recipe crud,
patch, update, edit, modify, change, write, mealie.
```

| Line | Contents |
| --- | --- |
| Headline | The spec summary, its tag, and a generated sentence naming the action and the resource (`Partially update recipe.`) |
| Route | The literal `[METHOD /path]`, which clients do match on |
| Detail | The spec's own prose, when it has any |
| Keywords | The tool's own name, its category and tag, the resource in both singular and plural, and every verb that means the same thing as the HTTP method |

Because the keyword line carries the tool's own name, even a terse name like
`patch_one` can be found by name without renaming it, so existing
`MEALIE_TOOLS` filters and client allow-lists keep working.

The generated text also spells out words Mealie writes as a single token
(`mealplans` becomes "meal plans"), so meal-plan tools match the words a user
would type. When a description would exceed 2000 characters, only the spec's
own prose is truncated, never the keyword line.

Upload tools say in their description which fields are file paths. See
[Restricting file uploads](#restricting-file-uploads).

### Troubleshooting: "name: String should have at most 64 characters"

Some MCP clients and hubs (e.g. MCPHub, remote connectors) prefix every tool
name with the server name, as `mcp__<server>__<tool>`, and the combined string
must stay within the API's 64-character limit. If you hit this error:

1. Keep the server's name/alias short (`mealie` is ideal).
2. Lower the tool-name cap, e.g. `MEALIE_TOOL_NAME_MAX=30`, until it fits.
3. Claude rejects the whole tool list if any tool from any server is too long,
   so the culprit may be a different server.

### Categories

<details>
<summary>All 57 categories</summary>

Counts are from the bundled snapshot, before any filtering. The `admin_*`
categories and `users_passwords` are never exposed, and a few single endpoints
in other categories are also dropped (see [the safe baseline](#the-safe-baseline-211-of-259-endpoints)).

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
| `src/description.ts` | Build searchable tool descriptions from the spec. |
| `src/config.ts` | Environment-variable configuration. |
| `src/auth.ts` | Resolve the `Authorization` header (static token or OAuth client credentials). |
| `src/openapi-loader.ts` | Fetch live OpenAPI schema with bundled fallback. |
| `src/tools.ts` | Generate one MCP tool per OpenAPI operation; built-in trimming. |
| `src/schema.ts` | Build self-contained JSON Schemas (`$ref` → `$defs`). |
| `src/http-client.ts` | Execute requests (JSON / urlencoded / multipart / binary). |
| `src/server.ts` | MCP server wiring (`tools/list`, `tools/call`). |
| `openapi.snapshot.json` | Bundled fallback OpenAPI schema. |

### Releases

Pull requests are type-checked, built and tested on Node 22 and 24. Merges to
`main` that touch source files are built, tested, version-bumped, published to
npm and tagged with a matching GitHub Release automatically.

---

## License

[MIT](./LICENSE)

This project is an independent client for Mealie and is not affiliated with the
Mealie project.
