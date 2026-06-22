import type { Config } from "./config.js";
import { buildDefs, localize } from "./schema.js";
import {
  HTTP_METHODS,
  type HttpMethod,
  type JsonSchema,
  type OpenApiDocument,
  type OpenApiOperation,
  type OpenApiParameter,
} from "./openapi-types.js";

export type BodyKind = "json" | "urlencoded" | "multipart";

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
  return name
    .split("_")
    .filter((tok, i, arr) => tok.length > 0 && tok !== arr[i - 1])
    .join("_");
}

function buildName(op: OpenApiOperation, path: string, method: string): { name: string; category: string } {
  const category = slug(op.tags?.[0] ?? "misc");
  const fn = operationName(op.operationId, path, method);
  let name = dedupeTokens(`${category}_${fn}`.replace(/_+/g, "_"));
  if (name.length > 64) name = name.slice(0, 64).replace(/_+$/, "");
  return { name, category };
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
  if (typeof ref === "string") {
    const match = /^#\/components\/schemas\/(.+)$/.exec(ref);
    if (match && components[match[1]]) return components[match[1]];
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

function buildInputSchema(
  op: OpenApiOperation,
  params: OpenApiParameter[],
  body: ReturnType<typeof pickBody>,
  components: Record<string, JsonSchema>,
): { inputSchema: JsonSchema; pathParams: string[]; queryParams: Array<{ name: string; isArray: boolean }> } {
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

  const inputSchema: JsonSchema = { type: "object", properties };
  if (required.length > 0) inputSchema.required = required;
  inputSchema.additionalProperties = false;

  const defs = buildDefs(rootSchemas, components);
  if (defs) inputSchema.$defs = defs;

  return { inputSchema, pathParams, queryParams };
}

/** Generate one MealieTool per operation in the OpenAPI document. */
export function generateTools(doc: OpenApiDocument): MealieTool[] {
  const components = doc.components?.schemas ?? {};
  const tools: MealieTool[] = [];
  const usedNames = new Set<string>();

  for (const [path, item] of Object.entries(doc.paths)) {
    const sharedParams = item.parameters ?? [];
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;

      const params = [...sharedParams, ...(op.parameters ?? [])];
      const body = pickBody(op, components);
      const { name: rawName, category } = buildName(op, path, method);

      let name = rawName;
      for (let i = 2; usedNames.has(name); i++) {
        name = `${rawName.slice(0, 61)}_${i}`;
      }
      usedNames.add(name);

      const { inputSchema, pathParams, queryParams } = buildInputSchema(op, params, body, components);

      tools.push({
        name,
        description: buildDescription(op, path, method),
        inputSchema,
        category,
        method,
        path,
        pathParams,
        queryParams,
        body: body ? { kind: body.kind, required: body.required, fileFields: body.fileFields } : undefined,
        deprecated: Boolean(op.deprecated),
      });
    }
  }

  return tools;
}

function matches(tool: MealieTool, entry: string): boolean {
  const e = entry.toLowerCase();
  return (
    tool.name === e ||
    tool.name.startsWith(`${e}_`) ||
    tool.category === e ||
    tool.category.startsWith(`${e}_`)
  );
}

/** Apply read-only / include / exclude filters from config. */
export function filterTools(tools: MealieTool[], config: Config): MealieTool[] {
  let result = tools;
  if (config.readOnly) result = result.filter((t) => t.method === "get");
  if (config.include.length > 0) {
    result = result.filter((t) => config.include.some((e) => matches(t, e)));
  }
  if (config.exclude.length > 0) {
    result = result.filter((t) => !config.exclude.some((e) => matches(t, e)));
  }
  return result;
}
