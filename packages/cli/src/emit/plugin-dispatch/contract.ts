// packages/cli/src/emit/plugin-dispatch/contract.ts
//
// MCPFO-60.2 — the plugin dispatch-boundary contract.
//
// The plugin-instrumentation design (ARCHITECTURE.md section 48) wraps a
// generated tool handler so a plugin (OTel, PostHog) sees every tool call.
// The original design named the wrap site concretely: "wrap the per-tool
// registerTool() call." Spike 059 (section 60.2) found that framing is
// TypeScript-specific — the Python SDK (mcp==2.1.1) exposes only a single
// global on_call_tool dispatch, with no per-tool registration primitive to
// wrap at the same granularity.
//
// This module re-expresses the contract one level up: a plugin wraps the
// TOOL-DISPATCH BOUNDARY — the point every tool call passes through. WHERE that
// boundary sits is a per-target detail:
//   - TypeScript: fine-grained — the boundary is each registerTool() handler,
//     wrapped per tool (unchanged behavior; this target already had the hook).
//   - Python (MCPFO-60.3): coarse-grained — the boundary is the shared
//     on_call_tool dispatch, wrapped once, with the tool looked up inside the
//     wrap. Semantically equivalent: every call still passes through
//     instrumentation; only the wrap SITE differs, not whether coverage is
//     total.
//
// This ticket is TypeScript-only and behavior-preserving: it names the
// abstraction and routes the existing TS wrap through it, so the Python target
// implements against a real contract instead of a TS-shaped assumption. It
// does NOT touch section 7's vendored-file rule (plugin instrumentation still
// ships as readable source in the generated project).

/**
 * How fine-grained a target's tool-dispatch boundary is.
 *   - "per-tool": each tool handler is a separate wrap site (TypeScript).
 *   - "shared-dispatch": one dispatch function is wrapped once and routes all
 *     tools through it (Python's on_call_tool).
 */
export type PluginDispatchGranularity = "per-tool" | "shared-dispatch";

/**
 * The plugin wiring a target consumes: an import line and the name of a
 * function that wraps a tool handler. This is exactly the shape a plugin's
 * getServerWiring() already returns (ObservabilityPlugin) — named here so the
 * dispatch strategy, not the plugin, owns how that wrap is rendered per target.
 */
export interface PluginWiring {
  /** e.g. `import { wrapTool } from "./instrumentation/otel.js";` */
  importStatement: string;
  /** e.g. `wrapTool` — wraps a handler as `wrapTool(toolName, handler)`. */
  wrapFunctionName: string;
}

/**
 * A per-language strategy for rendering the plugin wrap at that target's
 * tool-dispatch boundary. The emitter asks the strategy how to open and close
 * a wrapped handler rather than hand-rolling the wrap string itself — so a
 * second target plugs in its own idiom without the emitter core changing.
 */
export interface PluginDispatchStrategy {
  /** The language this strategy renders for. */
  readonly language: string;
  /** Where this target's dispatch boundary sits. */
  readonly granularity: PluginDispatchGranularity;
  /**
   * The opening of a tool handler, wrapped by the plugin when `wiring` is set,
   * or the bare handler opening when it isn't. `toolName` is the MCP tool name
   * the wrap is scoped to.
   */
  wrapHandlerOpen(toolName: string, wiring?: PluginWiring): string;
  /** The matching close for wrapHandlerOpen (accounts for the extra `)` a wrap adds). */
  wrapHandlerClose(wiring?: PluginWiring): string;
  /** Human-readable description of where/how this target wraps; for tests + docs. */
  describeBoundary(): string;
}
