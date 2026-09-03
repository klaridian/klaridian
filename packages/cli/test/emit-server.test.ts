// packages/cli/test/emit-server.test.ts
//
// Unit tests for the v2 emitter (MCPFO-21, option d — ARCHITECTURE.md sections
// 37/38, validated by spikes/021-sdk-v2-streamable-http). These assert the
// SHAPE of the emitted project files; the load-bearing end-to-end test (real
// npm install + tsc build + spawn + drive over JSON-RPC) lives in
// emit-e2e.test.ts, per the repo's standing validation rule.

import { test } from "node:test";
import assert from "node:assert/strict";
import { emitServerProject } from "../src/emit/emit-server.js";
import type { McpToolDefinition } from "openapi-mcp-generator";

const FIXTURE_GET: McpToolDefinition = {
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

test("emitServerProject returns the three core project files", () => {
  const files = emitServerProject({ serverName: "petstore", tools: [FIXTURE_GET], baseUrl: "https://x/api" });
  assert.ok(files["package.json"], "package.json emitted");
  assert.ok(files["tsconfig.json"], "tsconfig.json emitted");
  assert.ok(files["src/index.ts"], "src/index.ts emitted");
});

test("emitted src/index.ts uses the v2 SDK and registers the tool", () => {
  const files = emitServerProject({ serverName: "petstore", tools: [FIXTURE_GET], baseUrl: "https://x/api" });
  const index = files["src/index.ts"];
  assert.match(index, /@modelcontextprotocol\/server/, "imports v2 server package");
  assert.match(index, /new McpServer\(/, "constructs a fresh McpServer in a factory");
  assert.match(index, /registerTool\(\s*"getPetById"/, "registers the tool by name");
});

test("stdio transport (default) uses serveStdio(factory)", () => {
  const files = emitServerProject({ serverName: "petstore", tools: [FIXTURE_GET], baseUrl: "https://x/api" });
  assert.match(files["src/index.ts"], /serveStdio\(/, "stdio uses serveStdio");
});

test("streamable-http transport uses createMcpHandler + node adapter", () => {
  const files = emitServerProject({
    serverName: "petstore", tools: [FIXTURE_GET], baseUrl: "https://x/api",
    transport: "streamable-http", port: 4000,
  });
  const index = files["src/index.ts"];
  assert.match(index, /createMcpHandler\(/, "http uses stateless createMcpHandler factory");
  assert.match(index, /toNodeHandler/, "http uses the node adapter");
  assert.match(index, /localhostHostValidation/, "http arms host validation");
  assert.doesNotMatch(index, /mcp-session-id/i, "no session-id machinery (stateless)");
  assert.doesNotMatch(index, /fetch-to-node/, "no fetch-to-node (the v1 crash source)");
});
