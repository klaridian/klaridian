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

export class PluginContributionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginContributionError";
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
        throw new PluginContributionError(
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

/**
 * MCPFO-60.3 — the Python-target peer of getPluginProjectAdditions(). Collects a
 * plugin's Python `python.getTemplateContributions()` files + `python.
 * getDependencies()` pip specs, and fails loudly if a requested plugin has no
 * Python contribution (rather than silently emitting an uninstrumented Python
 * server). Also injects an `instrumentation/__init__.py` so the generated
 * `from instrumentation.<id> import wrap_dispatch` import resolves as a package.
 */
export function getPythonPluginProjectAdditions(
  plugins: ObservabilityPlugin[],
  configs: Map<string, ResolvedPluginConfig>
): { files: { path: string; content: string }[]; dependencies: Record<string, string> } {
  const filesByPath = new Map<string, { path: string; content: string; pluginId: string }>();
  let dependencies: Record<string, string> = {};

  for (const plugin of plugins) {
    if (!plugin.python) {
      throw new PluginContributionError(
        `Plugin "${plugin.id}" has no Python-target contribution — it can't be used with --language python. ` +
          `Use --language typescript, or drop --plugin ${plugin.id}.`
      );
    }
    const config = configs.get(plugin.id) ?? {};
    for (const c of plugin.python.getTemplateContributions(config)) {
      const existing = filesByPath.get(c.path);
      if (existing) {
        throw new PluginContributionError(
          `Plugins "${existing.pluginId}" and "${plugin.id}" both contribute a Python file at "${c.path}" — ` +
            `each plugin must write to its own path (e.g. instrumentation/<plugin-id>.py).`
        );
      }
      filesByPath.set(c.path, {
        path: c.path,
        content: typeof c.content === "function" ? c.content(config) : c.content,
        pluginId: plugin.id,
      });
    }
    dependencies = { ...dependencies, ...plugin.python.getDependencies() };
  }

  const files = [...filesByPath.values()].map(({ path, content }) => ({ path, content }));
  if (files.length > 0) {
    // Make `instrumentation/` an importable package for the generated
    // `from instrumentation.<id> import wrap_dispatch`.
    files.push({ path: "instrumentation/__init__.py", content: "" });
  }
  return { files, dependencies };
}
