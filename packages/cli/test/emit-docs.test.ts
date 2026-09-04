// packages/cli/test/emit-docs.test.ts
//
// MCPFO-31 — unit tests for search_docs's doc-building and static-data
// emission. Structural-fallback-only scope per direct instruction
// (ARCHITECTURE.md section 47): no LLM synthesis, deterministic from the
// spec's own shape. The load-bearing real-tools/call test lives in
// emit-codemode-e2e.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOperationDocs, emitDocsDataModule, emitSearchDocsToolBlock } from "../src/emit/emit-docs.js";
import type { McpToolDefinition } from "openapi-mcp-generator";

function makeTool(overrides: Partial<McpToolDefinition> = {}): McpToolDefinition {
  return {
    name: "getPetById",
    operationId: "getPetById",
    description: "",
    inputSchema: { type: "object", properties: { petId: { type: "integer" } }, required: ["petId"] },
    method: "get",
    pathTemplate: "/pet/{petId}",
    parameters: [],
    executionParameters: [{ name: "petId", in: "path" }],
    securityRequirements: [],
    ...overrides,
  } as McpToolDefinition;
}

test("buildOperationDocs uses the real description when present", () => {
  const docs = buildOperationDocs([makeTool({ description: "Find pet by ID." })], ["getPetById"]);
  assert.equal(docs[0].hasRealDescription, true);
  assert.equal(docs[0].doc, "Find pet by ID.");
});

test("buildOperationDocs builds a structural fallback when the description is empty", () => {
  const docs = buildOperationDocs([makeTool({ description: "" })], ["getPetById"]);
  assert.equal(docs[0].hasRealDescription, false);
  assert.match(docs[0].doc, /GET \/pet\/\{petId\}/);
  assert.match(docs[0].doc, /path parameter\(s\): petId/);
});

test("buildOperationDocs' structural fallback also treats whitespace-only descriptions as missing", () => {
  const docs = buildOperationDocs([makeTool({ description: "   \n  " })], ["getPetById"]);
  assert.equal(docs[0].hasRealDescription, false);
});

test("buildOperationDocs' structural fallback summarizes request body fields", () => {
  const tool = makeTool({
    description: "",
    method: "put",
    pathTemplate: "/pet",
    executionParameters: [],
    requestBodyContentType: "application/json",
    inputSchema: {
      type: "object",
      properties: {
        requestBody: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            status: { type: "string", enum: ["available", "pending", "sold"] },
          },
        },
      },
    },
  });
  const docs = buildOperationDocs([tool], ["updatePet"]);
  assert.match(docs[0].doc, /`name` \(string, required\)/);
  assert.match(docs[0].doc, /`status` \(string, optional\) \(one of: available, pending, sold\)/);
});

test("buildOperationDocs' structural fallback flags deprecated operations", () => {
  const docs = buildOperationDocs([makeTool({ description: "", deprecated: true })], ["getPetById"]);
  assert.match(docs[0].doc, /deprecated/i);
});

test("buildOperationDocs pairs each tool with the caller-supplied function name (not the raw operationId)", () => {
  const docs = buildOperationDocs([makeTool({ operationId: "get-pet.by/id" })], ["get_pet_by_id"]);
  assert.equal(docs[0].functionName, "get_pet_by_id");
});

test("emitDocsDataModule emits a valid-looking exported array with every doc entry", () => {
  const docs = buildOperationDocs([makeTool({ description: "Find pet by ID." })], ["getPetById"]);
  const src = emitDocsDataModule(docs);
  assert.match(src, /export const operationDocs: OperationDocEntry\[\] = \[/);
  assert.match(src, /functionName: "getPetById"/);
  assert.match(src, /hasRealDescription: true/);
});

test("emitSearchDocsToolBlock registers a read-only search_docs tool", () => {
  const block = emitSearchDocsToolBlock();
  assert.match(block, /"search_docs"/);
  assert.match(block, /readOnlyHint: true/);
  assert.match(block, /destructiveHint: false/);
  assert.match(block, /import\("\.\/docs-data\.js"\)/);
});
