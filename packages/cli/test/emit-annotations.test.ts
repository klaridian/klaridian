// packages/cli/test/emit-annotations.test.ts
//
// MCPFO-23 — generated tool annotations must meet the marketplace review bar
// (Claude + ChatGPT). Per docs/research/2026-09-02-mcp-marketplaces-and-
// connector-requirements.md line 254 [verified]: every tool needs `title`,
// `readOnlyHint` (GET/HEAD), `destructiveHint` (DELETE + destructive PUT),
// `idempotentHint` (idempotent HTTP methods), and `openWorldHint: true`
// (every generated tool calls an external upstream API; OpenAI requires it).

import { test } from "node:test";
import assert from "node:assert/strict";
import { annotationsForMethod, titleForTool } from "../src/emit/emit-tool.js";

test("GET → read-only, idempotent, open-world, not destructive", () => {
  const a = annotationsForMethod("get");
  assert.equal(a.readOnlyHint, true);
  assert.equal(a.idempotentHint, true);
  assert.equal(a.openWorldHint, true);
  assert.equal(a.destructiveHint, false);
});

test("HEAD → read-only + idempotent (same as GET)", () => {
  const a = annotationsForMethod("head");
  assert.equal(a.readOnlyHint, true);
  assert.equal(a.idempotentHint, true);
});

test("DELETE → destructive + idempotent, not read-only", () => {
  const a = annotationsForMethod("delete");
  assert.equal(a.readOnlyHint, false);
  assert.equal(a.destructiveHint, true);
  assert.equal(a.idempotentHint, true);
  assert.equal(a.openWorldHint, true);
});

test("PUT → destructive (full replace overwrites state) + idempotent", () => {
  const a = annotationsForMethod("put");
  assert.equal(a.readOnlyHint, false);
  assert.equal(a.destructiveHint, true);
  assert.equal(a.idempotentHint, true);
});

test("POST → write, non-destructive, non-idempotent (typically create)", () => {
  const a = annotationsForMethod("post");
  assert.equal(a.readOnlyHint, false);
  assert.equal(a.destructiveHint, false);
  assert.equal(a.idempotentHint, false);
  assert.equal(a.openWorldHint, true);
});

test("PATCH → write, non-idempotent, non-destructive (partial update)", () => {
  const a = annotationsForMethod("patch");
  assert.equal(a.readOnlyHint, false);
  assert.equal(a.idempotentHint, false);
  assert.equal(a.destructiveHint, false);
});

test("titleForTool humanizes camelCase and snake_case operation names", () => {
  assert.equal(titleForTool({ name: "getPetById", operationId: "getPetById" } as any), "Get Pet By Id");
  assert.equal(titleForTool({ name: "find_pets_by_status", operationId: "find_pets_by_status" } as any), "Find Pets By Status");
});

test("titleForTool prefers a summary when the tool carries one", () => {
  assert.equal(titleForTool({ name: "getPetById", summary: "Find pet by ID" } as any), "Find pet by ID");
});
