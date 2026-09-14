// packages/cli/src/emit/emit-server.ts
//
// Emits a complete, buildable v2 (@modelcontextprotocol/server) MCP server
// project from openapi-mcp-generator's pure tool DATA. The "option d" core
// (ARCHITECTURE.md sections 37/38). Stateless by construction (createMcpHandler
// factory-per-request), so the v1 session-based streamable-http crash
// (MCPFO-10) cannot occur here. The generated server negotiates protocol
// 2025-11-25 (the SDK's legacy path). The emitted SDK line
// (@modelcontextprotocol/server v2) is itself 2026-07-28-native — verified by
// driving a generated server over stdio: `server/discover` returns -32601 and
// `initialize` replies `protocolVersion: "2025-11-25"`. It serves the legacy
// wire only because this factory doesn't opt into modern serving (the SDK
// wires `server/discover` only when the factory advertises modern
// supportedProtocolVersions). Adopting 2026-07-28 is a deliberate decision
// (a client-compatibility trade-off), NOT gated on SDK support — tracked in
// Plane: MCPFO-93.
//
// MCPFO-28: also emits SDK code mode output (ARCHITECTURE.md section 43) when
// `architecture: "code-mode"` is requested — a single execute_code tool
// (emit-sandbox.ts) backed by a typed client (emit-client.ts) instead of one
// MCP tool per operation, unblocking MCPFO-29/30's generator code for real
// use for the first time.

import type { ToolIR } from "./ir.js";
import { emitToolBlock } from "./emit-tool.js";
import { emitClientModule, sanitizeFunctionName, dedupeFunctionNames } from "./emit-client.js";
import { emitSandboxRunner, emitExecuteCodeToolBlock, extractApiHost } from "./emit-sandbox.js";
import { buildOperationDocs, emitDocsDataModule, emitSearchDocsToolBlock } from "./emit-docs.js";
import { emitPackageJson, emitTsconfig, emitServerJson } from "./emit-project-files.js";
import { emitAuthModule } from "../render/auth.js";

export type Transport = "stdio" | "streamable-http";
export type Architecture = "tools" | "code-mode";

export interface EmitOptions {
  serverName: string;
  tools: ToolIR[];
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
   * scoping needs a concrete host). Plugin wiring (MCPFO-32) applies to
   * execute_code's own invocation only — see ARCHITECTURE.md section 48 for
   * the honest scope of what that observes vs. doesn't.
   */
  architecture?: Architecture;
  /** Optional plugin wiring: an import line + a wrap function name applied per tool. */
  wiring?: PluginWiring;
  /** Extra vendored files (path -> content), e.g. a plugin's instrumentation source. */
  extraFiles?: Record<string, string>;
  /** Extra npm dependencies for the generated project (e.g. a plugin's SDKs). */
  extraDependencies?: Record<string, string>;
  /** Short description used in server.json (MCPFO-25). */
  description?: string;
  /** Reverse-DNS MCP Registry name, e.g. "io.github.acme/petstore" (MCPFO-25).
   *  When set, package.json gains an `mcpName` and server.json uses it. */
  registryName?: string;
  /** OAuth 2.1 Resource Server config (MCPFO-22). streamable-http only. */
  auth?: OAuthConfig;
}

export type EmittedProject = Record<string, string>;

/** Import statement + wrap function name a plugin exposes for per-tool instrumentation (ObservabilityPlugin.getServerWiring()'s return shape). */
export type PluginWiring = { importStatement: string; wrapFunctionName: string };

/** OAuth 2.1 Resource Server config resolved from --oauth-* flags (MCPFO-22). */
export type OAuthConfig = { issuer: string; jwksUri: string; audience: string; requiredScopes?: string[] };

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

/**
 * Emits the tool-registration factory as a standalone, side-effect-free module
 * (`src/server-factory.ts`) exporting `buildServer`. Split out from the entry
 * (MCPFO-86 step 3) so multiple entrypoints can reuse the SAME registration
 * logic: the node entry (src/index.ts, stdio or streamable-http) AND a
 * Cloudflare Worker entry (worker.ts, emitted by `klaridian deploy --target
 * cloudflare`). Keeping this a pure module — no `.listen()`, no `serveStdio()`,
 * no top-level side effect — is what lets a Worker `import { buildServer }`
 * without triggering a node:http bootstrap. See ARCHITECTURE.md §81.
 */
function emitServerFactoryModule(opts: EmitOptions): string {
  const architecture: Architecture = opts.architecture ?? "tools";
  const wrap = opts.wiring ? { fn: opts.wiring.wrapFunctionName } : undefined;
  const toolBlocks =
    architecture === "code-mode"
      ? [emitExecuteCodeToolBlock(extractApiHost(opts.baseUrl), wrap), emitSearchDocsToolBlock()].join("\n\n")
      : opts.tools.map((t) => emitToolBlock(t, wrap)).join("\n\n");

  const imports = [`import { McpServer } from "@modelcontextprotocol/server";`, `import * as z from "zod/v4";`];
  if (opts.wiring) imports.push(opts.wiring.importStatement);

  return `${imports.join("\n")}

// The MCP server factory. Registers every tool and returns a fresh McpServer.
// Side-effect-free and transport-agnostic: the entrypoint (src/index.ts) and any
// other host (e.g. a Cloudflare Worker) call this to build a server instance.
export function buildServer() {
  const server = new McpServer({ name: ${JSON.stringify(opts.serverName)}, version: "1.0.0" });

${toolBlocks}

  return server;
}
`;
}

function emitIndex(opts: EmitOptions): string {
  const transport: Transport = opts.transport ?? "stdio";

  if (transport === "streamable-http") {
    const port = opts.port ?? 3000;
    const authImport = opts.auth ? `import { authenticate } from "./auth.js";\n` : "";
    const authGate = opts.auth
      ? `  const authResult = await authenticate(req, res);
  if (authResult === "handled") return;
  (req as unknown as { auth?: typeof authResult }).auth = authResult;
`
      : "";
    return `import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "node:http";
import { toNodeHandler, hostHeaderValidation, originValidation, localhostHostValidation, localhostOriginValidation } from "@modelcontextprotocol/node";
import { buildServer } from "./server-factory.js";
${authImport}
const handler = createMcpHandler(buildServer);

const nodeHandler = toNodeHandler(handler);
// Port precedence: PORT (the de-facto platform convention — Cloud Run, Render,
// Railway, Heroku all inject it) > KLARIDIAN_PORT > the value baked in at
// generation time (${port}). A deployed platform can move the port without a rebuild.
const port = Number(process.env.PORT || process.env.KLARIDIAN_PORT || ${port});
// Bind host is configurable so the same server is secure locally (default
// 127.0.0.1, per MCP spec) and reachable when the caller controls the network
// namespace it runs in (set KLARIDIAN_BIND_HOST=0.0.0.0, which a container/PaaS
// needs to accept traffic from outside its own loopback).
const bindHost = process.env.KLARIDIAN_BIND_HOST || "127.0.0.1";
// Host-header (DNS-rebinding) protection. By default only localhost is accepted,
// per the MCP spec. When deployed behind a public hostname (myapp.fly.dev,
// name.workers.dev, a custom domain), set KLARIDIAN_ALLOWED_HOSTS to a
// comma-separated hostname list so requests routed via that name are accepted —
// otherwise every public request is rejected with 403 "Invalid Host". Hostnames
// only (port-agnostic); an empty/unset value keeps the localhost-only default.
const allowedHosts = (process.env.KLARIDIAN_ALLOWED_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean);
const validateHost = allowedHosts.length > 0 ? hostHeaderValidation(allowedHosts) : localhostHostValidation();
const validateOrigin = allowedHosts.length > 0 ? originValidation(allowedHosts) : localhostOriginValidation();
createServer(async (req, res) => {
  if (!validateHost(req, res) || !validateOrigin(req, res)) return;
${authGate}  void nodeHandler(req, res);
}).listen(port, bindHost, () => {
  console.error(\`MCP server (streamable-http) on http://\${bindHost}:\${port}/mcp\`);
});

process.on("SIGINT", async () => { await handler.close(); process.exit(0); });
process.on("SIGTERM", async () => { await handler.close(); process.exit(0); });
`;
  }

  // stdio — serveStdio(factory) from @modelcontextprotocol/server/stdio (verified against the installed v2 dist).
  return `import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { buildServer } from "./server-factory.js";

serveStdio(buildServer);
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
    "src/server-factory.ts": emitServerFactoryModule(opts),
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
  return files;
}
