# klaridian

[![CI](https://github.com/klaridian/klaridian/actions/workflows/ci.yml/badge.svg)](https://github.com/klaridian/klaridian/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![MCP protocol](https://img.shields.io/badge/MCP-2025--11--25-8A2BE2.svg)](https://modelcontextprotocol.io)

![klaridian: OpenAPI spec to MCP server, instrumented with engineering observability (OTel → Datadog/Grafana/Honeycomb/New Relic/any OTLP backend) and product analytics (PostHog/Amplitude/Mixpanel plugins), plus tool curation](assets/banner.png)

> Generate MCP servers with engineering + product observability built in—no manual instrumentation.

**Status:** Published v0.1. Generates real, runnable [Model Context Protocol](https://modelcontextprotocol.io) servers from an OpenAPI spec (Swagger 2.0 specs are automatically converted to OpenAPI 3.0)—in TypeScript or Python—optionally instrumented with OpenTelemetry and/or a product-analytics plugin (PostHog, Amplitude, or Mixpanel), with generation-time tool curation. The CLI ships on **npm, PyPI, and Homebrew**, with prebuilt native binaries for macOS, Linux, and Windows (no Node.js required). See [PLAN.md](PLAN.md) for the strategic plan and [ARCHITECTURE.md](ARCHITECTURE.md) for technical design + validation history.

**Contents:** [What is this?](#what-is-this) · [Why](#why) · [Install](#install) · [Quickstart](#quickstart) · [Repository layout](#repository-layout) · [Status & roadmap](#status--roadmap) · [Running the tests](#running-the-tests) · [Development environment](#development-environment) · [License](#license) · [Contributing](#contributing)

## What is this?

`klaridian` is a CLI that generates MCP servers—from an OpenAPI spec—with observability and tool curation wired in from the start:

- **Engineering observability** (`otel` plugin)—OpenTelemetry spans for every tool call, exportable via OTLP to Datadog, Grafana, Honeycomb, New Relic, or any other OTLP-compatible backend. Latency, errors, and status per call, with zero manual instrumentation. One plugin reaches every backend here because OTel/OTLP is a genuine open wire protocol.
- **Product observability**—an event per tool call (`tool_name`, `duration_ms`, `success`) captured by whichever provider you pick: `posthog`, `amplitude`, or `mixpanel` plugins. Unlike OTel, there's no shared standard for product analytics ingestion, so this is three separate plugins rather than one—see [ARCHITECTURE.md section 26](ARCHITECTURE.md#26-two-more-product-analytics-plugins-amplitude-mixpanel--and-why-product-analytics-needed-more-than-one-unlike-engineering-observability-aug-30-2026) for why that's a structural difference, not an oversight.
- **Tool curation**—choose which OpenAPI operations become tools at generation time (`--include-tags`/`--exclude-tags`/`--exclude-operation-ids`, or tag-independent `--include-paths`/`--exclude-paths`/`--include-methods`/`--exclude-methods` regex/HTTP-method filters for specs with no OpenAPI tags at all, or an interactive prompt), so you don't ship every operation in a large spec as a tool by default.

You pick a plugin you want at generation time—e.g. `--plugin otel` or `--plugin posthog`. The server that comes out the other end is already instrumented. (Composing more than one plugin on the same server was a capability of the retired v1 pipeline and is not yet re-implemented on the current emitter—see [ARCHITECTURE.md section 49](ARCHITECTURE.md#49-mcpfo-21-full-cutover--the-legacy-v1-generation-engine-removed-entirely-sep-4-2026).)

OpenAPI parsing / tool-data extraction is handled by [`openapi-mcp-generator`](https://github.com/harsha-iiiv/openapi-mcp-generator)'s `getToolsFromOpenApi()`; klaridian's own code emits the MCP server project itself—a stateless [`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server) (SDK v2, protocol 2025-11-25) project—plus the instrumentation and curation layers on top.

## Why

Building an MCP server today means writing the server, then manually wiring up tracing and analytics—repetitive work every MCP server author does from scratch. Datadog, PostHog, Sentry, and Grafana already ship MCP servers of their own, but those let an agent *query* those platforms—they don't instrument a *new* server you're building. `klaridian` closes that gap.

## Install

klaridian is one CLI, distributed on every major channel. Pick whichever fits your toolchain—all deliver the same generator:

```bash
# npx (Node.js) — run once, nothing installed; recommended for a generator
npx klaridian generate --spec ./api.yaml --out ./my-server

# npm (Node.js) — install the klaridian command globally
npm install -g klaridian

# PyPI (prebuilt native binary — no Node.js, no virtualenv, nothing to compile)
pip install klaridian           # or: uv tool install klaridian / pipx install klaridian

# Homebrew (macOS + Linux, prebuilt native binary — no Node.js)
brew tap klaridian/klaridian
brew install klaridian
```

The PyPI and Homebrew channels ship a **standalone native binary** (compiled with `bun --compile`, byte-identical output to the Node build), so they run with zero Node.js on the machine—the same pattern [ruff](https://pypi.org/project/ruff/) and [uv](https://pypi.org/project/uv/) use. Prebuilt binaries cover **macOS (arm64, x64), Linux (arm64, x64), and Windows (x64)**.

Prefer to grab the raw binary directly? Every [GitHub Release](https://github.com/klaridian/klaridian/releases/latest) attaches one asset per platform (`klaridian-darwin-arm64`, `klaridian-darwin-x64`, `klaridian-linux-arm64`, `klaridian-linux-x64`, `klaridian-windows-x64.exe`)—download it, `chmod +x`, and run:

```bash
curl -fsSL -o klaridian \
  https://github.com/klaridian/klaridian/releases/latest/download/klaridian-darwin-arm64
chmod +x klaridian && ./klaridian --version
```

To build from source instead, see [Development environment](#development-environment).

## Quickstart

Once klaridian is on your PATH (or via `npx klaridian`), generate a server from an OpenAPI spec:

```bash
# Generate an MCP server from an OpenAPI spec, with OTel instrumentation:
klaridian generate \
  --spec ./openapi.json \
  --out /tmp/my-generated-server \
  --name my-petstore-server \
  --base-url https://petstore3.swagger.io/api/v3 \
  --plugin otel \
  --plugin-config otel.serviceName=my-petstore-server

# Then run the generated server:
cd /tmp/my-generated-server
npm install && npm run build
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces   # optional, has a default
npm start
```

Prefer Python? Add `--language python` to emit an official `mcp` Python SDK project instead—same tools, same annotations, same instrumentation:

```bash
klaridian generate \
  --spec ./openapi.json \
  --out /tmp/my-generated-server \
  --base-url https://petstore3.swagger.io/api/v3 \
  --plugin otel \
  --language python

# Then run the generated Python server:
cd /tmp/my-generated-server
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export KLARIDIAN_BASE_URL=https://petstore3.swagger.io/api/v3
python server.py
```

Omit `--plugin` entirely to generate a plain, un-instrumented server. Add `--include-tags`/`--exclude-tags`/`--exclude-operation-ids` (tag-based) or `--include-paths`/`--exclude-paths`/`--include-methods`/`--exclude-methods` (regex/HTTP-method, tag-independent—works even on specs with zero OpenAPI tags), or `--interactive`, to curate which operations become tools—see [ARCHITECTURE.md section 40](ARCHITECTURE.md#40-mcpfo-8-phase-1-implemented--tag-independent-structural-curation-sep-3-2026) for details.

Every generated server ships with a real `LICENSE` file and a `package.json.license` field by default (`--license mit`, or `--license apache-2.0`; `--license none` opts out but prints a warning)—MCP servers run with real credentials next to an autonomous agent, so being open/auditable by default matters more than for a typical scaffolded project. `--author "Your Name"` sets the copyright holder (falls back to `git config user.name`). See [PLAN.md section 7](PLAN.md#7-distribution-norm-why-mcp-servers-are-conventionally-open-source-and-what-that-implies-for-klaridian-aug-30-2026) and [ARCHITECTURE.md section 27](ARCHITECTURE.md#27-generated-server-license--packagejson-license-field-aug-30-2026) for why.

## Repository layout

```
klaridian/
├── packages/
│   └── cli/                # the klaridian CLI
│       ├── src/
│       │   ├── emit/       # emits the stateless SDK-v2 MCP server project from tool data
│       │   ├── render/instrument.ts  # collects a plugin's vendored files + npm deps for the emitter
│       │   ├── plugins/    # ObservabilityPlugin interface + plugins (otel, posthog, amplitude, mixpanel)
│       │   ├── curation/   # tool curation logic + interactive prompt
│       │   └── commands/   # the `generate` CLI command
│       └── test/           # end-to-end tests (real npm install + build + run)
│   └── python-posthog-middleware/  # FastMCP-native PostHog middleware (Python) — no generation/patching, see ARCHITECTURE.md section 23
├── examples/
│   └── petstore/           # real OpenAPI spec used as the test fixture throughout
├── spikes/                  # throwaway spikes that validated risky mechanics before building for real (see spikes/README.md)
├── PLAN.md                 # business/strategy plan
├── ARCHITECTURE.md         # technical design, decisions, and validation history
└── CLAUDE.md               # working agreements for AI agents (symlink to AGENTS.md, the cross-tool standard)
```

## Status & roadmap

Published v0.1: OpenAPI → MCP server generation, a tested OpenTelemetry / PostHog instrumentation layer, and generation-time tool curation. The CLI is distributed on npm, PyPI, and Homebrew, with prebuilt native binaries for macOS, Linux, and Windows (no Node.js required)—see [Install](#install) and [ARCHITECTURE.md section 64](ARCHITECTURE.md#64-distribution-reaches-the-python-ecosystem-through-a-compiled-binary-not-a-second-generator-sep-8-2026). The generator emits a stateless `@modelcontextprotocol/server` (SDK v2, protocol 2025-11-25) project directly from tool data—the legacy v1 pipeline (which delegated to `openapi-mcp-generator`'s code generator and textually patched its output) was removed in the MCPFO-21 cutover, [ARCHITECTURE.md section 49](ARCHITECTURE.md#49-mcpfo-21-full-cutover--the-legacy-v1-generation-engine-removed-entirely-sep-4-2026). See [ARCHITECTURE.md](ARCHITECTURE.md) for the full decision history, including the original hand-rolled OpenAPI mapper and the v1 delegation model (both superseded, kept for context).

### What's always on

- **MCP spec conformance**—the SDK-v2 emitter produces spec-conformant tool error handling natively: an unknown-tool call is a genuine JSON-RPC protocol error (`-32602`), and a tool-execution failure sets `isError: true` on the result. (v1 needed a textual patch for both—[ARCHITECTURE.md section 28](ARCHITECTURE.md#28-mcp-spec-conformance-audit--fixes-aug-30-2026)—which is why the cutover shrank klaridian's fragile surface.)
- **Marketplace tool annotations**—every tool gets a `title` and MCP annotations (`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`, derived from its HTTP method), emitted natively by the generator. Per-tool rate limiting and output sanitization were v1-only features with no v2 equivalent yet—tracked as follow-up in [ARCHITECTURE.md section 49](ARCHITECTURE.md#49-mcpfo-21-full-cutover--the-legacy-v1-generation-engine-removed-entirely-sep-4-2026).
- **Real `LICENSE` file by default**—every generated server ships with a `LICENSE` file and a `package.json.license` field (`--license mit` default, or `--license apache-2.0`; `--license none` opts out but prints a warning). MCP servers run with real credentials next to an autonomous agent, so being open/auditable by default matters more than for a typical scaffolded project. See [PLAN.md section 7](PLAN.md#7-distribution-norm-why-mcp-servers-are-conventionally-open-source-and-what-that-implies-for-klaridian-aug-30-2026) and [ARCHITECTURE.md section 27](ARCHITECTURE.md#27-generated-server-license--packagejson-license-field-aug-30-2026) for why.

### Plugins and transports

- **Plugins:** `otel` (engineering observability, any OTLP backend) and three product-analytics plugins—`posthog`, `amplitude`, `mixpanel`. One plugin per generated server on the current emitter; multi-plugin composition ([ARCHITECTURE.md section 20](ARCHITECTURE.md#20-second-plugin-posthog-product-observability-and-multi-plugin-composition-aug-30-2026)) was a v1 capability not yet re-implemented ([section 49](ARCHITECTURE.md#49-mcpfo-21-full-cutover--the-legacy-v1-generation-engine-removed-entirely-sep-4-2026)). See [section 26](ARCHITECTURE.md#26-two-more-product-analytics-plugins-amplitude-mixpanel--and-why-product-analytics-needed-more-than-one-unlike-engineering-observability-aug-30-2026) for why product analytics needed three plugins where engineering observability only needed one.
- **Transports:** `--transport stdio` (default) or `--transport streamable-http` (with `--port`, default 3000). The emitted streamable-http server is stateless by construction (`createMcpHandler` per request), so the v1 second-request crash (MCPFO-10) is structurally impossible—validated with real sequential HTTP requests in `emit-e2e.test.ts`. (`--transport web` was a v1-only option and was removed in the cutover.) See [ARCHITECTURE.md section 29](ARCHITECTURE.md#29-non-stdio-transports---transport-streamable-httpweb--the-stdio-only-guardrail-lifted-aug-30-2026) and [section 49](ARCHITECTURE.md#49-mcpfo-21-full-cutover--the-legacy-v1-generation-engine-removed-entirely-sep-4-2026).
- **Server metadata:** `--server-description <text>` sets the description in the emitted `server.json`. Cosmetic icon/website metadata (`--icon`/`--website`, [ARCHITECTURE.md section 31](ARCHITECTURE.md#31-cosmetic-branding-metadata-icons-websiteurl-description-aug-30-2026)) was v1-only and is tracked for re-implementation in [section 49](ARCHITECTURE.md#49-mcpfo-21-full-cutover--the-legacy-v1-generation-engine-removed-entirely-sep-4-2026).

### CLI ergonomics

`--force` overwrites a non-empty `--out` (refused by default); `--json` prints a single machine-readable result on stdout (success or failure, with a stable `stage` tag on error—built for scripts/agents); `--quiet` suppresses step-by-step progress while keeping warnings and the final summary; `--interactive` fails loudly instead of silently proceeding when stdin isn't a real terminal. The v2 emitter is quiet by construction—under `--json` stderr is empty, under `--quiet` it is just the final summary—so the section-33 third-party-noise workaround (needed only for v1's `generateMcpServer()`) is retired. See [ARCHITECTURE.md section 32](ARCHITECTURE.md#32-cli-ux-audit---force---json---quiet-non-tty-detection-for---interactive-aug-30-2026) for the audit these came from.

### Multi-language support

klaridian emits the generated server in **TypeScript (default) or Python**—pass `--language python` to get an official [`mcp`](https://pypi.org/project/mcp/) Python SDK project (`requirements.txt`, `pyproject.toml`, `server.py`) built from the same tool-data IR. Both languages produce identical tools, annotations, curation, and plugin instrumentation (`otel`, `posthog`, `amplitude`, `mixpanel`); the language choice is about the runtime you deploy, not the feature set. A few flags are still TypeScript-only for now (`--architecture code-mode`, `--oauth-*`, `--install`)—klaridian fails loudly rather than silently dropping them. See [ARCHITECTURE.md section 60](ARCHITECTURE.md) (guardrail reversed, `--language` design) and [section 61](ARCHITECTURE.md) (the Python emit-target build).

Separately, [`packages/python-posthog-middleware/`](packages/python-posthog-middleware/) ships `PostHogMiddleware`, a native FastMCP middleware (not a generator, not a patch) that attaches product-observability event capture to any *hand-written* FastMCP server via `mcp.add_middleware(PostHogMiddleware(...))`. Deliberately doesn't ship an `otel`-equivalent for Python—FastMCP already has that natively. See [ARCHITECTURE.md section 23](ARCHITECTURE.md#23-multi-language-expansion-pythonfastmcp-via-a-native-middleware-aug-30-2026).

### Competitive positioning

FastMCP (the dominant Python MCP framework) ships native, zero-config OpenTelemetry, and a competing generator already combines OpenAPI→FastMCP with OTel, OAuth2/JWT auth, and middleware—so the OTel plugin isn't differentiated for anyone already on FastMCP/Python. The PostHog plugin and tool curation are the clearer differentiators today. See [ARCHITECTURE.md section 21](ARCHITECTURE.md#21-competitive-feature-matrix-klaridian-vs-fastmcp-aug-30-2026) for the full matrix.

### Next up

The CLI now ships on PyPI (prebuilt wheels) and Homebrew alongside npm—that distribution work is done ([ARCHITECTURE.md section 64](ARCHITECTURE.md#64-distribution-reaches-the-python-ecosystem-through-a-compiled-binary-not-a-second-generator-sep-8-2026) and [section 66](ARCHITECTURE.md)). Ongoing differentiation work continues (see [ARCHITECTURE.md section 22](ARCHITECTURE.md#22-differentiation-paths-under-consideration-aug-30-2026)).

See [PLAN.md](PLAN.md) for:
- The full problem statement and validated market gap
- Business model (open-core, phased—see plan for why we're not committing to a paid tier on day one)
- What a future hosted layer could offer *without* duplicating Datadog/PostHog data
- Open questions and concrete next steps

## Running the tests

```bash
cd packages/cli
npm test
```

This runs real end-to-end tests: emitting a project, wiring in a plugin, `npm install`-ing it for real, building it with `tsc`, spawning it, and driving it over stdio JSON-RPC—not just unit tests on generated strings.

## Development environment

A [devcontainer](.devcontainer/devcontainer.json) is provided, pinned to the exact Node/Python versions [CI](.github/workflows/ci.yml) runs against (Node 22, Python 3.11) plus `gh`. Open this repo in VS Code / GitHub Codespaces and "Reopen in Container"—dependencies for both `packages/cli` and `packages/python-posthog-middleware` install automatically. See [PLAN.md section 11](PLAN.md#11-devcontainer-for-contributors-built-and-validated-aug-31-2026) for what was validated.

## License

[MIT](LICENSE) for the open-core CLI and base plugins—see [PLAN.md](PLAN.md) section 3 for the open-core model this sits within.

## Contributing

Early-stage, but open to issues and discussion—see [CONTRIBUTING.md](CONTRIBUTING.md). Please open an issue before investing time in a non-trivial PR, since the core direction is still being validated. Documentation follows the Microsoft Writing Style Guide—see [STYLE.md](STYLE.md).
