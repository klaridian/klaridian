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
export function mapMcpToolDefinitionToIR(tool: McpToolDefinitionLike): ToolIR {
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
