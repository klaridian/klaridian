// packages/cli/src/emit/deploy/emit-cloudflare.ts
//
// MCPFO-86 step 3 — the `--target cloudflare` deploy artifacts.
//
// Emits a Cloudflare Worker entry (worker.ts) + wrangler.toml for a generated
// TypeScript streamable-http server. This is the edge target in klaridian's
// deploy story (ARCHITECTURE.md §78): emit the platform's native config + shell
// out to `wrangler`, never reimplement infra.
//
// This is the first consumer of the buildServer() factory/transport split
// (§81). The MCP SDK's createMcpHandler(factory) returns a web-standard
// { fetch(Request): Promise<Response> } — the exact shape a Worker's
// `export default { fetch }` needs. So the Worker reuses the SAME
// src/server-factory.ts the node entry uses; only the transport wrapper differs.
// The SDK ships a `workerd` export condition and a ./validators/cf-worker entry,
// so it runs on workerd unmodified (validated end to end in spike 061).
//
// TypeScript-only: Workers runs JS/TS, not a CPython server. The command layer
// (commands/deploy.ts) fails loud on a Python project before reaching here.

export interface CloudflareEmitOptions {
  /** Server name — used for the wrangler `name` and Host-header allow-list hint. */
  serverName: string;
  /** Whether the generated server was built with OAuth (affects the worker note only). */
  hasAuth: boolean;
}

/** Files the cloudflare target contributes, as a relative-path -> content map. */
export type CloudflareArtifacts = Record<string, string>;

/**
 * The Worker entry. Reuses src/server-factory.ts's buildServer via
 * createMcpHandler, whose returned handler.fetch IS a web-standard fetch
 * handler — so `export default { fetch }` is a thin pass-through. Host-header
 * validation is left to the SDK defaults inside createMcpHandler; on Workers the
 * public hostname is the *.workers.dev / custom domain, configured via the
 * KLARIDIAN_ALLOWED_HOSTS var in wrangler.toml (read by the SDK the same way the
 * node entry reads it).
 */
function emitWorkerEntry(opts: CloudflareEmitOptions): string {
  const authNote = opts.hasAuth
    ? `//\n// NOTE: this server was generated with OAuth. The bearer-token validation in\n// src/auth.ts is written against the node http (req/res) types; porting it to\n// the Worker fetch path is not wired here. Deploy without --oauth-* to Workers,\n// or use --target docker/fly for an OAuth server, until Worker auth lands.\n`
    : "";
  return `// Cloudflare Worker entry — emitted by \`klaridian deploy --target cloudflare\`
// (ephemeral deploy input, not a maintained part of the generated project;
// see klaridian ARCHITECTURE.md §78/§81).
//
// Reuses the SAME server factory the node entry (src/index.ts) uses: the MCP
// SDK's createMcpHandler returns a web-standard { fetch(Request): Response },
// which is exactly what a Worker's default export needs. No node:http here, so
// this module runs on Cloudflare's workerd runtime.
${authNote}import { createMcpHandler } from "@modelcontextprotocol/server";
import { buildServer } from "./src/server-factory.js";

export interface Env {
  KLARIDIAN_BASE_URL?: string;
  KLARIDIAN_ALLOWED_HOSTS?: string;
  KLARIDIAN_AUTH_TOKEN?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // The generated tool handlers read KLARIDIAN_* from process.env; on Workers
    // those come from bindings (env). Bridge them onto globalThis.process.env so
    // the shared factory code is identical across node and workerd.
    const g = globalThis as unknown as { process?: { env: Record<string, string | undefined> } };
    g.process = g.process ?? { env: {} };
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === "string") g.process.env[k] = v;
    }
    const handler = createMcpHandler(buildServer);
    return handler.fetch(request);
  },
};
`;
}

/** wrangler.toml — the Worker manifest. nodejs_compat lets the MCP SDK resolve on workerd. */
function emitWranglerToml(opts: CloudflareEmitOptions): string {
  // wrangler names must be lowercase, alphanumeric + hyphens. Normalize the
  // server name defensively rather than emit an invalid manifest.
  const name = opts.serverName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "mcp-server";
  return `# Emitted by \`klaridian deploy --target cloudflare\` (ephemeral deploy input,
# not a maintained part of the generated project — see klaridian ARCHITECTURE.md §78).
name = "${name}"
main = "worker.ts"
compatibility_date = "2025-09-01"
# nodejs_compat lets the MCP SDK's node-ish internals resolve on the workerd runtime.
compatibility_flags = ["nodejs_compat"]

[vars]
# The upstream API this server proxies. Set to your real base URL before deploy.
KLARIDIAN_BASE_URL = "${"" /* left blank: filled by the user */}"
# On Workers the public hostname is <name>.workers.dev (or your custom domain).
# The generated server's Host-header validation must allow it, or requests get
# 403 "Invalid Host". Add every hostname the Worker is reachable at.
KLARIDIAN_ALLOWED_HOSTS = "${name}.workers.dev"
`;
}

/**
 * Emit the Cloudflare Worker deploy artifacts. Returns a relative-path ->
 * content map (worker.ts + wrangler.toml). The command layer guarantees this is
 * only called for a TypeScript streamable-http project.
 */
export function emitCloudflareArtifacts(opts: CloudflareEmitOptions): CloudflareArtifacts {
  return {
    "worker.ts": emitWorkerEntry(opts),
    "wrangler.toml": emitWranglerToml(opts),
  };
}
