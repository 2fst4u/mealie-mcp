import { DEFAULT_TOOL_NAME_MAX, type Config } from "./config.js";
import { buildDefs, COMPONENT_REF_PREFIX, localize } from "./schema.js";
import {
  HTTP_METHODS,
  type HttpMethod,
  type JsonSchema,
  type OpenApiDocument,
  type OpenApiOperation,
  type OpenApiParameter,
} from "./openapi-types.js";

type BodyKind = "json" | "urlencoded" | "multipart";

export interface MealieTool {
  /** MCP tool name: `<category>_<operation>`, unique and <= 64 chars. */
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Slugified first tag, used for include/exclude filtering. */
  category: string;
  method: HttpMethod;
  /** Path template containing `{param}` placeholders. */
  path: string;
  pathParams: string[];
  queryParams: Array<{ name: string; isArray: boolean }>;
  body?: {
    kind: BodyKind;
    required: boolean;
    /** Property names that carry file contents (multipart binary fields). */
    fileFields: string[];
  };
  deprecated: boolean;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Strip the FastAPI-generated `<path>_<method>` suffix off an operationId. */
function operationName(operationId: string | undefined, path: string, method: string): string {
  if (!operationId) return `${method}_${slug(path)}`;
  const suffix = `${path.replace(/\W/g, "_")}_${method}`;
  return operationId.endsWith(suffix) ? operationId.slice(0, -suffix.length) : operationId;
}

/** Collapse immediately repeated tokens, e.g. `recipe_recipe_get` -> `recipe_get`. */
function dedupeTokens(name: string): string {
  const parts = name.split("_");
  let result = "";
  let last = "";
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length > 0 && p !== last) {
      if (result.length > 0) result += "_";
      result += p;
      last = p;
    }
  }
  return result;
}

function nameParts(op: OpenApiOperation, path: string, method: string): { category: string; base: string } {
  const category = slug(op.tags?.[0] ?? "misc");
  const base = dedupeTokens(operationName(op.operationId, path, method).replace(/_+/g, "_"));
  return { category, base };
}

/**
 * Build the (untruncated) tool name. Bare operation names (e.g.
 * `suggest_recipes`) are used as-is for brevity; names reused across routers
 * (e.g. `get_all`, `create_one`) are prefixed with their category to stay unique.
 */
function buildName(category: string, base: string, prefixed: boolean): string {
  const name = prefixed ? dedupeTokens(`${category}_${base}`.replace(/_+/g, "_")) : base;
  return name || "tool";
}

/** Truncate a name to `max` chars without leaving a dangling underscore. */
function clampName(name: string, max: number): string {
  if (name.length <= max) return name;
  return name.slice(0, max).replace(/_+$/, "") || name.slice(0, max);
}

function buildDescription(op: OpenApiOperation, path: string, method: string): string {
  const parts: string[] = [];
  if (op.summary) parts.push(op.summary);
  parts.push(`[${method.toUpperCase()} ${path}]`);
  if (op.description && op.description.trim() && op.description.trim() !== op.summary) {
    parts.push(op.description.trim());
  }
  if (op.deprecated) parts.unshift("(DEPRECATED)");
  let text = parts.join("\n");
  if (text.length > 2000) text = `${text.slice(0, 1997)}...`;
  return text;
}

/** Does a parameter schema permit an array value (so we repeat the query key)? */
function schemaAllowsArray(schema: JsonSchema | undefined): boolean {
  if (!schema) return false;
  if (schema.type === "array") return true;
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const branch = schema[key];
    if (Array.isArray(branch) && branch.some((s) => schemaAllowsArray(s as JsonSchema))) return true;
  }
  return false;
}

/** Resolve a possibly-$ref'd schema to its target object (one hop) for inspection. */
function resolveSchema(schema: JsonSchema | undefined, components: Record<string, JsonSchema>): JsonSchema | undefined {
  if (!schema) return undefined;
  const ref = schema.$ref;
  if (typeof ref === "string" && ref.startsWith(COMPONENT_REF_PREFIX)) {
    const name = ref.slice(COMPONENT_REF_PREFIX.length);
    if (name && components[name]) return components[name];
  }
  return schema;
}

/** Find multipart properties whose schema is binary (a file), incl. arrays of files. */
function findFileFields(schema: JsonSchema | undefined, components: Record<string, JsonSchema>): string[] {
  const resolved = resolveSchema(schema, components);
  const props = resolved?.properties as Record<string, JsonSchema> | undefined;
  if (!props) return [];
  const isBinary = (s: JsonSchema | undefined): boolean => {
    if (!s || typeof s !== "object") return false;
    // Mealie marks file fields with `contentMediaType` (e.g. application/octet-stream);
    // OpenAPI 3.1 also allows `format: binary`. Files may be a single value or an array.
    if (s.format === "binary") return true;
    if (typeof s.contentMediaType === "string") return true;
    if (isBinary(s.items as JsonSchema | undefined)) return true;
    for (const key of ["anyOf", "oneOf", "allOf"] as const) {
      const branch = s[key];
      if (Array.isArray(branch) && branch.some((b) => isBinary(b as JsonSchema))) return true;
    }
    return false;
  };
  return Object.entries(props)
    .filter(([, s]) => isBinary(s))
    .map(([k]) => k);
}

function pickBody(
  op: OpenApiOperation,
  components: Record<string, JsonSchema>,
): { kind: BodyKind; schema: JsonSchema | undefined; required: boolean; fileFields: string[] } | undefined {
  const content = op.requestBody?.content;
  if (!content) return undefined;
  const required = Boolean(op.requestBody?.required);

  if (content["application/json"]) {
    return { kind: "json", schema: content["application/json"].schema, required, fileFields: [] };
  }
  if (content["multipart/form-data"]) {
    const schema = content["multipart/form-data"].schema;
    return { kind: "multipart", schema, required, fileFields: findFileFields(schema, components) };
  }
  if (content["application/x-www-form-urlencoded"]) {
    return { kind: "urlencoded", schema: content["application/x-www-form-urlencoded"].schema, required, fileFields: [] };
  }
  // Unknown body type: treat the first available content as JSON-ish passthrough.
  const first = Object.values(content)[0];
  return first ? { kind: "json", schema: first.schema, required, fileFields: [] } : undefined;
}

function processParams(params: OpenApiParameter[]) {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const pathParams: string[] = [];
  const queryParams: Array<{ name: string; isArray: boolean }> = [];
  const rootSchemas: Array<JsonSchema | undefined> = [];

  for (const param of params) {
    if (param.in !== "path" && param.in !== "query") continue; // headers/cookies handled globally
    const localized = localize(param.schema) ?? {};
    if (param.description && !localized.description) localized.description = param.description;
    properties[param.name] = localized;
    rootSchemas.push(param.schema);

    if (param.in === "path") {
      pathParams.push(param.name);
      required.push(param.name);
    } else {
      queryParams.push({ name: param.name, isArray: schemaAllowsArray(param.schema) });
      if (param.required) required.push(param.name);
    }
  }

  return { properties, required, pathParams, queryParams, rootSchemas };
}

function processBody(op: OpenApiOperation, body: ReturnType<typeof pickBody>) {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const rootSchemas: Array<JsonSchema | undefined> = [];

  if (body?.schema) {
    const bodySchema = localize(body.schema) ?? {};
    if (op.requestBody?.description && !bodySchema.description) {
      bodySchema.description = op.requestBody.description;
    }
    if (body.kind === "multipart" && body.fileFields.length > 0) {
      const note = `File fields (${body.fileFields.join(", ")}) must be absolute paths to local files to upload.`;
      bodySchema.description = bodySchema.description ? `${bodySchema.description} ${note}` : note;
    }
    properties.body = bodySchema;
    rootSchemas.push(body.schema);
    if (body.required) required.push("body");
  }

  return { properties, required, rootSchemas };
}

function buildInputSchema(
  op: OpenApiOperation,
  params: OpenApiParameter[],
  body: ReturnType<typeof pickBody>,
  components: Record<string, JsonSchema>,
  defsCache: Map<string, JsonSchema>,
): { inputSchema: JsonSchema; pathParams: string[]; queryParams: Array<{ name: string; isArray: boolean }> } {
  const parsedParams = processParams(params);
  const parsedBody = processBody(op, body);

  const properties: Record<string, JsonSchema> = { ...parsedParams.properties, ...parsedBody.properties };
  const required: string[] = [...parsedParams.required, ...parsedBody.required];
  const rootSchemas: Array<JsonSchema | undefined> = [...parsedParams.rootSchemas, ...parsedBody.rootSchemas];

  const inputSchema: JsonSchema = { type: "object", properties };
  if (required.length > 0) inputSchema.required = required;
  inputSchema.additionalProperties = false;

  const defs = buildDefs(rootSchemas, components, defsCache);
  if (defs) inputSchema.$defs = defs;

  return { inputSchema, pathParams: parsedParams.pathParams, queryParams: parsedParams.queryParams };
}

interface RawEntry {
  path: string;
  method: HttpMethod;
  op: OpenApiOperation;
  params: OpenApiParameter[];
  body: ReturnType<typeof pickBody>;
  category: string;
  base: string;
}

function collectOperations(
  doc: OpenApiDocument,
  components: Record<string, JsonSchema>,
): { entries: RawEntry[]; baseCounts: Record<string, number> } {
  const entries: RawEntry[] = [];
  const baseCounts: Record<string, number> = {};
  for (const path in doc.paths) {
    const item = doc.paths[path]!;
    const sharedParams = item.parameters ?? [];
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      const params = [...sharedParams, ...(op.parameters ?? [])];
      const body = pickBody(op, components);
      const { category, base } = nameParts(op, path, method);
      baseCounts[base] = (baseCounts[base] ?? 0) + 1;
      entries.push({ path, method, op, params, body, category, base });
    }
  }
  return { entries, baseCounts };
}

function buildTools(
  entries: RawEntry[],
  baseCounts: Record<string, number>,
  components: Record<string, JsonSchema>,
  nameMax: number,
): MealieTool[] {
  const tools: MealieTool[] = [];
  const usedNames = new Set<string>();
  const defsCache = new Map<string, JsonSchema>();
  for (const entry of entries) {
    const rawName = clampName(buildName(entry.category, entry.base, baseCounts[entry.base] > 1), nameMax);
    let name = rawName;
    for (let i = 2; usedNames.has(name); i++) {
      const suffix = `_${i}`;
      name = `${clampName(rawName, nameMax - suffix.length)}${suffix}`;
    }
    usedNames.add(name);

    const { inputSchema, pathParams, queryParams } = buildInputSchema(
      entry.op,
      entry.params,
      entry.body,
      components,
      defsCache,
    );

    tools.push({
      name,
      description: buildDescription(entry.op, entry.path, entry.method),
      inputSchema,
      category: entry.category,
      method: entry.method,
      path: entry.path,
      pathParams,
      queryParams,
      body: entry.body
        ? { kind: entry.body.kind, required: entry.body.required, fileFields: entry.body.fileFields }
        : undefined,
      deprecated: Boolean(entry.op.deprecated),
    });
  }

  return tools;
}

/** Generate one MealieTool per operation in the OpenAPI document. */
export function generateTools(doc: OpenApiDocument, nameMax: number = DEFAULT_TOOL_NAME_MAX): MealieTool[] {
  const components = doc.components?.schemas ?? {};

  // First pass: collect operations and count how often each base name occurs,
  // so we only prepend the category to names that would otherwise collide.
  const { entries, baseCounts } = collectOperations(doc, components);

  // Second pass: build tools with finalized, unique names.
  return buildTools(entries, baseCounts, components, nameMax);
}

type FilterCondition = { exact: string; prefix: string };

/**
 * ⚡ Bolt: Precomputing the exact lowercase and prefix match strings avoids
 * repeatedly calling `toLowerCase()` and allocating template strings for
 * every filter rule against every generated tool during initialization.
 */
function buildConditions(entries: string[]): FilterCondition[] {
  return entries.map((e) => {
    const exact = e.toLowerCase();
    return { exact, prefix: `${exact}_` };
  });
}

function matches(tool: MealieTool, conditions: FilterCondition[]): boolean {
  for (const c of conditions) {
    if (
      tool.name === c.exact ||
      tool.name.startsWith(c.prefix) ||
      tool.category === c.exact ||
      tool.category.startsWith(c.prefix)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Endpoints with essentially no use to an LLM client: account flows the MCP
 * credential already replaces or that need a browser/email, a healthcheck text
 * route, SSE stream duplicates of plain JSON endpoints, and opaque binary
 * downloads the client can only summarize.
 * (The `Users: Authentication` category is intentionally kept — the server can
 * authenticate via OAuth, so those routes are relevant.)
 */
export const DEFAULT_EXCLUDE: string[] = [
  "users_passwords", // forgot_password / reset_password (email-link flow)
  "register_new_user", // public signup
  "get_validation_text", // /api/media/docker/validate.txt healthcheck
  "create_recipe_from_html_or_json_stream", // SSE duplicate of create_recipe_from_html_or_json
  "parse_recipe_url_stream", // SSE duplicate of parse_recipe_url
  "get_exported_data", // zip export (opaque bytes)
  "get_exported_data_token", // zip download (opaque bytes)
  "get_shared_recipe_as_zip", // zip download (opaque bytes)
  "download_file", // /api/utils/download (opaque bytes)
];

/**
 * Admin / server-ops endpoints (backups, maintenance, multi-tenant user/group/
 * household management, debug, email config, AI providers). Powerful, rarely
 * what a recipe assistant needs, and a security footgun, so they are never
 * exposed. Matches every `Admin: *` category slug.
 */
export const ADMIN_EXCLUDE: string[] = ["admin"];

/**
 * Tools that are *never* exposed, regardless of user config. This is the safe
 * baseline: users can narrow further via MEALIE_TOOLS / MEALIE_EXCLUDE_TOOLS,
 * but cannot re-enable anything listed here.
 */
export const HARD_EXCLUDE: string[] = [...DEFAULT_EXCLUDE, ...ADMIN_EXCLUDE];

/** Apply the hard-exclude baseline, then read-only / include / exclude filters from config. */
export function filterTools(tools: MealieTool[], config: Config): MealieTool[] {
  // Baseline trim is unconditional and applied first so user filters can only
  // ever subtract from it, never add a hard-excluded tool back.
  const hardExcludeConditions = buildConditions(HARD_EXCLUDE);
  let result = tools.filter((t) => !matches(t, hardExcludeConditions));

  if (config.readOnly) result = result.filter((t) => t.method === "get");

  if (config.include.length > 0) {
    const includeConditions = buildConditions(config.include);
    result = result.filter((t) => matches(t, includeConditions));
  }

  if (config.exclude.length > 0) {
    const excludeConditions = buildConditions(config.exclude);
    result = result.filter((t) => !matches(t, excludeConditions));
  }

  return result;
}
