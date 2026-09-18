// packages/cli/src/emit/response-schema.ts
//
// klaridian-owned extraction of per-operation RESPONSE schemas from an OpenAPI
// document — the first piece of tool DATA klaridian derives itself instead of
// taking from `openapi-mcp-generator`. It is the deliberate embryo of the
// eventual `getToolsFromOwnEngine()` (ARCHITECTURE.md §65 Phase 2 / MCPFO-73):
// the concrete upstream limitation §65 named as the trigger for owning the
// engine is exactly this one — `openapi-mcp-generator`'s `McpToolDefinition`
// has NO `responses` field at all, so native `outputSchema`/`structuredContent`
// emission (MCPFO-33) is impossible without klaridian reading the spec itself.
//
// Scope is deliberately narrow: we keep the genuinely hard parts ($ref
// dereferencing + validation) in the mature `@apidevtools/swagger-parser`
// dependency (already used across generate.ts/curation.ts) and own ONLY the
// operation → response-schema mapping. openapi-mcp-generator still lists the
// tools; this augments each surviving tool's IR with its output schema.
//
// Design decision (MCPFO-33, faithful + defensive + gated): we advertise the
// spec's RICH, exact 2xx JSON schema, but ONLY when its resolved root is a JSON
// OBJECT. The MCP spec requires a tool `outputSchema` root to be `type: object`,
// and the TypeScript SDK VALIDATES a success result's `structuredContent`
// against it (a mismatch becomes a soft tool-error). Gating to object roots
// keeps the common, high-value case (a JSON object body) while never advertising
// a schema we can't faithfully honour (arrays, primitives, unions, empty/204,
// non-JSON) — those fall back to no outputSchema, i.e. today's text-only
// behaviour, rather than guessing.

import SwaggerParser from "@apidevtools/swagger-parser";
import type { JSONSchema7 } from "json-schema";
import type { OpenAPIV3 } from "openapi-types";

const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

/**
 * Is this resolved JSON Schema a plain OBJECT at its root? The gate for
 * advertising an outputSchema (see the module header). Accepts an explicit
 * `type: "object"`, a `type` array that includes `"object"`, or a schema that
 * declares `properties` without an explicit type (a common object shorthand).
 * Rejects arrays, primitives, and root-level unions (`oneOf`/`anyOf`/`allOf`),
 * which are ambiguous to honour faithfully — those fall back to no outputSchema.
 */
export function isObjectRootSchema(schema: unknown): schema is JSONSchema7 {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;
  const s = schema as Record<string, unknown>;
  // Root-level composition is ambiguous — don't advertise it as a plain object.
  if (s.oneOf || s.anyOf || s.allOf || s.not) return false;
  const type = s.type;
  if (type === "object") return true;
  if (Array.isArray(type) && type.includes("object")) return true;
  if (type === undefined && s.properties && typeof s.properties === "object") return true;
  return false;
}

/**
 * Deep-clone a resolved (dereferenced) schema, collapsing every REPEATED node —
 * whether a recursive `$ref` cycle or a shared-component DAG reference — to a
 * generic `{ type: "object" }` the first time it is re-encountered.
 * `SwaggerParser.dereference` resolves component `$ref`s into a real object GRAPH:
 * recursive schemas become circular (e.g. Stripe's `account` embeds itself;
 * ~474/594 Stripe success bodies are cyclic) and shared components become
 * multiply-referenced nodes. A naive deep walk of such a graph either overflows
 * the stack (cycles) or expands exponentially (diamond sharing) — Stripe's
 * account body alone blows up both the 2020-12 re-dialect step and canonical
 * serialization.
 *
 * A GLOBAL visited set (identity-based, never removed) makes this O(nodes) and
 * deterministic: the first traversal of each distinct object is expanded in
 * full; any later reference to that same object collapses to `{ type: "object" }`.
 * This mirrors — and extends to DAG sharing — `openapi-mcp-generator`'s own
 * cycle break in `mapOpenApiSchemaToJsonSchema` (a generic-object fallback), so a
 * klaridian-owned `outputSchema` is bounded symmetrically with the engine's
 * `inputSchema`. Because it is applied inside the engine-independent meta
 * pipeline, BOTH engines receive the identical transformed schema — parity is
 * unaffected. Acyclic, unshared schemas (the Phase-1 corpus) traverse each node
 * exactly once, so their output is byte-for-byte the prior full-clone result and
 * the committed goldens are unchanged.
 */
export function breakSchemaCycles(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (Array.isArray(value)) return value.map((v) => breakSchemaCycles(v, seen));
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  if (seen.has(obj)) return { type: "object" };
  seen.add(obj);
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(obj)) out[key] = breakSchemaCycles(v, seen);
  return out;
}

/**
 * Pick the response schema klaridian should advertise for one operation: the
 * `application/json` schema of its success response, preferring an explicit
 * `200`, then `201`, then any other `2xx`/`2XX`, then `default`. Returns the
 * resolved (dereferenced) object-root schema, or undefined when the operation
 * has no JSON success body, or its success body isn't a plain object.
 */
export function pickSuccessObjectSchema(
  responses: OpenAPIV3.ResponsesObject | undefined
): JSONSchema7 | undefined {
  if (!responses || typeof responses !== "object") return undefined;

  const codes = Object.keys(responses);
  const ordered: string[] = [];
  if (responses["200"]) ordered.push("200");
  if (responses["201"]) ordered.push("201");
  for (const c of codes) {
    if (c === "200" || c === "201") continue;
    if (/^2\d\d$/.test(c) || c === "2XX" || c === "2xx") ordered.push(c);
  }
  if (responses.default) ordered.push("default");

  for (const code of ordered) {
    const response = responses[code] as OpenAPIV3.ResponseObject | undefined;
    // Dereferenced by SwaggerParser.dereference upstream, so this is a real
    // ResponseObject, not a $ref. Guard defensively anyway.
    const content = response?.content;
    const json = content?.["application/json"];
    const schema = json?.schema as JSONSchema7 | undefined;
    if (schema && isObjectRootSchema(schema)) return schema;
  }
  return undefined;
}

/**
 * Walk an OpenAPI spec (by path — dereferenced here via swagger-parser) and
 * collect the advertisable output schema per operationId. Keyed by operationId
 * to match how the rest of the emit pipeline threads recovered per-operation
 * metadata onto ToolIR (see `extractOperationMetaByOperationId`).
 *
 * Fail-soft by design: if the spec can't be dereferenced (e.g. a circular
 * `$ref` swagger-parser refuses), we return an empty map — every tool falls
 * back to no outputSchema (today's behaviour). This is the ticket's stated
 * fallback ("no defined response schema → no outputSchema, rather than
 * guessing"), NOT a silent swallow of a generation-time contract: a missing
 * output schema is a legitimate, lossless outcome, unlike a broken server.
 */
export async function extractOutputSchemasByOperationId(
  specPath: string,
  allowExternalRefs = false
): Promise<Map<string, JSONSchema7>> {
  const map = new Map<string, JSONSchema7>();
  let doc: OpenAPIV3.Document;
  try {
    // Clone so we never mutate a spec another step also reads; dereference so
    // component `$ref`s in the response schemas are fully resolved.
    // MCPFO-106 (SSRF hardening, ARCHITECTURE.md §94): by default block remote
    // http(s) $ref FETCHES here too — this dereference runs BEFORE the own
    // engine in the generate pipeline, so it would otherwise be the first place
    // a malicious spec's remote $ref gets fetched. `resolve.http: false` only;
    // local-file $refs still resolve. A remote $ref makes dereference throw,
    // caught by the fail-soft path below (no outputSchema) — the own engine then
    // fails loudly with the actionable RemoteRefBlockedError.
    doc = (await SwaggerParser.dereference(
      specPath,
      allowExternalRefs
        ? { resolve: { http: { safeUrlResolver: false } } }
        : { resolve: { http: false } }
    )) as OpenAPIV3.Document;
  } catch {
    return map;
  }

  for (const pathItem of Object.values(doc.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of HTTP_METHODS) {
      const op = (pathItem as Record<string, OpenAPIV3.OperationObject | undefined>)[method];
      if (!op || typeof op !== "object") continue;
      const operationId = op.operationId;
      if (!operationId) continue;
      const schema = pickSuccessObjectSchema(op.responses);
      // Break recursive-$ref cycles (dereference produces circular object
      // graphs) so downstream deep walks — the 2020-12 re-dialect, canonical
      // serialization, SDK structured-content validation — never overflow. For
      // an acyclic schema this is a plain deep clone, so cycle-free specs
      // (including the Phase-1 corpus goldens) are byte-for-byte unchanged.
      if (schema) map.set(operationId, breakSchemaCycles(schema) as JSONSchema7);
    }
  }
  return map;
}
