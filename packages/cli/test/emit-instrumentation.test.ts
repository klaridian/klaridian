// packages/cli/test/emit-instrumentation.test.ts
//
// Phase 2 (MCPFO-21): confirms the EXISTING plugin interface works on the v2
// emit path WITHOUT any plugin code changes — validating ARCHITECTURE.md §38's
// claim that instrument.ts's textual-patch model is replaced by a clean wrap at
// the registerTool boundary, reusing getServerWiring()/getTemplateContributions().

import { test } from "node:test";
import assert from "node:assert/strict";
import { emitServerProject } from "../src/emit/emit-server.js";
import { otelPlugin } from "../src/plugins/otel/otel.plugin.js";
import { getPluginProjectAdditions } from "../src/render/instrument.js";
import { resolvePluginConfig } from "../src/plugins/plugin.interface.js";
import type { McpToolDefinition } from "openapi-mcp-generator";

const FIXTURE: McpToolDefinition = {
  name: "getPetById",
  description: "Find pet by ID",
  method: "get",
  pathTemplate: "/pet/{petId}",
  inputSchema: { type: "object", properties: { petId: { type: "integer" } }, required: ["petId"] },
  executionParameters: [{ name: "petId", in: "path" }],
  securityRequirements: [{ api_key: [] }],
  operationId: "getPetById",
  tags: ["pet"],
} as unknown as McpToolDefinition;

test("otel plugin instruments the v2 emit path with no plugin code changes", () => {
  const config = resolvePluginConfig(otelPlugin, {
    "otlpEndpoint": "http://localhost:4318/v1/traces",
    "serviceName": "petstore",
  });
  const configs = new Map([[otelPlugin.id, config]]);
  const additions = getPluginProjectAdditions([otelPlugin], configs);
  const wiring = otelPlugin.getServerWiring();

  const files = emitServerProject({
    serverName: "petstore",
    tools: [FIXTURE],
    baseUrl: "https://x/api",
    wiring,
    extraFiles: Object.fromEntries(additions.files.map((f) => [f.path, f.content])),
    extraDependencies: additions.dependencies,
  });

  const index = files["src/index.ts"];
  // The plugin's import is present
  assert.match(index, /import \{ wrapTool \} from ".\/instrumentation\/otel\.js"/, "wrapTool import emitted");
  // Every handler is wrapped via the plugin's wrap function
  assert.match(index, /wrapTool\(\s*"getPetById"\s*,\s*async \(args\)/, "handler wrapped with wrapTool");
  // The vendored instrumentation file is included verbatim
  assert.ok(files["src/instrumentation/otel.ts"], "vendored otel.ts included in output");
  assert.match(files["src/instrumentation/otel.ts"], /OTLPTraceExporter/, "vendored file is the real otel instrumentation");
  // The plugin's backend SDK deps are in package.json
  assert.match(files["package.json"], /@opentelemetry\/sdk-node/, "otel backend SDK dep added");
});

test("without a plugin, no instrumentation import or wrap is emitted", () => {
  const files = emitServerProject({ serverName: "petstore", tools: [FIXTURE], baseUrl: "https://x/api" });
  assert.doesNotMatch(files["src/index.ts"], /wrapTool/, "no wrap when no plugin");
  assert.doesNotMatch(files["src/index.ts"], /instrumentation/, "no instrumentation import when no plugin");
});
