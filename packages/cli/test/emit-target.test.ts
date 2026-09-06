// packages/cli/test/emit-target.test.ts
//
// MCPFO-60.0 — unit tests for the EmitTarget dispatch seam (ARCHITECTURE.md
// section 60). These assert the abstraction's contract: a target is
// resolvable by language, the TypeScript target produces exactly what the
// underlying emitServerProject() produces (behavior-preserving refactor), and
// an unregistered language fails loudly rather than silently defaulting.
// The load-bearing "does a generated project actually build and run" coverage
// stays in emit-e2e.test.ts; this file only guards the dispatch layer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getEmitTarget, typescriptTarget } from "../src/emit/target.js";
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

test("getEmitTarget('typescript') returns the TypeScript target", () => {
  const target = getEmitTarget("typescript");
  assert.equal(target.language, "typescript");
  assert.equal(target, typescriptTarget);
});

test("the TypeScript target emits byte-for-byte what emitServerProject does", () => {
  const opts = { serverName: "petstore", tools: [FIXTURE_GET], baseUrl: "https://x/api" };
  const viaTarget = getEmitTarget("typescript").emitProject(opts);
  const viaDirect = emitServerProject(opts);
  assert.deepEqual(viaTarget, viaDirect);
});

test("python is now a registered target (MCPFO-60.3)", () => {
  const target = getEmitTarget("python");
  assert.equal(target.language, "python");
});

test("an unregistered language fails loudly instead of defaulting", () => {
  // A language with no registered target must throw, not silently fall back to
  // a TypeScript project mislabeled as that language. (typescript + python are
  // registered; anything else is not.)
  assert.throws(
    // deliberate off-contract call: exercise the runtime guard, not the type.
    () => getEmitTarget("ruby" as never),
    /No emit target for language "ruby"/
  );
});
