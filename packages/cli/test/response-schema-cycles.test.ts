// packages/cli/test/response-schema-cycles.test.ts
//
// MCPFO-104 (ARCHITECTURE.md §91) — breakSchemaCycles is the guard that lets
// klaridian's outputSchema recovery survive real recursive/heavily-shared specs
// (Stripe: ~474/594 success bodies are cyclic after $ref dereference). A naive
// deep walk either overflows the stack (cycles) or expands exponentially
// (diamond sharing). The real-spec parity test exercises this implicitly on
// Stripe, but that coverage is only as durable as the corpus — these unit tests
// pin the intent directly and fail fast if the cycle break regresses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { breakSchemaCycles } from "../src/emit/response-schema.js";

test("breakSchemaCycles: a self-referential cycle terminates and collapses the repeat to {type:'object'}", () => {
  // A -> properties.self -> A  (a direct cycle; a naive clone would recurse forever)
  const a: Record<string, unknown> = { type: "object", properties: {} };
  (a.properties as Record<string, unknown>).self = a;

  // Must not throw / overflow.
  const out = breakSchemaCycles(a) as Record<string, unknown>;

  // First traversal of A is expanded; the back-reference collapses.
  assert.equal(out.type, "object");
  const selfNode = (out.properties as Record<string, unknown>).self;
  assert.deepEqual(selfNode, { type: "object" }, "the cyclic back-reference collapses to a generic object");
});

test("breakSchemaCycles: an indirect cycle (A -> B -> A) also terminates", () => {
  const a: Record<string, unknown> = { type: "object", properties: {} };
  const b: Record<string, unknown> = { type: "object", properties: {} };
  (a.properties as Record<string, unknown>).b = b;
  (b.properties as Record<string, unknown>).a = a;

  const out = breakSchemaCycles(a) as Record<string, unknown>;
  const bNode = (out.properties as Record<string, unknown>).b as Record<string, unknown>;
  // A recurs inside B, so the second sighting of A collapses.
  assert.deepEqual((bNode.properties as Record<string, unknown>).a, { type: "object" });
});

test("breakSchemaCycles: diamond sharing collapses the second reference (no exponential blow-up)", () => {
  // shared node referenced twice from the root; identity-visited => second one collapses.
  const shared: Record<string, unknown> = { type: "string", description: "shared" };
  const root: Record<string, unknown> = {
    type: "object",
    properties: { left: shared, right: shared },
  };

  const out = breakSchemaCycles(root) as Record<string, unknown>;
  const props = out.properties as Record<string, unknown>;
  // First sighting (left) is expanded in full; the second (right) collapses.
  assert.deepEqual(props.left, { type: "string", description: "shared" });
  assert.deepEqual(props.right, { type: "object" });
});

test("breakSchemaCycles: an acyclic, unshared schema is returned structurally unchanged", () => {
  // This is the property that keeps the Phase-1 goldens byte-for-byte identical:
  // every node is visited exactly once, so the output equals a plain deep clone.
  const schema = {
    type: "object",
    properties: {
      id: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      nested: { type: "object", properties: { n: { type: "number" } } },
    },
    required: ["id"],
  };

  const out = breakSchemaCycles(schema);
  assert.deepEqual(out, schema, "acyclic input round-trips unchanged");
  assert.notEqual(out, schema, "but it is a fresh object, not the same reference");
});

test("breakSchemaCycles: primitives and arrays pass through", () => {
  assert.equal(breakSchemaCycles("x"), "x");
  assert.equal(breakSchemaCycles(42), 42);
  assert.equal(breakSchemaCycles(null), null);
  assert.deepEqual(breakSchemaCycles([{ a: 1 }, { b: 2 }]), [{ a: 1 }, { b: 2 }]);
});
