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
import os from "node:os";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { generateMcpServer, getToolsFromOpenApi } from "openapi-mcp-generator";
import { instrumentGeneratedServer, getPluginProjectAdditions, InstrumentationPatchError } from "../render/instrument.js";
import { resolvePluginConfig } from "../plugins/plugin.interface.js";
import { otelPlugin } from "../plugins/otel/otel.plugin.js";
import { posthogPlugin } from "../plugins/posthog/posthog.plugin.js";
import { amplitudePlugin } from "../plugins/amplitude/amplitude.plugin.js";
import { mixpanelPlugin } from "../plugins/mixpanel/mixpanel.plugin.js";
import type { ObservabilityPlugin } from "../plugins/plugin.interface.js";
import { listOperations, validateCurationChoice, applyCurationToSpec, CurationValidationError } from "../curation/curation.js";
import { promptForCurationChoice } from "../curation/interactive.js";
import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPIV3 } from "openapi-types";
import { getLicenseText, getPackageJsonLicenseField, isSupportedLicense, SUPPORTED_LICENSES } from "../render/license.js";
import { applyConformanceFixes, ConformancePatchError } from "../render/conformance.js";

const AVAILABLE_PLUGINS: Record<string, ObservabilityPlugin> = {
  [otelPlugin.id]: otelPlugin,
  [posthogPlugin.id]: posthogPlugin,
  [amplitudePlugin.id]: amplitudePlugin,
  [mixpanelPlugin.id]: mixpanelPlugin,
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

/**
 * Resolves a default LICENSE copyright-holder name from local git config
 * (`git config user.name`), mirroring how most scaffolding tools (e.g.
 * `npm init`) pick a sensible default without requiring an explicit flag.
 * Returns undefined (never throws) if git isn't installed or unconfigured —
 * the caller falls back to a generic placeholder in that case.
 */
async function resolveGitAuthorName(): Promise<string | undefined> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("git", ["config", "user.name"]);
    const name = stdout.trim();
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
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
      "--include-tags <tags>",
      "Only include operations with at least one of these OpenAPI tags (comma-separated)"
    )
    .option("--exclude-tags <tags>", "Exclude operations with any of these OpenAPI tags (comma-separated)")
    .option(
      "--exclude-operation-ids <ids>",
      "Exclude these specific operationIds regardless of tags (comma-separated)"
    )
    .option(
      "--interactive",
      "Prompt for which tags to include before generating (ARCHITECTURE.md section 24 — user-chosen curation, not LLM-suggested)",
      false
    )
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
    .option(
      "--license <id>",
      `License for the generated server (ARCHITECTURE.md section 27 — MCP servers run with real credentials next to an autonomous agent, so shipping without a license is a real trust gap): ${SUPPORTED_LICENSES.join(", ")}`,
      "mit"
    )
    .option(
      "--author <name>",
      "Author/copyright holder name for the generated LICENSE file (default: your git user.name, or \"the project author\" if unset)"
    )
    .option(
      "--transport <type>",
      "Transport for the generated server: stdio (default), streamable-http, or web (ARCHITECTURE.md section 29 — stdio-only was a v0 guardrail, lifted now that openapi-mcp-generator supports the others natively)",
      "stdio"
    )
    .option(
      "--port <number>",
      "Port for the generated server when --transport is streamable-http or web (default: 3000)",
      (value: string) => parseInt(value, 10)
    )
    .action(
      async (opts: {
        spec: string;
        out: string;
        name?: string;
        baseUrl?: string;
        includeTags?: string;
        excludeTags?: string;
        excludeOperationIds?: string;
        interactive: boolean;
        plugin: string[];
        pluginConfig: string[];
        license: string;
        author?: string;
        transport: string;
        port?: number;
      }) => {
        let tempSpecDir: string | undefined;
        try {
          const specPath = path.resolve(opts.spec);
          const outputDir = path.resolve(opts.out);

          if (!isSupportedLicense(opts.license)) {
            console.error(`❌ Unknown license "${opts.license}". Supported: ${SUPPORTED_LICENSES.join(", ")}`);
            process.exitCode = 1;
            return;
          }
          const license = opts.license;

          const SUPPORTED_TRANSPORTS = ["stdio", "streamable-http", "web"] as const;
          type Transport = (typeof SUPPORTED_TRANSPORTS)[number];
          if (!(SUPPORTED_TRANSPORTS as readonly string[]).includes(opts.transport)) {
            console.error(`❌ Unknown transport "${opts.transport}". Supported: ${SUPPORTED_TRANSPORTS.join(", ")}`);
            process.exitCode = 1;
            return;
          }
          const transport = opts.transport as Transport;
          const port = opts.port ?? 3000;
          if (transport !== "stdio" && (!Number.isInteger(port) || port <= 0 || port > 65535)) {
            console.error(`❌ Invalid --port "${opts.port}" — must be an integer between 1 and 65535.`);
            process.exitCode = 1;
            return;
          }

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

          // Tool curation (ARCHITECTURE.md section 24): list operations
          // once, up front, so both the interactive prompt and the
          // non-interactive flags can validate/resolve against the same
          // real tag/operationId data — and so we can report a tool count
          // before committing to a full project generation either way.
          const operations = await listOperations(specPath);
          if (operations.length === 0) {
            console.error(`❌ No tools could be extracted from this spec — nothing to generate.`);
            process.exitCode = 1;
            return;
          }

          const parseCommaList = (value: string | undefined): string[] | undefined =>
            value
              ?.split(",")
              .map((s) => s.trim())
              .filter(Boolean);

          let curationChoice = {
            includeTags: parseCommaList(opts.includeTags),
            excludeTags: parseCommaList(opts.excludeTags),
            excludeOperationIds: parseCommaList(opts.excludeOperationIds),
          };

          if (opts.interactive) {
            curationChoice = { ...curationChoice, ...(await promptForCurationChoice(operations)) };
          }

          try {
            validateCurationChoice(curationChoice, operations);
          } catch (err) {
            if (err instanceof CurationValidationError) {
              console.error(`❌ ${err.message}`);
              process.exitCode = 1;
              return;
            }
            throw err;
          }

          const hasCuration =
            (curationChoice.includeTags?.length ?? 0) > 0 ||
            (curationChoice.excludeTags?.length ?? 0) > 0 ||
            (curationChoice.excludeOperationIds?.length ?? 0) > 0;

          // If the user chose to curate, pre-process the spec (setting
          // x-mcp: false on excluded operations, per curation.ts) and write
          // it to a temp file — generateMcpServer() only accepts a file
          // path, not a parsed document, so this is the integration seam.
          let generationSpecPath = specPath;
          if (hasCuration) {
            const doc = (await SwaggerParser.parse(specPath)) as OpenAPIV3.Document;
            const curated = applyCurationToSpec(doc, curationChoice);
            tempSpecDir = await mkdtemp(path.join(os.tmpdir(), "mcpforge-curated-spec-"));
            generationSpecPath = path.join(tempSpecDir, "spec.json");
            await writeFile(generationSpecPath, JSON.stringify(curated), "utf-8");
          }

          // Quick pre-check with the same library's own tool extraction, so
          // we can report a tool count and catch spec problems before
          // committing to a full project generation — mirrors the old
          // mapping-warnings UX without re-implementing the mapping itself.
          const tools = await getToolsFromOpenApi(generationSpecPath, {
            baseUrl: opts.baseUrl,
            dereference: true,
          });
          if (tools.length === 0) {
            console.error(`❌ No tools remain after curation — nothing to generate. Loosen --include-tags/--exclude-tags/--exclude-operation-ids.`);
            process.exitCode = 1;
            return;
          }

          await generateMcpServer({
            input: generationSpecPath,
            output: outputDir,
            serverName: opts.name,
            baseUrl: opts.baseUrl,
            transport,
            port: transport !== "stdio" ? port : undefined,
            force: true,
          });

          const curationSuffix = hasCuration ? ` (curated from ${operations.length} total)` : "";
          const transportSuffix = transport !== "stdio" ? ` [${transport}, port ${port}]` : "";
          console.error(`✅ Generated ${tools.length} tool(s)${curationSuffix} in ${outputDir}${transportSuffix} (via openapi-mcp-generator)`);

          // Apply MCP spec conformance fixes (ARCHITECTURE.md section 28) —
          // ALWAYS, regardless of --plugin. Unlike plugin instrumentation
          // (opt-in), these are correctness fixes for spec-required
          // behavior openapi-mcp-generator's output gets wrong (unknown
          // tools returning a "successful" result instead of a JSON-RPC
          // protocol error; execution failures never setting
          // `isError: true`). Applied before the plugin instrumentation
          // step below, so instrument.ts's textual patch operates on the
          // already-conformant source.
          {
            const serverFilePath = path.join(outputDir, "src", "index.ts");
            const serverSource = await readFile(serverFilePath, "utf-8");
            let conformant: string;
            try {
              conformant = applyConformanceFixes(serverSource);
            } catch (err) {
              if (err instanceof ConformancePatchError) {
                console.error(`❌ ${err.message}`);
                console.error(
                  `   The server was generated successfully but is NOT spec-conformant for tool errors — see ARCHITECTURE.md section 28.`
                );
                process.exitCode = 1;
                return;
              }
              throw err;
            }
            await writeFile(serverFilePath, conformant, "utf-8");
            console.error(`✅ Applied MCP spec conformance fixes (unknown-tool protocol errors, isError on tool failures)`);
          }

          // Write LICENSE + package.json's `license` field (ARCHITECTURE.md
          // section 27). Done unconditionally (default "mit") rather than
          // opt-in, because the absence of a license is itself the gap being
          // closed — an MCP server silently generated with no license at all
          // is a worse default than "assume MIT unless told otherwise",
          // consistent with the "fail loudly, don't guess" principle applied
          // here as "don't silently omit," not just "don't silently break."
          if (license !== "none") {
            const author = opts.author?.trim() || (await resolveGitAuthorName()) || "the project author";
            const licenseText = getLicenseText(license, author, new Date().getFullYear());
            if (licenseText) {
              await writeFile(path.join(outputDir, "LICENSE"), licenseText, "utf-8");
            }
            const packageJsonPath = path.join(outputDir, "package.json");
            const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8"));
            packageJson.license = getPackageJsonLicenseField(license);
            await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2), "utf-8");
            console.error(`✅ Licensed as ${getPackageJsonLicenseField(license)} (LICENSE file + package.json)`);
          } else {
            console.error(`⚠️  Generated with --license none — no LICENSE file written. Consider adding one before distributing this server (see ARCHITECTURE.md section 27).`);
          }

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

          const startScript = transport === "stdio" ? "npm start" : transport === "web" ? "npm run start:web" : "npm run start:http";
          console.error(`   Next: cd ${opts.out} && npm install && npm run build && ${startScript}`);
        } catch (err) {
          console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
        } finally {
          if (tempSpecDir) {
            await rm(tempSpecDir, { recursive: true, force: true });
          }
        }
      }
    );
}
