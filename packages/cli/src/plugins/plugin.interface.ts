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

/**
 * A plugin's contribution to a Python-target generated server (MCPFO-60.3).
 * Optional on ObservabilityPlugin so a plugin can be TypeScript-only, but every
 * shipped plugin provides it for launch parity (ARCHITECTURE.md section 60).
 *
 * The wrap shape is the SHARED-DISPATCH idiom (MCPFO-60.2 / plugin-dispatch/
 * python.ts): the exported wrap function takes the server's single async
 * `_dispatch(tool_name, arguments)` and returns a wrapped dispatch — so ONE
 * reassignment (`_dispatch = wrap(_dispatch)`) instruments every tool call,
 * versus TypeScript's per-tool `wrapTool(name, handler)`.
 */
export interface PythonPluginContribution {
  /** Files this plugin contributes to the Python project (path relative to root,
   *  e.g. "instrumentation/otel.py"). Vendored source per section 7. */
  getTemplateContributions(config: ResolvedPluginConfig): TemplateContribution[];
  /** pip requirement version specs the Python project needs, keyed by package
   *  name, e.g. { "opentelemetry-sdk": ">=1.28" }. */
  getDependencies(): Record<string, string>;
  /** The import line the generated server.py adds, e.g.
   *  `from instrumentation.otel import wrap_dispatch`. */
  importStatement: string;
  /** The wrap function name, applied as `_dispatch = <name>(_dispatch)`. */
  wrapFunctionName: string;
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

  /**
   * The Python-target contribution (MCPFO-60.3). Optional at the type level so
   * a TypeScript-only plugin still satisfies the interface, but every shipped
   * plugin provides it (full launch parity, ARCHITECTURE.md section 60). When a
   * plugin lacks it and `--language python` is requested, the CLI fails loudly
   * rather than emitting an uninstrumented server.
   */
  python?: PythonPluginContribution;
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
