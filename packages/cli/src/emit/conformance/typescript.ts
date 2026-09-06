// packages/cli/src/emit/conformance/typescript.ts
//
// MCPFO-60.1 — the TypeScript conformance adapter.
//
// The @modelcontextprotocol/server v2 SDK satisfies the whole conformance
// contract natively (verified end to end in emit-e2e.test.ts, which drives a
// real spawned server over JSON-RPC):
//   - unknownTool          → the SDK rejects a tools/call for an unregistered
//                            name with JSON-RPC -32602 (protocol error) before
//                            the handler runs.
//   - invalidArguments     → the SDK validates args against the tool's zod
//                            inputSchema and returns a tool-error result
//                            (isError: true, "Input validation error: ..."),
//                            per the MCP two-tier model — NOT a -32602 protocol
//                            error. (This corrected the ticket's initial
//                            assumption; see contract.ts.)
//   - toolExecutionError   → the emitted handler returns isError: !resp.ok, so
//                            an upstream HTTP failure is a tool-error result.
// So this adapter emits NO extra server code — emitServerContributions()
// returns "", keeping the generated project byte-for-byte identical to before
// MCPFO-60.1.
//
// The value of this module is not code injection (there is none for TS); it's
// naming the previously-implicit guarantee as a first-class, tested contract so
// the Python target (MCPFO-60.3), whose SDK does NOT provide this for free
// (spike 059), has an explicit spec to implement rather than an accident to
// rediscover.

import {
  CONFORMANCE_CONTRACT,
  type ConformanceAdapter,
  type ConformanceContract,
} from "./contract.js";

export const typescriptConformanceAdapter: ConformanceAdapter = {
  language: "typescript",
  contract: CONFORMANCE_CONTRACT,
  emitServerContributions(): string {
    // Natively conformant — nothing to inject. Returning "" is load-bearing:
    // it is what keeps this a zero-behavior-change refactor.
    return "";
  },
  describeCoverage(): string {
    return [
      "unknownTool: native protocol error — @modelcontextprotocol/server",
      "  rejects a tools/call for an unregistered tool name with -32602.",
      "invalidArguments: native tool-error — args are validated against the",
      "  tool's zod inputSchema; a mismatch returns isError: true with an",
      "  \"Input validation error\" message, per the MCP two-tier model.",
      "toolExecutionError: native tool-error — the emitted handler returns",
      "  isError: !resp.ok, so an upstream HTTP failure is a tool-error result.",
    ].join("\n");
  },
};

/** Re-exported for callers that only need the contract shape. */
export type { ConformanceContract };
