import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Config } from "./config.js";
import { isRefreshable, type TokenProvider } from "./auth.js";
import type { MealieTool } from "./tools.js";

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: ContentBlock[];
  isError?: boolean;
  [key: string]: unknown;
}

const MAX_TEXT = 100_000;

// Statuses worth retrying for idempotent requests: rate-limiting and transient
// server-side failures. 4xx (other than 429) are the caller's fault and repeating
// them just wastes time.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_BASE_DELAY_MS = 250;

function text(value: string): ContentBlock {
  return { type: "text", text: value };
}

function debugLog(config: Config, message: string): void {
  if (config.debug) process.stderr.write(`[mealie-mcp] ${message}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff for the Nth retry (1-based): 250ms, 500ms, 1s, … */
function backoffMs(attempt: number): number {
  return RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
}

function truncate(value: string): string {
  if (value.length <= MAX_TEXT) return value;
  return `${value.slice(0, MAX_TEXT)}\n\n…[truncated ${value.length - MAX_TEXT} characters]`;
}

function buildUrl(config: Config, tool: MealieTool, args: Record<string, unknown>): string {
  let path = tool.path;
  for (const name of tool.pathParams) {
    const value = args[name];
    if (value === undefined || value === null) {
      throw new Error(`Missing required path parameter: ${name}`);
    }
    path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
  }

  const url = new URL(config.baseUrl + path);
  for (const { name } of tool.queryParams) {
    const value = args[name];
    if (value === undefined || value === null) continue;
    // Array values are always expanded as repeated `key=` pairs, regardless of
    // whether the schema declared the parameter as an array.
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(name, scalar(item));
    } else {
      url.searchParams.append(name, scalar(value));
    }
  }
  return url.toString();
}

function scalar(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function buildMultipart(tool: MealieTool, body: Record<string, unknown>): Promise<FormData> {
  const form = new FormData();
  const fileFields = new Set(tool.body?.fileFields ?? []);
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    if (fileFields.has(key)) {
      const paths = Array.isArray(value) ? value : [value];
      const filePromises = paths.map(async (p) => {
        const filePath = String(p);
        const data = await readFile(filePath);
        return { filePath, data };
      });
      const files = await Promise.all(filePromises);
      for (const { filePath, data } of files) {
        form.append(key, new Blob([new Uint8Array(data)]), basename(filePath));
      }
    } else if (Array.isArray(value)) {
      for (const item of value) form.append(key, scalar(item));
    } else {
      form.append(key, scalar(value));
    }
  }
  return form;
}

async function readBody(res: Response): Promise<{ blocks: ContentBlock[]; raw: string }> {
  const contentType = res.headers.get("content-type") ?? "";

  if (res.status === 204 || res.headers.get("content-length") === "0") {
    // Only call an empty body a "success"; on an error status the caller
    // prepends the HTTP status, so a neutral note reads correctly there.
    const message = res.ok ? `Success (HTTP ${res.status}, no content).` : "(no response body)";
    return { blocks: [text(message)], raw: "" };
  }

  if (contentType.startsWith("image/")) {
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      blocks: [{ type: "image", data: buf.toString("base64"), mimeType: contentType.split(";")[0] }],
      raw: `[image ${contentType} ${buf.length} bytes]`,
    };
  }

  if (contentType.includes("application/json")) {
    const raw = await res.text();
    try {
      const pretty = JSON.stringify(JSON.parse(raw), null, 2);
      return { blocks: [text(truncate(pretty))], raw };
    } catch {
      return { blocks: [text(truncate(raw))], raw };
    }
  }

  if (contentType.startsWith("text/") || contentType.includes("xml") || contentType.includes("yaml")) {
    const raw = await res.text();
    return { blocks: [text(truncate(raw))], raw };
  }

  // Other binary payloads (zip, pdf, octet-stream): summarize instead of dumping base64.
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    blocks: [text(`Received ${buf.length} bytes of binary data (${contentType || "unknown type"}).`)],
    raw: `[binary ${buf.length} bytes]`,
  };
}

export async function executeTool(
  config: Config,
  tool: MealieTool,
  args: Record<string, unknown>,
  auth: TokenProvider,
): Promise<ToolResult> {
  const url = buildUrl(config, tool, args);

  const baseHeaders: Record<string, string> = { Accept: "application/json" };
  if (config.acceptLanguage) baseHeaders["Accept-Language"] = config.acceptLanguage;

  let payload: string | URLSearchParams | FormData | undefined;
  if (tool.body && args.body !== undefined && args.body !== null) {
    const bodyValue = args.body as Record<string, unknown>;
    if (tool.body.kind === "json") {
      payload = JSON.stringify(bodyValue);
      baseHeaders["Content-Type"] = "application/json";
    } else if (tool.body.kind === "urlencoded") {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(bodyValue)) {
        if (v !== undefined && v !== null) params.append(k, scalar(v));
      }
      payload = params;
    } else {
      payload = await buildMultipart(tool, bodyValue);
    }
  }

  const send = async (forceRefresh: boolean): Promise<{ res: Response; body: { blocks: ContentBlock[]; raw: string } }> => {
    const headers = { ...baseHeaders };
    const authValue = await auth.authHeader(forceRefresh);
    if (authValue) headers.Authorization = authValue;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const res = await fetch(url, {
        method: tool.method.toUpperCase(),
        headers,
        body: payload,
        signal: controller.signal,
      });
      // SECURITY: Ensure body is read within the timeout window (prevent Slow Loris DoS attacks)
      const body = await readBody(res);
      return { res, body };
    } finally {
      clearTimeout(timer);
    }
  };

  const method = tool.method.toUpperCase();
  // Only GET is retried automatically: it is idempotent, so a repeat is safe.
  const maxAttempts = tool.method === "get" ? (config.retries ?? 0) + 1 : 1;

  for (let attempt = 1; ; attempt++) {
    let res: Response;
    let bodyResult: { blocks: ContentBlock[]; raw: string };
    try {
      ({ res, body: bodyResult } = await send(false));
      // A 401 may mean the OAuth access token expired mid-flight; force one refresh and retry.
      if (res.status === 401 && isRefreshable(config)) {
        ({ res, body: bodyResult } = await send(true));
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) {
        const delay = backoffMs(attempt);
        debugLog(config, `${method} ${tool.path} failed (${reason}); retrying in ${delay}ms`);
        await sleep(delay);
        continue;
      }
      debugLog(config, `${method} ${tool.path} → network error: ${reason}`);
      return { content: [text(`Request to ${method} ${url} failed: ${reason}`)], isError: true };
    }

    debugLog(config, `${method} ${tool.path} → ${res.status}`);

    if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
      const delay = backoffMs(attempt);
      debugLog(config, `${method} ${tool.path} → ${res.status}; retrying in ${delay}ms`);
      await sleep(delay);
      continue;
    }

    const { blocks } = bodyResult;
    if (!res.ok) {
      const detail = blocks.map((b) => (b.type === "text" ? b.text : "[binary]")).join("\n");
      return {
        content: [text(`HTTP ${res.status} ${res.statusText} from ${method} ${tool.path}\n${detail}`)],
        isError: true,
      };
    }

    return { content: blocks };
  }
}
