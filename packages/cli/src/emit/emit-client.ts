// packages/cli/src/emit/emit-client.ts
//
// Emits a typed TypeScript API client module from openapi-mcp-generator's
// tool DATA (McpToolDefinition[]) — one exported async function per OpenAPI
// operation, each backed by a Zod schema for runtime input validation and
// `z.infer` for compile-time types. This is the typed-client half of
// MCPFO-29 / MCPFO-26's SDK code mode architecture (ARCHITECTURE.md section
// 43): the code-mode `execute_code` tool (MCPFO-30) runs model-written
// TypeScript against this module inside a sandboxed Deno subprocess, instead
// of exposing one MCP tool per operation (the existing emit-tool.ts path).
//
// Reuses the exact same tool DATA and HTTP-call-building shape as
// emit-tool.ts's 1:1 MCP-tool emission (path/query/header params, JSON body,
// Bearer auth) — the two emitters differ only in what they wrap the HTTP
// call in: an MCP `server.registerTool` handler (emit-tool.ts) vs. a plain
// importable async function (this file). Function names are derived from
// operationId, sanitized to valid JS identifiers, and deduplicated.
//
// Response bodies are intentionally typed as `unknown` — openapi-mcp-
// generator's McpToolDefinition carries only the request-side inputSchema,
// not per-operation OpenAPI response schemas, so there is no typed output to
// map yet. Documented here rather than silently pretended away; mapping
// response schemas is future scope, not blocking MCPFO-29.

import type { McpToolDefinition } from "openapi-mcp-generator";
import { jsonSchemaToZod } from "json-schema-to-zod";

/**
 * Converts an operationId (or tool name) into a valid, camelCase-preserving
 * JS identifier: non-identifier characters become `_`, and a leading digit
 * gets a `_` prefix (identifiers can't start with a digit).
 */
export function sanitizeFunctionName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_$]+/g, "_").replace(/^([0-9])/, "_$1");
  return cleaned || "operation";
}

/**
 * Deduplicates function names by appending a numeric suffix to repeats.
 * Deterministic: the same input order always yields the same output, so
 * generated output is stable across runs (matches the project's existing
 * tool-name collision handling in openapi-mcp-generator's own
 * `shortenToolName`/`truncateToolName`, applied here at the identifier
 * level instead of the MCP-tool-name level).
 */
export function dedupeFunctionNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}_${count}`;
  });
}

/** Capitalizes the first character (used to derive a TS type name from a function name). */
function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function emitFunctionBody(tool: McpToolDefinition, inputTypeName: string): string {
  const params = (tool.executionParameters ?? []) as Array<{ name: string; in: string }>;
  const pathParams = params.filter((p) => p.in === "path");
  const queryParams = params.filter((p) => p.in === "query");
  const headerParams = params.filter((p) => p.in === "header");
  const hasBody = Boolean(tool.requestBodyContentType);
  const hasAuth = Array.isArray(tool.securityRequirements) && tool.securityRequirements.length > 0;
  const method = (tool.method || "get").toUpperCase();

  const lines: string[] = [];
  lines.push(`  const parsed = ${inputTypeName}Schema.parse(args) as ${inputTypeName};`);
  lines.push(`  const base = process.env.KLARIDIAN_BASE_URL;`);
  lines.push(`  if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");`);
  lines.push(`  let path = ${JSON.stringify(tool.pathTemplate)};`);
  for (const p of pathParams) {
    lines.push(
      `  path = path.replace(${JSON.stringify("{" + p.name + "}")}, encodeURIComponent(String((parsed as Record<string, unknown>)[${JSON.stringify(p.name)}])));`
    );
  }
  lines.push(`  const url = new URL(base.replace(/\\/$/, "") + path);`);
  for (const p of queryParams) {
    lines.push(
      `  if ((parsed as Record<string, unknown>)[${JSON.stringify(p.name)}] !== undefined) url.searchParams.set(${JSON.stringify(p.name)}, String((parsed as Record<string, unknown>)[${JSON.stringify(p.name)}]));`
    );
  }
  lines.push(`  const headers: Record<string, string> = {};`);
  for (const p of headerParams) {
    lines.push(
      `  if ((parsed as Record<string, unknown>)[${JSON.stringify(p.name)}] !== undefined) headers[${JSON.stringify(p.name)}] = String((parsed as Record<string, unknown>)[${JSON.stringify(p.name)}]);`
    );
  }
  if (hasAuth) {
    lines.push(
      `  if (process.env.KLARIDIAN_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.KLARIDIAN_AUTH_TOKEN;`
    );
  }
  if (hasBody) {
    lines.push(`  headers["Content-Type"] = ${JSON.stringify(tool.requestBodyContentType)};`);
  }
  lines.push(`  const resp = await fetch(url, {`);
  lines.push(`    method: ${JSON.stringify(method)},`);
  lines.push(`    headers,`);
  if (hasBody) {
    lines.push(
      `    body: (parsed as Record<string, unknown>).requestBody !== undefined ? JSON.stringify((parsed as Record<string, unknown>).requestBody) : undefined,`
    );
  }
  lines.push(`  });`);
  lines.push(`  const text = await resp.text();`);
  lines.push(`  let data: unknown = text;`);
  lines.push(`  try { data = text ? JSON.parse(text) : undefined; } catch { /* non-JSON response body, keep as text */ }`);
  lines.push(`  if (!resp.ok) throw new ApiError(resp.status, resp.statusText, data);`);
  lines.push(`  return { status: resp.status, data };`);
  return lines.join("\n");
}

/**
 * Emits the full typed client module source for a set of tools. `tools`
 * should come straight from `getToolsFromOpenApi()` (the same call site
 * curation.ts and emit-server.ts already use) — this function does not
 * re-parse or re-filter anything; curation (MCPFO-8/9) already decided
 * which operations survive before this is called.
 */
export function emitClientModule(tools: McpToolDefinition[]): string {
  const functionNames = dedupeFunctionNames(tools.map((t) => sanitizeFunctionName(t.operationId || t.name)));

  const blocks = tools.map((tool, i) => {
    const fnName = functionNames[i];
    const inputTypeName = `${capitalize(fnName)}Input`;
    const schemaSrc = jsonSchemaToZod(tool.inputSchema ?? { type: "object", properties: {} });
    const doc = (tool.description ?? "").trim();
    const docComment = doc ? `/**\n * ${doc.replace(/\*\//g, "*\\/").replace(/\n/g, "\n * ")}\n */\n` : "";
    return `${docComment}export const ${inputTypeName}Schema = ${schemaSrc};
export type ${inputTypeName} = z.infer<typeof ${inputTypeName}Schema>;

export async function ${fnName}(args: ${inputTypeName}): Promise<ApiResult> {
${emitFunctionBody(tool, inputTypeName)}
}`;
  });

  const namespaceEntries = functionNames.map((name) => `  ${name},`).join("\n");

  return `// Generated by klaridian — typed API client (SDK code mode, MCPFO-29).
// One function per OpenAPI operation. Runtime input validation via Zod;
// response bodies are returned as \`unknown\` (OpenAPI response schemas are
// not currently mapped to TS types — see ARCHITECTURE.md section 43).
// Do not edit directly; regenerate with \`klaridian generate\`.

import { z } from "zod";

/** Thrown when the upstream API responds with a non-2xx status. */
export class ApiError extends Error {
  status: number;
  statusText: string;
  body: unknown;
  constructor(status: number, statusText: string, body: unknown) {
    super(\`API request failed: \${status} \${statusText}\`);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

export interface ApiResult {
  status: number;
  data: unknown;
}

${blocks.join("\n\n")}

/** Convenience namespace grouping every generated operation function, for code-mode's execute_code sandbox to import as a single object. */
export const client = {
${namespaceEntries}
};
`;
}
