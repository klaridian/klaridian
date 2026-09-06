// packages/cli/src/emit/emit-tool.ts
//
// Emits a single `server.registerTool(...)` block for the v2 MCP SDK
// (@modelcontextprotocol/server) from openapi-mcp-generator's pure tool DATA
// (getToolsFromOpenApi output). This is the "option d" path decided in
// ARCHITECTURE.md sections 37/38: klaridian emits the v2 tool surface itself
// instead of consuming the frozen v1 code generator. The upstream-fetch
// mapping below was validated end to end in spikes/021-sdk-v2-streamable-http
// (README-021d): path/query/header params, JSON body, and Bearer auth.

import type { McpToolDefinition } from "openapi-mcp-generator";
import { jsonSchemaToZod } from "json-schema-to-zod";
import { typescriptPluginDispatch } from "./plugin-dispatch/typescript.js";

/**
 * Maps an HTTP method to MCP tool annotations required by marketplace review
 * (Claude + ChatGPT) — see MCPFO-23 and docs/research/2026-09-02-mcp-
 * marketplaces-and-connector-requirements.md line 254 [verified].
 *
 * - readOnlyHint:    true for GET/HEAD (no state change).
 * - destructiveHint: true for DELETE and PUT (PUT fully replaces/overwrites a
 *                    resource). POST/PATCH default to false (create / partial
 *                    update) — we cannot statically prove a POST is destructive,
 *                    and over-flagging harms the author's tool UX.
 * - idempotentHint:  true for the idempotent HTTP methods GET/HEAD/PUT/DELETE;
 *                    false for POST/PATCH. Only meaningful when not read-only,
 *                    but emitted uniformly for clarity.
 * - openWorldHint:   always true — every generated tool proxies to an external
 *                    upstream HTTP API. OpenAI requires this hint.
 */
export function annotationsForMethod(method: string): {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
} {
  const m = (method || "get").toLowerCase();
  const readOnly = m === "get" || m === "head";
  const idempotent = m === "get" || m === "head" || m === "put" || m === "delete";
  const destructive = m === "delete" || m === "put";
  return {
    readOnlyHint: readOnly,
    destructiveHint: destructive,
    idempotentHint: idempotent,
    openWorldHint: true,
  };
}

/**
 * Human-readable tool title required by both marketplaces. Prefers an explicit
 * OpenAPI summary; otherwise humanizes the operation name (camelCase and
 * snake_case → "Title Case Words").
 */
export function titleForTool(tool: { name: string; operationId?: string; summary?: string }): string {
  const summary = (tool.summary ?? "").trim();
  if (summary) return summary;
  const raw = tool.operationId || tool.name || "";
  const words = raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Emits the handler body that proxies to the upstream HTTP API. */
function emitHandlerBody(tool: McpToolDefinition): string {
  const params = (tool.executionParameters ?? []) as Array<{ name: string; in: string }>;
  const pathParams = params.filter((p) => p.in === "path");
  const queryParams = params.filter((p) => p.in === "query");
  const headerParams = params.filter((p) => p.in === "header");
  const hasBody = Boolean(tool.requestBodyContentType);
  const hasAuth = Array.isArray(tool.securityRequirements) && tool.securityRequirements.length > 0;
  const method = (tool.method || "get").toUpperCase();

  const lines: string[] = [];
  lines.push(`      const base = process.env.KLARIDIAN_BASE_URL;`);
  lines.push(`      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");`);
  lines.push(`      let path = ${JSON.stringify(tool.pathTemplate)};`);
  for (const p of pathParams) {
    lines.push(
      `      path = path.replace(${JSON.stringify("{" + p.name + "}")}, encodeURIComponent(String(args[${JSON.stringify(p.name)}])));`
    );
  }
  lines.push(`      const url = new URL(base.replace(/\\/$/, "") + path);`);
  for (const p of queryParams) {
    lines.push(
      `      if (args[${JSON.stringify(p.name)}] !== undefined) url.searchParams.set(${JSON.stringify(p.name)}, String(args[${JSON.stringify(p.name)}]));`
    );
  }
  lines.push(`      const headers: Record<string, string> = {};`);
  for (const p of headerParams) {
    lines.push(
      `      if (args[${JSON.stringify(p.name)}] !== undefined) headers[${JSON.stringify(p.name)}] = String(args[${JSON.stringify(p.name)}]);`
    );
  }
  if (hasAuth) {
    lines.push(`      if (process.env.KLARIDIAN_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.KLARIDIAN_AUTH_TOKEN;`);
  }
  if (hasBody) {
    lines.push(`      headers["Content-Type"] = ${JSON.stringify(tool.requestBodyContentType)};`);
  }
  lines.push(`      const resp = await fetch(url, {`);
  lines.push(`        method: ${JSON.stringify(method)},`);
  lines.push(`        headers,`);
  if (hasBody) {
    lines.push(`        body: (args as Record<string, unknown>).requestBody !== undefined ? JSON.stringify((args as Record<string, unknown>).requestBody) : undefined,`);
  }
  lines.push(`      });`);
  lines.push(`      const text = await resp.text();`);
  lines.push(`      return { content: [{ type: "text" as const, text }], isError: !resp.ok };`);
  return lines.join("\n");
}

/**
 * Emits a full `server.registerTool(name, config, handler)` block.
 * `wrap`, when provided, wraps the handler (plugin instrumentation) — e.g.
 * `wrapTool` from a vendored instrumentation file.
 */
export function emitToolBlock(tool: McpToolDefinition, wrap?: { fn: string }): string {
  const zodSrc = jsonSchemaToZod(tool.inputSchema ?? { type: "object", properties: {} });
  const ann = annotationsForMethod(tool.method || "get");
  const title = titleForTool(tool as { name: string; operationId?: string; summary?: string });
  const wiring = wrap ? { importStatement: "", wrapFunctionName: wrap.fn } : undefined;
  const handlerOpen = typescriptPluginDispatch.wrapHandlerOpen(tool.name, wiring);
  const handlerClose = typescriptPluginDispatch.wrapHandlerClose(wiring);
  const annotations =
    `{ title: ${JSON.stringify(title)}, readOnlyHint: ${ann.readOnlyHint}, ` +
    `destructiveHint: ${ann.destructiveHint}, idempotentHint: ${ann.idempotentHint}, ` +
    `openWorldHint: ${ann.openWorldHint} }`;
  return `  server.registerTool(
    ${JSON.stringify(tool.name)},
    {
      title: ${JSON.stringify(title)},
      description: ${JSON.stringify(tool.description ?? "")},
      inputSchema: ${zodSrc},
      annotations: ${annotations},
    },
    ${handlerOpen}
${emitHandlerBody(tool)}
${handlerClose},
  );`;
}
