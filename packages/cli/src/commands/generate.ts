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
//
// Section 32 (ARCHITECTURE.md): --force/--json/--quiet + non-TTY detection
// for --interactive, following a direct CLI-UX audit against clig.dev and
// the "designing CLIs for agents" guidelines (agents-json-required,
// agents-structured-errors, agents-no-prompts-default, agents-yes-flag).

import type { Command } from "commander";
import path from "node:path";
import os from "node:os";
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir, stat } from "node:fs/promises";
import { generateMcpServer, getToolsFromOpenApi } from "openapi-mcp-generator";
import { instrumentGeneratedServer, getPluginProjectAdditions, InstrumentationPatchError } from "../render/instrument.js";
import { emitServerProject, resolveBaseUrlWarning } from "../emit/emit-server.js";
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
import { applySecurityHardening, getSecurityHelpersFileContent, SecurityPatchError } from "../render/security.js";
import { applyBranding, BrandingPatchError, type Icon } from "../render/branding.js";

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

/** Infers an icon's MIME type from its URL/path extension, for the common formats. Returns undefined if unrecognized (the field is optional per spec). */
function inferIconMimeType(src: string): string | undefined {
  const ext = src.split(".").pop()?.toLowerCase().split(/[?#]/)[0];
  switch (ext) {
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "ico":
      return "image/x-icon";
    default:
      return undefined;
  }
}

/**
 * Runs `fn` with `console.log`/`console.warn`/`console.error` temporarily
 * replaced with no-ops, restoring the originals in a `finally` no matter
 * how `fn` exits (including throwing). Workaround for a real, upstream gap
 * (ARCHITECTURE.md section 33): `openapi-mcp-generator`'s `generateMcpServer()`
 * writes ~20 lines of its own hardcoded progress text directly to
 * `console.error`/`console.warn` with no verbosity/logger option exposed in
 * its public API to control it — confirmed directly by reading its source,
 * not assumed. This is the only available lever mcpforge has to honor its
 * own `--quiet`/`--json` contracts without a fork or an upstream fix.
 *
 * Deliberately scoped as tightly as possible around the single call site
 * that needs it (`generateMcpServer()`) rather than applied globally for
 * the whole command — anything mcpforge's own code logs during that same
 * window (there is none today, but this guards against a future regression)
 * would also be silenced otherwise, which isn't the intent.
 */
async function withConsoleSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const noop = () => {};
  console.log = noop;
  console.warn = noop;
  console.error = noop;
  try {
    return await fn();
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
}

/**
 * Shape of the machine-readable summary printed to stdout when --json is
 * passed. On failure, `success: false` + `error` + `stage` (which step
 * failed) are set and everything else is omitted — deliberately a single,
 * predictable JSON value on stdout either way (never a mix of prose and
 * JSON), so a script/agent doing `mcpforge generate --json ... | jq` always
 * gets exactly one parseable value regardless of outcome. Exit code (0/1)
 * still reflects success independent of this payload, so callers that only
 * check the exit code don't need to parse anything.
 */
interface GenerateJsonResult {
  success: boolean;
  outputDir?: string;
  toolCount?: number;
  curatedFromTotal?: number | null;
  transport?: string;
  port?: number | null;
  license?: string | null;
  plugins?: string[];
  branding?: { icons: number; website: boolean; description: boolean } | null;
  nextSteps?: string;
  warnings?: string[];
  error?: string;
  stage?: string;
}

async function directoryExistsAndIsNonEmpty(dir: string): Promise<{ exists: boolean; isDirectory: boolean; nonEmpty: boolean }> {
  let st;
  try {
    st = await stat(dir);
  } catch {
    return { exists: false, isDirectory: false, nonEmpty: false };
  }
  if (!st.isDirectory()) {
    return { exists: true, isDirectory: false, nonEmpty: false };
  }
  const entries = await readdir(dir);
  return { exists: true, isDirectory: true, nonEmpty: entries.length > 0 };
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
      "Prompt for which tags to include before generating (ARCHITECTURE.md section 24 — user-chosen curation, not LLM-suggested). Requires an interactive terminal — fails loudly if stdin is not a TTY (e.g. running in CI or under an agent) instead of silently accepting empty input.",
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
    .option(
      "--engine <id>",
      "Generation engine: v2 (default, mcpforge's own emitter, @modelcontextprotocol/server SDK v2, stateless, protocol 2025-11-25 — MCPFO-21/ARCHITECTURE.md section 38) or v1 (legacy, via openapi-mcp-generator, SDK v1, protocol 2025-06-18; its streamable-http transport crashes on the 2nd request — MCPFO-10). v2 is stateless so that crash cannot occur; it is NOT yet 2026-07-28-conformant (the SDK does not negotiate that era).",
      "v2"
    )
    .option(
      "--registry-name <name>",
      "Reverse-DNS name for the official MCP Registry, e.g. io.github.<you>/<server>. When set, the emitted server.json and package.json mcpName use it (MCPFO-25). v2 engine only."
    )
    .option(
      "--docker",
      "Emit a minimal least-privilege Dockerfile + .dockerignore for the generated server (MCPFO-12). Requires --transport streamable-http (a containerized stdio server leaks orphaned containers). v2 engine only.",
      false
    )
    .option(
      "--icon <src[|theme]>",
      "Icon URL/data-URI for the server (MCP spec 2025-11-25, purely cosmetic). Repeatable for multiple sizes/themes. Optional |light or |dark suffix sets the theme, e.g. --icon https://x/icon-dark.svg|dark --icon https://x/icon-light.svg|light. MIME type is inferred from the file extension.",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[]
    )
    .option("--website <url>", "Website URL for the server (MCP spec 2025-11-25, purely cosmetic)")
    .option(
      "--server-description <text>",
      "Human-readable description for the server's Implementation metadata (MCP spec 2025-11-25, purely cosmetic — distinct from individual tool descriptions)"
    )
    .option(
      "--force",
      "Overwrite --out even if it already exists and is non-empty (default: refuse, to avoid silently destroying unrelated files)",
      false
    )
    .option(
      "--json",
      "Print a single machine-readable JSON result to stdout instead of human-readable progress lines on stderr (success or failure — always exactly one JSON value, exit code still reflects success)",
      false
    )
    .option(
      "--quiet",
      "Suppress step-by-step progress messages; still prints warnings, errors, and the final summary/next-steps line",
      false
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
        engine: string;
        registryName?: string;
        docker: boolean;
        icon: string[];
        website?: string;
        serverDescription?: string;
        force: boolean;
        json: boolean;
        quiet: boolean;
      }) => {
        const jsonMode = opts.json;
        const quietMode = opts.quiet || opts.json;
        const warnings: string[] = [];

        /** Human-readable-mode-only progress line; suppressed by --quiet and --json. */
        const step = (msg: string) => {
          if (!quietMode) console.error(msg);
        };
        /** Always recorded (surfaces in JSON's `warnings` array); also printed to stderr unless --json. */
        const warn = (msg: string) => {
          warnings.push(msg);
          if (!jsonMode) console.error(msg);
        };
        /**
         * Unified failure path for every error branch below: prints a single
         * JSON error object to stdout in --json mode (tagged with `stage` so
         * a caller/agent can tell which step failed without string-matching
         * prose), or the human `❌ message` line(s) on stderr otherwise. Sets
         * the process exit code either way. Callers still need their own
         * `return` right after calling this (it doesn't throw/exit itself),
         * matching every other early-return in this file.
         */
        const fail = (message: string, stage: string) => {
          process.exitCode = 1;
          if (jsonMode) {
            const result: GenerateJsonResult = { success: false, error: message, stage, warnings };
            process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          } else {
            console.error(`❌ ${message}`);
          }
        };

        let tempSpecDir: string | undefined;
        try {
          const specPath = path.resolve(opts.spec);
          const outputDir = path.resolve(opts.out);

          if (!isSupportedLicense(opts.license)) {
            fail(`Unknown license "${opts.license}". Supported: ${SUPPORTED_LICENSES.join(", ")}`, "validate-license");
            return;
          }
          const license = opts.license;

          const SUPPORTED_TRANSPORTS = ["stdio", "streamable-http", "web"] as const;
          type Transport = (typeof SUPPORTED_TRANSPORTS)[number];
          if (!(SUPPORTED_TRANSPORTS as readonly string[]).includes(opts.transport)) {
            fail(`Unknown transport "${opts.transport}". Supported: ${SUPPORTED_TRANSPORTS.join(", ")}`, "validate-transport");
            return;
          }
          const transport = opts.transport as Transport;
          const port = opts.port ?? 3000;
          if (transport !== "stdio" && (!Number.isInteger(port) || port <= 0 || port > 65535)) {
            fail(`Invalid --port "${opts.port}" — must be an integer between 1 and 65535.`, "validate-port");
            return;
          }

          const SUPPORTED_ENGINES = ["v1", "v2"] as const;
          if (!(SUPPORTED_ENGINES as readonly string[]).includes(opts.engine)) {
            fail(`Unknown engine "${opts.engine}". Supported: ${SUPPORTED_ENGINES.join(", ")}`, "validate-engine");
            return;
          }
          const engine = opts.engine as (typeof SUPPORTED_ENGINES)[number];

          // MCPFO-12: --docker only makes sense for a network transport.
          if (opts.docker && transport !== "streamable-http") {
            fail(
              `--docker requires --transport streamable-http (a containerized stdio server leaks orphaned containers when the client session ends).`,
              "validate-docker"
            );
            return;
          }
          if (opts.docker && engine !== "v2") {
            fail(`--docker is only supported by --engine v2.`, "validate-docker");
            return;
          }
          if (engine === "v2" && transport === "web") {
            fail(`--engine v2 does not support --transport web (v1-only). Use stdio or streamable-http.`, "validate-engine");
            return;
          }

          // --force / overwrite protection (ARCHITECTURE.md section 32):
          // refuse to generate into an existing, non-empty directory unless
          // --force is passed. Checked early — before any spec parsing or
          // generation work — so a mistaken --out never silently destroys
          // unrelated files in a directory the user didn't mean to target.
          const outDirState = await directoryExistsAndIsNonEmpty(outputDir);
          if (outDirState.exists && !outDirState.isDirectory) {
            fail(`Output path "${outputDir}" already exists and is not a directory.`, "check-output-dir");
            return;
          }
          if (outDirState.nonEmpty && !opts.force) {
            fail(
              `Output directory "${outputDir}" already exists and is not empty. Use --force to overwrite its contents, or choose a different --out.`,
              "check-output-dir"
            );
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
              fail(`Unknown plugin "${id}". Available plugins: ${Object.keys(AVAILABLE_PLUGINS).join(", ")}`, "validate-plugin");
              return;
            }
            plugins.push(plugin);
            pluginConfigs.set(plugin.id, resolvePluginConfig(plugin, allConfig[plugin.id] ?? {}));
          }

          // --interactive + non-TTY detection (ARCHITECTURE.md section 32):
          // found during a direct CLI-UX audit that `echo "" | mcpforge
          // generate --interactive` silently proceeded with the prompt
          // library's default (everything selected) rather than failing —
          // dangerous for a flag whose entire point is "the user explicitly
          // chose this," since a script/agent invoking it without a real
          // terminal would get a silent no-op curation instead of a clear
          // signal that --interactive doesn't apply to their context.
          if (opts.interactive && !process.stdin.isTTY) {
            fail(
              "--interactive requires an interactive terminal (stdin is not a TTY) — this looks like it's running in a script, CI, or agent context, where there's no one to answer the prompt. Remove --interactive and use --include-tags/--exclude-tags/--exclude-operation-ids instead for scripted curation.",
              "interactive-requires-tty"
            );
            return;
          }

          // Tool curation (ARCHITECTURE.md section 24): list operations
          // once, up front, so both the interactive prompt and the
          // non-interactive flags can validate/resolve against the same
          // real tag/operationId data — and so we can report a tool count
          // before committing to a full project generation either way.
          const operations = await listOperations(specPath);
          if (operations.length === 0) {
            fail("No tools could be extracted from this spec — nothing to generate.", "list-operations");
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
              fail(err.message, "validate-curation");
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
            fail(
              "No tools remain after curation — nothing to generate. Loosen --include-tags/--exclude-tags/--exclude-operation-ids.",
              "curation-empty"
            );
            return;
          }

          // --- Engine v2: mcpforge's own emitter (MCPFO-21, ARCHITECTURE.md
          // section 38). Emits a stateless @modelcontextprotocol/server (SDK v2)
          // project directly from `tools` data — no generateMcpServer(), no
          // textual conformance/security/instrument patches (v2 gives native
          // isError/-32602, and instrumentation wraps at the registerTool
          // boundary via the same plugin interface). Returns early.
          if (engine === "v2") {
            const serverName = opts.name ?? path.basename(outputDir);
            const baseUrl = opts.baseUrl ?? "";

            // MCPFO-20: warn if neither --base-url nor the spec provides an
            // absolute upstream host. tools[0].baseUrl is the resolved spec
            // server URL (or the override, if given).
            const specServerUrl = (tools[0] as { baseUrl?: string } | undefined)?.baseUrl;
            const baseUrlWarning = resolveBaseUrlWarning(opts.baseUrl, specServerUrl);
            if (baseUrlWarning) {
              warnings.push(baseUrlWarning);
              warn(baseUrlWarning);
            }
            let wiring: { importStatement: string; wrapFunctionName: string } | undefined;
            let extraFiles: Record<string, string> = {};
            let extraDependencies: Record<string, string> = {};
            if (plugins.length > 0) {
              if (plugins.length > 1) {
                fail(`--engine v2 currently supports at most one --plugin (got ${plugins.length}).`, "emit-v2");
                return;
              }
              const plugin = plugins[0];
              wiring = plugin.getServerWiring();
              const additions = getPluginProjectAdditions(plugins, pluginConfigs);
              extraFiles = Object.fromEntries(additions.files.map((f) => [f.path, f.content]));
              extraDependencies = additions.dependencies;
            }

            const project = emitServerProject({
              serverName,
              tools,
              baseUrl,
              transport: transport === "streamable-http" ? "streamable-http" : "stdio",
              port: transport === "streamable-http" ? port : undefined,
              wiring,
              extraFiles,
              extraDependencies,
              description: opts.serverDescription,
              registryName: opts.registryName,
              docker: opts.docker,
            });

            await mkdir(outputDir, { recursive: true });
            for (const [rel, content] of Object.entries(project)) {
              const full = path.join(outputDir, rel);
              await mkdir(path.dirname(full), { recursive: true });
              await writeFile(full, content, "utf-8");
            }

            // License (same policy as v1: default MIT, --license none warns).
            if (license !== "none") {
              const author = opts.author?.trim() || (await resolveGitAuthorName()) || "the project author";
              const licenseText = getLicenseText(license, author, new Date().getFullYear());
              if (licenseText) await writeFile(path.join(outputDir, "LICENSE"), licenseText, "utf-8");
              const pkgPath = path.join(outputDir, "package.json");
              const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
              pkg.license = getPackageJsonLicenseField(license);
              await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
            }

            const transportSuffix = transport === "streamable-http" ? ` [streamable-http, port ${port}]` : "";
            const pluginSuffix = plugins.length > 0 ? ` + ${plugins.map((p) => p.id).join(", ")}` : "";
            step(`✅ Generated ${tools.length} tool(s) in ${outputDir}${transportSuffix} (engine v2: @modelcontextprotocol/server, stateless, protocol 2025-11-25)${pluginSuffix}`);

            const startScript = transport === "streamable-http" ? "npm start" : "npm start";
            const nextSteps = `cd ${opts.out} && npm install && npm run build && ${startScript}`;
            if (jsonMode) {
              const result: GenerateJsonResult = {
                success: true,
                outputDir,
                toolCount: tools.length,
                curatedFromTotal: hasCuration ? operations.length : null,
                transport,
                port: transport === "streamable-http" ? port : null,
                license: license !== "none" ? getPackageJsonLicenseField(license) : null,
                plugins: plugins.map((p) => p.id),
                branding: null,
                nextSteps,
                warnings,
              };
              process.stdout.write(JSON.stringify(result, null, 2) + "\n");
            } else {
              console.error(`   Next: ${nextSteps}`);
            }
            return;
          }

          const runGeneration = () =>
            generateMcpServer({
              input: generationSpecPath,
              output: outputDir,
              serverName: opts.name,
              baseUrl: opts.baseUrl,
              transport,
              port: transport !== "stdio" ? port : undefined,
              force: true,
            });
          await (quietMode ? withConsoleSuppressed(runGeneration) : runGeneration());

          const curationSuffix = hasCuration ? ` (curated from ${operations.length} total)` : "";
          const transportSuffix = transport !== "stdio" ? ` [${transport}, port ${port}]` : "";
          step(`✅ Generated ${tools.length} tool(s)${curationSuffix} in ${outputDir}${transportSuffix} (via openapi-mcp-generator)`);

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
                fail(
                  `${err.message}\n   The server was generated successfully but is NOT spec-conformant for tool errors — see ARCHITECTURE.md section 28.`,
                  "apply-conformance"
                );
                return;
              }
              throw err;
            }
            await writeFile(serverFilePath, conformant, "utf-8");
            step(`✅ Applied MCP spec conformance fixes (unknown-tool protocol errors, isError on tool failures)`);
          }

          // Apply security hardening (ARCHITECTURE.md section 30) — ALWAYS,
          // same discipline as the conformance fixes above: tool
          // annotations/title, rate limiting, and output sanitization are
          // spec-recommended/required, not opt-in plugin features. Applied
          // after conformance so both patches compose against the already-
          // conformant source (they touch disjoint call sites, but ordering
          // is kept deterministic rather than incidental).
          {
            const serverFilePath = path.join(outputDir, "src", "index.ts");
            const serverSource = await readFile(serverFilePath, "utf-8");
            let hardened: string;
            try {
              hardened = applySecurityHardening(serverSource);
            } catch (err) {
              if (err instanceof SecurityPatchError) {
                fail(
                  `${err.message}\n   The server was generated successfully but is NOT security-hardened (annotations/rate-limiting/output sanitization) — see ARCHITECTURE.md section 30.`,
                  "apply-security"
                );
                return;
              }
              throw err;
            }
            await writeFile(serverFilePath, hardened, "utf-8");
            await writeFile(path.join(outputDir, "src", "security-helpers.ts"), getSecurityHelpersFileContent(), "utf-8");
            step(`✅ Applied security hardening (tool annotations/title, rate limiting, output sanitization)`);
          }

          // Apply branding metadata (ARCHITECTURE.md section 31) — OPT-IN,
          // unlike conformance/security above: only touches source when the
          // user actually passed --icon/--website/--server-description,
          // since there's no "wrong until fixed" default here, just an
          // optional cosmetic addition.
          const brandingRequested = opts.icon.length > 0 || Boolean(opts.website) || Boolean(opts.serverDescription);
          if (brandingRequested) {
            const icons: Icon[] = opts.icon.map((raw) => {
              const [src, theme] = raw.split("|");
              const icon: Icon = { src };
              const mimeType = inferIconMimeType(src);
              if (mimeType) icon.mimeType = mimeType;
              if (theme === "light" || theme === "dark") icon.theme = theme;
              else if (theme) {
                warn(`⚠️  Ignoring unrecognized icon theme "${theme}" for "${src}" — expected "light" or "dark".`);
              }
              return icon;
            });

            const serverFilePath = path.join(outputDir, "src", "index.ts");
            const serverSource = await readFile(serverFilePath, "utf-8");
            let branded: string;
            try {
              branded = applyBranding(serverSource, {
                icons: icons.length > 0 ? icons : undefined,
                websiteUrl: opts.website,
                description: opts.serverDescription,
              });
            } catch (err) {
              if (err instanceof BrandingPatchError) {
                fail(
                  `${err.message}\n   The server was generated successfully but WITHOUT the requested branding metadata — see ARCHITECTURE.md section 31.`,
                  "apply-branding"
                );
                return;
              }
              throw err;
            }
            await writeFile(serverFilePath, branded, "utf-8");
            step(
              `✅ Applied branding metadata (${[icons.length > 0 ? `${icons.length} icon(s)` : null, opts.website ? "website" : null, opts.serverDescription ? "description" : null].filter(Boolean).join(", ")})`
            );
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
            step(`✅ Licensed as ${getPackageJsonLicenseField(license)} (LICENSE file + package.json)`);
          } else {
            warn(
              `⚠️  Generated with --license none — no LICENSE file written. Consider adding one before distributing this server (see ARCHITECTURE.md section 27).`
            );
          }

          if (plugins.length > 0) {
            const serverFilePath = path.join(outputDir, "src", "index.ts");
            const serverSource = await readFile(serverFilePath, "utf-8");

            let instrumented: string;
            try {
              instrumented = instrumentGeneratedServer(serverSource, plugins);
            } catch (err) {
              if (err instanceof InstrumentationPatchError) {
                fail(
                  `${err.message}\n   The server was generated successfully but NOT instrumented — remove --plugin to use it as-is, or file an issue.`,
                  "apply-instrumentation"
                );
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
                fail(err.message, "apply-instrumentation");
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

            step(`✅ Instrumented with: ${plugins.map((p) => p.id).join(", ")}`);
          }

          const startScript = transport === "stdio" ? "npm start" : transport === "web" ? "npm run start:web" : "npm run start:http";
          const nextSteps = `cd ${opts.out} && npm install && npm run build && ${startScript}`;

          if (jsonMode) {
            const result: GenerateJsonResult = {
              success: true,
              outputDir,
              toolCount: tools.length,
              curatedFromTotal: hasCuration ? operations.length : null,
              transport,
              port: transport !== "stdio" ? port : null,
              license: license !== "none" ? getPackageJsonLicenseField(license) : null,
              plugins: plugins.map((p) => p.id),
              branding: brandingRequested
                ? { icons: opts.icon.length, website: Boolean(opts.website), description: Boolean(opts.serverDescription) }
                : null,
              nextSteps,
              warnings,
            };
            process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          } else {
            // The final summary line always prints, even under --quiet —
            // quiet reduces step-by-step noise, it doesn't hide the one
            // line a human actually needs to know what to do next.
            console.error(`   Next: ${nextSteps}`);
          }
        } catch (err) {
          fail(err instanceof Error ? err.message : String(err), "unexpected");
        } finally {
          if (tempSpecDir) {
            await rm(tempSpecDir, { recursive: true, force: true });
          }
        }
      }
    );
}
