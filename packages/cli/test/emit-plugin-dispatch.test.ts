// packages/cli/test/emit-plugin-dispatch.test.ts
//
// MCPFO-60.2 — unit tests for the plugin dispatch-boundary strategy. These
// pin the exact wrap strings the TypeScript strategy renders (the
// zero-behavior-change invariant: identical to what emit-tool.ts /
// emit-sandbox.ts hand-rolled inline before this refactor), plus the
// granularity and the EmitTarget slot. The proof that a wrapped server still
// builds and runs lives in emit-instrumentation.test.ts + emit-e2e.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { typescriptPluginDispatch } from "../src/emit/plugin-dispatch/typescript.js";
import { getEmitTarget } from "../src/emit/target.js";

const WIRING = { importStatement: 'import { wrapTool } from "./instrumentation/otel.js";', wrapFunctionName: "wrapTool" };

test("TS strategy is per-tool granularity", () => {
  assert.equal(typescriptPluginDispatch.granularity, "per-tool");
  assert.equal(typescriptPluginDispatch.language, "typescript");
});

test("wrapped handler open/close match the pre-refactor byte output", () => {
  assert.equal(
    typescriptPluginDispatch.wrapHandlerOpen("getPetById", WIRING),
    'wrapTool("getPetById", async (args) => {'
  );
  assert.equal(typescriptPluginDispatch.wrapHandlerClose(WIRING), "    })");
});

test("unwrapped handler open/close match the pre-refactor byte output", () => {
  assert.equal(typescriptPluginDispatch.wrapHandlerOpen("getPetById", undefined), "async (args) => {");
  assert.equal(typescriptPluginDispatch.wrapHandlerClose(undefined), "    }");
});

test("tool name is JSON-encoded in the wrap (handles quotes/specials safely)", () => {
  assert.equal(
    typescriptPluginDispatch.wrapHandlerOpen('weird"name', WIRING),
    'wrapTool("weird\\"name", async (args) => {'
  );
});

test("the TypeScript emit target exposes the dispatch strategy on its slot", () => {
  const target = getEmitTarget("typescript");
  assert.equal(target.pluginDispatch, typescriptPluginDispatch);
});
