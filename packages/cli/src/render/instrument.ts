// packages/cli/src/render/instrument.ts
//
// Plugin project additions for the v2 emitter (emit/emit-server.ts).
//
// Historical note: this file used to also hold `instrumentGeneratedServer()`,
// a textual patch that rewrote the single `executeApiTool` call site in
// openapi-mcp-generator's generated output to route through an
// ObservabilityPlugin. That whole model was removed in the MCPFO-21 cutover
// (ARCHITECTURE.md section 49) — the v2 emitter wraps instrumentation natively
// at the `registerTool` boundary via `plugin.getServerWiring()`, so no textual
// patch of third-party generated code is needed anymore.
//
// What remains here is `getPluginProjectAdditions()`: it collects each
// plugin's vendored files + npm dependencies so the emitter can drop them
// into the generated project. Still used by both the "tools" and "code-mode"
// emit paths.

import type { ObservabilityPlugin, ResolvedPluginConfig } from "../plugins/plugin.interface.js";

export class InstrumentationPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstrumentationPatchError";
  }
}

/**
 * Writes every plugin's own contributed files (e.g. the vendored OTel
 * instrumentation module) into the generated project, and returns the merged
 * npm dependencies the project's package.json needs to add.
 *
 * Detects file-path collisions between plugins loudly rather than letting
 * one silently overwrite another's contribution — each plugin should write
 * under its own `src/instrumentation/<plugin-id>.ts`-style namespace (see
 * otel.plugin.ts), so a collision here means two plugins picked the same
 * path and needs a real decision, not a silent last-write-wins.
 */
export function getPluginProjectAdditions(
  plugins: ObservabilityPlugin[],
  configs: Map<string, ResolvedPluginConfig>
): { files: { path: string; content: string }[]; dependencies: Record<string, string> } {
  const filesByPath = new Map<string, { path: string; content: string; pluginId: string }>();
  let dependencies: Record<string, string> = {};

  for (const plugin of plugins) {
    const config = configs.get(plugin.id) ?? {};
    const contributions = plugin.getTemplateContributions(config);
    for (const c of contributions) {
      const existing = filesByPath.get(c.path);
      if (existing) {
        throw new InstrumentationPatchError(
          `Plugins "${existing.pluginId}" and "${plugin.id}" both contribute a file at "${c.path}" — ` +
            `each plugin must write to its own path (e.g. src/instrumentation/<plugin-id>.ts).`
        );
      }
      filesByPath.set(c.path, {
        path: c.path,
        content: typeof c.content === "function" ? c.content(config) : c.content,
        pluginId: plugin.id,
      });
    }
    dependencies = { ...dependencies, ...plugin.getDependencies() };
  }

  return { files: [...filesByPath.values()].map(({ path, content }) => ({ path, content })), dependencies };
}
