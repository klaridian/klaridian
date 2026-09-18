// packages/cli/test/json-schema-dialect.test.ts
//
// MCPFO-91 (ARCHITECTURE.md §89) — re-dialect tool input/output JSON Schema from
// draft-07 (what OpenAPI-3.x-derived schemas arrive as) to JSON Schema 2020-12,
// the MCP default dialect. Unit tests for the pure normalizer; the golden test
// (ir-golden.test.ts) and the E2E tests prove it through the real pipeline +
// spawned servers.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toJsonSchema2020,
  JSON_SCHEMA_2020_12_URI,
} from "../src/emit/json-schema-dialect.js";
import type { JSONSchema7 } from "json-schema";

// ---------------------------------------------------------------------------
// $schema dialect declaration
// ---------------------------------------------------------------------------

test("stamps the 2020-12 $schema on an object schema root", () => {
  const out = toJsonSchema2020({ type: "object", properties: { a: { type: "string" } } }) as JSONSchema7;
  assert.equal(out.$schema, JSON_SCHEMA_2020_12_URI);
  assert.equal(out.type, "object");
});

test("overwrites a source-declared draft-07 $schema with the 2020-12 URI", () => {
  const out = toJsonSchema2020({
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
  } as JSONSchema7) as JSONSchema7;
  assert.equal(out.$schema, JSON_SCHEMA_2020_12_URI);
});

test("boolean schemas pass through unchanged (no $schema attachable)", () => {
  assert.equal(toJsonSchema2020(true), true);
  assert.equal(toJsonSchema2020(false), false);
});

// ---------------------------------------------------------------------------
// exclusiveMinimum / exclusiveMaximum: boolean draft-07 form → numeric 2020-12
// ---------------------------------------------------------------------------

test("exclusiveMinimum:true + minimum → numeric exclusiveMinimum, minimum dropped", () => {
  const out = toJsonSchema2020({
    type: "number",
    minimum: 0,
    exclusiveMinimum: true,
  } as unknown as JSONSchema7) as Record<string, unknown>;
  assert.equal(out.exclusiveMinimum, 0);
  assert.ok(!("minimum" in out), "inclusive minimum removed");
});

test("exclusiveMaximum:true + maximum → numeric exclusiveMaximum, maximum dropped", () => {
  const out = toJsonSchema2020({
    type: "number",
    maximum: 100,
    exclusiveMaximum: true,
  } as unknown as JSONSchema7) as Record<string, unknown>;
  assert.equal(out.exclusiveMaximum, 100);
  assert.ok(!("maximum" in out));
});

test("exclusiveMinimum:false → flag dropped, minimum kept as inclusive bound", () => {
  const out = toJsonSchema2020({
    type: "integer",
    minimum: 1,
    exclusiveMinimum: false,
  } as unknown as JSONSchema7) as Record<string, unknown>;
  assert.ok(!("exclusiveMinimum" in out), "boolean flag removed");
  assert.equal(out.minimum, 1);
});

test("boolean exclusiveMinimum with no paired minimum → flag dropped (uncoercible)", () => {
  const out = toJsonSchema2020({
    type: "number",
    exclusiveMinimum: true,
  } as unknown as JSONSchema7) as Record<string, unknown>;
  assert.ok(!("exclusiveMinimum" in out));
});

test("already-numeric exclusiveMinimum (2020-12) is left untouched", () => {
  const out = toJsonSchema2020({
    type: "number",
    exclusiveMinimum: 5,
  } as unknown as JSONSchema7) as Record<string, unknown>;
  assert.equal(out.exclusiveMinimum, 5);
});

test("converts exclusive bounds nested inside properties + items + arrays", () => {
  const out = toJsonSchema2020({
    type: "object",
    properties: {
      nums: {
        type: "array",
        items: { type: "number", minimum: 0, exclusiveMinimum: true },
      },
      choice: {
        anyOf: [{ type: "number", maximum: 10, exclusiveMaximum: true }, { type: "null" }],
      },
    },
  } as unknown as JSONSchema7) as Record<string, unknown>;
  const props = out.properties as Record<string, Record<string, unknown>>;
  const items = props.nums.items as Record<string, unknown>;
  assert.equal(items.exclusiveMinimum, 0);
  assert.ok(!("minimum" in items));
  const anyOf = props.choice.anyOf as Array<Record<string, unknown>>;
  assert.equal(anyOf[0].exclusiveMaximum, 10);
});

// ---------------------------------------------------------------------------
// definitions → $defs (defensive; usually dereferenced away)
// ---------------------------------------------------------------------------

test("definitions → $defs and #/definitions/ $ref pointers rewritten to #/$defs/", () => {
  const out = toJsonSchema2020({
    type: "object",
    properties: { thing: { $ref: "#/definitions/Thing" } },
    definitions: { Thing: { type: "string" } },
  } as unknown as JSONSchema7) as Record<string, unknown>;
  assert.ok("$defs" in out, "definitions renamed to $defs");
  assert.ok(!("definitions" in out));
  const props = out.properties as Record<string, Record<string, unknown>>;
  assert.equal(props.thing.$ref, "#/$defs/Thing");
});

// ---------------------------------------------------------------------------
// 2020-12-valid input is preserved; nullable arrays untouched
// ---------------------------------------------------------------------------

test("type array including null (OpenAPI 3.0 nullable) is preserved as valid 2020-12", () => {
  const out = toJsonSchema2020({
    type: "object",
    properties: { name: { type: ["string", "null"] } },
  } as unknown as JSONSchema7) as Record<string, unknown>;
  const props = out.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(props.name.type, ["string", "null"]);
});

test("does not mutate the input schema object", () => {
  const input = { type: "number", minimum: 0, exclusiveMinimum: true } as unknown as JSONSchema7;
  toJsonSchema2020(input);
  assert.equal((input as Record<string, unknown>).exclusiveMinimum, true, "input untouched");
  assert.equal((input as Record<string, unknown>).minimum, 0);
});
