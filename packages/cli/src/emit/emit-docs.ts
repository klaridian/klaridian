// packages/cli/src/emit/emit-docs.ts
//
// Emits the `search_docs` MCP tool (MCPFO-31) for SDK code mode
// (ARCHITECTURE.md sections 43/44/47): lets the model look up how to call a
// generated client function (emit-client.ts, MCPFO-29) before writing
// execute_code (MCPFO-30) code against it — this is what let Stainless's
// eval model self-correct in ~4 turns instead of guessing blindly (section
// 43's evidence review).
//
// Real, explicitly-scoped-out problem this file addresses: OpenAPI specs in
// the wild frequently have sparse or missing operation descriptions (unlike
// the fully-documented Petstore fixture used elsewhere in this repo's
// tests). Two options were considered for what search_docs shows when a
// description is missing: (a) a purely structural fallback built from the
// spec's own shape (method, path, parameter names/types, schema) — no LLM,
// deterministic, free; (b) LLM-assisted doc synthesis at generation time.
// Per direct instruction, this file implements ONLY (a) for now — consistent
// with curation.ts's prior rejection of LLM involvement at generation time
// (ARCHITECTURE.md section 24/PLAN.md section 10: "the user explicitly
// rejected LLM-suggested curation ... in favor of user-chosen[/structural]
// mechanism"). Option (b) is deliberately NOT built here; flagged as a
// distinct future decision, not folded into this ticket's "done" scope —
// see ARCHITECTURE.md section 47 for the parking-lot note.

import type { McpToolDefinition } from "openapi-mcp-generator";

export interface OperationDoc {
  /** The generated client function name (matches emit-client.ts's naming). */
  functionName: string;
  method: string;
  path: string;
  /** True when built from the spec's own description; false when structurally synthesized (no description was present). */
  hasRealDescription: boolean;
  /** Markdown doc text: the real description, or the structural fallback. */
  doc: string;
}

interface JsonSchemaLike {
  type?: string;
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  enum?: unknown[];
  description?: string;
}

/** Renders a short, one-line-per-field summary of a JSON Schema's top-level properties (no recursion into nested objects — enough to orient the model, not a full schema dump, which it can already see via the Zod type). */
function summarizeSchemaFields(schema: JsonSchemaLike | boolean | undefined): string {
  if (!schema || typeof schema === "boolean" || !schema.properties) return "";
  const required = new Set(schema.required ?? []);
  const lines = Object.entries(schema.properties).map(([name, prop]) => {
    const type = typeof prop === "object" ? prop.type ?? "any" : "any";
    const req = required.has(name) ? "required" : "optional";
    const enumSuffix = typeof prop === "object" && Array.isArray(prop.enum) ? ` (one of: ${prop.enum.join(", ")})` : "";
    return `  - \`${name}\` (${type}, ${req})${enumSuffix}`;
  });
  return lines.join("\n");
}

/**
 * Builds a structural fallback description from the operation's own shape
 * (method, path, parameters, request body schema) when the OpenAPI spec
 * provides no real `description`/`summary`. Deterministic, no network call,
 * no LLM — see this file's header for why that's the deliberate scope here.
 */
function buildStructuralFallback(tool: McpToolDefinition): string {
  const parts: string[] = [`${tool.method.toUpperCase()} ${tool.pathTemplate}`];
  const params = (tool.executionParameters ?? []) as Array<{ name: string; in: string }>;
  if (params.length > 0) {
    const byLocation = params.reduce<Record<string, string[]>>((acc, p) => {
      (acc[p.in] ??= []).push(p.name);
      return acc;
    }, {});
    for (const [loc, names] of Object.entries(byLocation)) {
      parts.push(`${loc} parameter(s): ${names.join(", ")}`);
    }
  }
  const bodyFields = summarizeSchemaFields(
    (tool.inputSchema as { properties?: { requestBody?: JsonSchemaLike } } | undefined)?.properties?.requestBody
  );
  if (bodyFields) {
    parts.push(`request body fields:\n${bodyFields}`);
  }
  if (tool.deprecated) parts.push("⚠️ deprecated");
  return parts.join(" — ");
}

/**
 * Builds one `OperationDoc` per tool. `functionNames` must be the exact,
 * already-deduplicated names `emit-client.ts` generated for the same
 * `tools` array (same order) — search_docs must point at real, importable
 * function names, not the raw OpenAPI operationId.
 */
export function buildOperationDocs(tools: McpToolDefinition[], functionNames: string[]): OperationDoc[] {
  return tools.map((tool, i) => {
    const description = (tool.description ?? "").trim();
    const hasRealDescription = description.length > 0;
    return {
      functionName: functionNames[i],
      method: tool.method.toUpperCase(),
      path: tool.pathTemplate,
      hasRealDescription,
      doc: hasRealDescription ? description : buildStructuralFallback(tool),
    };
  });
}

/**
 * Emits `src/docs-data.ts` — the generated project's static, vendored
 * per-operation documentation data that `search_docs` (emit-docs.ts's
 * `emitSearchDocsToolBlock`) searches over at runtime. Computed once at
 * generation time (not regenerated per request), consistent with every
 * other vendored-source artifact in this project (section 7).
 */
export function emitDocsDataModule(docs: OperationDoc[]): string {
  const entries = docs
    .map(
      (d) =>
        `  { functionName: ${JSON.stringify(d.functionName)}, method: ${JSON.stringify(d.method)}, path: ${JSON.stringify(
          d.path
        )}, hasRealDescription: ${d.hasRealDescription}, doc: ${JSON.stringify(d.doc)} },`
    )
    .join("\n");

  return `// Generated by klaridian — operation documentation data (SDK code mode, MCPFO-31).
// Structural fallback docs are synthesized from the OpenAPI spec's own shape
// (method/path/params/schema) when no real description was provided — no
// LLM involved, deterministic (ARCHITECTURE.md section 47).
// Do not edit directly; regenerate with \`klaridian generate\`.

export interface OperationDocEntry {
  functionName: string;
  method: string;
  path: string;
  hasRealDescription: boolean;
  doc: string;
}

export const operationDocs: OperationDocEntry[] = [
${entries}
];
`;
}

/**
 * Emits the `search_docs` MCP tool registration block, matching the same
 * `server.registerTool(...)` shape `emit-sandbox.ts` uses for `execute_code`
 * — the two tools together are SDK code mode's full surface (section 43).
 * Search is a simple case-insensitive substring match over function name,
 * path, and doc text — intentionally not a fuzzy/semantic search (no extra
 * runtime dependency, no embeddings, fully deterministic); revisit only if
 * real usage shows substring matching is insufficient for large specs.
 */
export function emitSearchDocsToolBlock(): string {
  return `  server.registerTool(
    "search_docs",
    {
      title: "Search Docs",
      description:
        "Searches the generated API client's operation documentation (function names, HTTP method/path, parameter shapes). " +
        "Use this before execute_code to find the right function and its input shape. Case-insensitive substring match; " +
        "an empty query returns every operation.",
      inputSchema: z.object({ query: z.string().optional().describe("Search text, e.g. a function name, resource, or keyword. Omit or pass an empty string to list every operation.") }),
      annotations: { title: "Search Docs", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const { operationDocs } = await import("./docs-data.js");
      const query = ((args as { query?: string }).query ?? "").trim().toLowerCase();
      const matches = query
        ? operationDocs.filter(
            (d) =>
              d.functionName.toLowerCase().includes(query) ||
              d.path.toLowerCase().includes(query) ||
              d.doc.toLowerCase().includes(query)
          )
        : operationDocs;
      if (matches.length === 0) {
        return { content: [{ type: "text" as const, text: \`No operations matched "\${query}". \${operationDocs.length} operation(s) total — try search_docs with an empty query to list them all.\` }], isError: false };
      }
      const text = matches
        .map((d) => \`### \${d.functionName}\\n\${d.method} \${d.path}\${d.hasRealDescription ? "" : " (structural summary — no description in the source spec)"}\\n\\n\${d.doc}\`)
        .join("\\n\\n---\\n\\n");
      return { content: [{ type: "text" as const, text }], isError: false };
    },
  );`;
}
