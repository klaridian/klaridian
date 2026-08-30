// packages/cli/src/commands/generate.ts
//
// Implements `mcpforge generate` — ARCHITECTURE.md section 16/18 pivot:
// delegates the actual OpenAPI -> MCP server generation to
// openapi-mcp-generator (a mature, MIT-licensed library, validated against
// a large real-world production API spec in section 16), then post-processes
// the generated server with mcpforge's own observability instrumentation layer
// (instrument.ts). mcpforge's own code no longer parses OpenAPI or renders
// server source from scratch — that's the whole point of the pivot.
//
// Section 20: supports 0, 1, or multiple --plugin flags (the old v0
// guardrail of "exactly 0 or 1 plugins" is lifted now that a second plugin
// (posthog) actually exists to validate composition against).

import type { Command } from "commander";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { generateMcpServer, getToolsFromOpenApi } from "openapi-mcp-generator";
import { instrumentGeneratedServer, getPluginProjectAdditions, InstrumentationPatchError } from "../render/instrument.js";
import { resolvePluginConfig } from "../plugins/plugin.interface.js";
import { otelPlugin } from "../plugins/otel/otel.plugin.js";
import { posthogPlugin } from "../plugins/posthog/posthog.plugin.js";
import type { ObservabilityPlugin } from "../plugins/plugin.interface.js";

const AVAILABLE_PLUGINS: Record<string, ObservabilityPlugin> = {
  [otelPlugin.id]: otelPlugin,
  [posthogPlugin.id]: posthogPlugin,
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
    .description(
      "Generate an MCP server from an OpenAPI spec (via openapi-mcp-generator), optionally instrumented with one or more observability plugins"
    )
    .requiredOption("--spec <path>", "Path to the OpenAPI spec (JSON or YAML)")
    .requiredOption("--out <dir>", "Output directory for the generated server")
    .option("--name <name>", "Name for the generated server (default: derived from the spec's info.title)")
    .option("--base-url <url>", "Override the API base URL (required if the spec's servers[] is relative/missing)")
    .option(
      "--plugin <id>",
      `Observability plugin to enable, repeatable (available: ${Object.keys(AVAILABLE_PLUGINS).join(", ")})`,
      (value: string, previous: string[]) => [...previous, value],
      [] as string[]
    )
    .option(
      "--plugin-config <keyvalue...>",
      "Plugin config in <pluginId>.<key>=<value> form, repeatable",
      []
    )
    .action(
      async (opts: {
        spec: string;
        out: string;
        name?: string;
        baseUrl?: string;
        plugin: string[];
        pluginConfig: string[];
      }) => {
        try {
          const specPath = path.resolve(opts.spec);
          const outputDir = path.resolve(opts.out);

          // Resolve + validate every requested plugin BEFORE generating
          // anything, so we fail fast on a bad --plugin/--plugin-config
          // rather than generating a project we then can't instrument.
          const requestedIds = [...new Set(opts.plugin)];
          const plugins: ObservabilityPlugin[] = [];
          const pluginConfigs = new Map<string, Record<string, string>>();

          const allConfig = parsePluginConfigFlags(opts.pluginConfig);
          for (const id of requestedIds) {
            const plugin = AVAILABLE_PLUGINS[id];
            if (!plugin) {
              console.error(`❌ Unknown plugin "${id}". Available plugins: ${Object.keys(AVAILABLE_PLUGINS).join(", ")}`);
              process.exitCode = 1;
              return;
            }
            plugins.push(plugin);
            pluginConfigs.set(plugin.id, resolvePluginConfig(plugin, allConfig[plugin.id] ?? {}));
          }

          // Quick pre-check with the same library's own tool extraction, so
          // we can report a tool count and catch spec problems before
          // committing to a full project generation — mirrors the old
          // mapping-warnings UX without re-implementing the mapping itself.
          const tools = await getToolsFromOpenApi(specPath, {
            baseUrl: opts.baseUrl,
            dereference: true,
          });
          if (tools.length === 0) {
            console.error(`❌ No tools could be extracted from this spec — nothing to generate.`);
            process.exitCode = 1;
            return;
          }

          await generateMcpServer({
            input: specPath,
            output: outputDir,
            serverName: opts.name,
            baseUrl: opts.baseUrl,
            transport: "stdio",
            force: true,
          });

          console.error(`✅ Generated ${tools.length} tool(s) in ${outputDir} (via openapi-mcp-generator)`);

          if (plugins.length > 0) {
            const serverFilePath = path.join(outputDir, "src", "index.ts");
            const serverSource = await readFile(serverFilePath, "utf-8");

            let instrumented: string;
            try {
              instrumented = instrumentGeneratedServer(serverSource, plugins);
            } catch (err) {
              if (err instanceof InstrumentationPatchError) {
                console.error(`❌ ${err.message}`);
                console.error(
                  `   The server was generated successfully but NOT instrumented — remove --plugin to use it as-is, or file an issue.`
                );
                process.exitCode = 1;
                return;
              }
              throw err;
            }
            await writeFile(serverFilePath, instrumented, "utf-8");

            let files: { path: string; content: string }[];
            let dependencies: Record<string, string>;
            try {
              ({ files, dependencies } = getPluginProjectAdditions(plugins, pluginConfigs));
            } catch (err) {
              if (err instanceof InstrumentationPatchError) {
                console.error(`❌ ${err.message}`);
                process.exitCode = 1;
                return;
              }
              throw err;
            }
            for (const file of files) {
              const filePath = path.join(outputDir, file.path);
              await mkdir(path.dirname(filePath), { recursive: true });
              await writeFile(filePath, file.content, "utf-8");
            }

            const packageJsonPath = path.join(outputDir, "package.json");
            const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8"));
            packageJson.dependencies = { ...packageJson.dependencies, ...dependencies };
            await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), "utf-8");

            console.error(`✅ Instrumented with: ${plugins.map((p) => p.id).join(", ")}`);
          }

          console.error(`   Next: cd ${opts.out} && npm install && npm run build && npm start`);
        } catch (err) {
          console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
        }
      }
    );
}
