// Resolves the `Authorization` header sent to Mealie. The server supports two
// credential sources: a static long-lived token, or — taking precedence — an
// OAuth2 client-credentials grant whose access token is fetched, cached and
// refreshed against the IdP. Keeping this behind a small interface lets the
// HTTP client stay agnostic about where the bearer value comes from.

import type { Config, OAuthConfig } from "./config.js";

export interface TokenProvider {
  /**
   * Full `Authorization` header value (e.g. `Bearer <token>`), or undefined when
   * the server is unauthenticated. Pass `forceRefresh` to bypass any cache —
   * used to recover from a 401 caused by an expired/revoked access token.
   */
  authHeader(forceRefresh?: boolean): Promise<string | undefined>;
}

// Refresh a little before the IdP-stated expiry to absorb clock skew / latency.
const EXPIRY_MARGIN_MS = 60_000;
// Fallback lifetime when the token response omits `expires_in`.
const DEFAULT_LIFETIME_S = 3600;

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

class OAuthTokenProvider implements TokenProvider {
  private cached?: { header: string; expiresAt: number };
  /** In-flight fetch, shared so parallel tool calls don't stampede the token endpoint. */
  private inflight?: Promise<string>;

  constructor(
    private readonly oauth: OAuthConfig,
    private readonly timeoutMs: number,
  ) {}

  async authHeader(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.cached && Date.now() < this.cached.expiresAt) {
      return this.cached.header;
    }
    if (forceRefresh) this.cached = undefined;
    if (!this.inflight) {
      this.inflight = this.fetchToken().finally(() => {
        this.inflight = undefined;
      });
    }
    return this.inflight;
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.oauth.clientId,
      client_secret: this.oauth.clientSecret,
    });
    if (this.oauth.scope) body.append("scope", this.oauth.scope);
    if (this.oauth.audience) body.append("audience", this.oauth.audience);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    let rawText: string;
    try {
      res = await fetch(this.oauth.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body,
        signal: controller.signal,
      });
      // SECURITY: Ensure body is read within the timeout window
      rawText = await res.text();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`OAuth token request to ${this.oauth.tokenUrl} failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // SECURITY: Do not include rawText in the error message to avoid leaking sensitive information.
      throw new Error(
        `OAuth token request to ${this.oauth.tokenUrl} returned HTTP ${res.status} ${res.statusText}`,
      );
    }

    let parsed: TokenResponse;
    try {
      parsed = JSON.parse(rawText) as TokenResponse;
    } catch {
      throw new Error(`OAuth token response from ${this.oauth.tokenUrl} was not valid JSON.`);
    }
    if (!parsed.access_token) {
      throw new Error(`OAuth token response from ${this.oauth.tokenUrl} did not include an access_token.`);
    }

    const lifetimeMs = (parsed.expires_in ?? DEFAULT_LIFETIME_S) * 1000;
    const header = `${parsed.token_type?.trim() || "Bearer"} ${parsed.access_token}`;
    this.cached = { header, expiresAt: Date.now() + Math.max(0, lifetimeMs - EXPIRY_MARGIN_MS) };
    return header;
  }
}

class StaticTokenProvider implements TokenProvider {
  private readonly header: string;
  constructor(token: string) {
    this.header = `Bearer ${token}`;
  }
  async authHeader(): Promise<string> {
    return this.header;
  }
}

const ANONYMOUS: TokenProvider = { authHeader: async () => undefined };

/** Build the token provider for the given config. OAuth wins over a static token. */
export function createTokenProvider(config: Config): TokenProvider {
  if (config.oauth) return new OAuthTokenProvider(config.oauth, config.timeoutMs);
  if (config.token) return new StaticTokenProvider(config.token);
  return ANONYMOUS;
}

/** Whether a provider can refresh its credential (so a 401 retry is worth attempting). */
export function isRefreshable(config: Config): boolean {
  return Boolean(config.oauth);
}
