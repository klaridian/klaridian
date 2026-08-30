// packages/cli/src/commands/generate.ts
//
// Implements `mcpforge generate` — wires together parse -> map -> (plugin
// config) -> render, and is responsible for surfacing mapping
// warnings/errors to the user (ARCHITECTURE.md section 8: fail loudly).

import type { Command } from "commander";
import path from "node:path";
import { parseOpenApiSpec, OpenApiParseError } from "../openapi/parse.js";
import { mapOpenApiToTools } from "../openapi/map-tools.js";
import { renderProject } from "../render/render-project.js";
import { resolvePluginConfig } from "../plugins/plugin.interface.js";
import { otelPlugin } from "../plugins/otel/otel.plugin.js";
import type { ObservabilityPlugin } from "../plugins/plugin.interface.js";

const AVAILABLE_PLUGINS: Record<string, ObservabilityPlugin> = {
  [otelPlugin.id]: otelPlugin,
};

/** Parses `--plugin-config otel.serviceName=foo` style flags into a nested map. */
function parsePluginConfigFlags(flags: string[]): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const flag of flags) {
    const match = /^([^.]+)\.([^=]+)=(.*)$/.exec(flag);
    if (!match) {
      throw new Error(`Invalid --plugin-config value "${flag}", expected format: <pluginId>.<key>=<value>`);
    }
    const [, pluginId, key, value] = match;
    result[pluginId] ??= {};
    result[pluginId][key] = value;
  }
  return result;
}

export function registerGenerateCommand(program: Command): void {
  program
    .command("generate")
    .description("Generate an MCP server from an OpenAPI spec")
    .requiredOption("--spec <path>", "Path to the OpenAPI spec (JSON or YAML)")
    .requiredOption("--out <dir>", "Output directory for the generated server")
    .option("--name <name>", "Name for the generated server", "mcp-server")
    .option("--plugin <id>", `Observability plugin to enable (available: ${Object.keys(AVAILABLE_PLUGINS).join(", ")})`)
    .option(
      "--plugin-config <keyvalue...>",
      "Plugin config in <pluginId>.<key>=<value> form, repeatable",
      []
    )
    .option(
      "--strict",
      "Refuse to generate at all if any operation has a mapping error (default: skip failing operations, generate the rest)",
      false
    )
    .action(async (opts: { spec: string; out: string; name: string; plugin?: string; pluginConfig: string[]; strict: boolean }) => {
      try {
        const spec = await parseOpenApiSpec(path.resolve(opts.spec));
        const mapping = mapOpenApiToTools(spec);

        if (mapping.warnings.length > 0) {
          console.error(`\n⚠️  ${mapping.warnings.length} warning(s) while mapping the spec:`);
          for (const w of mapping.warnings) {
            console.error(`   - ${w.method.toUpperCase()} ${w.path}: ${w.message}`);
          }
        }

        if (mapping.errors.length > 0) {
          if (opts.strict) {
            console.error(`\n❌ ${mapping.errors.length} error(s) — refusing to generate (--strict):`);
            for (const e of mapping.errors) {
              console.error(`   - ${e.method.toUpperCase()} ${e.path}: ${e.message}`);
            }
            process.exitCode = 1;
            return;
          }
          console.error(
            `\n⚠️  ${mapping.errors.length} operation(s) skipped due to mapping errors (pass --strict to refuse generation entirely instead):`
          );
          for (const e of mapping.errors) {
            console.error(`   - ${e.method.toUpperCase()} ${e.path}: ${e.message}`);
          }
        }

        if (mapping.tools.length === 0) {
          console.error(`\n❌ No tools could be mapped from this spec — nothing to generate.`);
          process.exitCode = 1;
          return;
        }

        let plugin: ObservabilityPlugin | undefined;
        let pluginConfig: Record<string, string> | undefined;

        if (opts.plugin) {
          plugin = AVAILABLE_PLUGINS[opts.plugin];
          if (!plugin) {
            console.error(
              `❌ Unknown plugin "${opts.plugin}". Available plugins: ${Object.keys(AVAILABLE_PLUGINS).join(", ")}`
            );
            process.exitCode = 1;
            return;
          }
          const allConfig = parsePluginConfigFlags(opts.pluginConfig);
          pluginConfig = resolvePluginConfig(plugin, allConfig[plugin.id] ?? {});
        }

        await renderProject(
          { ...mapping, errors: [] }, // errors already excluded from mapping.tools; clear so renderProject's safety guard doesn't trip in non-strict (skip) mode
          {
            outputDir: path.resolve(opts.out),
            serverName: opts.name,
            plugin,
            pluginConfig,
          }
        );

        console.error(
          `\n✅ Generated ${mapping.tools.length} tool(s) in ${path.resolve(opts.out)}${plugin ? ` (instrumented with "${plugin.id}")` : ""}${mapping.auth ? ` [requires MCPFORGE_AUTH_TOKEN]` : ""}`
        );
        console.error(`   Next: cd ${opts.out} && npm install && npm run build && npm start`);
      } catch (err) {
        if (err instanceof OpenApiParseError) {
          console.error(`❌ ${err.message}`);
        } else {
          console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
        }
        process.exitCode = 1;
      }
    });
}
