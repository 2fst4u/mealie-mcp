// Runtime configuration, sourced entirely from environment variables so the
// server works cleanly as an `npx` stdio process launched by an MCP client.

export interface OAuthConfig {
  /** IdP token endpoint to POST the client-credentials grant to. */
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Optional space-delimited scopes. */
  scope?: string;
  /** Optional audience (some IdPs, e.g. Auth0, require it to mint a Mealie-targeted token). */
  audience?: string;
}

export interface Config {
  /** Base URL of the Mealie instance, e.g. https://mealie.example.com (no trailing slash). */
  baseUrl: string;
  /** Long-lived Mealie API token (Authorization: Bearer <token>). Optional but most endpoints need it. */
  token?: string;
  /**
   * OAuth2 client-credentials config. When set it takes precedence over `token`:
   * the server obtains (and refreshes) an access token from the IdP and sends it
   * as the Bearer credential. Requires a Mealie that validates IdP tokens (JWKS).
   */
  oauth?: OAuthConfig;
  /** Where to load the OpenAPI spec from. Defaults to `${baseUrl}/openapi.json`. */
  openapiUrl?: string;
  /** Skip the live fetch and always use the snapshot bundled with the package. */
  useBundledSpec: boolean;
  /** Only expose read (GET) endpoints. Useful for safe, read-only deployments. */
  readOnly: boolean;
  /** Whitelist of tool names and/or category slugs to include. Empty = include all. */
  include: string[];
  /** Blacklist of tool names and/or category slugs to exclude. */
  exclude: string[];
  /** Expose admin/server-ops endpoints (backups, maintenance, user management, …). Off by default. */
  includeAdmin: boolean;
  /** Disable all built-in tool trimming (default-exclude list + admin gate), restoring full API coverage. */
  includeAll: boolean;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Optional default Accept-Language header forwarded to Mealie. */
  acceptLanguage?: string;
  /**
   * Maximum length for generated tool names. Kept low by default because many
   * MCP clients prefix tool names (e.g. `mcp__<server>__<tool>`) and the
   * combined string must stay within the 64-char API limit. Lower this further
   * if your client adds a long prefix.
   */
  toolNameMax: number;
}

const DEFAULT_TOOL_NAME_MAX = 50;

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function list(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawBase = env.MEALIE_BASE_URL?.trim();
  if (!rawBase) {
    throw new Error(
      "MEALIE_BASE_URL is required (e.g. https://mealie.example.com). " +
        "Set it in your MCP client config under the server's `env`.",
    );
  }
  const baseUrl = rawBase.replace(/\/+$/, "");

  const timeoutRaw = env.MEALIE_TIMEOUT?.trim();
  const timeoutMs = timeoutRaw && /^\d+$/.test(timeoutRaw) ? Number(timeoutRaw) : 60_000;

  const nameMaxRaw = env.MEALIE_TOOL_NAME_MAX?.trim();
  const toolNameMax =
    nameMaxRaw && /^\d+$/.test(nameMaxRaw)
      ? Math.min(64, Math.max(16, Number(nameMaxRaw)))
      : DEFAULT_TOOL_NAME_MAX;

  const oauthTokenUrl = env.MEALIE_OAUTH_TOKEN_URL?.trim();
  const oauthClientId = env.MEALIE_OAUTH_CLIENT_ID?.trim();
  const oauthClientSecret = env.MEALIE_OAUTH_CLIENT_SECRET?.trim();
  // Enable OAuth only when the full client-credentials triplet is present;
  // a partial config is treated as "not configured" rather than silently broken.
  const oauth: OAuthConfig | undefined =
    oauthTokenUrl && oauthClientId && oauthClientSecret
      ? {
          tokenUrl: oauthTokenUrl,
          clientId: oauthClientId,
          clientSecret: oauthClientSecret,
          scope: env.MEALIE_OAUTH_SCOPE?.trim() || undefined,
          audience: env.MEALIE_OAUTH_AUDIENCE?.trim() || undefined,
        }
      : undefined;

  return {
    baseUrl,
    token: env.MEALIE_API_TOKEN?.trim() || env.MEALIE_TOKEN?.trim() || undefined,
    oauth,
    openapiUrl: env.MEALIE_OPENAPI_URL?.trim() || undefined,
    useBundledSpec: bool(env.MEALIE_USE_BUNDLED_SPEC),
    readOnly: bool(env.MEALIE_READ_ONLY),
    include: list(env.MEALIE_TOOLS),
    exclude: list(env.MEALIE_EXCLUDE_TOOLS),
    includeAdmin: bool(env.MEALIE_INCLUDE_ADMIN),
    includeAll: bool(env.MEALIE_INCLUDE_ALL),
    timeoutMs,
    acceptLanguage: env.MEALIE_ACCEPT_LANGUAGE?.trim() || undefined,
    toolNameMax,
  };
}
