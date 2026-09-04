// packages/cli/src/emit/emit-server.ts
//
// Emits a complete, buildable v2 (@modelcontextprotocol/server) MCP server
// project from openapi-mcp-generator's pure tool DATA. The "option d" core
// (ARCHITECTURE.md sections 37/38). Stateless by construction (createMcpHandler
// factory-per-request), so the v1 session-based streamable-http crash
// (MCPFO-10) cannot occur here. Targets protocol 2025-11-25 (the current v2
// SDK line) — NOT 2026-07-28, which the SDK does not yet negotiate (spike 021c).
//
// MCPFO-28: also emits SDK code mode output (ARCHITECTURE.md section 43) when
// `architecture: "code-mode"` is requested — a single execute_code tool
// (emit-sandbox.ts) backed by a typed client (emit-client.ts) instead of one
// MCP tool per operation, unblocking MCPFO-29/30's generator code for real
// use for the first time.

import type { McpToolDefinition } from "openapi-mcp-generator";
import { emitToolBlock } from "./emit-tool.js";
import { emitClientModule, sanitizeFunctionName, dedupeFunctionNames } from "./emit-client.js";
import { emitSandboxRunner, emitExecuteCodeToolBlock, extractApiHost } from "./emit-sandbox.js";
import { buildOperationDocs, emitDocsDataModule, emitSearchDocsToolBlock } from "./emit-docs.js";
import { emitPackageJson, emitTsconfig, emitServerJson } from "./emit-project-files.js";
import { emitDockerfile, emitDockerignore } from "./emit-dockerfile.js";
import { emitAuthModule } from "../render/auth.js";

export type Transport = "stdio" | "streamable-http";
export type Architecture = "tools" | "code-mode";

export interface EmitOptions {
  serverName: string;
  tools: McpToolDefinition[];
  baseUrl: string;
  transport?: Transport;
  port?: number;
  /**
   * MCPFO-28/ARCHITECTURE.md section 43: "tools" (default) emits one MCP
   * tool per OpenAPI operation (the existing 1:1 path). "code-mode" emits a
   * single execute_code tool backed by a typed client, run in a sandboxed
   * Deno subprocess (MCPFO-29/30) — for large APIs where the industry has
   * converged on code execution over per-endpoint tool proliferation.
   * code-mode requires an absolute `baseUrl` (the sandbox's --allow-net
   * scoping needs a concrete host) and does not currently support plugin
   * wiring (`wiring`/`extraFiles`/`extraDependencies` below still apply to
   * project-level additions, but there is no per-tool wrap call site for a
   * plugin to hook — see MCPFO-32, tracked separately, not blocking this).
   */
  architecture?: Architecture;
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
  /** Emit a Dockerfile + .dockerignore (MCPFO-12). streamable-http only. */
  docker?: boolean;
  /** OAuth 2.1 Resource Server config (MCPFO-22). streamable-http only. */
  auth?: { issuer: string; jwksUri: string; audience: string; requiredScopes?: string[] };
}

export type EmittedProject = Record<string, string>;

/**
 * MCPFO-20 — returns a human-readable warning if the generated server would have
 * no usable absolute upstream base URL, else null. `override` is --base-url;
 * `specServerUrl` is the spec's resolved servers[0].url (may be relative). An
 * absolute override always wins. Non-fatal: KLARIDIAN_BASE_URL can still be set
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
    `KLARIDIAN_BASE_URL at runtime, but you should pass --base-url <https://host/...> ` +
    `so it has a usable default. Without it, tool calls will fail until ` +
    `KLARIDIAN_BASE_URL is set in the environment.`
  );
}

function emitIndex(opts: EmitOptions): string {
  const transport: Transport = opts.transport ?? "stdio";
  const architecture: Architecture = opts.architecture ?? "tools";
  const wrap = opts.wiring ? { fn: opts.wiring.wrapFunctionName } : undefined;
  const toolBlocks =
    architecture === "code-mode"
      ? [emitExecuteCodeToolBlock(extractApiHost(opts.baseUrl)), emitSearchDocsToolBlock()].join("\n\n")
      : opts.tools.map((t) => emitToolBlock(t, wrap)).join("\n\n");

  const baseImports = [`import { McpServer } from "@modelcontextprotocol/server";`, `import * as z from "zod/v4";`];
  if (opts.wiring) baseImports.push(opts.wiring.importStatement);

  const factoryBody = `() => {
  const server = new McpServer({ name: ${JSON.stringify(opts.serverName)}, version: "1.0.0" });

${toolBlocks}

  return server;
}`;

  if (transport === "streamable-http") {
    const port = opts.port ?? 3000;
    const authImport = opts.auth ? `import { authenticate } from "./auth.js";\n` : "";
    const authGate = opts.auth
      ? `  const authResult = await authenticate(req, res);
  if (authResult === "handled") return;
  (req as unknown as { auth?: typeof authResult }).auth = authResult;
`
      : "";
    return `${baseImports.join("\n")}
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "node:http";
import { toNodeHandler, localhostHostValidation, localhostOriginValidation } from "@modelcontextprotocol/node";
${authImport}
const handler = createMcpHandler(${factoryBody});

const nodeHandler = toNodeHandler(handler);
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();
// Bind host is configurable so the same server is secure locally (default
// 127.0.0.1, per MCP spec) and reachable inside a container (set
// KLARIDIAN_BIND_HOST=0.0.0.0 — see the generated Dockerfile). Host-header
// validation still restricts callers to localhost, so 0.0.0.0 only widens the
// network interface, not the accepted Host set.
const bindHost = process.env.KLARIDIAN_BIND_HOST || "127.0.0.1";
createServer(async (req, res) => {
  if (!validateHost(req, res) || !validateOrigin(req, res)) return;
${authGate}  void nodeHandler(req, res);
}).listen(${port}, bindHost, () => {
  console.error(\`MCP server (streamable-http) on http://\${bindHost}:${port}/mcp\`);
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
  const architecture: Architecture = opts.architecture ?? "tools";
  // MCPFO-22: auth only applies to network transports — a stdio server MUST
  // NOT implement it per spec (credentials come from the launching process's
  // environment instead).
  if (opts.auth && transport !== "streamable-http") {
    throw new Error("OAuth (opts.auth) is only supported for --transport streamable-http.");
  }
  // code-mode needs a concrete API host up front to scope the sandbox's
  // --allow-net permission — fail loudly here (generation time) rather than
  // emitting a project whose execute_code tool would throw at runtime.
  if (architecture === "code-mode") {
    extractApiHost(opts.baseUrl);
  }
  const files: EmittedProject = {
    "package.json": emitPackageJson(opts.serverName, transport, opts.extraDependencies, opts.registryName, Boolean(opts.auth)),
    "tsconfig.json": emitTsconfig(),
    "src/index.ts": emitIndex(opts),
    "server.json": emitServerJson({
      serverName: opts.serverName,
      description: opts.description ?? "",
      transport,
      registryName: opts.registryName,
    }),
  };
  if (architecture === "code-mode") {
    // MCPFO-29/30: the typed client execute_code runs model code against,
    // and the sandbox runner that spawns the Deno subprocess. Both vendored
    // (not npm dependencies) per the project's vendored-source rule (section 7).
    files["src/client.ts"] = emitClientModule(opts.tools);
    files["src/sandbox-runner.ts"] = emitSandboxRunner();
    // MCPFO-31: search_docs's static data, computed once at generation time
    // from the exact same function names emit-client.ts generated for
    // these tools (same sanitize/dedupe logic, same order) — so search_docs
    // always points at real, importable function names.
    const functionNames = dedupeFunctionNames(opts.tools.map((t) => sanitizeFunctionName(t.operationId || t.name)));
    files["src/docs-data.ts"] = emitDocsDataModule(buildOperationDocs(opts.tools, functionNames));
  }
  if (opts.auth) {
    files["src/auth.ts"] = emitAuthModule(opts.auth);
  }
  for (const [p, content] of Object.entries(opts.extraFiles ?? {})) {
    files[p] = content;
  }
  // MCPFO-12: containerization only makes sense for a network transport.
  if (opts.docker && transport === "streamable-http") {
    files["Dockerfile"] = emitDockerfile({ port: opts.port ?? 3000 });
    files[".dockerignore"] = emitDockerignore();
  }
  return files;
}
