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
  /** Base URL of the Mealie instance, e.g. https://mealie.example.com. */
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
  /** Whitelist of tool names and/or category slugs to include. Empty = include all (within the safe baseline). */
  include: string[];
  /** Blacklist of tool names and/or category slugs to exclude (on top of the always-on baseline trim). */
  exclude: string[];
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
  /** Log each outgoing request (method, path, status) to stderr for troubleshooting. */
  debug: boolean;
  /**
   * Extra attempts for idempotent (GET) requests that fail with a network error
   * or a retryable status (429/5xx). 0 disables retries. Non-GET methods are
   * never retried automatically because they may not be safe to repeat.
   */
  retries: number;
}

/** Default cap for generated tool names; shared with the tool generator. */
export const DEFAULT_TOOL_NAME_MAX = 50;
const DEFAULT_RETRIES = 2;
const MAX_RETRIES = 5;

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

function parseBaseUrl(env: NodeJS.ProcessEnv): string {
  const rawBase = env.MEALIE_BASE_URL?.trim();
  if (!rawBase) {
    throw new Error(
      "MEALIE_BASE_URL is required (e.g. https://mealie.example.com). " +
        "Set it in your MCP client config under the server's `env`.",
    );
  }
  const baseUrl = rawBase.replace(/\/+$/, "");
  try {
    // Fail fast with a clear message rather than surfacing a cryptic
    // ERR_INVALID_URL later, on the first spec fetch or tool call.
    // eslint-disable-next-line no-new
    new URL(baseUrl);
  } catch {
    throw new Error(
      `MEALIE_BASE_URL is not a valid URL: ${JSON.stringify(rawBase)}. ` +
        "Use an absolute URL including the scheme, e.g. https://mealie.example.com.",
    );
  }
  return baseUrl;
}

function parseTimeout(env: NodeJS.ProcessEnv): number {
  const timeoutRaw = env.MEALIE_TIMEOUT?.trim();
  return timeoutRaw && /^\d+$/.test(timeoutRaw) ? Number(timeoutRaw) : 60_000;
}

function parseToolNameMax(env: NodeJS.ProcessEnv): number {
  const nameMaxRaw = env.MEALIE_TOOL_NAME_MAX?.trim();
  return nameMaxRaw && /^\d+$/.test(nameMaxRaw)
    ? Math.min(64, Math.max(16, Number(nameMaxRaw)))
    : DEFAULT_TOOL_NAME_MAX;
}

function parseRetries(env: NodeJS.ProcessEnv): number {
  const retriesRaw = env.MEALIE_RETRIES?.trim();
  return retriesRaw && /^\d+$/.test(retriesRaw)
    ? Math.min(MAX_RETRIES, Number(retriesRaw))
    : DEFAULT_RETRIES;
}

function parseOAuth(env: NodeJS.ProcessEnv): OAuthConfig | undefined {
  const oauthTokenUrl = env.MEALIE_OAUTH_TOKEN_URL?.trim();
  const oauthClientId = env.MEALIE_OAUTH_CLIENT_ID?.trim();
  const oauthClientSecret = env.MEALIE_OAUTH_CLIENT_SECRET?.trim();
  // Enable OAuth only when the full client-credentials triplet is present;
  // a partial config is treated as "not configured" rather than silently broken.
  return oauthTokenUrl && oauthClientId && oauthClientSecret
    ? {
        tokenUrl: oauthTokenUrl,
        clientId: oauthClientId,
        clientSecret: oauthClientSecret,
        scope: env.MEALIE_OAUTH_SCOPE?.trim() || undefined,
        audience: env.MEALIE_OAUTH_AUDIENCE?.trim() || undefined,
      }
    : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    baseUrl: parseBaseUrl(env),
    token: env.MEALIE_API_TOKEN?.trim() || env.MEALIE_TOKEN?.trim() || undefined,
    oauth: parseOAuth(env),
    openapiUrl: env.MEALIE_OPENAPI_URL?.trim() || undefined,
    useBundledSpec: bool(env.MEALIE_USE_BUNDLED_SPEC),
    readOnly: bool(env.MEALIE_READ_ONLY),
    include: list(env.MEALIE_TOOLS),
    exclude: list(env.MEALIE_EXCLUDE_TOOLS),
    timeoutMs: parseTimeout(env),
    acceptLanguage: env.MEALIE_ACCEPT_LANGUAGE?.trim() || undefined,
    toolNameMax: parseToolNameMax(env),
    debug: bool(env.MEALIE_DEBUG),
    retries: parseRetries(env),
  };
}
