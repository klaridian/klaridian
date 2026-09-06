// packages/cli/src/emit/plugin-dispatch/typescript.ts
//
// MCPFO-60.2 — the TypeScript plugin dispatch strategy.
//
// TypeScript's boundary is fine-grained: each tool handler is its own wrap
// site. This strategy renders exactly the wrap the emitter produced inline
// before MCPFO-60.2, so the generated project is byte-for-byte unchanged:
//
//   wrapped:   `wrapTool("getPetById", async (args) => {` ... `    })`
//   unwrapped: `async (args) => {`                         ... `    }`
//
// Both emit-tool.ts (per-operation tools) and emit-sandbox.ts (the code-mode
// execute_code tool) previously hand-rolled these two strings identically;
// routing both through this strategy removes the duplication and gives the
// Python target (MCPFO-60.3) a slot to render its coarser shared-dispatch wrap
// in its own idiom.

import type { PluginDispatchStrategy, PluginWiring } from "./contract.js";

export const typescriptPluginDispatch: PluginDispatchStrategy = {
  language: "typescript",
  granularity: "per-tool",
  wrapHandlerOpen(toolName: string, wiring?: PluginWiring): string {
    return wiring
      ? `${wiring.wrapFunctionName}(${JSON.stringify(toolName)}, async (args) => {`
      : `async (args) => {`;
  },
  wrapHandlerClose(wiring?: PluginWiring): string {
    // The extra `)` closes the wrap call opened above; indentation matches the
    // emitted handler block exactly (four spaces), preserving byte output.
    return wiring ? `    })` : `    }`;
  },
  describeBoundary(): string {
    return [
      "per-tool: each server.registerTool() handler is wrapped individually by",
      "  the plugin's wrap function (e.g. wrapTool(name, handler)). The finer",
      "  granularity is native to the @modelcontextprotocol/server SDK; every",
      "  tool call passes through the plugin because every handler is wrapped.",
    ].join("\n");
  },
};
