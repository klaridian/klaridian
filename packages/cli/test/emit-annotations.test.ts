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
import { annotationsForMethod, titleForTool, resolveAnnotations } from "../src/emit/emit-tool.js";
import {
  parseKlaridianAnnotations,
  extractKlaridianByOperationId,
  prepareSpecForEngine,
  type ToolIR,
} from "../src/emit/ir.js";

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

// ---------------------------------------------------------------------------
// MCPFO-76 — object-form x-mcp annotations (readOnly/destructive/openWorld/expose)
// ---------------------------------------------------------------------------

function toolIR(partial: Partial<ToolIR>): ToolIR {
  return {
    name: "t",
    description: "",
    method: "get",
    pathTemplate: "/t",
    inputSchema: { type: "object" },
    executionParameters: [],
    securityRequirements: [],
    operationId: "t",
    ...partial,
  };
}

test("parseKlaridianAnnotations: object form maps recognised boolean keys", () => {
  assert.deepEqual(
    parseKlaridianAnnotations({ readOnly: true, destructive: false, openWorld: false, expose: true }),
    { readOnly: true, destructive: false, openWorld: false, expose: true }
  );
});

test("parseKlaridianAnnotations: unknown/non-boolean keys are dropped; empty/non-object → undefined", () => {
  assert.deepEqual(
    parseKlaridianAnnotations({ readOnly: true, description: "hi", bogus: 3 }),
    { readOnly: true }
  );
  assert.equal(parseKlaridianAnnotations({ description: "hi" }), undefined);
  assert.equal(parseKlaridianAnnotations(true), undefined); // not an object
  assert.equal(parseKlaridianAnnotations(undefined), undefined);
  assert.equal(parseKlaridianAnnotations(null), undefined);
});

test("resolveAnnotations: no x-klaridian → identical to method-derived defaults", () => {
  assert.deepEqual(resolveAnnotations(toolIR({ method: "post" })), annotationsForMethod("post"));
});

test("resolveAnnotations: x-klaridian overrides the method default per hint", () => {
  // POST would derive destructive:false, openWorld:true; author says destructive:true.
  const a = resolveAnnotations(
    toolIR({ method: "post", klaridian: { destructive: true } })
  );
  assert.equal(a.destructiveHint, true);
  assert.equal(a.readOnlyHint, false); // untouched method default
  assert.equal(a.openWorldHint, true); // untouched method default
  assert.equal(a.idempotentHint, false); // method-derived, never from x-klaridian
});

test("resolveAnnotations: an absent x-klaridian key falls back to that one hint's method default", () => {
  // GET derives readOnly:true; author only sets openWorld:false.
  const a = resolveAnnotations(
    toolIR({ method: "get", klaridian: { openWorld: false } })
  );
  assert.equal(a.openWorldHint, false); // overridden
  assert.equal(a.readOnlyHint, true); // still the GET default
  assert.equal(a.idempotentHint, true); // still the GET default
});

test("extractKlaridianByOperationId: collects x-klaridian keyed by operationId", () => {
  const doc: any = {
    openapi: "3.0.0",
    info: { title: "t", version: "1" },
    paths: {
      "/a": { get: { operationId: "aGet", "x-klaridian": { readOnly: true, expose: true } } },
      "/b": { post: { operationId: "bPost", "x-mcp": false } }, // boolean x-mcp → not ours
      "/c": { get: { operationId: "cGet" } }, // no x-klaridian
    },
  };
  const map = extractKlaridianByOperationId(doc);
  assert.deepEqual(map.get("aGet"), { readOnly: true, expose: true });
  assert.equal(map.has("bPost"), false);
  assert.equal(map.has("cGet"), false);
});

test("prepareSpecForEngine: x-klaridian.expose:false → x-mcp:false; object x-mcp collapsed; input untouched", () => {
  const doc: any = {
    openapi: "3.0.0",
    info: { title: "t", version: "1" },
    paths: {
      // hidden by author → engine-native exclusion
      "/a": { get: { operationId: "aGet", "x-klaridian": { readOnly: true, expose: false } } },
      // exposed by author (no expose key) → left includable
      "/b": { get: { operationId: "bGet", "x-klaridian": { readOnly: true } } },
      // third-party object x-mcp → collapsed to boolean so the engine stays quiet
      "/c": { post: { operationId: "cPost", "x-mcp": { readOnly: true, expose: true } } },
      // third-party object x-mcp with expose:false → collapsed to false
      "/d": { get: { operationId: "dGet", "x-mcp": { expose: false } } },
    },
  };
  const out: any = prepareSpecForEngine(doc);
  assert.equal(out.paths["/a"].get["x-mcp"], false);
  assert.equal(out.paths["/b"].get["x-mcp"], undefined); // untouched, engine defaults to include
  assert.equal(out.paths["/c"].post["x-mcp"], true);
  assert.equal(out.paths["/d"].get["x-mcp"], false);
  // input document is not mutated (deep clone)
  assert.equal(doc.paths["/a"].get["x-mcp"], undefined);
  assert.deepEqual(doc.paths["/c"].post["x-mcp"], { readOnly: true, expose: true });
});
