import { realpath, stat } from "node:fs/promises";
import * as fs from "node:fs";
import { basename, extname, sep } from "node:path";
import { Readable } from "node:stream";
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

function safeUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    // SECURITY: Do not return the raw urlStr here, as it may contain sensitive credentials
    return "<invalid url>";
  }
}

// `basename()` has already dropped the directory part, so this is not about
// containment — the allowlist check in `readUpload` owns that. It is about not
// forwarding a name Mealie has to cope with: control characters, quotes, and
// characters that are illegal in a filename on the far side.
function sanitizeFilename(name: string): string {
  const safe = name.replace(/[\x00-\x1F\x7F<>:"/\\|?*]/g, "_");
  // A name that was nothing but stripped characters, or only dots, is no name.
  return !safe || /^\.+$/.test(safe) ? "upload.bin" : safe;
}

// Statuses worth retrying for idempotent requests: rate-limiting and transient
// server-side failures. 4xx (other than 429) are the caller's fault and repeating
// them just wastes time.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_BASE_DELAY_MS = 250;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// `fs.openAsBlob` hands `fetch` a file-backed Blob it can stream straight off
// disk, so a 50MB upload never lands in the V8 heap. It arrived in Node 19.8
// and `engines` still allows 18, where we fall back to the stream-backed
// stand-in below, which keeps the same streaming property.
// It has to be read off the namespace rather than imported by name: a static
// named import of a missing builtin export is a link-time SyntaxError, which
// would take down the whole server on Node 18 instead of just this one path.
const openAsBlob: typeof fs.openAsBlob | undefined =
  typeof fs.openAsBlob === "function" ? fs.openAsBlob : undefined;

// Every part used to go out as a typeless Blob, which multipart serializes as
// `application/octet-stream` — so an uploaded JPEG announced itself as opaque
// bytes. Server-side handlers that branch on the part's content type (image
// uploads, the recipe-from-image endpoints that hand the file to an AI
// provider) have nothing useful to branch on. Cover the formats Mealie's
// upload endpoints accept; anything else keeps the octet-stream default.
const MIME_TYPES = new Map<string, string>([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".heic", "image/heic"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".webp", "image/webp"],
  [".csv", "text/csv"],
  [".html", "text/html"],
  [".json", "application/json"],
  [".md", "text/markdown"],
  [".pdf", "application/pdf"],
  [".txt", "text/plain"],
  [".xml", "application/xml"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"],
  [".zip", "application/zip"],
]);

function mimeTypeFor(filePath: string): string {
  return MIME_TYPES.get(extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

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

  // Resolve against the base rather than concatenating. `baseUrl + path` lets a
  // spec-supplied path beginning with `@` reparse the host: "https://mealie.example"
  // + "@evil.com/x" is a URL whose host is evil.com. The two-argument form cannot
  // be steered that way.
  //
  // Both sides need adjusting for that form to preserve a base with a subpath:
  // the base must end in `/` or its last segment is dropped, and the path must
  // not start with `/` or it resolves against the origin and drops the subpath.
  const base = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  const url = new URL(path.replace(/^\/+/, ""), base);

  // SECURITY: Assert that the generated URL origin strictly matches the base origin
  // to prevent Server-Side Request Forgery (SSRF) via protocol-relative paths or absolute URLs.
  if (url.origin !== new URL(base).origin) {
    throw new Error("SSRF attack detected: URL origin mismatch");
  }

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

/**
 * Resolve the allowlist once per request. Each entry is realpath'd so a
 * symlinked allowed directory still matches, and given a trailing separator so
 * `/srv/uploads` cannot be satisfied by `/srv/uploads-evil`. Entries that do
 * not resolve (typo, not mounted) are dropped rather than throwing: a bad entry
 * must never widen the allowlist, and dropping it can only narrow.
 */
async function resolveAllowedDirs(dirs: string[]): Promise<string[]> {
  const resolved = await Promise.all(
    dirs.map(async (dir) => {
      try {
        const real = await realpath(dir);
        return real.endsWith(sep) ? real : real + sep;
      } catch {
        return undefined;
      }
    }),
  );
  return resolved.filter((dir): dir is string => dir !== undefined);
}

async function readUpload(
  filePath: string,
  allowedDirs: string[],
): Promise<{ filePath: string; blob: Blob }> {
  // SECURITY: the path comes from the model, so resolve symlinks before doing
  // anything else and then use only the real path. Checking the path as given
  // and reading it afterwards would let a symlink inside an allowed directory
  // point anywhere on the box — a lexical `resolve()` cannot see through one.
  let realPath: string;
  try {
    realPath = await realpath(filePath);
  } catch (err) {
    // Paths here come from a model, so a bare ENOENT/EACCES is worth restating
    // in terms of the upload it broke.
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Upload failed: cannot read ${filePath} (${reason}).`);
  }

  if (!allowedDirs.some((dir) => (realPath + sep).startsWith(dir))) {
    // Deliberately reports the real path: when a symlink is what pushed the
    // upload out of bounds, naming only the link makes the refusal baffling.
    throw new Error(
      `Upload failed: ${filePath} resolves to ${realPath}, which is outside MEALIE_ALLOWED_UPLOAD_DIRS.`,
    );
  }

  // SECURITY: Validate file type and size before reading to prevent DoS (e.g., /dev/urandom or huge files)
  const stats = await stat(realPath);
  if (!stats.isFile()) {
    throw new Error(`Upload failed: ${filePath} is not a regular file.`);
  }
  if (stats.size > MAX_FILE_SIZE) {
    throw new Error(`Upload failed: ${filePath} exceeds the maximum allowed size of 50MB.`);
  }

  // Name and MIME type come from the path the caller asked for; the bytes come
  // from the real path that was actually vetted.
  const type = mimeTypeFor(filePath);
  // An `openAsBlob` part is lazy: the bytes are pulled during `fetch`, so the
  // file has to stay put until the request goes out.
  if (openAsBlob) return { filePath, blob: await openAsBlob(realPath, { type }) };

  // Fallback for Node 18: create a duck-typed Blob that streams the file
  // to avoid loading up to 50MB into the V8 heap at once.
  const blob = {
    [Symbol.toStringTag]: "Blob",
    type,
    size: stats.size,
    stream() {
      return Readable.toWeb(fs.createReadStream(realPath)) as ReadableStream;
    },
    arrayBuffer() {
      return new Response((this as any).stream()).arrayBuffer();
    },
    slice() {
      return this;
    },
    text() {
      return new Response((this as any).stream()).text();
    },
  } as unknown as Blob;

  return { filePath, blob };
}

async function buildMultipart(
  config: Config,
  tool: MealieTool,
  body: Record<string, unknown>,
): Promise<FormData> {
  const form = new FormData();
  const fileFields = tool._fileFieldsSet ?? new Set(tool.body?.fileFields ?? []);
  // SECURITY: Fail closed. If no upload directories are explicitly allowed,
  // uploads are refused to prevent arbitrary local file reads.
  const allowedDirs = await resolveAllowedDirs(config.allowedUploadDirs);

  // ⚡ Bolt: Process files concurrently to overlap I/O latency, but return
  // synchronous closures to execute sequentially and preserve append order.
  const operations = await Promise.all(
    Object.entries(body).map(async ([key, value]) => {
      if (value === undefined || value === null) return () => {};
      if (fileFields.has(key)) {
        const paths = Array.isArray(value) ? value : [value];
        const files = await Promise.all(paths.map((p) => readUpload(String(p), allowedDirs)));
        return () => {
          for (const { filePath, blob } of files) {
            form.append(key, blob, sanitizeFilename(basename(filePath)));
          }
        };
      } else if (Array.isArray(value)) {
        return () => {
          for (const item of value) form.append(key, scalar(item));
        };
      } else {
        return () => {
          form.append(key, scalar(value));
        };
      }
    })
  );

  for (const apply of operations) {
    apply();
  }

  return form;
}

async function readImageBody(res: Response, contentType: string): Promise<{ blocks: ContentBlock[]; raw: string }> {
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    blocks: [{ type: "image", data: buf.toString("base64"), mimeType: contentType.split(";")[0] }],
    raw: `[image ${contentType} ${buf.length} bytes]`,
  };
}

async function readJsonBody(res: Response): Promise<{ blocks: ContentBlock[]; raw: string }> {
  const raw = await res.text();
  // ⚡ Bolt: Avoid expensive parsing and stringifying if the result is going
  // to be heavily truncated anyway. MAX_TEXT * 5 is an arbitrary threshold
  // indicating the raw JSON is already huge (e.g. 500KB+).
  if (raw.length > MAX_TEXT * 5) {
    return { blocks: [text(truncate(raw))], raw };
  }
  try {
    const pretty = JSON.stringify(JSON.parse(raw), null, 2);
    return { blocks: [text(truncate(pretty))], raw };
  } catch {
    return { blocks: [text(truncate(raw))], raw };
  }
}

async function readTextBody(res: Response): Promise<{ blocks: ContentBlock[]; raw: string }> {
  const raw = await res.text();
  return { blocks: [text(truncate(raw))], raw };
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
    return readImageBody(res, contentType);
  }

  if (contentType.includes("application/json")) {
    return readJsonBody(res);
  }

  if (contentType.startsWith("text/") || contentType.includes("xml") || contentType.includes("yaml")) {
    return readTextBody(res);
  }

  // Other binary payloads (zip, pdf, octet-stream): summarize instead of dumping base64.
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    blocks: [text(`Received ${buf.length} bytes of binary data (${contentType || "unknown type"}).`)],
    raw: `[binary ${buf.length} bytes]`,
  };
}

async function buildPayload(
  config: Config,
  tool: MealieTool,
  args: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<string | URLSearchParams | FormData | undefined> {
  if (!tool.body || args.body === undefined || args.body === null) {
    return undefined;
  }

  const bodyValue = args.body as Record<string, unknown>;
  if (tool.body.kind === "json") {
    headers["Content-Type"] = "application/json";
    return JSON.stringify(bodyValue);
  }

  if (tool.body.kind === "urlencoded") {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(bodyValue)) {
      if (v !== undefined && v !== null) params.append(k, scalar(v));
    }
    return params;
  }

  return await buildMultipart(config, tool, bodyValue);
}

async function performRequest(
  config: Config,
  url: string,
  method: string,
  headers: Record<string, string>,
  payload: string | URLSearchParams | FormData | undefined,
): Promise<{ res: Response; body: { blocks: ContentBlock[]; raw: string } }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await fetch(url, {
      method,
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
}

async function executeWithRetry(
  config: Config,
  tool: MealieTool,
  url: string,
  method: string,
  maxAttempts: number,
  send: (forceRefresh: boolean) => Promise<{ res: Response; body: { blocks: ContentBlock[]; raw: string } }>,
): Promise<ToolResult> {
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
      return { content: [text(`Request to ${method} ${safeUrl(url)} failed: ${reason}`)], isError: true };
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

export async function executeTool(
  config: Config,
  tool: MealieTool,
  args: Record<string, unknown>,
  auth: TokenProvider,
): Promise<ToolResult> {
  const url = buildUrl(config, tool, args);

  const baseHeaders: Record<string, string> = { Accept: "application/json" };
  if (config.acceptLanguage) baseHeaders["Accept-Language"] = config.acceptLanguage;

  const payload = await buildPayload(config, tool, args, baseHeaders);

  const send = async (forceRefresh: boolean): Promise<{ res: Response; body: { blocks: ContentBlock[]; raw: string } }> => {
    const headers = { ...baseHeaders };
    const authValue = await auth.authHeader(forceRefresh);
    if (authValue) headers.Authorization = authValue;

    return performRequest(config, url, tool.method.toUpperCase(), headers, payload);
  };

  const method = tool.method.toUpperCase();
  // Only GET is retried automatically: it is idempotent, so a repeat is safe.
  const maxAttempts = tool.method === "get" ? (config.retries ?? 0) + 1 : 1;

  return executeWithRetry(config, tool, url, method, maxAttempts, send);
}
