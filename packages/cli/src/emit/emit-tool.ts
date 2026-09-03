// packages/cli/src/emit/emit-tool.ts
//
// Emits a single `server.registerTool(...)` block for the v2 MCP SDK
// (@modelcontextprotocol/server) from openapi-mcp-generator's pure tool DATA
// (getToolsFromOpenApi output). This is the "option d" path decided in
// ARCHITECTURE.md sections 37/38: mcpforge emits the v2 tool surface itself
// instead of consuming the frozen v1 code generator. The upstream-fetch
// mapping below was validated end to end in spikes/021-sdk-v2-streamable-http
// (README-021d): path/query/header params, JSON body, and Bearer auth.

import type { McpToolDefinition } from "openapi-mcp-generator";
import { jsonSchemaToZod } from "json-schema-to-zod";

/**
 * Maps an HTTP method to MCP tool annotations. GET is read-only; DELETE is
 * destructive; everything else is neither (a write that isn't a delete).
 * Marketplaces (Claude/ChatGPT) require these hints — see MCPFO-23.
 */
export function annotationsForMethod(method: string): { readOnlyHint: boolean; destructiveHint: boolean } {
  const m = (method || "get").toLowerCase();
  return { readOnlyHint: m === "get", destructiveHint: m === "delete" };
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
  lines.push(`      const base = process.env.MCPFORGE_BASE_URL;`);
  lines.push(`      if (!base) throw new Error("MCPFORGE_BASE_URL is not set");`);
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
    lines.push(`      if (process.env.MCPFORGE_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.MCPFORGE_AUTH_TOKEN;`);
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
  const handlerOpen = wrap ? `${wrap.fn}(${JSON.stringify(tool.name)}, async (args) => {` : `async (args) => {`;
  const handlerClose = wrap ? `    })` : `    }`;
  return `  server.registerTool(
    ${JSON.stringify(tool.name)},
    {
      description: ${JSON.stringify(tool.description ?? "")},
      inputSchema: ${zodSrc},
      annotations: { readOnlyHint: ${ann.readOnlyHint}, destructiveHint: ${ann.destructiveHint} },
    },
    ${handlerOpen}
${emitHandlerBody(tool)}
${handlerClose},
  );`;
}
