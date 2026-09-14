// packages/cli/test/emit-python.test.ts
//
// Unit tests for the Python emit target (MCPFO-60.3). String-shape assertions
// only — the real install/spawn/drive proof lives in emit-python-e2e.test.ts,
// mirroring the emit-server.test.ts / emit-e2e.test.ts split for TypeScript.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getToolsFromOpenApi } from "openapi-mcp-generator";
import { getEmitTarget, pythonTarget } from "../src/emit/target.js";
import { pythonConformanceAdapter } from "../src/emit/conformance/python.js";
import { pythonPluginDispatch, emitDispatchWrap } from "../src/emit/plugin-dispatch/python.js";
import { otelPlugin } from "../src/plugins/otel/otel.plugin.js";
import { posthogPlugin } from "../src/plugins/posthog/posthog.plugin.js";
import { amplitudePlugin } from "../src/plugins/amplitude/amplitude.plugin.js";
import { mixpanelPlugin } from "../src/plugins/mixpanel/mixpanel.plugin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

async function petstoreTools() {
  return getToolsFromOpenApi(PETSTORE_SPEC_PATH, { dereference: true });
}

test("python target is registered and resolvable via getEmitTarget", () => {
  const target = getEmitTarget("python");
  assert.equal(target.language, "python");
  assert.equal(target, pythonTarget);
  assert.equal(target.conformance.language, "python");
  assert.equal(target.pluginDispatch.language, "python");
  assert.equal(target.pluginDispatch.granularity, "shared-dispatch");
});

test("python conformance adapter injects real server code (NOT a no-op like TS)", () => {
  const code = pythonConformanceAdapter.emitServerContributions();
  assert.notEqual(code.trim(), "", "python adapter must contribute conformance.py");
  // The two spike-059 gaps must both be addressed in the injected module.
  assert.match(code, /raise MCPError\(INVALID_PARAMS/, "unknown-tool -> raised MCPError(-32602)");
  assert.match(code, /jsonschema\.validate/, "invalid-args validated via jsonschema");
  assert.match(code, /is_error=True/, "invalid-args + tool failures are tool-error results");
  assert.match(code, /INVALID_PARAMS = -32602/);
});

test("python plugin dispatch renders a single shared-dispatch wrap, not per-tool", () => {
  assert.equal(emitDispatchWrap(undefined), "", "no wrap without a plugin");
  const wrap = emitDispatchWrap({ importStatement: "x", wrapFunctionName: "wrap_dispatch" });
  assert.equal(wrap, "_dispatch = wrap_dispatch(_dispatch)");
  // wrapHandlerOpen/Close are per-tool TS concepts — Python must not use them.
  assert.throws(() => pythonPluginDispatch.wrapHandlerOpen("t"), /not used/);
  assert.throws(() => pythonPluginDispatch.wrapHandlerClose(), /not used/);
});

test("python target emits a complete, coherent project from real tool data", async () => {
  const tools = await petstoreTools();
  const files = pythonTarget.emitProject({
    serverName: "petstore-py",
    tools,
    baseUrl: "https://petstore3.swagger.io/api/v3",
    transport: "stdio",
  });
  // Core project files present.
  for (const f of ["server.py", "tools.py", "conformance.py", "pyproject.toml", "requirements.txt", "README.md"]) {
    assert.ok(files[f], `missing ${f}`);
  }
  // server.py wires the conformance module + the shared dispatch boundary.
  assert.match(files["server.py"], /import conformance/);
  assert.match(files["server.py"], /async def _dispatch\(tool_name/);
  assert.match(files["server.py"], /conformance\.raise_unknown_tool/);
  assert.match(files["server.py"], /conformance\.validate_arguments/);
  // tools.py has one proxy + registry entry per tool, with camelCase wire
  // annotations preserved (getPetById is a read-only GET).
  assert.match(files["tools.py"], /"name": "getPetById"/);
  assert.match(files["tools.py"], /read_only_hint=True/);
  assert.match(files["tools.py"], /open_world_hint=True/);
  // requirements pin the validated SDK + httpx + jsonschema.
  assert.match(files["requirements.txt"], /mcp==2\.1\.1/);
  assert.match(files["requirements.txt"], /httpx/);
  assert.match(files["requirements.txt"], /jsonschema/);
});

test("MCPFO-90: python server threads request _meta to the shared dispatch, and otel continues the W3C trace", async () => {
  const tools = await petstoreTools();
  const files = pythonTarget.emitProject({
    serverName: "petstore-py",
    tools,
    baseUrl: "https://petstore3.swagger.io/api/v3",
    transport: "stdio",
  });
  // The shared dispatch accepts a meta arg, and on_call_tool forwards the
  // request _meta into it (so a wrapping plugin can read trace context).
  assert.match(files["server.py"], /async def _dispatch\(tool_name: str, arguments: dict, meta: dict \| None = None\)/);
  assert.match(files["server.py"], /_dispatch\(params\.name, arguments, meta_dict\)/);
  assert.match(files["server.py"], /params\.meta/, "reads _meta off the call params");

  // The otel Python instrumentation extracts the parent context from that meta.
  const config = { otlpEndpoint: "http://localhost:4318/v1/traces", serviceName: "petstore-py" };
  const contribs = otelPlugin.python!.getTemplateContributions(config);
  const otel = contribs.find((c) => c.path === "instrumentation/otel.py")!;
  const src = otel.content as string;
  assert.match(src, /from opentelemetry\.propagate import extract/, "imports the W3C extract helper");
  assert.match(src, /async def wrapped\(tool_name, arguments, meta=None\)/, "wrap receives the request meta");
  assert.match(src, /extract\(meta or \{\}\)/, "extracts parent context from the request meta");
  assert.match(src, /dispatch\(tool_name, arguments, meta\)/, "forwards meta down the dispatch chain");
});

test("python target: outputSchema advertised + structured_content populated only when the IR carries one (MCPFO-33)", () => {
  // Two hand-built ToolIRs: one WITH a recovered outputSchema (object body),
  // one WITHOUT. Mirrors the TS emitToolBlock gating so parity is enforced.
  const withSchema = {
    name: "getWidget",
    description: "Get a widget",
    method: "get",
    pathTemplate: "/widgets/{id}",
    inputSchema: { type: "object", properties: { id: { type: "string" } } },
    executionParameters: [{ name: "id", in: "path" }],
    securityRequirements: [],
    operationId: "getWidget",
    outputSchema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } },
  };
  const withoutSchema = {
    name: "listWidgets",
    description: "List widgets",
    method: "get",
    pathTemplate: "/widgets",
    inputSchema: { type: "object", properties: {} },
    executionParameters: [],
    securityRequirements: [],
    operationId: "listWidgets",
  };
  const files = pythonTarget.emitProject({
    serverName: "widget-py",
    tools: [withSchema, withoutSchema] as never,
    baseUrl: "https://api.example.com",
    transport: "stdio",
  });
  const toolsPy = files["tools.py"];
  // The tool WITH a schema advertises output_schema (a real json.loads object)
  // and its proxy populates structured_content on success.
  assert.match(toolsPy, /"name": "getWidget"/);
  assert.match(toolsPy, /"output_schema": json\.loads\(/);
  assert.match(toolsPy, /structured_content=structured if isinstance\(structured, dict\) else None/);
  // The tool WITHOUT a schema carries output_schema: None and no structured_content.
  assert.match(toolsPy, /"name": "listWidgets"/);
  assert.match(toolsPy, /"output_schema": None/);
  // server.py's on_list_tools threads output_schema through to types.Tool.
  assert.match(files["server.py"], /output_schema=e\["output_schema"\]/);
});

test("python target's streamable-http variant emits the ASGI app + uvicorn entry", async () => {
  const tools = await petstoreTools();
  const files = pythonTarget.emitProject({
    serverName: "petstore-py-http",
    tools,
    baseUrl: "https://petstore3.swagger.io/api/v3",
    transport: "streamable-http",
    port: 3000,
  });
  assert.match(files["server.py"], /StreamableHTTPSessionManager/);
  assert.match(files["server.py"], /stateless=True/);
  assert.match(files["server.py"], /uvicorn\.run/);
});

test("python target fails loudly on out-of-scope configurations", async () => {
  const tools = await petstoreTools();
  assert.throws(
    () => pythonTarget.emitProject({ serverName: "x", tools, baseUrl: "https://h", architecture: "code-mode" }),
    /code-mode/,
    "code-mode is MCPFO-60.35, not this ticket"
  );
  // MCPFO-79: OAuth on stdio is rejected (a stdio server MUST NOT implement
  // authorization per the MCP spec — it reads credentials from its environment).
  assert.throws(
    () =>
      pythonTarget.emitProject({
        serverName: "x",
        tools,
        baseUrl: "https://h",
        transport: "stdio",
        auth: { issuer: "https://i", jwksUri: "https://j", audience: "https://a" },
      }),
    /streamable-http/,
    "OAuth is streamable-http only"
  );
});

test("python target emits the OAuth resource-server auth module for streamable-http (MCPFO-79)", async () => {
  const tools = await petstoreTools();
  const files = pythonTarget.emitProject({
    serverName: "petstore-py-oauth",
    tools,
    baseUrl: "https://petstore3.swagger.io/api/v3",
    transport: "streamable-http",
    port: 3000,
    auth: {
      issuer: "https://example-idp.test",
      jwksUri: "https://example-idp.test/.well-known/jwks.json",
      audience: "https://mcp.example.com/mcp",
      requiredScopes: ["mcp:tools"],
    },
  });
  // The vendored auth module ships, with the RFC surfaces the ticket names.
  assert.ok(files["auth.py"], "auth.py emitted");
  assert.match(files["auth.py"], /import jwt/, "uses PyJWT (the jose peer)");
  assert.match(files["auth.py"], /PyJWKClient/, "JWKS-backed key resolution");
  assert.match(files["auth.py"], /oauth-protected-resource/, "RFC 9728 PRM path");
  assert.match(files["auth.py"], /audience=AUDIENCE/, "RFC 8707 audience validation");
  assert.match(files["auth.py"], /require".*exp".*iss".*aud"/s, "requires exp/iss/aud");
  assert.match(files["auth.py"], /insufficient_scope/, "required-scope enforcement -> 403");
  assert.match(files["auth.py"], /www-authenticate/, "401 Bearer challenge");
  // Defaults are baked in from the flags (overridable by env at runtime).
  assert.match(files["auth.py"], /"https:\/\/example-idp\.test"/);
  assert.match(files["auth.py"], /"https:\/\/mcp\.example\.com\/mcp"/);
  // server.py wires the gate into the hand-written ASGI app before /mcp.
  assert.match(files["server.py"], /^import auth$/m, "server imports auth");
  assert.match(files["server.py"], /await auth\.authenticate\(scope, send\)/, "auth gate wired into ASGI app");
  // Dependency + module listing only appear when OAuth is enabled.
  assert.match(files["requirements.txt"], /pyjwt\[crypto\]/, "pyjwt pinned");
  assert.match(files["pyproject.toml"], /pyjwt\[crypto\]/, "pyjwt in pyproject deps");
  assert.match(files["pyproject.toml"], /py-modules = \["server", "tools", "conformance", "auth"\]/);
});

test("python target omits the auth module (and pyjwt) when OAuth is not configured", async () => {
  const tools = await petstoreTools();
  const files = pythonTarget.emitProject({
    serverName: "petstore-py-noauth",
    tools,
    baseUrl: "https://petstore3.swagger.io/api/v3",
    transport: "streamable-http",
    port: 3000,
  });
  assert.equal(files["auth.py"], undefined, "no auth.py without OAuth");
  assert.doesNotMatch(files["requirements.txt"], /pyjwt/, "no pyjwt without OAuth");
  assert.doesNotMatch(files["server.py"], /import auth/, "no auth import without OAuth");
  assert.match(files["pyproject.toml"], /py-modules = \["server", "tools", "conformance"\]/);
});

test("every shipped plugin has a Python contribution (launch parity)", () => {
  for (const plugin of [otelPlugin, posthogPlugin, amplitudePlugin, mixpanelPlugin]) {
    assert.ok(plugin.python, `${plugin.id} must expose a python contribution`);
    assert.equal(plugin.python!.wrapFunctionName, "wrap_dispatch");
    const files = plugin.python!.getTemplateContributions({});
    assert.ok(files.length >= 1, `${plugin.id} contributes a Python instrumentation file`);
    const content = typeof files[0].content === "function" ? files[0].content({}) : files[0].content;
    assert.match(content, /def wrap_dispatch\(dispatch\)/, `${plugin.id} wraps the shared dispatch`);
    assert.match(content, /async def wrapped\(tool_name, arguments, meta=None\)/, `${plugin.id} covers every call and receives request _meta`);
    assert.ok(Object.keys(plugin.python!.getDependencies()).length >= 1, `${plugin.id} declares Python deps`);
  }
});
