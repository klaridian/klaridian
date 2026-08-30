// packages/cli/src/plugins/plugin.interface.ts
//
// The extensibility seam of the whole system (ARCHITECTURE.md section 4).
// A plugin contributes files/config to a generated project without the CLI
// core knowing anything tool-specific — this is what lets a future PostHog
// plugin be additive rather than a rewrite.

export interface PluginConfigField {
  key: string;
  prompt: string;
  default?: string;
  required: boolean;
}

export type ResolvedPluginConfig = Record<string, string>;

export interface TemplateContribution {
  /** Path relative to the generated project root, e.g. "src/instrumentation/otel.ts" */
  path: string;
  /** Either static file content, or a function producing it from resolved config. */
  content: string | ((config: ResolvedPluginConfig) => string);
}

export interface ObservabilityPlugin {
  /** Unique plugin id, used on the CLI: --plugin otel */
  id: string;

  /** Human-readable name for CLI output / prompts. */
  name: string;

  /** Config questions to ask the user at generation time (e.g. OTLP endpoint). */
  configSchema: PluginConfigField[];

  /** Returns the files this plugin contributes to the generated project. */
  getTemplateContributions(config: ResolvedPluginConfig): TemplateContribution[];

  /** Additional npm dependencies the generated project needs for this plugin. */
  getDependencies(): Record<string, string>;

  /**
   * Returns the import statement(s) and per-tool wrapping expression needed
   * to instrument a generated tool handler. Kept minimal and string-based
   * for v0 (see ARCHITECTURE.md section 6) — a real templating/AST approach
   * can replace this once a second plugin needs to share the same
   * injection point in server code.
   */
  getServerWiring(): {
    /** e.g. `import { wrapTool } from "./instrumentation/otel.js";` */
    importStatement: string;
    /** e.g. `wrapTool` — wraps `handler` as `wrapTool(toolName, handler)` */
    wrapFunctionName: string;
  };
}

/** Resolves a plugin's configSchema against CLI-provided values, applying defaults and checking required fields. */
export function resolvePluginConfig(
  plugin: ObservabilityPlugin,
  provided: Record<string, string | undefined>
): ResolvedPluginConfig {
  const resolved: ResolvedPluginConfig = {};
  const missing: string[] = [];

  for (const field of plugin.configSchema) {
    const value = provided[field.key] ?? field.default;
    if (value === undefined) {
      if (field.required) {
        missing.push(field.key);
      }
      continue;
    }
    resolved[field.key] = value;
  }

  if (missing.length > 0) {
    throw new Error(
      `Plugin "${plugin.id}" is missing required config: ${missing.join(", ")}. ` +
        `Provide via --plugin-config ${plugin.id}.<key>=<value>.`
    );
  }

  return resolved;
}
