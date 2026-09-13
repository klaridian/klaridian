// packages/cli/src/emit/emit-tool.ts
//
// Emits a single `server.registerTool(...)` block for the v2 MCP SDK
// (@modelcontextprotocol/server) from openapi-mcp-generator's pure tool DATA
// (getToolsFromOpenApi output). This is the "option d" path decided in
// ARCHITECTURE.md sections 37/38: klaridian emits the v2 tool surface itself
// instead of consuming the frozen v1 code generator. The upstream-fetch
// mapping below was validated end to end in spikes/021-sdk-v2-streamable-http
// (README-021d): path/query/header params, JSON body, and Bearer auth.

import type { ToolIR } from "./ir.js";
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
 * Human-readable tool title required by both marketplaces. Precedence:
 *   1. `x-klaridian.title` — the author's explicit override (MCPFO-76/77).
 *   2. OpenAPI `summary` — the author's human label for the operation.
 *   3. humanized operationId (camelCase / snake_case → "Title Case Words").
 * The tool `name` is never affected — only the display title.
 */
export function titleForTool(tool: {
  name: string;
  operationId?: string;
  summary?: string;
  klaridian?: { title?: string };
}): string {
  const explicit = (tool.klaridian?.title ?? "").trim();
  if (explicit) return explicit;
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

/**
 * Resolve the final tool annotations for a ToolIR: the HTTP-method-derived
 * defaults (`annotationsForMethod`), with any author-supplied `x-klaridian`
 * hints (MCPFO-76) overlaid PER HINT. An absent hint leaves that one at its
 * method default — the author overrides only what they set, not the whole
 * annotation.
 *
 * `idempotentHint` stays method-derived: `x-klaridian` does not carry it, and
 * inferring it from anything else would assert a contract the author never
 * made. `title` is handled separately (titleForTool / MCPFO-77).
 */
export function resolveAnnotations(tool: ToolIR): {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
} {
  const ann = annotationsForMethod(tool.method || "get");
  const k = tool.klaridian;
  if (!k) return ann;
  return {
    readOnlyHint: k.readOnly ?? ann.readOnlyHint,
    destructiveHint: k.destructive ?? ann.destructiveHint,
    idempotentHint: ann.idempotentHint,
    openWorldHint: k.openWorld ?? ann.openWorldHint,
  };
}

/** Emits the handler body that proxies to the upstream HTTP API. */
function emitHandlerBody(tool: ToolIR): string {
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
  if (tool.outputSchema) {
    // MCPFO-33: this tool advertises an outputSchema, so a SUCCESS result must
    // carry structuredContent matching it or the SDK turns it into a soft
    // tool-error. Parse the JSON body and attach it as structuredContent on the
    // success path only; on !resp.ok we return isError (validation is skipped
    // for error results), and if the body isn't parseable JSON we fall back to
    // text-only (the SDK will soft-error only if the schema is genuinely unmet).
    lines.push(`      if (resp.ok) {`);
    lines.push(`        try {`);
    lines.push(`          const structuredContent = JSON.parse(text) as Record<string, unknown>;`);
    lines.push(`          return { content: [{ type: "text" as const, text }], structuredContent };`);
    lines.push(`        } catch {`);
    lines.push(`          return { content: [{ type: "text" as const, text }] };`);
    lines.push(`        }`);
    lines.push(`      }`);
    lines.push(`      return { content: [{ type: "text" as const, text }], isError: true };`);
  } else {
    lines.push(`      return { content: [{ type: "text" as const, text }], isError: !resp.ok };`);
  }
  return lines.join("\n");
}

/**
 * Emits a full `server.registerTool(name, config, handler)` block.
 * `wrap`, when provided, wraps the handler (plugin instrumentation) — e.g.
 * `wrapTool` from a vendored instrumentation file.
 */
export function emitToolBlock(tool: ToolIR, wrap?: { fn: string }): string {
  const zodSrc = jsonSchemaToZod(tool.inputSchema ?? { type: "object", properties: {} });
  const ann = resolveAnnotations(tool);
  const title = titleForTool(tool);
  const wiring = wrap ? { importStatement: "", wrapFunctionName: wrap.fn } : undefined;
  const handlerOpen = typescriptPluginDispatch.wrapHandlerOpen(tool.name, wiring);
  const handlerClose = typescriptPluginDispatch.wrapHandlerClose(wiring);
  const annotations =
    `{ title: ${JSON.stringify(title)}, readOnlyHint: ${ann.readOnlyHint}, ` +
    `destructiveHint: ${ann.destructiveHint}, idempotentHint: ${ann.idempotentHint}, ` +
    `openWorldHint: ${ann.openWorldHint} }`;
  // MCPFO-33: advertise the operation's success response schema as the tool's
  // outputSchema when klaridian recovered one (a JSON-object success body — the
  // gate lives in response-schema.ts). Same json-schema-to-zod path as
  // inputSchema, so the SDK gets a Zod raw shape it can validate + convert to
  // JSON Schema for tools/list.
  const outputSchemaLine = tool.outputSchema
    ? `\n      outputSchema: ${jsonSchemaToZod(tool.outputSchema)},`
    : "";
  return `  server.registerTool(
    ${JSON.stringify(tool.name)},
    {
      title: ${JSON.stringify(title)},
      description: ${JSON.stringify(tool.description ?? "")},
      inputSchema: ${zodSrc},${outputSchemaLine}
      annotations: ${annotations},
    },
    ${handlerOpen}
${emitHandlerBody(tool)}
${handlerClose},
  );`;
}
