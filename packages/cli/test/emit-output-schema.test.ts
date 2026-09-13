// packages/cli/test/emit-output-schema.test.ts
//
// MCPFO-33 (ARCHITECTURE.md §83) — per-tool `outputSchema` / `structuredContent`
// emitted from the OpenAPI success response, via klaridian's OWN response-schema
// extraction (`emit/response-schema.ts`, the embryo of the own-engine, §65).
//
// Two layers:
//  1. Pure unit tests of the gating + extraction (isObjectRootSchema,
//     pickSuccessObjectSchema, extractOutputSchemasByOperationId) — fast.
//  2. Emitter tests: emitToolBlock (TS) and the Python registry entry advertise
//     outputSchema + populate structuredContent ONLY when the IR carries one,
//     and remain byte-identical to before when it doesn't.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isObjectRootSchema,
  pickSuccessObjectSchema,
  extractOutputSchemasByOperationId,
} from "../src/emit/response-schema.js";
import { emitToolBlock } from "../src/emit/emit-tool.js";
import type { ToolIR } from "../src/emit/ir.js";

const objectSchema = { type: "object", properties: { id: { type: "string" } } } as const;

function baseTool(overrides: Partial<ToolIR> = {}): ToolIR {
  return {
    name: "getThing",
    description: "Get a thing",
    method: "get",
    pathTemplate: "/things/{id}",
    inputSchema: { type: "object", properties: { id: { type: "string" } } },
    executionParameters: [{ name: "id", in: "path" }],
    securityRequirements: [],
    operationId: "getThing",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isObjectRootSchema — the gate
// ---------------------------------------------------------------------------

test("isObjectRootSchema: explicit object type → true", () => {
  assert.equal(isObjectRootSchema(objectSchema), true);
});

test("isObjectRootSchema: properties without explicit type → true (object shorthand)", () => {
  assert.equal(isObjectRootSchema({ properties: { a: { type: "string" } } }), true);
});

test("isObjectRootSchema: type array including object → true", () => {
  assert.equal(isObjectRootSchema({ type: ["object", "null"] }), true);
});

test("isObjectRootSchema: array root → false (gated out)", () => {
  assert.equal(isObjectRootSchema({ type: "array", items: objectSchema }), false);
});

test("isObjectRootSchema: primitive root → false", () => {
  assert.equal(isObjectRootSchema({ type: "string" }), false);
});

test("isObjectRootSchema: root-level oneOf/anyOf/allOf → false (ambiguous)", () => {
  assert.equal(isObjectRootSchema({ oneOf: [objectSchema] }), false);
  assert.equal(isObjectRootSchema({ anyOf: [objectSchema] }), false);
  assert.equal(isObjectRootSchema({ allOf: [objectSchema] }), false);
});

test("isObjectRootSchema: null/undefined/non-object → false", () => {
  assert.equal(isObjectRootSchema(undefined), false);
  assert.equal(isObjectRootSchema(null), false);
  assert.equal(isObjectRootSchema("nope"), false);
  assert.equal(isObjectRootSchema([objectSchema]), false);
});

// ---------------------------------------------------------------------------
// pickSuccessObjectSchema — status-code precedence + JSON content gate
// ---------------------------------------------------------------------------

test("pickSuccessObjectSchema: prefers 200 over other 2xx", () => {
  const picked = pickSuccessObjectSchema({
    "200": { description: "ok", content: { "application/json": { schema: { type: "object", properties: { a: {} } } } } },
    "201": { description: "created", content: { "application/json": { schema: { type: "object", properties: { b: {} } } } } },
  } as never);
  assert.ok(picked);
  assert.deepEqual(Object.keys(picked!.properties ?? {}), ["a"]);
});

test("pickSuccessObjectSchema: falls back to 201 when no 200", () => {
  const picked = pickSuccessObjectSchema({
    "201": { description: "created", content: { "application/json": { schema: objectSchema } } },
  } as never);
  assert.ok(picked);
});

test("pickSuccessObjectSchema: array 2xx body → undefined (gated)", () => {
  const picked = pickSuccessObjectSchema({
    "200": { description: "list", content: { "application/json": { schema: { type: "array", items: objectSchema } } } },
  } as never);
  assert.equal(picked, undefined);
});

test("pickSuccessObjectSchema: no JSON content (204) → undefined", () => {
  const picked = pickSuccessObjectSchema({ "204": { description: "no content" } } as never);
  assert.equal(picked, undefined);
});

test("pickSuccessObjectSchema: only error responses → undefined", () => {
  const picked = pickSuccessObjectSchema({
    "404": { description: "not found" },
    "500": { description: "boom" },
  } as never);
  assert.equal(picked, undefined);
});

// ---------------------------------------------------------------------------
// extractOutputSchemasByOperationId — end-to-end over a real spec file,
// including $ref dereferencing (the reason we own this, not the engine).
// ---------------------------------------------------------------------------

test("extractOutputSchemasByOperationId: dereferences $ref, gates array/none out", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "klaridian-os-extract-"));
  try {
    const specPath = path.join(dir, "openapi.json");
    await writeFile(
      specPath,
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "t", version: "1.0.0" },
        paths: {
          "/w/{id}": {
            get: {
              operationId: "getWidget",
              responses: {
                "200": { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Widget" } } } },
              },
            },
          },
          "/w": {
            get: {
              operationId: "listWidgets",
              responses: {
                "200": { description: "list", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Widget" } } } } },
              },
            },
          },
          "/ping": {
            get: { operationId: "ping", responses: { "204": { description: "no content" } } },
          },
        },
        components: {
          schemas: {
            Widget: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } }, required: ["id"] },
          },
        },
      }),
      "utf-8"
    );

    const map = await extractOutputSchemasByOperationId(specPath);
    // getWidget: object body via $ref → present + dereferenced (no $ref left).
    assert.ok(map.has("getWidget"));
    const gw = map.get("getWidget")!;
    assert.equal(gw.type, "object");
    assert.deepEqual(Object.keys(gw.properties ?? {}).sort(), ["id", "name"]);
    assert.equal(JSON.stringify(gw).includes("$ref"), false, "must be dereferenced");
    // listWidgets: array root → gated out.
    assert.equal(map.has("listWidgets"), false);
    // ping: no JSON body → gated out.
    assert.equal(map.has("ping"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("extractOutputSchemasByOperationId: unparseable/broken spec → empty map (fail-soft)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "klaridian-os-broken-"));
  try {
    const specPath = path.join(dir, "openapi.json");
    await writeFile(specPath, "{ not valid json", "utf-8");
    const map = await extractOutputSchemasByOperationId(specPath);
    assert.equal(map.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// emitToolBlock (TypeScript) — advertise + populate only when IR carries schema
// ---------------------------------------------------------------------------

test("emitToolBlock: no outputSchema on IR → no outputSchema, no structuredContent (unchanged)", () => {
  const src = emitToolBlock(baseTool());
  assert.equal(src.includes("outputSchema:"), false);
  assert.equal(src.includes("structuredContent"), false);
  assert.match(src, /isError: !resp\.ok/);
});

test("emitToolBlock: outputSchema on IR → advertises outputSchema + populates structuredContent on success", () => {
  const src = emitToolBlock(baseTool({ outputSchema: objectSchema }));
  assert.match(src, /outputSchema: z\.object/);
  assert.match(src, /const structuredContent = JSON\.parse\(text\)/);
  // Success path returns structuredContent; error path stays isError with no structuredContent.
  assert.match(src, /if \(resp\.ok\)/);
  assert.match(src, /return \{ content: \[\{ type: "text" as const, text \}\], isError: true \}/);
  // Must NOT unconditionally set structuredContent (would break on !ok / non-JSON).
  assert.equal(src.includes("structuredContent }], isError"), false);
});
