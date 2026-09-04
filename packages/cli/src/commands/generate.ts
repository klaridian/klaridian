// packages/cli/src/commands/generate.ts
//
// Implements `klaridian generate`. openapi-mcp-generator is used only for its
// pure spec->tool-DATA extraction (getToolsFromOpenApi); the actual MCP server
// project is emitted by klaridian's own emitter (emit/emit-server.ts) targeting
// @modelcontextprotocol/server (SDK v2), stateless, protocol 2025-11-25 —
// MCPFO-21 / ARCHITECTURE.md sections 38 and 49. The legacy v1 engine (which
// delegated generation to openapi-mcp-generator's generateMcpServer() and then
// textually patched its output for conformance/security/branding/instrumentation)
// was removed in the MCPFO-21 cutover (section 49); v2 gives native isError/-32602
// and wraps instrumentation at the registerTool boundary instead.
//
// Section 20: supports 0, 1, or multiple --plugin flags (the old v0
// guardrail of "exactly 0 or 1 plugins" is lifted now that a second plugin
// (posthog) actually exists to validate composition against). Note: the v2
// emit path currently supports at most one --plugin.
//
// Section 32 (ARCHITECTURE.md): --force/--json/--quiet + non-TTY detection
// for --interactive, following a direct CLI-UX audit against clig.dev and
// the "designing CLIs for agents" guidelines (agents-json-required,
// agents-structured-errors, agents-no-prompts-default, agents-yes-flag).

import type { Command } from "commander";
import path from "node:path";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { getToolsFromOpenApi } from "openapi-mcp-generator";
import { getPluginProjectAdditions } from "../render/instrument.js";
import { emitServerProject, resolveBaseUrlWarning, type PluginWiring, type OAuthConfig } from "../emit/emit-server.js";
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
import { isSwagger2Document, convertSwagger2ToOpenApi3, Swagger2ConversionError } from "../spec/swagger2-conversion.js";
import {
  parsePluginConfigFlags,
  resolveGitAuthorName,
  directoryExistsAndIsNonEmpty,
  writeTempSpec,
  type GenerateJsonResult,
} from "./generate-helpers.js";

const AVAILABLE_PLUGINS: Record<string, ObservabilityPlugin> = {
  [otelPlugin.id]: otelPlugin,
  [posthogPlugin.id]: posthogPlugin,
  [amplitudePlugin.id]: amplitudePlugin,
  [mixpanelPlugin.id]: mixpanelPlugin,
};

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
      "--include-paths <patterns>",
      "MCPFO-8: only include operations whose path matches at least one of these regex patterns (comma-separated). Tag-independent — works even when the spec has zero OpenAPI tags (e.g. Stripe's public spec), since real-world APIs are almost always structured by path. Composes with --include-tags (both must pass)."
    )
    .option(
      "--exclude-paths <patterns>",
      "MCPFO-8: exclude operations whose path matches any of these regex patterns (comma-separated)"
    )
    .option(
      "--include-methods <methods>",
      "MCPFO-8: only include operations using one of these HTTP methods (comma-separated, e.g. get,post). Tag-independent."
    )
    .option(
      "--exclude-methods <methods>",
      "MCPFO-8: exclude operations using any of these HTTP methods (comma-separated)"
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
      "Transport for the generated server: stdio (default) or streamable-http (ARCHITECTURE.md section 29 — stdio-only was a v0 guardrail, lifted in the emitter). The v2 emitter is stateless by construction, so streamable-http does not hit the v1 2nd-request crash (MCPFO-10).",
      "stdio"
    )
    .option(
      "--port <number>",
      "Port for the generated server when --transport is streamable-http (default: 3000)",
      (value: string) => parseInt(value, 10)
    )
    .option(
      "--architecture <id>",
      "MCPFO-28/ARCHITECTURE.md section 43: tools (default) emits one MCP tool per OpenAPI operation; code-mode emits a single execute_code tool backed by a typed client, run in a Deno-sandboxed subprocess (MCPFO-29/30) — for large APIs where one-tool-per-operation is the wrong default. Requires an absolute --base-url (or an absolute server URL in the spec) since the sandbox's network permission needs a concrete host.",
      "tools"
    )
    .option(
      "--registry-name <name>",
      "Reverse-DNS name for the official MCP Registry, e.g. io.github.<you>/<server>. When set, the emitted server.json and package.json mcpName use it (MCPFO-25)."
    )
    .option(
      "--docker",
      "Emit a minimal least-privilege Dockerfile + .dockerignore for the generated server (MCPFO-12). Requires --transport streamable-http (a containerized stdio server leaks orphaned containers).",
      false
    )
    .option(
      "--oauth-issuer <url>",
      "OAuth 2.1 issuer URL of the external Authorization Server (IdP) protecting this server (MCPFO-22). Requires --transport streamable-http. The generated server acts ONLY as a resource server (RFC 9728 PRM, bearer-token/audience validation) — never as an authorization server."
    )
    .option(
      "--oauth-jwks-uri <url>",
      "JWKS URI to fetch the IdP's signing keys from. When omitted, resolved automatically from --oauth-issuer's OIDC discovery document (<issuer>/.well-known/openid-configuration) at generation time."
    )
    .option(
      "--oauth-audience <uri>",
      "Expected token audience (RFC 8707) — the canonical URI this server will be reachable at, e.g. https://mcp.example.com/mcp. Required with --oauth-issuer; tokens not bound to this exact value are rejected."
    )
    .option(
      "--oauth-required-scopes <scopes>",
      "Comma-separated OAuth scopes required on every tool call (default: none beyond token validity)"
    )
    .option(
      "--server-description <text>",
      "Short human-readable description for the emitted server.json (distinct from individual tool descriptions)"
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
        includePaths?: string;
        excludePaths?: string;
        includeMethods?: string;
        excludeMethods?: string;
        interactive: boolean;
        plugin: string[];
        pluginConfig: string[];
        license: string;
        author?: string;
        transport: string;
        port?: number;
        architecture: string;
        registryName?: string;
        docker: boolean;
        oauthIssuer?: string;
        oauthJwksUri?: string;
        oauthAudience?: string;
        oauthRequiredScopes?: string;
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

        let tempSpecDirs: string[] = [];
        try {
          let specPath = path.resolve(opts.spec);
          const outputDir = path.resolve(opts.out);

          if (!isSupportedLicense(opts.license)) {
            fail(`Unknown license "${opts.license}". Supported: ${SUPPORTED_LICENSES.join(", ")}`, "validate-license");
            return;
          }
          const license = opts.license;

          const SUPPORTED_TRANSPORTS = ["stdio", "streamable-http"] as const;
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

          const SUPPORTED_ARCHITECTURES = ["tools", "code-mode"] as const;
          if (!(SUPPORTED_ARCHITECTURES as readonly string[]).includes(opts.architecture)) {
            fail(`Unknown architecture "${opts.architecture}". Supported: ${SUPPORTED_ARCHITECTURES.join(", ")}`, "validate-architecture");
            return;
          }
          const architecture = opts.architecture as (typeof SUPPORTED_ARCHITECTURES)[number];

          // MCPFO-12: --docker only makes sense for a network transport.
          if (opts.docker && transport !== "streamable-http") {
            fail(
              `--docker requires --transport streamable-http (a containerized stdio server leaks orphaned containers when the client session ends).`,
              "validate-docker"
            );
            return;
          }

          // MCPFO-22: OAuth resource-server validation. stdio servers MUST
          // NOT implement authorization per spec (they get credentials from
          // their launching process's environment instead) — the flag
          // combination is rejected outright rather than silently ignored.
          let authConfig: OAuthConfig | undefined;
          if (opts.oauthIssuer) {
            if (transport !== "streamable-http") {
              fail(
                `--oauth-issuer requires --transport streamable-http (stdio servers must not implement authorization per the MCP spec — they read credentials from their environment instead).`,
                "validate-oauth"
              );
              return;
            }
            if (!opts.oauthAudience) {
              fail(`--oauth-audience is required together with --oauth-issuer (the canonical URI tokens must be bound to, e.g. https://mcp.example.com/mcp).`, "validate-oauth");
              return;
            }
            let issuerUrl: URL;
            try {
              issuerUrl = new URL(opts.oauthIssuer);
            } catch {
              fail(`Invalid --oauth-issuer URL "${opts.oauthIssuer}".`, "validate-oauth");
              return;
            }
            if (issuerUrl.protocol !== "https:" && issuerUrl.hostname !== "localhost" && issuerUrl.hostname !== "127.0.0.1") {
              fail(`--oauth-issuer must be HTTPS (got "${opts.oauthIssuer}") — plain HTTP is only accepted for localhost during local testing.`, "validate-oauth");
              return;
            }

            let jwksUri = opts.oauthJwksUri;
            if (!jwksUri) {
              // Resolve from the issuer's OIDC discovery document — the
              // standard convention every OAuth 2.1/OIDC-conformant IdP
              // (WorkOS, Auth0, Clerk, Okta, Entra, Keycloak, ...) publishes.
              const discoveryUrl = new URL("/.well-known/openid-configuration", issuerUrl).toString();
              try {
                const res = await fetch(discoveryUrl);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const doc = (await res.json()) as { jwks_uri?: string };
                if (!doc.jwks_uri) throw new Error("discovery document has no jwks_uri");
                jwksUri = doc.jwks_uri;
              } catch (err) {
                fail(
                  `Could not resolve a JWKS URI from --oauth-issuer's OIDC discovery document (${discoveryUrl}): ${
                    err instanceof Error ? err.message : String(err)
                  }. Pass --oauth-jwks-uri explicitly if this IdP doesn't publish standard OIDC discovery.`,
                  "validate-oauth"
                );
                return;
              }
            }

            authConfig = {
              issuer: opts.oauthIssuer,
              jwksUri,
              audience: opts.oauthAudience,
              requiredScopes: opts.oauthRequiredScopes
                ?.split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            };
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
          // found during a direct CLI-UX audit that `echo "" | klaridian
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

          // MCPFO-27 / ARCHITECTURE.md section 36: transparently convert a
          // Swagger 2.0 input spec to OpenAPI 3.0 before anything else touches
          // it. openapi-mcp-generator only understands OpenAPI 3.x — handed a
          // raw Swagger 2.0 doc, listOperations()/getToolsFromOpenApi() below
          // would silently produce tools with empty inputSchema.properties
          // for every operation (the exact bug reproduced and fixed in
          // section 35/36 against the real Slack spec). Detect once here,
          // ahead of curation and the tool-extraction pre-check, so every
          // downstream step (curation, tool count, emission) operates on the
          // same real OpenAPI 3.0 document either way.
          const rawParsedSpec = await SwaggerParser.parse(specPath);
          if (isSwagger2Document(rawParsedSpec)) {
            step(
              `Detected Swagger 2.0 spec — converting to OpenAPI 3.0 before generation (swagger2openapi, MCPFO-27)`
            );
            let converted: OpenAPIV3.Document;
            try {
              converted = await convertSwagger2ToOpenApi3(rawParsedSpec);
            } catch (err) {
              if (err instanceof Swagger2ConversionError) {
                fail(err.message, "convert-swagger2");
                return;
              }
              throw err;
            }
            const { dir, specPath: convertedSpecPath } = await writeTempSpec(converted, "klaridian-converted-spec-");
            tempSpecDirs.push(dir);
            specPath = convertedSpecPath;
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
            includePathPatterns: parseCommaList(opts.includePaths),
            excludePathPatterns: parseCommaList(opts.excludePaths),
            includeMethods: parseCommaList(opts.includeMethods),
            excludeMethods: parseCommaList(opts.excludeMethods),
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
            (curationChoice.excludeOperationIds?.length ?? 0) > 0 ||
            (curationChoice.includePathPatterns?.length ?? 0) > 0 ||
            (curationChoice.excludePathPatterns?.length ?? 0) > 0 ||
            (curationChoice.includeMethods?.length ?? 0) > 0 ||
            (curationChoice.excludeMethods?.length ?? 0) > 0;

          // If the user chose to curate, pre-process the spec (setting
          // x-mcp: false on excluded operations, per curation.ts) and write
          // it to a temp file — getToolsFromOpenApi() only accepts a file
          // path, not a parsed document, so this is the integration seam.
          let generationSpecPath = specPath;
          if (hasCuration) {
            const doc = (await SwaggerParser.parse(specPath)) as OpenAPIV3.Document;
            const curated = applyCurationToSpec(doc, curationChoice);
            const { dir, specPath: curatedSpecPath } = await writeTempSpec(curated, "klaridian-curated-spec-");
            tempSpecDirs.push(dir);
            generationSpecPath = curatedSpecPath;
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

          // klaridian's own emitter (MCPFO-21, ARCHITECTURE.md sections 38/49).
          // Emits a stateless @modelcontextprotocol/server (SDK v2) project
          // directly from `tools` DATA — no generateMcpServer(), no textual
          // conformance/security/branding/instrument patches. The SDK gives
          // native isError/-32602, and plugin instrumentation wraps at the
          // registerTool boundary via the same ObservabilityPlugin interface.
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
          // code-mode's sandbox needs a concrete, absolute API host at
          // generation time (--allow-net scoping) — unlike the "tools"
          // architecture, a missing absolute base URL is fatal here, not
          // just a warning (there is no KLARIDIAN_BASE_URL-at-runtime
          // fallback for a sandbox permission baked in at generation time).
          if (architecture === "code-mode" && baseUrlWarning) {
            fail(
              `--architecture code-mode requires an absolute --base-url (the sandbox's network permission must be scoped to a concrete host at generation time): ${baseUrlWarning}`,
              "validate-architecture"
            );
            return;
          }
          let wiring: PluginWiring | undefined;
          let extraFiles: Record<string, string> = {};
          let extraDependencies: Record<string, string> = {};
          if (plugins.length > 0) {
            if (plugins.length > 1) {
              fail(`The emitter currently supports at most one --plugin (got ${plugins.length}).`, "emit");
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
            architecture,
            transport: transport === "streamable-http" ? "streamable-http" : "stdio",
            port: transport === "streamable-http" ? port : undefined,
            wiring,
            extraFiles,
            extraDependencies,
            description: opts.serverDescription,
            registryName: opts.registryName,
            docker: opts.docker,
            auth: authConfig,
          });

          await mkdir(outputDir, { recursive: true });
          for (const [rel, content] of Object.entries(project)) {
            const full = path.join(outputDir, rel);
            await mkdir(path.dirname(full), { recursive: true });
            await writeFile(full, content, "utf-8");
          }

          // Write LICENSE + package.json's `license` field (ARCHITECTURE.md
          // section 27). Done unconditionally (default "mit"); --license none warns.
          if (license !== "none") {
            const author = opts.author?.trim() || (await resolveGitAuthorName()) || "the project author";
            const licenseText = getLicenseText(license, author, new Date().getFullYear());
            if (licenseText) await writeFile(path.join(outputDir, "LICENSE"), licenseText, "utf-8");
            const pkgPath = path.join(outputDir, "package.json");
            const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
            pkg.license = getPackageJsonLicenseField(license);
            await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
            step(`✅ Licensed as ${getPackageJsonLicenseField(license)} (LICENSE file + package.json)`);
          } else {
            warn(
              `⚠️  Generated with --license none — no LICENSE file written. Consider adding one before distributing this server (see ARCHITECTURE.md section 27).`
            );
          }

          const curationSuffix = hasCuration ? ` (curated from ${operations.length} total)` : "";
          const transportSuffix = transport === "streamable-http" ? ` [streamable-http, port ${port}]` : "";
          const pluginSuffix = plugins.length > 0 ? ` + ${plugins.map((p) => p.id).join(", ")}` : "";
          const architectureSuffix = architecture === "code-mode" ? " [code-mode: execute_code + typed client, Deno-sandboxed]" : "";
          const toolCountLabel = architecture === "code-mode" ? `1 tool (execute_code, wrapping ${tools.length} operation(s))` : `${tools.length} tool(s)`;
          step(`✅ Generated ${toolCountLabel}${curationSuffix} in ${outputDir}${transportSuffix} (@modelcontextprotocol/server, stateless, protocol 2025-11-25)${architectureSuffix}${pluginSuffix}`);

          const nextSteps =
            architecture === "code-mode"
              ? `cd ${opts.out} && npm install && npm run build && (install Deno if needed: https://deno.com/) && npm start`
              : `cd ${opts.out} && npm install && npm run build && npm start`;
          if (jsonMode) {
            const result: GenerateJsonResult = {
              success: true,
              outputDir,
              toolCount: tools.length,
              curatedFromTotal: hasCuration ? operations.length : null,
              transport,
              port: transport === "streamable-http" ? port : null,
              architecture,
              license: license !== "none" ? getPackageJsonLicenseField(license) : null,
              plugins: plugins.map((p) => p.id),
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
          for (const dir of tempSpecDirs) {
            await rm(dir, { recursive: true, force: true });
          }
        }
      }
    );
}
