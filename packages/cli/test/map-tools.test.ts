// packages/cli/test/map-tools.test.ts
//
// Tests the OpenAPI -> ToolDefinition mapping against the real Petstore spec
// (examples/petstore/openapi.json) plus targeted fixtures for edge cases
// (oneOf/allOf, missing operationId, duplicate names) that the real spec
// doesn't happen to exercise.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseOpenApiSpec } from "../src/openapi/parse.js";
import { mapOpenApiToTools } from "../src/openapi/map-tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// NOTE: this file is compiled to packages/cli/dist/test/map-tools.test.js
// before running (see package.json test script), so the relative path is
// computed from the *compiled* location, not the source location.
const PETSTORE_SPEC_PATH = path.resolve(
  __dirname,
  "../../../../examples/petstore/openapi.json"
);

test("maps every operation in the real Petstore spec without hard errors", async () => {
  const spec = await parseOpenApiSpec(PETSTORE_SPEC_PATH);
  const result = mapOpenApiToTools(spec);

  // The Petstore spec has 19 operations across pet/store/user (verified
  // manually against the spec during the spike phase).
  assert.equal(result.errors.length, 0, `Unexpected errors: ${JSON.stringify(result.errors, null, 2)}`);
  assert.equal(result.tools.length, 19, `Expected 19 tools, got ${result.tools.length}: ${result.tools.map(t => t.name).join(", ")}`);
});

test("getPetById maps to a tool with a required path parameter", async () => {
  const spec = await parseOpenApiSpec(PETSTORE_SPEC_PATH);
  const result = mapOpenApiToTools(spec);

  const tool = result.tools.find((t) => t.name === "getPetById");
  assert.ok(tool, "getPetById tool should exist");
  assert.equal(tool!.method, "get");
  assert.equal(tool!.path, "/pet/{petId}");

  const petIdParam = tool!.parameters.find((p) => p.name === "petId");
  assert.ok(petIdParam, "petId parameter should exist");
  assert.equal(petIdParam!.location, "path");
  assert.equal(petIdParam!.required, true);

  assert.deepEqual(tool!.inputSchema.required, ["petId"]);
});

test("findPetsByStatus maps to a tool with a required query parameter with enum", async () => {
  const spec = await parseOpenApiSpec(PETSTORE_SPEC_PATH);
  const result = mapOpenApiToTools(spec);

  const tool = result.tools.find((t) => t.name === "findPetsByStatus");
  assert.ok(tool, "findPetsByStatus tool should exist");

  const statusParam = tool!.parameters.find((p) => p.name === "status");
  assert.ok(statusParam, "status parameter should exist");
  assert.equal(statusParam!.location, "query");
  // Per the real Petstore spec, `status` is required: true (has a default
  // value too, but the spec still marks it required).
  assert.equal(statusParam!.required, true);
  assert.ok(Array.isArray(statusParam!.schema.enum), "status should have an enum");
});

test("addPet maps to a tool with a body parameter", async () => {
  const spec = await parseOpenApiSpec(PETSTORE_SPEC_PATH);
  const result = mapOpenApiToTools(spec);

  const tool = result.tools.find((t) => t.name === "addPet");
  assert.ok(tool, "addPet tool should exist");

  const bodyParam = tool!.parameters.find((p) => p.name === "body");
  assert.ok(bodyParam, "addPet should have a body parameter");
  assert.equal(bodyParam!.location, "body");
});

test("baseUrl is extracted from the spec's servers array", async () => {
  const spec = await parseOpenApiSpec(PETSTORE_SPEC_PATH);
  const result = mapOpenApiToTools(spec);

  // The real Petstore spec declares a relative server URL ("/api/v3"), not
  // an absolute one — mapOpenApiToTools should pass it through as-is and
  // leave resolving it against a real host to the generated server /
  // its config, not guess a domain here.
  assert.equal(result.baseUrl, "/api/v3");
});

// --- Edge cases via inline fixtures (not present in the real Petstore spec) ---

function fixtureSpec(paths: Record<string, unknown>) {
  return {
    openapi: "3.0.0",
    info: { title: "fixture", version: "1.0.0" },
    paths,
  };
}

test("operation with missing operationId falls back to a derived name with a warning", () => {
  const spec = fixtureSpec({
    "/widgets/{id}": {
      get: {
        summary: "Get a widget",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "ok" } },
      },
    },
  });

  const result = mapOpenApiToTools(spec as any);
  assert.equal(result.tools.length, 1);
  assert.equal(result.tools[0].name, "get_widgets_id");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0].message, /no operationId/);
});

test("operation using oneOf in a parameter schema is skipped with a hard error, not silently mismapped", () => {
  const spec = fixtureSpec({
    "/widgets": {
      post: {
        operationId: "createWidget",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                oneOf: [{ type: "string" }, { type: "number" }],
              },
            },
          },
        },
        responses: { "200": { description: "ok" } },
      },
    },
  });

  const result = mapOpenApiToTools(spec as any);
  assert.equal(result.tools.length, 0, "operation with oneOf should be skipped, not mapped");
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /oneOf/);
});

test("duplicate derived tool names produce a hard error", () => {
  const spec = fixtureSpec({
    "/widgets/foo": {
      get: {
        // no operationId -> both derive to the same fallback shape after sanitization
        responses: { "200": { description: "ok" } },
      },
    },
    "/widgets-foo": {
      get: {
        responses: { "200": { description: "ok" } },
      },
    },
  });

  const result = mapOpenApiToTools(spec as any);
  const dupErrors = result.errors.filter((e) => e.message.includes("Duplicate tool name"));
  assert.equal(dupErrors.length, 1, "should detect the name collision");
});

test("non-JSON request body is skipped with a warning, not an error", () => {
  const spec = fixtureSpec({
    "/upload": {
      post: {
        operationId: "uploadFile",
        requestBody: {
          content: {
            "application/octet-stream": { schema: { type: "string", format: "binary" } },
          },
        },
        responses: { "200": { description: "ok" } },
      },
    },
  });

  const result = mapOpenApiToTools(spec as any);
  assert.equal(result.tools.length, 1, "operation should still be mapped, just without the body");
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0].message, /application\/json/);
});

// --- allOf support (ARCHITECTURE.md section 14 — highest-priority post-v0 fix) ---

test("allOf request body is merged into a flat object schema, not rejected", () => {
  const spec = fixtureSpec({
    "/campaigns": {
      post: {
        operationId: "createCampaign",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                allOf: [
                  {
                    type: "object",
                    properties: { name: { type: "string" } },
                    required: ["name"],
                  },
                  {
                    type: "object",
                    properties: { voice_campaign: { type: "boolean" } },
                    required: ["voice_campaign"],
                  },
                ],
              },
            },
          },
        },
        responses: { "200": { description: "ok" } },
      },
    },
  });

  const result = mapOpenApiToTools(spec as any);
  assert.equal(result.errors.length, 0, `Unexpected errors: ${JSON.stringify(result.errors)}`);
  assert.equal(result.tools.length, 1);

  const bodyParam = result.tools[0].parameters.find((p) => p.name === "body");
  assert.ok(bodyParam, "body parameter should exist");
  assert.equal(bodyParam!.schema.type, "object");
  // Both allOf branches' properties should be merged into one flat schema.
  assert.ok(bodyParam!.schema.properties?.name, "name from first branch should be present");
  assert.ok(bodyParam!.schema.properties?.voice_campaign, "voice_campaign from second branch should be present");
  // required from both branches should be unioned.
  assert.deepEqual(new Set(bodyParam!.schema.required), new Set(["name", "voice_campaign"]));
});

test("allOf in a parameter schema is merged rather than rejected", () => {
  const spec = fixtureSpec({
    "/widgets/{id}": {
      get: {
        operationId: "getWidget",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: {
              allOf: [{ type: "string" }, { description: "Widget identifier" }],
            },
          },
        ],
        responses: { "200": { description: "ok" } },
      },
    },
  });

  const result = mapOpenApiToTools(spec as any);
  assert.equal(result.errors.length, 0);
  assert.equal(result.tools.length, 1);
  const idParam = result.tools[0].parameters.find((p) => p.name === "id");
  assert.equal(idParam!.schema.type, "string");
});

test("nested allOf (allOf member that itself has allOf) is fully flattened", () => {
  const spec = fixtureSpec({
    "/things": {
      post: {
        operationId: "createThing",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                allOf: [
                  {
                    allOf: [
                      { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
                      { type: "object", properties: { b: { type: "string" } }, required: ["b"] },
                    ],
                  },
                  { type: "object", properties: { c: { type: "string" } }, required: ["c"] },
                ],
              },
            },
          },
        },
        responses: { "200": { description: "ok" } },
      },
    },
  });

  const result = mapOpenApiToTools(spec as any);
  assert.equal(result.errors.length, 0, `Unexpected errors: ${JSON.stringify(result.errors)}`);
  const bodyParam = result.tools[0].parameters.find((p) => p.name === "body");
  assert.ok(bodyParam!.schema.properties?.a);
  assert.ok(bodyParam!.schema.properties?.b);
  assert.ok(bodyParam!.schema.properties?.c);
  assert.deepEqual(new Set(bodyParam!.schema.required), new Set(["a", "b", "c"]));
});

test("allOf containing a oneOf branch still produces a hard error (allOf merging doesn't hide genuine ambiguity)", () => {
  const spec = fixtureSpec({
    "/ambiguous": {
      post: {
        operationId: "createAmbiguous",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                allOf: [
                  { type: "object", properties: { name: { type: "string" } } },
                  { oneOf: [{ type: "string" }, { type: "number" }] },
                ],
              },
            },
          },
        },
        responses: { "200": { description: "ok" } },
      },
    },
  });

  const result = mapOpenApiToTools(spec as any);
  assert.equal(result.tools.length, 0, "operation with a oneOf nested inside allOf should still be rejected");
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /oneOf/);
});
