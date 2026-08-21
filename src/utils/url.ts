/**
 * Strips sensitive data (query strings, `user:pass@` userinfo) from a URL string.
 * This is meant to be used for safely logging or displaying error messages.
 * Falls back to a hardcoded string when the URL will not parse.
 *
 * Nothing validates the provided string as a true URL during app initialization,
 * so a misconfigured token/endpoint URL must still produce the "request failed"
 * message that says what broke, rather than a bare ERR_INVALID_URL.
 */
export function safeUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    // SECURITY: Do not return the raw urlStr here, as it may contain sensitive credentials.
    // This is a deliberate mitigation for the "Sensitive Data Exposure in Request URL Logging Fallback"
    // vulnerability to ensure credentials are never leaked if URL parsing fails.
    return "<invalid url>";
  }
}
