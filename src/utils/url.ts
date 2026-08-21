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
