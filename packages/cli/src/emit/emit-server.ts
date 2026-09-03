// packages/cli/src/emit/emit-server.ts
//
// Emits a complete, buildable v2 (@modelcontextprotocol/server) MCP server
// project from openapi-mcp-generator's pure tool DATA. The "option d" core
// (ARCHITECTURE.md sections 37/38). Stateless by construction (createMcpHandler
// factory-per-request), so the v1 session-based streamable-http crash
// (MCPFO-10) cannot occur here. Targets protocol 2025-11-25 (the current v2
// SDK line) — NOT 2026-07-28, which the SDK does not yet negotiate (spike 021c).

import type { McpToolDefinition } from "openapi-mcp-generator";
import { emitToolBlock } from "./emit-tool.js";
import { emitPackageJson, emitTsconfig, emitServerJson } from "./emit-project-files.js";

export type Transport = "stdio" | "streamable-http";

export interface EmitOptions {
  serverName: string;
  tools: McpToolDefinition[];
  baseUrl: string;
  transport?: Transport;
  port?: number;
  /** Optional plugin wiring: an import line + a wrap function name applied per tool. */
  wiring?: { importStatement: string; wrapFunctionName: string };
  /** Extra vendored files (path -> content), e.g. a plugin's instrumentation source. */
  extraFiles?: Record<string, string>;
  /** Extra npm dependencies for the generated project (e.g. a plugin's SDKs). */
  extraDependencies?: Record<string, string>;
  /** Short description used in server.json (MCPFO-25). */
  description?: string;
  /** Reverse-DNS MCP Registry name, e.g. "io.github.acme/petstore" (MCPFO-25).
   *  When set, package.json gains an `mcpName` and server.json uses it. */
  registryName?: string;
}

export type EmittedProject = Record<string, string>;

/**
 * MCPFO-20 — returns a human-readable warning if the generated server would have
 * no usable absolute upstream base URL, else null. `override` is --base-url;
 * `specServerUrl` is the spec's resolved servers[0].url (may be relative). An
 * absolute override always wins. Non-fatal: MCPFORGE_BASE_URL can still be set
 * at runtime, but the author almost always wants to bake in an absolute default.
 */
export function resolveBaseUrlWarning(
  override: string | undefined,
  specServerUrl: string | undefined
): string | null {
  const isAbsolute = (u: string | undefined): boolean => {
    if (!u) return false;
    return /^https?:\/\//i.test(u.trim());
  };
  if (isAbsolute(override)) return null;
  if (isAbsolute(specServerUrl)) return null;
  const offending = specServerUrl && specServerUrl.trim()
    ? `the spec's server URL is relative ("${specServerUrl}")`
    : "the spec declares no absolute server URL";
  return (
    `Base URL is not absolute: ${offending}. The generated server reads ` +
    `MCPFORGE_BASE_URL at runtime, but you should pass --base-url <https://host/...> ` +
    `so it has a usable default. Without it, tool calls will fail until ` +
    `MCPFORGE_BASE_URL is set in the environment.`
  );
}

function emitIndex(opts: EmitOptions): string {
  const transport: Transport = opts.transport ?? "stdio";
  const wrap = opts.wiring ? { fn: opts.wiring.wrapFunctionName } : undefined;
  const toolBlocks = opts.tools.map((t) => emitToolBlock(t, wrap)).join("\n\n");

  const baseImports = [`import { McpServer } from "@modelcontextprotocol/server";`, `import * as z from "zod/v4";`];
  if (opts.wiring) baseImports.push(opts.wiring.importStatement);

  const factoryBody = `() => {
  const server = new McpServer({ name: ${JSON.stringify(opts.serverName)}, version: "1.0.0" });

${toolBlocks}

  return server;
}`;

  if (transport === "streamable-http") {
    const port = opts.port ?? 3000;
    return `${baseImports.join("\n")}
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "node:http";
import { toNodeHandler, localhostHostValidation, localhostOriginValidation } from "@modelcontextprotocol/node";

const handler = createMcpHandler(${factoryBody});

const nodeHandler = toNodeHandler(handler);
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();
createServer((req, res) => {
  if (!validateHost(req, res) || !validateOrigin(req, res)) return;
  void nodeHandler(req, res);
}).listen(${port}, "127.0.0.1", () => {
  console.error("MCP server (streamable-http) on http://127.0.0.1:${port}/mcp");
});

process.on("SIGINT", async () => { await handler.close(); process.exit(0); });
process.on("SIGTERM", async () => { await handler.close(); process.exit(0); });
`;
  }

  // stdio — serveStdio(factory) from @modelcontextprotocol/server/stdio (verified against the installed v2 dist).
  return `${baseImports.join("\n")}
import { serveStdio } from "@modelcontextprotocol/server/stdio";

serveStdio(${factoryBody});
`;
}

export function emitServerProject(opts: EmitOptions): EmittedProject {
  const transport: Transport = opts.transport ?? "stdio";
  const files: EmittedProject = {
    "package.json": emitPackageJson(opts.serverName, transport, opts.extraDependencies, opts.registryName),
    "tsconfig.json": emitTsconfig(),
    "src/index.ts": emitIndex(opts),
    "server.json": emitServerJson({
      serverName: opts.serverName,
      description: opts.description ?? "",
      transport,
      registryName: opts.registryName,
    }),
  };
  for (const [p, content] of Object.entries(opts.extraFiles ?? {})) {
    files[p] = content;
  }
  return files;
}
