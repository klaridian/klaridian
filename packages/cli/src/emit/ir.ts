// packages/cli/src/emit/ir.ts
//
// klaridian's OWN tool intermediate representation (ToolIR) and the single
// adapter that maps openapi-mcp-generator's `McpToolDefinition` onto it.
//
// Phase 0 of the IR-ownership plan (ARCHITECTURE.md §65/§70, MCPFO-71). The
// v1→v2 cutover (§49) already shrank openapi-mcp-generator's role to one
// function — `getToolsFromOpenApi()` (spec → tool DATA). The only remaining
// wide coupling was that every downstream emitter/consumer imported the
// third-party `McpToolDefinition` TYPE directly. This file makes ToolIR the
// type the rest of the codebase depends on, so `openapi-mcp-generator` becomes
// a pluggable frontend behind `mapMcpToolDefinitionToIR()` rather than a type
// welded across the emit/curation stack.
//
// ToolIR mirrors ONLY the fields klaridian actually consumes today (verified
// across emit-server / emit-tool / emit-client / emit-docs / emit-python /
// curation). It is a faithful capture of the current shape — no new fields, no
// outputSchema, no behavior change. New IR fields belong to later tickets
// (e.g. object-form x-mcp, summary-derived titles, outputSchema).

import type { JSONSchema7 } from "json-schema";
import type { OpenAPIV3 } from "openapi-types";

/**
 * Author-supplied MCP annotations from the `x-mcp` OpenAPI vendor extension,
 * in its OBJECT form (MCPFO-76). Each field is optional: an absent key means
 * "the author said nothing about this hint", and the emitter falls back to its
 * HTTP-method-derived default for that hint alone (not the whole annotation).
 *
 * Note `openapi-mcp-generator` reads `x-mcp` ONLY as a boolean include/exclude
 * flag (`shouldIncludeOperationForMcp`) and DISCARDS the object form entirely —
 * it never reaches `McpToolDefinition`. klaridian therefore recovers the object
 * from the raw spec (`extractXMcpByOperationId`) and threads it onto ToolIR.
 */
export interface XMcpAnnotations {
  /** Author's readOnly hint → `readOnlyHint`. */
  readOnly?: boolean;
  /** Author's destructive hint → `destructiveHint`. */
  destructive?: boolean;
  /** Author's open-world hint → `openWorldHint`. */
  openWorld?: boolean;
  /** `false` hides the operation from the tool surface. Missing = exposed. */
  expose?: boolean;
}

/** Coerce a JSON boolean or booleanish string ("true"/"1"/"yes"/"on" and the
 *  falsey equivalents) to a boolean; anything else → undefined. Mirrors the
 *  coercion `openapi-mcp-generator` applies to the boolean form, so the two
 *  agree on what "x-mcp: true" means. */
function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(v)) return true;
    if (["false", "0", "no", "off"].includes(v)) return false;
  }
  return undefined;
}

/**
 * Parse a raw `x-mcp` value (boolean, booleanish string, or object) into
 * `XMcpAnnotations`, or undefined when it carries nothing usable.
 *
 * - boolean / booleanish string → `{ expose }` (the back-compat shorthand;
 *   this is exactly what `openapi-mcp-generator` already honours for
 *   include/exclude, so we only need it to also drive `expose`).
 * - object → the recognised keys (`readOnly`/`destructive`/`openWorld`/`expose`),
 *   each coerced to boolean; unrecognised or non-boolean values are dropped.
 * - anything else → undefined.
 */
export function parseXMcp(raw: unknown): XMcpAnnotations | undefined {
  if (raw === undefined || raw === null) return undefined;

  const asBool = coerceBoolean(raw);
  if (asBool !== undefined) return { expose: asBool };

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const result: XMcpAnnotations = {};
    const readOnly = coerceBoolean(obj.readOnly);
    const destructive = coerceBoolean(obj.destructive);
    const openWorld = coerceBoolean(obj.openWorld);
    const expose = coerceBoolean(obj.expose);
    if (readOnly !== undefined) result.readOnly = readOnly;
    if (destructive !== undefined) result.destructive = destructive;
    if (openWorld !== undefined) result.openWorld = openWorld;
    if (expose !== undefined) result.expose = expose;
    return Object.keys(result).length > 0 ? result : undefined;
  }

  return undefined;
}

/**
 * Walk a parsed OpenAPI document and collect the OBJECT-form `x-mcp`
 * annotations keyed by operationId. Only the object form carries rich hints
 * worth recovering; the boolean/string form is pure include/exclude and is
 * left entirely to openapi-mcp-generator. Only operation-level `x-mcp` is read.
 * Operations without an operationId or without an object `x-mcp` are omitted —
 * a caller looking one up gets undefined and keeps the method-derived defaults.
 */
export function extractXMcpByOperationId(
  doc: OpenAPIV3.Document
): Map<string, XMcpAnnotations> {
  const map = new Map<string, XMcpAnnotations>();
  const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
  for (const pathItem of Object.values(doc.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of methods) {
      const op = (pathItem as Record<string, OpenAPIV3.OperationObject | undefined>)[method];
      if (!op || typeof op !== "object") continue;
      const operationId = op.operationId;
      if (!operationId) continue;
      const raw = (op as Record<string, unknown>)["x-mcp"];
      // Object form only. Boolean/string x-mcp is include/exclude, handled
      // upstream — recovering it here would gain nothing and muddy the map.
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const parsed = parseXMcp(raw);
      if (parsed) map.set(operationId, parsed);
    }
  }
  return map;
}

/**
 * Return a deep clone of the document with every OBJECT-form operation-level
 * `x-mcp` rewritten to its boolean `expose` value (`expose ?? true`).
 *
 * Why: openapi-mcp-generator reads `x-mcp` only as a boolean and emits a
 * `console.warn` for every object it sees (the "~60 fallback warnings" noise in
 * MCPFO-76), then falls back to include. Rewriting the object to the boolean it
 * already means BEFORE the engine parses the spec removes the warnings AND lets
 * the engine own exclusion uniformly: `expose: false` → `x-mcp: false` →
 * excluded natively, exactly like a boolean `x-mcp: false` or a curation
 * exclusion. The rich hints are recovered separately from the pre-normalized
 * document via `extractXMcpByOperationId`, so nothing is lost. Boolean/string
 * `x-mcp` values are left untouched (the engine already handles them silently).
 */
export function normalizeXMcpObjectsToExpose(doc: OpenAPIV3.Document): OpenAPIV3.Document {
  const cloned: OpenAPIV3.Document = JSON.parse(JSON.stringify(doc));
  const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
  for (const pathItem of Object.values(cloned.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of methods) {
      const op = (pathItem as Record<string, OpenAPIV3.OperationObject | undefined>)[method];
      if (!op || typeof op !== "object") continue;
      const holder = op as Record<string, unknown>;
      const raw = holder["x-mcp"];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const parsed = parseXMcp(raw);
      holder["x-mcp"] = parsed?.expose ?? true;
    }
  }
  return cloned;
}

/** A single parameter's name and location (query/header/path), as consumed by
 *  the emitters to build the upstream HTTP request. */
export interface ToolIRExecutionParameter {
  name: string;
  in: string;
}

/**
 * klaridian's own per-tool IR. The rest of the codebase imports THIS, never
 * `McpToolDefinition` from openapi-mcp-generator.
 *
 * Field provenance (all currently sourced from `getToolsFromOpenApi()`):
 *   - name, description, method, pathTemplate, inputSchema, executionParameters,
 *     requestBodyContentType, securityRequirements, operationId, tags, deprecated
 *     come straight from `McpToolDefinition`.
 *   - `summary` is NOT on `McpToolDefinition`; `titleForTool()` already reads it
 *     optionally (falling back to operationId), so it is undefined today. It is
 *     declared here to capture the shape the code already expects — the adapter
 *     maps it faithfully (undefined in, undefined out), preserving behavior. A
 *     future ticket (MCPFO-77) can populate it from the OpenAPI summary.
 */
export interface ToolIR {
  /** Unique tool name (already de-duplicated/sanitized upstream). */
  name: string;
  /** Human-readable tool description. */
  description: string;
  /** HTTP method for the operation (get, post, ...). */
  method: string;
  /** URL path template with `{param}` placeholders. */
  pathTemplate: string;
  /** JSON Schema for the tool's input parameters (or a boolean schema). */
  inputSchema: JSONSchema7 | boolean;
  /** Parameter names + locations used to assemble the upstream request. */
  executionParameters: ToolIRExecutionParameter[];
  /** Request body content type, when the operation takes a body. */
  requestBodyContentType?: string;
  /** Security requirements for the operation (drives Bearer wiring). */
  securityRequirements: OpenAPIV3.SecurityRequirementObject[];
  /** Original OpenAPI operationId. */
  operationId: string;
  /** OpenAPI tags for this operation, if any (used by curation). */
  tags?: string[];
  /** Whether the operation is marked deprecated in the spec (docs surface it). */
  deprecated?: boolean;
  /** OpenAPI operation summary, if present. Undefined today; reserved for
   *  summary-derived tool titles (MCPFO-77). */
  summary?: string;
  /** Author-supplied object-form `x-mcp` annotations (MCPFO-76), recovered
   *  from the raw spec since openapi-mcp-generator discards them. Undefined
   *  when the operation carries no usable `x-mcp` — the emitter then uses its
   *  method-derived annotation defaults. */
  xMcp?: XMcpAnnotations;
}

/**
 * The single adapter seam. Maps one `McpToolDefinition` (openapi-mcp-generator's
 * type) onto klaridian's ToolIR. Structural — it copies the fields ToolIR
 * declares and nothing else, so swapping the frontend engine later means
 * replacing only this function (and the call site that invokes the engine).
 *
 * Kept structural on the input (`McpToolDefinitionLike`) so `emit/ir.ts` carries
 * no import from `openapi-mcp-generator` at all. The "breaks loudly if upstream
 * renames a consumed field" guarantee still holds — it lives at the CALL SITES
 * (`commands/generate.ts`, `curation/curation.ts`), which pass the real
 * `McpToolDefinition[]` into this mapper, so tsc checks assignability of the
 * real type against `McpToolDefinitionLike` there.
 */
export function mapMcpToolDefinitionToIR(
  tool: McpToolDefinitionLike,
  xMcp?: XMcpAnnotations
): ToolIR {
  return {
    name: tool.name,
    description: tool.description,
    method: tool.method,
    pathTemplate: tool.pathTemplate,
    inputSchema: tool.inputSchema,
    executionParameters: (tool.executionParameters ?? []).map((p) => ({
      name: p.name,
      in: p.in,
    })),
    requestBodyContentType: tool.requestBodyContentType,
    securityRequirements: tool.securityRequirements ?? [],
    operationId: tool.operationId,
    tags: tool.tags,
    deprecated: tool.deprecated,
    // Not present on McpToolDefinition today; captured for faithful shape.
    summary: (tool as { summary?: string }).summary,
    xMcp,
  };
}

/**
 * The subset of `McpToolDefinition`'s shape the adapter reads. Declared
 * structurally (not imported as the concrete type) so `emit/ir.ts` carries no
 * value/type import from `openapi-mcp-generator` — the coupling lives at the
 * single call site in `commands/generate.ts`, which passes the real type in.
 */
export interface McpToolDefinitionLike {
  name: string;
  description: string;
  method: string;
  pathTemplate: string;
  inputSchema: JSONSchema7 | boolean;
  executionParameters?: ToolIRExecutionParameter[];
  requestBodyContentType?: string;
  securityRequirements?: OpenAPIV3.SecurityRequirementObject[];
  operationId: string;
  tags?: string[];
  deprecated?: boolean;
}
