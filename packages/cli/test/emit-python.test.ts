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
  assert.throws(
    () =>
      pythonTarget.emitProject({
        serverName: "x",
        tools,
        baseUrl: "https://h",
        transport: "streamable-http",
        auth: { issuer: "https://i", jwksUri: "https://j", audience: "https://a" },
      }),
    /OAuth/,
    "OAuth is out of Python launch parity"
  );
});

test("every shipped plugin has a Python contribution (launch parity)", () => {
  for (const plugin of [otelPlugin, posthogPlugin, amplitudePlugin, mixpanelPlugin]) {
    assert.ok(plugin.python, `${plugin.id} must expose a python contribution`);
    assert.equal(plugin.python!.wrapFunctionName, "wrap_dispatch");
    const files = plugin.python!.getTemplateContributions({});
    assert.ok(files.length >= 1, `${plugin.id} contributes a Python instrumentation file`);
    const content = typeof files[0].content === "function" ? files[0].content({}) : files[0].content;
    assert.match(content, /def wrap_dispatch\(dispatch\)/, `${plugin.id} wraps the shared dispatch`);
    assert.match(content, /async def wrapped\(tool_name, arguments\)/, `${plugin.id} covers every call`);
    assert.ok(Object.keys(plugin.python!.getDependencies()).length >= 1, `${plugin.id} declares Python deps`);
  }
});
