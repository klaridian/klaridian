// packages/cli/src/curation/curation.ts
//
// Tool curation (ARCHITECTURE.md section 24): user-chosen filtering of which
// OpenAPI operations become MCP tools, decided at generation time. This is
// deliberately NOT LLM-suggested and NOT usage-data-gated — the user picks
// tags/operations to include or exclude, full stop. Addresses the strongest
// validated pain point in the MCP ecosystem (tool bloat/context overload,
// see docs/research/2026-08-30-developer-pain-points.md) at the one point
// klaridian actually controls: which operations exist as tools in the first
// place, before the server is ever generated.
//
// Mechanism: pre-process the parsed OpenAPI document, setting `x-mcp: false`
// on every operation the user chose to exclude, then hand the modified
// document to openapi-mcp-generator's generateMcpServer() — which already
// respects that extension natively (confirmed with a real generated-output
// test, see section 24). No fork, no patch to openapi-mcp-generator itself.

import type { OpenAPIV3 } from "openapi-types";
import { getToolsFromOpenApi, type McpToolDefinition } from "openapi-mcp-generator";

export interface CurationChoice {
  /** Tags to include; if non-empty, only operations with at least one of these tags survive (before excludeTags/excludeOperationIds are applied). */
  includeTags?: string[];
  /** Tags to exclude; operations with any of these tags are dropped. */
  excludeTags?: string[];
  /** Specific operationIds to exclude, regardless of tags. */
  excludeOperationIds?: string[];
  /**
   * Regex patterns (MCPFO-8): only operations whose path template matches at
   * least one pattern survive. Tag-independent — works on specs with zero
   * OpenAPI tags (e.g. Stripe's public spec, ARCHITECTURE.md section 34),
   * since real-world APIs are almost always structured by path even when
   * untagged (e.g. every Stripe operation lives under /v1/<resource>/...).
   */
  includePathPatterns?: string[];
  /** Regex patterns; operations whose path template matches any are dropped. */
  excludePathPatterns?: string[];
  /** HTTP methods (case-insensitive, e.g. "GET"); if non-empty, only operations using one of these methods survive. Tag-independent. */
  includeMethods?: string[];
  /** HTTP methods; operations using any of these methods are dropped. */
  excludeMethods?: string[];
}

export interface OperationSummary {
  operationId: string;
  tags: string[];
  method: string;
  path: string;
}

/**
 * Lists every operation in the spec (operationId + tags), for building an
 * interactive prompt or validating --include-tags/--exclude-tags input
 * against real tag names before generation.
 */
export async function listOperations(specPathOrUrl: string): Promise<OperationSummary[]> {
  const tools: McpToolDefinition[] = await getToolsFromOpenApi(specPathOrUrl, { dereference: true });
  return tools.map((t) => ({
    operationId: t.operationId,
    tags: t.tags ?? [],
    method: t.method,
    path: t.pathTemplate,
  }));
}

/** Every distinct tag across the spec's operations, sorted, plus a count of untagged operations. */
export function summarizeTags(operations: OperationSummary[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const op of operations) {
    const tags = op.tags.length > 0 ? op.tags : ["(untagged)"];
    for (const tag of tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }));
}

export class CurationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurationValidationError";
  }
}

/**
 * Validates a curation choice against the real tags/operationIds in the
 * spec — fails loudly (not silently ignoring a typo) if the user asked to
 * include/exclude a tag or operationId that doesn't exist in the spec,
 * per the project's "fail loudly, don't guess" rule (section 7/8) applied
 * to user input, not just OpenAPI parsing.
 */
export function validateCurationChoice(choice: CurationChoice, operations: OperationSummary[]): void {
  const knownTags = new Set(operations.flatMap((op) => op.tags));
  const knownOperationIds = new Set(operations.map((op) => op.operationId));

  for (const tag of [...(choice.includeTags ?? []), ...(choice.excludeTags ?? [])]) {
    if (!knownTags.has(tag)) {
      throw new CurationValidationError(
        `Unknown tag "${tag}" — this spec's operations use these tags: ${[...knownTags].sort().join(", ") || "(none — spec has no tagged operations)"}`
      );
    }
  }
  for (const operationId of choice.excludeOperationIds ?? []) {
    if (!knownOperationIds.has(operationId)) {
      throw new CurationValidationError(`Unknown operationId "${operationId}" — not found in this spec's operations.`);
    }
  }
  for (const pattern of [...(choice.includePathPatterns ?? []), ...(choice.excludePathPatterns ?? [])]) {
    try {
      new RegExp(pattern);
    } catch (err) {
      throw new CurationValidationError(
        `Invalid regex "${pattern}" in --include-paths/--exclude-paths: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  const knownMethods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
  for (const method of [...(choice.includeMethods ?? []), ...(choice.excludeMethods ?? [])]) {
    if (!knownMethods.has(method.toLowerCase())) {
      throw new CurationValidationError(
        `Unknown HTTP method "${method}" in --include-methods/--exclude-methods — expected one of: ${[...knownMethods].join(", ")}`
      );
    }
  }
}

/**
 * Applies a curation choice to a parsed OpenAPI document by setting
 * `x-mcp: false` on every excluded operation's method object — mutates a
 * clone of the input document (never the caller's original) and returns it.
 * `generateMcpServer()` respects this extension natively (validated with
 * real generated output, ARCHITECTURE.md section 24) — this function's job
 * is only to compute which operations get flagged, not to reimplement any
 * of openapi-mcp-generator's own filtering.
 */
export function applyCurationToSpec(doc: OpenAPIV3.Document, choice: CurationChoice): OpenAPIV3.Document {
  const cloned: OpenAPIV3.Document = JSON.parse(JSON.stringify(doc));
  const includeTags = choice.includeTags && choice.includeTags.length > 0 ? new Set(choice.includeTags) : undefined;
  const excludeTags = new Set(choice.excludeTags ?? []);
  const excludeOperationIds = new Set(choice.excludeOperationIds ?? []);
  const includePathRegexes = (choice.includePathPatterns ?? []).map((p) => new RegExp(p));
  const excludePathRegexes = (choice.excludePathPatterns ?? []).map((p) => new RegExp(p));
  const includeMethods = choice.includeMethods && choice.includeMethods.length > 0
    ? new Set(choice.includeMethods.map((m) => m.toLowerCase()))
    : undefined;
  const excludeMethods = new Set((choice.excludeMethods ?? []).map((m) => m.toLowerCase()));

  const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

  for (const [pathTemplate, pathItem] of Object.entries(cloned.paths ?? {})) {
    if (!pathItem) continue;
    for (const method of methods) {
      const operation = (pathItem as Record<string, OpenAPIV3.OperationObject | undefined>)[method];
      if (!operation) continue;

      const tags = operation.tags ?? [];
      const operationId = operation.operationId;

      let excluded = false;
      if (includeTags && !tags.some((t) => includeTags.has(t))) {
        excluded = true;
      }
      if (tags.some((t) => excludeTags.has(t))) {
        excluded = true;
      }
      if (operationId && excludeOperationIds.has(operationId)) {
        excluded = true;
      }
      // MCPFO-8: tag-independent structural filters — path pattern and HTTP
      // method — evaluated the same way as the tag/operationId filters above
      // (include narrows, exclude always wins), so they compose freely with
      // tag-based curation on specs that DO have tags, and work standalone
      // on specs that don't (e.g. Stripe's public spec, zero tags).
      if (includePathRegexes.length > 0 && !includePathRegexes.some((re) => re.test(pathTemplate))) {
        excluded = true;
      }
      if (excludePathRegexes.some((re) => re.test(pathTemplate))) {
        excluded = true;
      }
      if (includeMethods && !includeMethods.has(method)) {
        excluded = true;
      }
      if (excludeMethods.has(method)) {
        excluded = true;
      }

      if (excluded) {
        (operation as OpenAPIV3.OperationObject & { "x-mcp"?: boolean })["x-mcp"] = false;
      }
    }
  }

  return cloned;
}
