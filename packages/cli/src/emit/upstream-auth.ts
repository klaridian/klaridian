// packages/cli/src/emit/upstream-auth.ts
//
// MCPFO-105 (ARCHITECTURE.md §95) — per-scheme upstream authentication.
//
// Before this, both emitters (emit-tool.ts / emit-python.ts) emitted BEARER
// ONLY: whenever an operation had ANY security requirement they unconditionally
// set `Authorization: Bearer ${KLARIDIAN_AUTH_TOKEN}`, regardless of the actual
// OpenAPI securityScheme. A spec whose scheme was apiKey (header/query/cookie),
// http basic, or oauth2 therefore generated a server that sent the WRONG auth.
//
// This module is the ONE language-neutral planner both targets consume, so the
// TypeScript and Python servers wire IDENTICAL auth for a given spec (parity is
// structural, not two hand-kept copies). Each emitter renders the returned
// directives in its own idiom (headers[...] / url.searchParams / Cookie).
//
// Env-var convention (mirrors upstream openapi-mcp-generator's per-scheme model
// but keeps klaridian's KLARIDIAN_ prefix, consistent with KLARIDIAN_BASE_URL /
// KLARIDIAN_AUTH_TOKEN):
//   - http bearer          → KLARIDIAN_AUTH_TOKEN   (the pre-existing var; kept
//                             as the bearer default for BACK-COMPAT)
//   - apiKey (any location) → KLARIDIAN_API_KEY
//   - http basic           → KLARIDIAN_BASIC_USER + KLARIDIAN_BASIC_PASS
//   - oauth2 / openIdConnect→ KLARIDIAN_OAUTH_TOKEN (operator supplies a bearer
//                             token; token acquisition is the operator's job)
//
// mutualTLS is OUT OF SCOPE: it can't be wired from an env var (it's a TLS
// client-cert handshake). If an operation offers ONLY mutualTLS scheme(s) we
// FAIL LOUDLY at generation time (planUpstreamAuth throws) rather than emit a
// server that silently sends no auth. When mutualTLS coexists with a supported
// scheme, the supported one is used and mutualTLS is skipped.

import type { ToolIR, ToolIRSecurityScheme } from "./ir.js";

/** Env var names — the single source of truth for the auth env-var convention. */
export const AUTH_ENV = {
  bearer: "KLARIDIAN_AUTH_TOKEN",
  apiKey: "KLARIDIAN_API_KEY",
  basicUser: "KLARIDIAN_BASIC_USER",
  basicPass: "KLARIDIAN_BASIC_PASS",
  oauthToken: "KLARIDIAN_OAUTH_TOKEN",
} as const;

/**
 * One normalized auth wiring directive, language-neutral. The emitters render
 * these; they never re-derive scheme logic.
 *
 *  - apiKeyHeader / apiKeyCookie: set header `headerName` (Cookie carries a
 *    `${name}=${value}` pair) to KLARIDIAN_API_KEY when set.
 *  - apiKeyQuery: set query param `paramName` to KLARIDIAN_API_KEY when set.
 *  - bearer: `Authorization: Bearer ${env}` when `env` is set.
 *  - basic:  `Authorization: Basic base64(user:pass)` when both env vars set.
 */
export type UpstreamAuthDirective =
  | { kind: "bearer"; env: string }
  | { kind: "basic"; userEnv: string; passEnv: string }
  | { kind: "apiKeyHeader"; headerName: string; env: string }
  | { kind: "apiKeyQuery"; paramName: string; env: string }
  | { kind: "apiKeyCookie"; cookieName: string; env: string };

/** Thrown when an operation's ONLY security option is mutualTLS (unsupported). */
export class MutualTlsOnlyError extends Error {
  constructor(public readonly toolName: string) {
    super(
      `Operation "${toolName}" requires mutualTLS, which klaridian does not ` +
        `support for generated upstream auth (MCPFO-105): a mutual-TLS client ` +
        `certificate can't be supplied from an environment variable the way a ` +
        `bearer token or API key can. Remove the mutualTLS-only requirement, add ` +
        `a supported scheme (apiKey, http bearer/basic, or oauth2) to this ` +
        `operation, or use --auth-hook to wire the client certificate yourself.`
    );
    this.name = "MutualTlsOnlyError";
  }
}

/**
 * Turn a tool's resolved securitySchemes into an ordered list of auth
 * directives. Empty when the operation declares no security.
 *
 * BACK-COMPAT: when a tool has securityRequirements but NO resolved
 * securitySchemes (a spec whose scheme names don't resolve to definitions, or
 * IR produced before MCPFO-105), fall back to the legacy single bearer directive
 * from KLARIDIAN_AUTH_TOKEN — exactly what the emitters did before.
 *
 * FAIL LOUD: if every resolved scheme is mutualTLS (and there is at least one),
 * throw MutualTlsOnlyError. mutualTLS mixed with a supported scheme is skipped.
 */
export function planUpstreamAuth(tool: ToolIR): UpstreamAuthDirective[] {
  const schemes: ToolIRSecurityScheme[] = tool.securitySchemes ?? [];
  const hasRequirement =
    Array.isArray(tool.securityRequirements) && tool.securityRequirements.length > 0;

  if (schemes.length === 0) {
    // Legacy back-compat path: a security requirement with no resolved scheme
    // definition still gets the historical bearer wiring.
    return hasRequirement ? [{ kind: "bearer", env: AUTH_ENV.bearer }] : [];
  }

  const directives: UpstreamAuthDirective[] = [];
  let sawSupported = false;
  let sawMutualTls = false;

  for (const scheme of schemes) {
    const type = (scheme.type || "").toLowerCase();
    if (type === "apikey") {
      const where = (scheme.in || "header").toLowerCase();
      const name = scheme.name || "";
      if (!name) continue;
      if (where === "query") {
        directives.push({ kind: "apiKeyQuery", paramName: name, env: AUTH_ENV.apiKey });
      } else if (where === "cookie") {
        directives.push({ kind: "apiKeyCookie", cookieName: name, env: AUTH_ENV.apiKey });
      } else {
        directives.push({ kind: "apiKeyHeader", headerName: name, env: AUTH_ENV.apiKey });
      }
      sawSupported = true;
    } else if (type === "http") {
      const httpScheme = (scheme.scheme || "bearer").toLowerCase();
      if (httpScheme === "basic") {
        directives.push({
          kind: "basic",
          userEnv: AUTH_ENV.basicUser,
          passEnv: AUTH_ENV.basicPass,
        });
      } else {
        // bearer (and any other http token scheme) → Authorization: Bearer.
        directives.push({ kind: "bearer", env: AUTH_ENV.bearer });
      }
      sawSupported = true;
    } else if (type === "oauth2" || type === "openidconnect") {
      directives.push({ kind: "bearer", env: AUTH_ENV.oauthToken });
      sawSupported = true;
    } else if (type === "mutualtls") {
      sawMutualTls = true;
      // skip — unsupported; handled after the loop.
    }
    // Unknown scheme types are ignored (no directive), same spirit as skipping
    // an unresolved requirement.
  }

  if (sawMutualTls && !sawSupported) {
    throw new MutualTlsOnlyError(tool.name);
  }
  return directives;
}
