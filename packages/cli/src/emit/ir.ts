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
import { toJsonSchema2020 } from "./json-schema-dialect.js";

/**
 * Author-supplied MCP annotations from klaridian's `x-klaridian` OpenAPI vendor
 * extension. Each field is optional: an absent key means "the author said
 * nothing about this hint", and the emitter falls back to its HTTP-method-derived
 * default for that hint alone (not the whole annotation).
 *
 * `x-klaridian` is klaridian's OWN extension (reverse-DNS-free `x-<vendor>` per
 * the OpenAPI spec-extension convention). The hint KEYS map 1:1 onto the MCP
 * protocol's own `ToolAnnotations` (`readOnlyHint`/`destructiveHint`/
 * `openWorldHint`) — standard MCP values under a klaridian-owned key. `expose`
 * controls whether the operation becomes a tool at all.
 *
 * Distinct from the boolean `x-mcp` include/exclude flag that `openapi-mcp-
 * generator` reads natively (and that `curation.ts` writes) — that stays as-is.
 * klaridian does not read annotation hints from `x-mcp`.
 */
export interface KlaridianAnnotations {
  /** Author's readOnly hint → `readOnlyHint`. */
  readOnly?: boolean;
  /** Author's destructive hint → `destructiveHint`. */
  destructive?: boolean;
  /** Author's open-world hint → `openWorldHint`. */
  openWorld?: boolean;
  /** `false` hides the operation from the tool surface. Missing = exposed. */
  expose?: boolean;
  /** Explicit human-readable tool title; top of the title precedence chain
   *  (`x-klaridian.title` → OpenAPI `summary` → humanized operationId). */
  title?: string;
}

/** The vendor-extension key klaridian reads for per-operation annotations. */
export const KLARIDIAN_EXTENSION = "x-klaridian";

/** Coerce a JSON boolean or booleanish string ("true"/"1"/"yes"/"on" and the
 *  falsey equivalents) to a boolean; anything else → undefined. */
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
 * Parse a raw `x-klaridian` value (an object) into `KlaridianAnnotations`, or
 * undefined when it carries nothing usable. Recognised keys (`readOnly`/
 * `destructive`/`openWorld`/`expose`) are each coerced to boolean; unrecognised
 * or non-boolean values are dropped. A non-object (or empty result) → undefined.
 */
export function parseKlaridianAnnotations(raw: unknown): KlaridianAnnotations | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const result: KlaridianAnnotations = {};
  const readOnly = coerceBoolean(obj.readOnly);
  const destructive = coerceBoolean(obj.destructive);
  const openWorld = coerceBoolean(obj.openWorld);
  const expose = coerceBoolean(obj.expose);
  if (readOnly !== undefined) result.readOnly = readOnly;
  if (destructive !== undefined) result.destructive = destructive;
  if (openWorld !== undefined) result.openWorld = openWorld;
  if (expose !== undefined) result.expose = expose;
  if (typeof obj.title === "string" && obj.title.trim()) result.title = obj.title.trim();
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Per-operation metadata klaridian recovers from the raw spec because the
 *  `openapi-mcp-generator` engine drops it: the OpenAPI `summary`, the
 *  `x-klaridian` annotations, and the operation's success response schema.
 *  All feed the emitter (title + tool hints + outputSchema). */
export interface OperationMeta {
  /** OpenAPI operation `summary`, if the author wrote one. */
  summary?: string;
  /** Parsed `x-klaridian` annotations, if present + usable. */
  klaridian?: KlaridianAnnotations;
  /** The operation's advertisable success response schema (MCPFO-33), recovered
   *  by klaridian's own extraction (`emit/response-schema.ts`) because the
   *  engine carries no response data at all. Present only when the success
   *  body is a JSON object (the gate that makes it a valid MCP `outputSchema`). */
  outputSchema?: JSONSchema7;
}

/**
 * Walk a parsed OpenAPI document and collect per-operation metadata keyed by
 * operationId: the `summary` and `x-klaridian` annotations. The engine
 * (`getToolsFromOpenApi`) carries neither onto `McpToolDefinition`, so klaridian
 * recovers them here and threads them onto ToolIR via the adapter. Operations
 * with no operationId, or with neither a summary nor a usable `x-klaridian`, are
 * omitted — a caller looking one up gets undefined and keeps the defaults.
 */
export function extractOperationMetaByOperationId(
  doc: OpenAPIV3.Document
): Map<string, OperationMeta> {
  const map = new Map<string, OperationMeta>();
  const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
  for (const pathItem of Object.values(doc.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of methods) {
      const op = (pathItem as Record<string, OpenAPIV3.OperationObject | undefined>)[method];
      if (!op || typeof op !== "object") continue;
      const operationId = op.operationId;
      if (!operationId) continue;
      const meta: OperationMeta = {};
      if (typeof op.summary === "string" && op.summary.trim()) meta.summary = op.summary.trim();
      const klaridian = parseKlaridianAnnotations((op as Record<string, unknown>)[KLARIDIAN_EXTENSION]);
      if (klaridian) meta.klaridian = klaridian;
      if (meta.summary || meta.klaridian) map.set(operationId, meta);
    }
  }
  return map;
}

/**
 * Return a deep clone of the document prepared for the openapi-mcp-generator
 * engine, doing two things per operation:
 *
 * 1. **Apply `x-klaridian.expose: false` as a native exclusion.** An operation
 *    the author hides is given `x-mcp: false` (the boolean include/exclude flag
 *    the engine reads natively — same mechanism `curation.ts` uses), so exclusion
 *    lives in exactly one place. `x-klaridian` remains on the operation but is
 *    inert to the engine (it ignores unknown `x-*` keys).
 * 2. **Silence the engine's object-`x-mcp` warning.** openapi-mcp-generator reads
 *    `x-mcp` only as a boolean and `console.warn`s once per operation on any
 *    object value. Some third-party specs carry an object `x-mcp`; rewrite any
 *    such object to its `expose` boolean (default true) so the engine stays
 *    quiet. klaridian does NOT read hints from `x-mcp` — only from `x-klaridian`.
 *
 * The rich hints are recovered separately from the ORIGINAL document via
 * `extractKlaridianByOperationId`, so nothing is lost here.
 */
export function prepareSpecForEngine(doc: OpenAPIV3.Document): OpenAPIV3.Document {
  const cloned: OpenAPIV3.Document = JSON.parse(JSON.stringify(doc));
  const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
  for (const pathItem of Object.values(cloned.paths ?? {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of methods) {
      const op = (pathItem as Record<string, OpenAPIV3.OperationObject | undefined>)[method];
      if (!op || typeof op !== "object") continue;
      const holder = op as Record<string, unknown>;

      // (1) x-klaridian.expose: false → engine-native exclusion via x-mcp:false.
      const klar = parseKlaridianAnnotations(holder[KLARIDIAN_EXTENSION]);
      if (klar?.expose === false) {
        holder["x-mcp"] = false;
      }

      // (2) Silence the engine's warning on a third-party object x-mcp: collapse
      // it to its boolean expose (default true) unless (1) already set it false.
      const xmcp = holder["x-mcp"];
      if (xmcp && typeof xmcp === "object" && !Array.isArray(xmcp)) {
        const exposeVal = coerceBoolean((xmcp as Record<string, unknown>).expose);
        holder["x-mcp"] = exposeVal ?? true;
      }
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
 * A resolved OpenAPI `securityScheme` DEFINITION for one of an operation's
 * security requirements (MCPFO-105, ARCHITECTURE.md §95). The `securityRequirements`
 * field carries only the scheme NAMES; this carries the actual `type`/`scheme`/
 * `in`/`name` that the emitters need to wire the CORRECT upstream auth per scheme
 * (apiKey header/query/cookie, http bearer/basic, oauth2/openIdConnect bearer).
 *
 * Only the fields klaridian's emitters consume are captured (a faithful subset
 * of `OpenAPIV3.SecuritySchemeObject`): `type` always; `in` + `name` for apiKey;
 * `scheme` for http. oauth2/openIdConnect need only `type` (the operator supplies
 * the token via env). Resolved by the engine from `components.securitySchemes`.
 */
export interface ToolIRSecurityScheme {
  /** The scheme kind: apiKey | http | oauth2 | openIdConnect | mutualTLS. */
  type: string;
  /** apiKey only: where the key travels — header | query | cookie. */
  in?: string;
  /** apiKey only: the header/query/cookie name to set. */
  name?: string;
  /** http only: the HTTP auth scheme — bearer | basic | ... */
  scheme?: string;
}

/**
 * klaridian's own per-tool IR. The rest of the codebase imports THIS, never
 * `McpToolDefinition` from openapi-mcp-generator.
 *
 * Field provenance:
 *   - name, description, method, pathTemplate, inputSchema, executionParameters,
 *     requestBodyContentType, securityRequirements, operationId, tags, deprecated
 *     come straight from `McpToolDefinition`.
 *   - `summary` and `klaridian` are recovered from the raw spec (the engine drops
 *     both) and threaded in via the adapter's `meta` arg — see
 *     `extractOperationMetaByOperationId`. `summary` feeds the tool title
 *     (MCPFO-77); `klaridian` feeds tool hints + title + expose (MCPFO-76).
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
  /** Resolved securityScheme DEFINITIONS (MCPFO-105) for the operation's
   *  security requirements — the actual type/scheme/in/name the emitters need
   *  to wire per-scheme upstream auth. De-duplicated, first-appearance order.
   *  Empty when the operation has no security or the engine resolved none.
   *  Optional in the type only so hand-built test fixtures need not set it; the
   *  adapter always populates it (`?? []`), so it is always present at runtime. */
  securitySchemes?: ToolIRSecurityScheme[];
  /** Original OpenAPI operationId. */
  operationId: string;
  /** OpenAPI tags for this operation, if any (used by curation). */
  tags?: string[];
  /** Whether the operation is marked deprecated in the spec (docs surface it). */
  deprecated?: boolean;
  /** OpenAPI operation summary, recovered from the raw spec. Top-but-one of the
   *  title precedence chain (after `klaridian.title`, before the operationId). */
  summary?: string;
  /** Author-supplied `x-klaridian` annotations (MCPFO-76). Undefined when the
   *  operation carries no usable `x-klaridian` — the emitter then uses its
   *  method-derived annotation defaults. */
  klaridian?: KlaridianAnnotations;
  /** The operation's success response schema (MCPFO-33), recovered from the raw
   *  spec by klaridian's own extraction (the engine carries no response data).
   *  Present only when the success body is a JSON object; the emitter advertises
   *  it as the tool's `outputSchema` and populates `structuredContent`. */
  outputSchema?: JSONSchema7;
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
  meta?: OperationMeta
): ToolIR {
  return {
    name: tool.name,
    description: tool.description,
    method: tool.method,
    pathTemplate: tool.pathTemplate,
    // inputSchema/outputSchema are re-dialected from JSON Schema draft-07 (what
    // OpenAPI-3.x-derived schemas arrive as) to JSON Schema 2020-12 — the MCP
    // default dialect since revision 2025-11-25 (SEP-1613/2106), MCPFO-91 / §89.
    // Doing it in the ONE adapter seam keeps every emitter + the golden contract
    // in lockstep and guarantees TS/Python parity for free.
    inputSchema: toJsonSchema2020(tool.inputSchema),
    executionParameters: (tool.executionParameters ?? []).map((p) => ({
      name: p.name,
      in: p.in,
    })),
    requestBodyContentType: tool.requestBodyContentType,
    securityRequirements: tool.securityRequirements ?? [],
    securitySchemes: tool.securitySchemes ?? [],
    operationId: tool.operationId,
    tags: tool.tags,
    deprecated: tool.deprecated,
    // Recovered from the raw spec (the engine drops all of these): the OpenAPI
    // summary feeds the tool title, x-klaridian feeds hints + title + expose,
    // and outputSchema (MCPFO-33) feeds the tool's outputSchema/structuredContent.
    summary: meta?.summary,
    klaridian: meta?.klaridian,
    outputSchema:
      meta?.outputSchema === undefined
        ? undefined
        : (toJsonSchema2020(meta.outputSchema) as JSONSchema7),
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
  securitySchemes?: ToolIRSecurityScheme[];
  operationId: string;
  tags?: string[];
  deprecated?: boolean;
}
