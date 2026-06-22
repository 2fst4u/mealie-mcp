import type { JsonSchema } from "./openapi-types.js";

const COMPONENT_REF = /^#\/components\/schemas\/(.+)$/;

/** Deep clone a JSON-compatible value. */
function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/**
 * Walk a schema node and collect every `#/components/schemas/<name>` it
 * references, transitively, by following into the referenced components.
 */
function collectRefs(
  node: unknown,
  components: Record<string, JsonSchema>,
  seen: Set<string>,
): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, components, seen);
    return;
  }
  if (!node || typeof node !== "object") return;

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "$ref" && typeof value === "string") {
      const match = COMPONENT_REF.exec(value);
      if (match) {
        const name = match[1];
        if (!seen.has(name)) {
          seen.add(name);
          if (components[name]) collectRefs(components[name], components, seen);
        }
      }
      continue;
    }
    collectRefs(value, components, seen);
  }
}

/** Rewrite `#/components/schemas/X` refs to local `#/$defs/X` refs (in place). */
function rewriteRefs(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) rewriteRefs(item);
    return;
  }
  if (!node || typeof node !== "object") return;

  const obj = node as Record<string, unknown>;
  if (typeof obj.$ref === "string") {
    const match = COMPONENT_REF.exec(obj.$ref);
    if (match) obj.$ref = `#/$defs/${match[1]}`;
  }
  for (const value of Object.values(obj)) rewriteRefs(value);
}

/**
 * Given a set of root schemas, build the `$defs` map containing the transitive
 * closure of component schemas they reference, with all refs rewritten to
 * `#/$defs/...`. Returns `undefined` when nothing is referenced.
 */
export function buildDefs(
  roots: Array<JsonSchema | undefined>,
  components: Record<string, JsonSchema>,
): Record<string, JsonSchema> | undefined {
  const seen = new Set<string>();
  for (const root of roots) {
    if (root) collectRefs(root, components, seen);
  }
  if (seen.size === 0) return undefined;

  const defs: Record<string, JsonSchema> = {};
  for (const name of seen) {
    const schema = components[name];
    if (!schema) continue;
    const copy = clone(schema);
    rewriteRefs(copy);
    defs[name] = copy;
  }
  return defs;
}

/** Clone a schema and rewrite its component refs to local `$defs` refs. */
export function localize(schema: JsonSchema | undefined): JsonSchema | undefined {
  if (!schema) return undefined;
  const copy = clone(schema);
  rewriteRefs(copy);
  return copy;
}
