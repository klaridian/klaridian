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
// Scope discipline: this file began as the MCPFO-60.0 TS-first refactor (the
// EmitTarget interface + TypeScript implementation + dispatch seam). The
// target-specific slots are filled in by their own tickets:
//   - the per-target conformance adapter (MCPFO-60.1, DONE) — spec-mandated
//     JSON-RPC error shapes the underlying SDK doesn't provide for free; lives
//     on the `conformance` slot below (emit/conformance/*).
//   - the plugin dispatch-boundary contract (MCPFO-60.2, DONE) — how a
//     plugin's instrumentation wraps the tool-dispatch path (per-tool
//     `registerTool` for TS; the shared `on_call_tool` dispatch for Python);
//     lives on the `pluginDispatch` slot below (emit/plugin-dispatch/*).
// Each is native/implicit for the TypeScript SDK v2; a second target is what
// forces it to become an explicit slot on this interface. See ARCHITECTURE.md
// section 60.1 / 60.2 for the design.
//
// The tool-data IR (openapi-mcp-generator's getToolsFromOpenApi() output) is
// deliberately NOT part of this interface: spike 059 (ARCHITECTURE.md section
// 60.3) proved the IR is already language-neutral and needs zero changes to
// support a second target. All coupling to TypeScript lived in the
// rendering/dispatch layer this interface abstracts, never in the data model.

import type { EmitOptions, EmittedProject } from "./emit-server.js";
import { emitServerProject } from "./emit-server.js";
import { typescriptConformanceAdapter } from "./conformance/typescript.js";
import type { ConformanceAdapter } from "./conformance/contract.js";
import { typescriptPluginDispatch } from "./plugin-dispatch/typescript.js";
import type { PluginDispatchStrategy } from "./plugin-dispatch/contract.js";

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
   * The conformance adapter guaranteeing spec-mandated JSON-RPC error shapes
   * for this target (MCPFO-60.1). For TypeScript the SDK is natively conformant
   * so the adapter contributes no server code; a target whose SDK isn't (e.g.
   * Python, MCPFO-60.3) injects explicit error-mapping through the same slot.
   */
  readonly conformance: ConformanceAdapter;

  /**
   * The plugin dispatch strategy for this target (MCPFO-60.2): how a plugin's
   * instrumentation wrap is rendered at this target's tool-dispatch boundary.
   * TypeScript wraps per-tool (fine-grained); a target whose SDK only exposes a
   * shared dispatch (e.g. Python, MCPFO-60.3) wraps once through the same slot.
   */
  readonly pluginDispatch: PluginDispatchStrategy;

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
  conformance: typescriptConformanceAdapter,
  pluginDispatch: typescriptPluginDispatch,
  emitProject(opts: EmitOptions): EmittedProject {
    // Route through the conformance adapter genuinely, not decoratively: the
    // TS SDK is natively conformant, so contributions MUST be empty and the
    // emitted project is byte-for-byte what emitServerProject produces. If a
    // future change makes TS need injected error-mapping, this fails loudly
    // here rather than silently emitting a non-conformant server — the same
    // "fail loudly, don't guess" discipline the emitter already follows.
    const contributions = this.conformance.emitServerContributions();
    if (contributions !== "") {
      throw new Error(
        "TypeScript target expected native SDK conformance (no injected " +
          "contributions), but the adapter produced server code. Wire it into " +
          "the emitter before shipping — see emit/conformance/typescript.ts."
      );
    }
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
