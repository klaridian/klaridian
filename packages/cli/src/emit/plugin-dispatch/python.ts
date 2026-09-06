// packages/cli/src/emit/plugin-dispatch/python.ts
//
// MCPFO-60.3 — the Python plugin dispatch strategy (the shared-dispatch half
// of the MCPFO-60.2 contract).
//
// The official Python SDK's low-level Server exposes a single global
// `on_call_tool` dispatch, with no per-tool registration primitive to wrap
// (spike 059, ARCHITECTURE.md section 60.2). So Python's tool-dispatch
// boundary is COARSE-GRAINED: the generated server wraps its one shared
// `_dispatch(tool_name, args)` function ONCE, and every tool call flows
// through the wrap because every call flows through that dispatch. This is
// semantically equivalent to TypeScript's per-tool wrap — only the wrap SITE
// differs, not whether coverage is total.
//
// A Python plugin therefore exposes a wrap function of shape
// `wrap_tool(dispatch)` -> `async def wrapped(tool_name, args)`, NOT the
// TS `wrapTool(name, handler)` per-tool shape. The emitter renders a single
// reassignment (`_dispatch = wrap_tool(_dispatch)`) rather than opening/closing
// a wrap around each handler — so wrapHandlerOpen/Close (which the per-tool TS
// target needs) are not the primary seam here; emitDispatchWrap() is. They are
// still implemented to satisfy the shared interface and describe the idiom.

import type { PluginDispatchStrategy, PluginWiring } from "./contract.js";

export const pythonPluginDispatch: PluginDispatchStrategy = {
  language: "python",
  granularity: "shared-dispatch",
  wrapHandlerOpen(_toolName: string, _wiring?: PluginWiring): string {
    // Python does not wrap per handler — see emitDispatchWrap() below, which is
    // where the single shared-dispatch wrap is rendered. This method exists to
    // satisfy the shared PluginDispatchStrategy interface; the Python emitter
    // does not call it per tool.
    throw new Error(
      "pythonPluginDispatch.wrapHandlerOpen is not used — Python wraps the " +
        "shared dispatch once (emitDispatchWrap), not per tool (MCPFO-60.2 / 60.3)."
    );
  },
  wrapHandlerClose(_wiring?: PluginWiring): string {
    throw new Error(
      "pythonPluginDispatch.wrapHandlerClose is not used — Python wraps the " +
        "shared dispatch once (emitDispatchWrap), not per tool (MCPFO-60.2 / 60.3)."
    );
  },
  describeBoundary(): string {
    return [
      "shared-dispatch: the generated server's single _dispatch(tool_name,",
      "  args) function is wrapped once (_dispatch = wrap_tool(_dispatch)). The",
      "  Python SDK exposes only one global on_call_tool, so there is no",
      "  per-tool hook — but every tool call still flows through the wrap",
      "  because every call flows through the shared dispatch.",
    ].join("\n");
  },
};

/**
 * Renders the single reassignment that wraps the shared dispatch with a
 * plugin's wrap function, in Python idiom. Called once by the Python emitter
 * (not per tool), which is the whole point of the shared-dispatch boundary.
 * Returns "" when there is no plugin, keeping the emitted server unwrapped.
 */
export function emitDispatchWrap(wiring?: PluginWiring): string {
  if (!wiring) return "";
  return `_dispatch = ${wiring.wrapFunctionName}(_dispatch)`;
}
