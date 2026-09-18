// packages/cli/src/emit/json-schema-dialect.ts
//
// Re-dialect a tool's input/output JSON Schema from JSON Schema draft-07 (what
// OpenAPI-3.x-derived schemas arrive as) to JSON Schema 2020-12 — the DEFAULT
// dialect for MCP schema definitions since MCP revision 2025-11-25 (SEP-1613),
// with SEP-2106 (2026-07-28) allowing any 2020-12 keyword on input/outputSchema.
// klaridian's tool DATA originates from `openapi-mcp-generator`'s
// `getToolsFromOpenApi({dereference:true})` (inputSchema) and klaridian's own
// `response-schema.ts` (outputSchema) — both OpenAPI-3.x-derived, so the realistic
// draft-07 → 2020-12 deltas are SMALL and bounded (MCPFO-91, ARCHITECTURE.md §89).
//
// What this normalizer does, and WHY only these transforms:
//
//   1. Boolean `exclusiveMinimum`/`exclusiveMaximum` → the 2020-12 NUMERIC form.
//      OpenAPI 3.0 (and JSON Schema draft-04) express an exclusive bound as a
//      boolean flag paired with `minimum`/`maximum` (`{minimum:0,
//      exclusiveMinimum:true}`); JSON Schema draft-06+ / 2020-12 make the keyword
//      a NUMBER (`{exclusiveMinimum:0}`). `openapi-mcp-generator` passes the
//      OpenAPI-3.0 boolean form straight through (verified: a 3.0 spec with
//      `exclusiveMinimum:true` yields `{minimum:0,exclusiveMinimum:true}` on the
//      tool inputSchema), so this is the one delta that actually occurs and must
//      be normalized or a strict 2020-12 validator rejects the boolean.
//        - `exclusiveMinimum:true` + numeric `minimum` → `exclusiveMinimum:<minimum>`, drop `minimum`.
//        - `exclusiveMinimum:false` → drop the flag (keep `minimum` as an inclusive bound).
//        - a boolean flag with no paired numeric bound → drop the flag (uncoercible; leave the schema valid).
//        - an already-numeric `exclusiveMinimum` → left untouched (already 2020-12).
//
//   2. `definitions` → `$defs` (and `#/definitions/…` `$ref` pointers rewritten
//      to `#/$defs/…`). draft-07 uses `definitions`; 2020-12 renames the reserved
//      keyword to `$defs`. After `{dereference:true}` no local defs normally
//      survive, so this is defensive — but cheap and correct if any do.
//
//   3. Declares the dialect explicitly with a ROOT-level
//      `$schema: "https://json-schema.org/draft/2020-12/schema"`. The MCP SDK
//      the generated server runs (`@modelcontextprotocol/server` 2.x) treats an
//      ABSENT `$schema` as 2020-12 and converts every advertised schema to
//      2020-12 on the wire (`JSON_SCHEMA_CONVERSION_TARGET = "draft-2020-12"`),
//      and it ACCEPTS an explicit 2020-12 `$schema` (its `declaredDialect`
//      allow-lists the 2020-12 URI). Declaring it makes the dialect self-describing
//      on the wire for both targets — matching what the TypeScript SDK already
//      emits from Zod (`z.toJSONSchema(..., {target:"draft-2020-12"})` stamps the
//      same `$schema`) — rather than relying on the "absent means 2020-12" default.
//
// NOT normalized (deliberately out of scope, per the ticket): OpenAPI-3.0
// `nullable:true` already arrives as a 2020-12-valid `type:[...,"null"]` array
// from the engine (verified), so no work is needed. Arbitrary 2020-12 composition
// keywords beyond what OpenAPI 3.x produces are not synthesized.

import type { JSONSchema7 } from "json-schema";

/** Canonical 2020-12 dialect URI (the form the MCP SDK allow-lists + Zod emits). */
export const JSON_SCHEMA_2020_12_URI = "https://json-schema.org/draft/2020-12/schema";

/** Object-valued subschema keywords whose value is itself a schema (or boolean schema). */
const SUBSCHEMA_KEYS = [
  "items",
  "additionalProperties",
  "unevaluatedProperties",
  "additionalItems",
  "contains",
  "propertyNames",
  "if",
  "then",
  "else",
  "not",
] as const;

/** Keywords whose value is a MAP of name → subschema. */
const SUBSCHEMA_MAP_KEYS = ["properties", "patternProperties", "$defs", "definitions"] as const;

/** Keywords whose value is an ARRAY of subschemas. */
const SUBSCHEMA_ARRAY_KEYS = ["allOf", "anyOf", "oneOf", "prefixItems"] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursively convert one schema NODE in place-free fashion (returns a new node). */
function convertNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convertNode);
  if (!isPlainObject(node)) return node;

  const out: Record<string, unknown> = { ...node };

  // (1) boolean exclusiveMinimum/exclusiveMaximum → numeric 2020-12 form.
  normalizeExclusiveBound(out, "exclusiveMinimum", "minimum");
  normalizeExclusiveBound(out, "exclusiveMaximum", "maximum");

  // (2) definitions → $defs, and rewrite $ref pointers into it.
  if ("definitions" in out && !("$defs" in out)) {
    out.$defs = out.definitions;
    delete out.definitions;
  }
  if (typeof out.$ref === "string" && out.$ref.startsWith("#/definitions/")) {
    out.$ref = out.$ref.replace(/^#\/definitions\//, "#/$defs/");
  }

  // Recurse into every subschema-bearing keyword.
  for (const key of SUBSCHEMA_KEYS) {
    if (key in out) out[key] = convertNode(out[key]);
  }
  for (const key of SUBSCHEMA_ARRAY_KEYS) {
    if (Array.isArray(out[key])) out[key] = (out[key] as unknown[]).map(convertNode);
  }
  for (const key of SUBSCHEMA_MAP_KEYS) {
    const map = out[key];
    if (isPlainObject(map)) {
      const next: Record<string, unknown> = {};
      for (const [name, sub] of Object.entries(map)) next[name] = convertNode(sub);
      out[key] = next;
    }
  }

  return out;
}

/** Turn a boolean exclusive bound + paired inclusive bound into the numeric 2020-12 form. */
function normalizeExclusiveBound(
  node: Record<string, unknown>,
  exclusiveKey: "exclusiveMinimum" | "exclusiveMaximum",
  boundKey: "minimum" | "maximum"
): void {
  const excl = node[exclusiveKey];
  if (typeof excl !== "boolean") return; // already numeric (2020-12) or absent.
  if (excl === true && typeof node[boundKey] === "number") {
    node[exclusiveKey] = node[boundKey];
    delete node[boundKey];
  } else {
    // exclusiveMinimum:false → the bound is inclusive: drop the flag, keep `minimum`.
    // boolean-true with no numeric pair → uncoercible: drop the flag to stay 2020-12-valid.
    delete node[exclusiveKey];
  }
}

/**
 * Re-dialect a tool's input/output JSON Schema to JSON Schema 2020-12.
 *
 * Boolean schemas (`true`/`false` — valid JSON Schema for "anything"/"nothing")
 * pass through unchanged: there is no object to re-dialect and `$schema` cannot
 * attach. Object schemas are deep-converted (see the module header) and stamped
 * with a root-level 2020-12 `$schema`.
 */
export function toJsonSchema2020(schema: JSONSchema7 | boolean): JSONSchema7 | boolean {
  if (typeof schema === "boolean") return schema;
  const converted = convertNode(schema) as Record<string, unknown>;
  // Root-level dialect declaration first (readability on the wire), then the
  // converted body; re-assign $schema last so any source-declared dialect is
  // overwritten with the canonical 2020-12 URI (that IS the re-dialecting).
  const result: Record<string, unknown> = { $schema: JSON_SCHEMA_2020_12_URI, ...converted };
  result.$schema = JSON_SCHEMA_2020_12_URI;
  return result as JSONSchema7;
}
