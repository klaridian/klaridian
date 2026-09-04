// packages/cli/test/emit-client.test.ts
//
// MCPFO-29 — typed client generation for SDK code mode (ARCHITECTURE.md
// section 43). Unit tests for the identifier-naming helpers and the shape of
// generated function bodies; emit-client-e2e.test.ts covers the load-bearing
// real compile+run path per the repo's standing rule (CLAUDE.md).

import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeFunctionName, dedupeFunctionNames, emitClientModule } from "../src/emit/emit-client.js";
import type { McpToolDefinition } from "openapi-mcp-generator";

test("sanitizeFunctionName keeps valid identifiers unchanged", () => {
  assert.equal(sanitizeFunctionName("getPetById"), "getPetById");
  assert.equal(sanitizeFunctionName("find_pets_by_status"), "find_pets_by_status");
});

test("sanitizeFunctionName replaces non-identifier characters", () => {
  assert.equal(sanitizeFunctionName("get-pet.by/id"), "get_pet_by_id");
});

test("sanitizeFunctionName prefixes a leading digit", () => {
  assert.equal(sanitizeFunctionName("2faLogin"), "_2faLogin");
});

test("sanitizeFunctionName falls back to a default for an empty name", () => {
  assert.equal(sanitizeFunctionName(""), "operation");
});

test("dedupeFunctionNames leaves unique names untouched", () => {
  assert.deepEqual(dedupeFunctionNames(["getPet", "listPets", "deletePet"]), ["getPet", "listPets", "deletePet"]);
});

test("dedupeFunctionNames appends a deterministic numeric suffix to repeats", () => {
  assert.deepEqual(dedupeFunctionNames(["getPet", "getPet", "getPet"]), ["getPet", "getPet_1", "getPet_2"]);
});

function makeTool(overrides: Partial<McpToolDefinition> = {}): McpToolDefinition {
  return {
    name: "getPetById",
    operationId: "getPetById",
    description: "Find pet by ID",
    inputSchema: {
      type: "object",
      properties: { petId: { type: "integer" } },
      required: ["petId"],
    },
    method: "get",
    pathTemplate: "/pet/{petId}",
    parameters: [],
    executionParameters: [{ name: "petId", in: "path" }],
    securityRequirements: [],
    ...overrides,
  } as McpToolDefinition;
}

test("emitClientModule emits one exported async function per tool, named from operationId", () => {
  const src = emitClientModule([makeTool()]);
  assert.match(src, /export async function getPetById\(args: GetPetByIdInput\): Promise<ApiResult>/);
  assert.match(src, /export const GetPetByIdInputSchema = /);
  assert.match(src, /export type GetPetByIdInput = z\.infer<typeof GetPetByIdInputSchema>;/);
});

test("emitClientModule's client namespace lists every function", () => {
  const src = emitClientModule([
    makeTool({ operationId: "getPetById", name: "getPetById" }),
    makeTool({ operationId: "listPets", name: "listPets", method: "get", pathTemplate: "/pets", executionParameters: [] }),
  ]);
  assert.match(src, /export const client = \{\n {2}getPetById,\n {2}listPets,\n\};/);
});

test("emitClientModule dedupes colliding operationIds in the generated function names", () => {
  const src = emitClientModule([
    makeTool({ operationId: "get_pet", name: "a" }),
    makeTool({ operationId: "get-pet", name: "b" }), // sanitizes to the same identifier as above
  ]);
  assert.match(src, /export async function get_pet\(/);
  assert.match(src, /export async function get_pet_1\(/);
});

test("emitClientModule validates input via the generated Zod schema before building the request", () => {
  const src = emitClientModule([makeTool()]);
  assert.match(src, /const parsed = GetPetByIdInputSchema\.parse\(args\) as GetPetByIdInput;/);
});

test("emitClientModule throws ApiError on a non-2xx response instead of returning it silently", () => {
  const src = emitClientModule([makeTool()]);
  assert.match(src, /if \(!resp\.ok\) throw new ApiError\(resp\.status, resp\.statusText, data\);/);
  assert.match(src, /export class ApiError extends Error \{/);
});

test("emitClientModule includes Bearer auth header wiring only for tools with security requirements", () => {
  const withAuth = emitClientModule([makeTool({ securityRequirements: [{ bearerAuth: [] }] })]);
  assert.match(withAuth, /headers\["Authorization"\] = "Bearer " \+ process\.env\.KLARIDIAN_AUTH_TOKEN;/);

  const withoutAuth = emitClientModule([makeTool({ securityRequirements: [] })]);
  assert.doesNotMatch(withoutAuth, /KLARIDIAN_AUTH_TOKEN/);
});

test("emitClientModule includes a request body content-type header only for tools with a request body", () => {
  const withBody = emitClientModule([makeTool({ requestBodyContentType: "application/json" })]);
  assert.match(withBody, /headers\["Content-Type"\] = "application\/json";/);

  const withoutBody = emitClientModule([makeTool({ requestBodyContentType: undefined })]);
  assert.doesNotMatch(withoutBody, /Content-Type/);
});
