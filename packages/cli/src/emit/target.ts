// packages/cli/src/emit/target.ts
//
// MCPFO-60.0 — the EmitTarget abstraction.
//
// Section 60 (ARCHITECTURE.md) reverses the TypeScript-only guardrail and
// commits klaridian to a second real language target (Python). The forcing
// function only works if `--language` dispatches to a *target implementation*
// rather than to `if (language === "python")` branches scattered through the
// already-oversized generate.ts god file (section 57). This file defines that
// dispatch seam.
//
// Scope discipline (MCPFO-60.0): this is a TS-first refactor with NO behavior
// change. It defines the interface shape and makes the existing TypeScript
// emitter its first implementation. The two abstractions that fill in the
// target-specific slots below arrive in their own tickets and MUST NOT be
// pre-built here:
//   - the per-target conformance adapter (MCPFO-60.1) — spec-mandated JSON-RPC
//     error shapes the underlying SDK doesn't provide for free;
//   - the plugin dispatch-boundary contract (MCPFO-60.2) — where a plugin's
//     instrumentation wraps the tool-dispatch path (per-tool `registerTool`
//     for TS; the shared `on_call_tool` dispatch for Python).
// Today both are satisfied natively by the TypeScript SDK v2 and by the
// existing `wiring` field on EmitOptions respectively; a second target is what
// forces them to become explicit slots on this interface. See ARCHITECTURE.md
// section 60.1 / 60.2 for the design, and keep them out of this ticket.
//
// The tool-data IR (openapi-mcp-generator's getToolsFromOpenApi() output) is
// deliberately NOT part of this interface: spike 059 (ARCHITECTURE.md section
// 60.3) proved the IR is already language-neutral and needs zero changes to
// support a second target. All coupling to TypeScript lived in the
// rendering/dispatch layer this interface abstracts, never in the data model.

import type { EmitOptions, EmittedProject } from "./emit-server.js";
import { emitServerProject } from "./emit-server.js";

/** Languages a generated MCP server project can be emitted in. */
export type TargetLanguage = "typescript" | "python";

/**
 * A language target: everything the generator needs to turn the (language-
 * neutral) tool-data IR + EmitOptions into a complete, buildable project.
 *
 * `emitProject` is the single operation generate.ts dispatches on. A target
 * composes its own sub-emitters (server entrypoint, per-tool blocks, typed
 * client, sandbox runner, docs data, project manifest files) internally — how
 * that composition is structured is the target's own concern, not part of this
 * contract, precisely because the two targets differ there (TS emits one MCP
 * tool per operation via `registerTool`; Python's SDK exposes a single
 * `on_call_tool` dispatch). What both MUST produce is an EmittedProject: a
 * path -> file-content map ready to write to disk.
 */
export interface EmitTarget {
  /** The language this target emits. Used for registry lookup and diagnostics. */
  readonly language: TargetLanguage;

  /**
   * Emit a complete generated MCP server project from the IR + options.
   * Returns a path -> content map (relative paths, POSIX separators). Throws
   * loudly on an un-emittable configuration (e.g. code-mode without an
   * absolute base URL) rather than emitting a broken project — the
   * "fail loudly, don't guess" rule (AGENTS.md) applies to every target.
   */
  emitProject(opts: EmitOptions): EmittedProject;
}

/**
 * The TypeScript target — klaridian's original and, until MCPFO-60.3, only
 * emitter. This is a thin adapter over emitServerProject() so the refactor is
 * provably behavior-preserving: the exact same function produces the exact
 * same bytes; only the call path (through a target lookup) changed.
 */
export const typescriptTarget: EmitTarget = {
  language: "typescript",
  emitProject(opts: EmitOptions): EmittedProject {
    return emitServerProject(opts);
  },
};

/** All registered targets, keyed by language. */
const TARGETS: Record<TargetLanguage, EmitTarget> = {
  typescript: typescriptTarget,
  // python: added in MCPFO-60.3, once the real Python emitter exists and has
  // passed the full E2E matrix (MCPFO-60.4). Until then, requesting it below
  // fails loudly instead of silently falling back to TypeScript.
} as Record<TargetLanguage, EmitTarget>;

/**
 * Resolve the emit target for a language. Fails loudly for a language that has
 * no registered target yet (rather than guessing or silently defaulting), so a
 * premature `--language python` surfaces as a clear error, not a TypeScript
 * project mislabeled as Python.
 */
export function getEmitTarget(language: TargetLanguage): EmitTarget {
  const target = TARGETS[language];
  if (!target) {
    const available = Object.keys(TARGETS).join(", ");
    throw new Error(
      `No emit target for language "${language}". Available: ${available}.`
    );
  }
  return target;
}
