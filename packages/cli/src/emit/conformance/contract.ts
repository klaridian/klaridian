// packages/cli/src/emit/conformance/contract.ts
//
// MCPFO-60.1 — the conformance contract every language target must satisfy.
//
// Spike 059 (ARCHITECTURE.md section 60.1) found that spec-mandated error
// surfacing is NOT free across SDKs: the TypeScript SDK v2 rejects a
// tools/call for an unknown tool with JSON-RPC -32602 natively, but a naive
// Python handler produced a non-conformant code: 0. Before that finding,
// TypeScript's conformance was implicit and accidental — nothing named it as a
// contract or tested it. This module makes it explicit and language-neutral so
// the Python target (MCPFO-60.3) implements against a shared contract rather
// than rediscovering the behavior.
//
// TWO-TIER ERROR MODEL (corrected against real SDK behavior, not the ticket's
// initial assumption — see the E2E test and ARCHITECTURE.md section 60.1):
// MCP surfaces failures at two distinct levels, and conformance means using
// the RIGHT level for each condition, not one code for everything.
//
//   1. Protocol errors — a JSON-RPC `error` object with a numeric code. Used
//      when the request is wrong at the protocol level (e.g. an unknown tool
//      name). The caller gets no `result`.
//
//   2. Tool-execution errors — a normal `result` with `isError: true` and
//      content describing the failure. Used for anything that happens WHILE
//      running the tool: input-schema validation failures, upstream HTTP
//      errors. This is deliberate MCP design — the model sees the error text
//      and can react, rather than the call failing opaquely at the protocol
//      layer. Verified: the TS SDK v2 returns invalid arguments this way
//      (`isError: true`, "Input validation error: ..."), NOT as -32602.
//
// The codes below are JSON-RPC 2.0 canonical (https://www.jsonrpc.org/
// specification#error_object); they belong in a shared contract precisely
// because both targets must reference the same values.

/** JSON-RPC 2.0: invalid method parameters. What an unknown-tool tools/call
 *  surfaces as at the protocol level in MCP. */
export const JSONRPC_INVALID_PARAMS = -32602;

/** JSON-RPC 2.0: internal error. */
export const JSONRPC_INTERNAL_ERROR = -32603;

/** How a given failure condition must be surfaced. */
export type ErrorSurface =
  | { readonly kind: "protocol"; readonly code: number }
  | { readonly kind: "tool-error" };

/**
 * The conditions a generated MCP server MUST surface correctly, regardless of
 * emit language. Each names its surface (protocol vs. tool-error) so tests and
 * both targets refer to the same contract point rather than a bare code.
 */
export interface ConformanceContract {
  /** tools/call naming a tool that isn't registered → protocol error -32602. */
  readonly unknownTool: ErrorSurface;
  /** tools/call whose arguments fail the tool's input schema → tool-error
   *  (result with isError: true), per the MCP two-tier model. */
  readonly invalidArguments: ErrorSurface;
  /** An error while executing the tool (e.g. an upstream HTTP failure) →
   *  tool-error (result with isError: true). */
  readonly toolExecutionError: ErrorSurface;
}

/** The single canonical contract instance shared by every target. */
export const CONFORMANCE_CONTRACT: ConformanceContract = {
  unknownTool: { kind: "protocol", code: JSONRPC_INVALID_PARAMS },
  invalidArguments: { kind: "tool-error" },
  toolExecutionError: { kind: "tool-error" },
};

/**
 * A per-language conformance adapter. Its job is to guarantee the contract
 * above in the emitted server. Some SDKs provide it natively (the adapter then
 * emits no extra server code); others need explicit error-mapping code
 * injected — that difference is precisely what spike 059 surfaced, and why
 * this is a per-target slot rather than a single shared implementation.
 */
export interface ConformanceAdapter {
  /** The language this adapter guarantees conformance for. */
  readonly language: string;
  /** The contract this adapter satisfies (always the canonical instance). */
  readonly contract: ConformanceContract;
  /**
   * Target-specific server code that must be injected to guarantee the
   * contract, or "" when the underlying SDK is already conformant (the
   * TypeScript case). Returning "" MUST leave the emitted project byte-for-byte
   * unchanged — a natively-conformant target adds nothing.
   */
  emitServerContributions(): string;
  /**
   * Human-readable explanation of how each contract point is satisfied for
   * this target. Surfaced in tests and for the Python target to mirror; not
   * emitted into the generated project.
   */
  describeCoverage(): string;
}
