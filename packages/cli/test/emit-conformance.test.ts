// packages/cli/test/emit-conformance.test.ts
//
// MCPFO-60.1 — unit tests for the conformance contract + TypeScript adapter.
// These assert the contract's canonical JSON-RPC codes and that the TS adapter
// is natively conformant (contributes no server code, so the emitted project
// is unchanged). The wire-level proof that a running server actually returns
// these codes lives in emit-e2e.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFORMANCE_CONTRACT,
  JSONRPC_INVALID_PARAMS,
} from "../src/emit/conformance/contract.js";
import { typescriptConformanceAdapter } from "../src/emit/conformance/typescript.js";
import { getEmitTarget } from "../src/emit/target.js";

test("the conformance contract uses the correct two-tier error surfaces", () => {
  // unknown tool → protocol error -32602
  assert.deepEqual(CONFORMANCE_CONTRACT.unknownTool, {
    kind: "protocol",
    code: JSONRPC_INVALID_PARAMS,
  });
  // invalid arguments and tool-execution errors → tool-error (isError: true),
  // NOT a protocol error, per the MCP two-tier model (verified against the SDK
  // in emit-e2e.test.ts).
  assert.deepEqual(CONFORMANCE_CONTRACT.invalidArguments, { kind: "tool-error" });
  assert.deepEqual(CONFORMANCE_CONTRACT.toolExecutionError, { kind: "tool-error" });
});

test("the TypeScript adapter is natively conformant (no injected server code)", () => {
  assert.equal(typescriptConformanceAdapter.language, "typescript");
  assert.equal(typescriptConformanceAdapter.contract, CONFORMANCE_CONTRACT);
  // "" is load-bearing: a natively-conformant target adds nothing, which is
  // what makes this a zero-behavior-change refactor.
  assert.equal(typescriptConformanceAdapter.emitServerContributions(), "");
  assert.match(typescriptConformanceAdapter.describeCoverage(), /native/);
});

test("the TypeScript emit target exposes the conformance adapter on its slot", () => {
  const target = getEmitTarget("typescript");
  assert.equal(target.conformance, typescriptConformanceAdapter);
});
