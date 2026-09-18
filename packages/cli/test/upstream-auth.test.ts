// packages/cli/test/upstream-auth.test.ts
//
// MCPFO-105 (ARCHITECTURE.md §95): unit + golden-contract coverage for the
// per-scheme upstream-auth planner and the emitter wiring it drives, in BOTH
// targets (TS + Python parity). The load-bearing end-to-end proof (a spawned
// server actually sending the right header/query) is in upstream-auth-e2e.test.ts;
// this file locks the emitted-string shape and the fail-loud behaviour cheaply.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { ToolIR, ToolIRSecurityScheme } from "../src/emit/ir.js";
import { planUpstreamAuth, MutualTlsOnlyError, AUTH_ENV } from "../src/emit/upstream-auth.js";
import { emitToolBlock } from "../src/emit/emit-tool.js";
import { emitServerProject } from "../src/emit/emit-server.js";
import { pythonTarget } from "../src/emit/target.js";

function makeTool(overrides: Partial<ToolIR> = {}): ToolIR {
  return {
    name: "op",
    description: "an op",
    method: "get",
    pathTemplate: "/thing",
    inputSchema: { type: "object", properties: {} },
    executionParameters: [],
    securityRequirements: [{ scheme: [] }],
    securitySchemes: [],
    operationId: "op",
    ...overrides,
  };
}

function scheme(s: ToolIRSecurityScheme): ToolIRSecurityScheme {
  return s;
}

// --- planner ---------------------------------------------------------------

test("planUpstreamAuth: apiKey header/query/cookie map to the right directive", () => {
  const header = planUpstreamAuth(makeTool({ securitySchemes: [scheme({ type: "apiKey", in: "header", name: "X-API-Key" })] }));
  assert.deepEqual(header, [{ kind: "apiKeyHeader", headerName: "X-API-Key", env: AUTH_ENV.apiKey }]);

  const query = planUpstreamAuth(makeTool({ securitySchemes: [scheme({ type: "apiKey", in: "query", name: "api_key" })] }));
  assert.deepEqual(query, [{ kind: "apiKeyQuery", paramName: "api_key", env: AUTH_ENV.apiKey }]);

  const cookie = planUpstreamAuth(makeTool({ securitySchemes: [scheme({ type: "apiKey", in: "cookie", name: "session" })] }));
  assert.deepEqual(cookie, [{ kind: "apiKeyCookie", cookieName: "session", env: AUTH_ENV.apiKey }]);
});

test("planUpstreamAuth: http bearer/basic and oauth2/openIdConnect", () => {
  assert.deepEqual(planUpstreamAuth(makeTool({ securitySchemes: [scheme({ type: "http", scheme: "bearer" })] })), [
    { kind: "bearer", env: AUTH_ENV.bearer },
  ]);
  assert.deepEqual(planUpstreamAuth(makeTool({ securitySchemes: [scheme({ type: "http", scheme: "basic" })] })), [
    { kind: "basic", userEnv: AUTH_ENV.basicUser, passEnv: AUTH_ENV.basicPass },
  ]);
  assert.deepEqual(planUpstreamAuth(makeTool({ securitySchemes: [scheme({ type: "oauth2" })] })), [
    { kind: "bearer", env: AUTH_ENV.oauthToken },
  ]);
  assert.deepEqual(planUpstreamAuth(makeTool({ securitySchemes: [scheme({ type: "openIdConnect" })] })), [
    { kind: "bearer", env: AUTH_ENV.oauthToken },
  ]);
});

test("planUpstreamAuth: back-compat — a requirement with no resolved scheme falls back to bearer from KLARIDIAN_AUTH_TOKEN", () => {
  const directives = planUpstreamAuth(makeTool({ securityRequirements: [{ x: [] }], securitySchemes: [] }));
  assert.deepEqual(directives, [{ kind: "bearer", env: AUTH_ENV.bearer }]);
});

test("planUpstreamAuth: no security requirement means no auth", () => {
  assert.deepEqual(planUpstreamAuth(makeTool({ securityRequirements: [], securitySchemes: [] })), []);
});

test("planUpstreamAuth: mutualTLS-only fails loudly", () => {
  assert.throws(
    () => planUpstreamAuth(makeTool({ securitySchemes: [scheme({ type: "mutualTLS" })] })),
    MutualTlsOnlyError
  );
});

test("planUpstreamAuth: mutualTLS mixed with a supported scheme uses the supported one", () => {
  const directives = planUpstreamAuth(
    makeTool({ securitySchemes: [scheme({ type: "mutualTLS" }), scheme({ type: "http", scheme: "bearer" })] })
  );
  assert.deepEqual(directives, [{ kind: "bearer", env: AUTH_ENV.bearer }]);
});

// --- emitted TypeScript shape ---------------------------------------------

test("emit-tool (TS): apiKey-in-header sets the named header from KLARIDIAN_API_KEY, not Bearer", () => {
  const block = emitToolBlock(makeTool({ securitySchemes: [scheme({ type: "apiKey", in: "header", name: "X-API-Key" })] }));
  assert.match(block, /headers\["X-API-Key"\] = process\.env\.KLARIDIAN_API_KEY/);
  assert.doesNotMatch(block, /Bearer/);
});

test("emit-tool (TS): apiKey-in-query sets the search param", () => {
  const block = emitToolBlock(makeTool({ securitySchemes: [scheme({ type: "apiKey", in: "query", name: "api_key" })] }));
  assert.match(block, /url\.searchParams\.set\("api_key", process\.env\.KLARIDIAN_API_KEY\)/);
});

test("emit-tool (TS): http basic sets Authorization Basic base64(user:pass)", () => {
  const block = emitToolBlock(makeTool({ securitySchemes: [scheme({ type: "http", scheme: "basic" })] }));
  assert.match(block, /"Basic " \+ Buffer\.from\(process\.env\.KLARIDIAN_BASIC_USER \+ ":" \+ process\.env\.KLARIDIAN_BASIC_PASS\)\.toString\("base64"\)/);
});

test("emit-tool (TS): back-compat KLARIDIAN_AUTH_TOKEN bearer still works for http bearer", () => {
  const block = emitToolBlock(makeTool({ securitySchemes: [scheme({ type: "http", scheme: "bearer" })] }));
  assert.match(block, /"Bearer " \+ process\.env\.KLARIDIAN_AUTH_TOKEN/);
});

// --- emitted Python shape (parity) ----------------------------------------

test("emit-python: per-scheme auth parity with TS", () => {
  const files = pythonTarget.emitProject({
    serverName: "auth-parity",
    baseUrl: "https://api.example.com",
    tools: [
      makeTool({ name: "h", operationId: "h", pathTemplate: "/h", securitySchemes: [scheme({ type: "apiKey", in: "header", name: "X-API-Key" })] }),
      makeTool({ name: "q", operationId: "q", pathTemplate: "/q", securitySchemes: [scheme({ type: "apiKey", in: "query", name: "api_key" })] }),
      makeTool({ name: "b", operationId: "b", pathTemplate: "/b", securitySchemes: [scheme({ type: "http", scheme: "basic" })] }),
      makeTool({ name: "o", operationId: "o", pathTemplate: "/o", securitySchemes: [scheme({ type: "oauth2" })] }),
    ],
  });
  const toolsPy = files["tools.py"];
  assert.match(toolsPy, /headers\["X-API-Key"\] = _ak/);
  assert.match(toolsPy, /query\["api_key"\] = _ak/);
  assert.match(toolsPy, /base64\.b64encode\(\(_bu \+ ":" \+ _bp\)\.encode\("utf-8"\)\)\.decode\("ascii"\)/);
  assert.match(toolsPy, /os\.environ\.get\("KLARIDIAN_OAUTH_TOKEN"\)/);
  assert.match(toolsPy, /os\.environ\.get\("KLARIDIAN_API_KEY"\)/);
});

// --- feature C: auth hook emit --------------------------------------------

test("emit (TS): --auth-hook emits an editable src/auth-hook.ts and the handler calls it", () => {
  const files = emitServerProject({
    serverName: "hook-ts",
    baseUrl: "https://api.example.com",
    tools: [makeTool({ securitySchemes: [scheme({ type: "http", scheme: "bearer" })] })],
    authHook: true,
  });
  assert.ok(files["src/auth-hook.ts"], "auth-hook.ts is emitted");
  assert.match(files["src/auth-hook.ts"], /export async function authHook/);
  assert.match(files["src/server-factory.ts"], /import \{ authHook \} from "\.\/auth-hook\.js"/);
  assert.match(files["src/server-factory.ts"], /const authHandled = await authHook\(/);
  assert.match(files["src/server-factory.ts"], /if \(!authHandled\)/);
});

test("emit (Python): --auth-hook emits an editable auth_hook.py and the proxy calls it", () => {
  const files = pythonTarget.emitProject({
    serverName: "hook-py",
    baseUrl: "https://api.example.com",
    tools: [makeTool({ securitySchemes: [scheme({ type: "http", scheme: "bearer" })] })],
    authHook: true,
  });
  assert.ok(files["auth_hook.py"], "auth_hook.py is emitted");
  assert.match(files["auth_hook.py"], /async def auth_hook/);
  assert.match(files["tools.py"], /from auth_hook import auth_hook/);
  assert.match(files["tools.py"], /_auth_handled = await auth_hook\(/);
  assert.match(files["tools.py"], /if not _auth_handled:/);
  // auth_hook is registered as a py-module so setuptools ships it.
  assert.match(files["pyproject.toml"], /"auth_hook"/);
});

test("emit (TS): --auth-hook OFF emits no hook file and no hook call", () => {
  const files = emitServerProject({
    serverName: "nohook-ts",
    baseUrl: "https://api.example.com",
    tools: [makeTool({ securitySchemes: [scheme({ type: "http", scheme: "bearer" })] })],
  });
  assert.equal(files["src/auth-hook.ts"], undefined);
  assert.doesNotMatch(files["src/server-factory.ts"], /authHook/);
});
