# klaridian

[![CI](https://github.com/klaridian/klaridian/actions/workflows/ci.yml/badge.svg)](https://github.com/klaridian/klaridian/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![MCP protocol](https://img.shields.io/badge/MCP-2026--07--28-8A2BE2.svg)](https://modelcontextprotocol.io)

![klaridian: OpenAPI spec to MCP server, instrumented with engineering observability (OTel → Datadog/Grafana/Honeycomb/New Relic/any OTLP backend) and product analytics (PostHog/Amplitude/Mixpanel plugins), plus tool curation](assets/banner.png)

> Generate MCP servers with engineering + product observability built in—no manual instrumentation.

**Status:** v0.3.0. Generates real, runnable [Model Context Protocol](https://modelcontextprotocol.io) servers from an OpenAPI spec—**OpenAPI 3.1, 3.0, and Swagger 2.0** (2.0 is converted to 3.0 automatically)—in TypeScript or Python, optionally instrumented with OpenTelemetry and/or a product-analytics plugin (PostHog, Amplitude, or Mixpanel), with generation-time tool curation. klaridian owns the full spec-to-server pipeline (built on `@apidevtools/swagger-parser` and `swagger2openapi`). The CLI ships on **npm, PyPI, and Homebrew**, with prebuilt native binaries for macOS, Linux, and Windows. See [PLAN.md](PLAN.md) for the strategic plan and [ARCHITECTURE.md](ARCHITECTURE.md) for technical design + validation history.

**Contents:** [What is this?](#what-is-this) · [Why](#why) · [Install](#install) · [Quickstart](#quickstart) · [Repository layout](#repository-layout) · [Status & roadmap](#status--roadmap) · [Running the tests](#running-the-tests) · [Development environment](#development-environment) · [License](#license) · [Contributing](#contributing)

## What is this?

`klaridian` is a CLI that generates MCP servers—from an OpenAPI spec—with observability and tool curation wired in from the start.

**What you get:**

- **Two languages**—TypeScript (default) or Python, same tools and features (`--language python`).
- **Every OpenAPI flavor**—3.1, 3.0, and Swagger 2.0 (2.0 is converted automatically).
- **The latest MCP protocol**—serves `2026-07-28` and keeps `2025-11-25` clients working, on one server.
- **Observability wired in**—OpenTelemetry (`otel`) or product analytics (`posthog`, `amplitude`, `mixpanel`), one flag.
- **Tool curation**—pick which operations become tools by tag, path, or HTTP method, or through an interactive prompt.
- **Structured output**—tools advertise an `outputSchema` and return `structuredContent`, in JSON Schema 2020-12.
- **Marketplace annotations**—every tool gets a title and read-only / destructive / idempotent / open-world hints.
- **A built-in test client**—streamable-http servers serve an HTML client at `GET /`; stdio documents MCP Inspector.
- **Ships where you deploy**—`deploy --target docker|cloudflare|fly`.
- **Runs everywhere**—one CLI on npm, PyPI, and Homebrew, with prebuilt binaries for macOS, Linux, and Windows.
- **Open by default**—a real `LICENSE` file in every generated server.

The three things it wires in that you'd otherwise hand-write:

- **Engineering observability** (`otel` plugin)—OpenTelemetry spans for every tool call, exportable via OTLP to Datadog, Grafana, Honeycomb, New Relic, or any other OTLP-compatible backend. Latency, errors, and status per call, with zero manual instrumentation. One plugin reaches every backend here because OTel/OTLP is a genuine open wire protocol.
- **Product observability**—an event per tool call (`tool_name`, `duration_ms`, `success`) captured by whichever provider you pick: `posthog`, `amplitude`, or `mixpanel` plugins. Unlike OTel, there's no shared standard for product analytics ingestion, so this is three separate plugins rather than one—see [ARCHITECTURE.md section 26](ARCHITECTURE.md#26-two-more-product-analytics-plugins-amplitude-mixpanel--and-why-product-analytics-needed-more-than-one-unlike-engineering-observability-aug-30-2026) for why that's a structural difference, not an oversight.
- **Tool curation**—choose which OpenAPI operations become tools at generation time (`--include-tags`/`--exclude-tags`/`--exclude-operation-ids`, or tag-independent `--include-paths`/`--exclude-paths`/`--include-methods`/`--exclude-methods` regex/HTTP-method filters for specs with no OpenAPI tags at all, or an interactive prompt), so you don't ship every operation in a large spec as a tool by default.

You can also curate and annotate from inside the spec with the `x-klaridian` extension (klaridian's own `x-<vendor>` field). `expose: false` hides an operation; `title` overrides the tool name; `readOnly`/`destructive`/`openWorld` set the matching MCP tool annotations:

```yaml
paths:
  /books/{id}:
    delete:
      x-klaridian:
        expose: true                       # include as a tool (omit = included by default)
        title: "Remove a book from the catalog"   # overrides the generated tool name
        destructive: true                  # sets destructiveHint on the tool
    get:
      x-klaridian:
        readOnly: true                     # sets readOnlyHint
  /internal/admin:
    post:
      x-klaridian:
        expose: false                      # never surfaced as a tool
```

You pick a plugin you want at generation time—e.g. `--plugin otel` or `--plugin posthog`. The server that comes out the other end is already instrumented. (Composing more than one plugin on the same server was a capability of the retired v1 pipeline and is not yet re-implemented on the current emitter—see [ARCHITECTURE.md section 49](ARCHITECTURE.md#49-mcpfo-21-full-cutover--the-legacy-v1-generation-engine-removed-entirely-sep-4-2026).)

OpenAPI parsing / tool-data extraction is handled by klaridian's own spec→tool-data engine, built on [`@apidevtools/swagger-parser`](https://www.npmjs.com/package/@apidevtools/swagger-parser) (parse, `$ref` dereference, validation) and [`swagger2openapi`](https://www.npmjs.com/package/swagger2openapi) (Swagger 2.0 → OpenAPI 3.0 conversion); klaridian owns the operation→tool mapping end to end. Its own code then emits the MCP server project itself—a stateless [`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server) (SDK v2, protocol 2026-07-28 with 2025-11-25 legacy clients still supported) project—plus the instrumentation and curation layers on top.

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

## Upstream authentication

The generated server authenticates to the upstream API using **the actual OpenAPI `securityScheme`** each operation declares—apiKey (header, query, or cookie), HTTP bearer, HTTP basic, or OAuth2/OpenID Connect—not a one-size-fits-all bearer token. Credentials come from environment variables at runtime, so one build points at different deployments without a rebuild. The convention (TypeScript and Python emit identical wiring):

| Scheme | Environment variable(s) | What the server sends |
|---|---|---|
| `http` `bearer` | `KLARIDIAN_AUTH_TOKEN` | `Authorization: Bearer <token>` |
| `apiKey` (header/query/cookie) | `KLARIDIAN_API_KEY` | the named header, query param, or `Cookie` entry |
| `http` `basic` | `KLARIDIAN_BASIC_USER` + `KLARIDIAN_BASIC_PASS` | `Authorization: Basic base64(user:pass)` |
| `oauth2` / `openIdConnect` | `KLARIDIAN_OAUTH_TOKEN` | `Authorization: Bearer <token>` (you supply the token) |

`KLARIDIAN_AUTH_TOKEN` stays the bearer default, so existing deployments keep working. `mutualTLS` is unsupported (a client certificate can't come from an env var)—klaridian fails loudly at generation time if an operation offers only `mutualTLS`.

Two flags cover per-user and exotic auth:

- **`--forward-headers <names>`** — a comma-separated list of inbound HTTP header names the server forwards from the MCP client to the upstream (streamable-http only; stdio has no inbound headers and the flag is rejected there). Use it for per-user API keys passed through the MCP client.
- **`--auth-hook`** — emits an editable pre-auth hook file (`src/auth-hook.ts` or `auth_hook.py`) the server calls before built-in auth. Return `true` to skip built-in auth—an escape hatch for request signing, token exchange, or any scheme klaridian doesn't emit natively.

See the [Upstream authentication how-to](https://klaridian.dev/docs/how-to/upstream-auth) for the full guide and [ARCHITECTURE.md section 95](ARCHITECTURE.md) for the design.

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
│   ├── petstore/           # real OpenAPI spec used as the test fixture throughout
│   └── annotated/          # small spec showing the x-klaridian extension (tool hints + expose)
├── spikes/                  # throwaway spikes that validated risky mechanics before building for real (see spikes/README.md)
├── PLAN.md                 # business/strategy plan
├── ARCHITECTURE.md         # technical design, decisions, and validation history
└── CLAUDE.md               # working agreements for AI agents (symlink to AGENTS.md, the cross-tool standard)
```

## Status & roadmap

Released v0.3.0: OpenAPI → MCP server generation across OpenAPI 3.1, 3.0, and Swagger 2.0, a tested OpenTelemetry / product-analytics instrumentation layer, generation-time tool curation, structured tool output (`outputSchema` + `structuredContent`), a built-in HTML test client for streamable-http servers, and `deploy --target docker|cloudflare|fly`. The CLI is distributed on npm, PyPI, and Homebrew, with prebuilt native binaries for macOS, Linux, and Windows—see [Install](#install) and [ARCHITECTURE.md section 64](ARCHITECTURE.md#64-distribution-reaches-the-python-ecosystem-through-a-compiled-binary-not-a-second-generator-sep-8-2026). klaridian owns the full spec-to-tool-data pipeline (on `@apidevtools/swagger-parser` + `swagger2openapi`) and emits a stateless `@modelcontextprotocol/server` (SDK v2) project directly from tool data. The generated server serves MCP protocol `2026-07-28` (the modern revision, negotiated via `server/discover`) while keeping `2025-11-25` legacy clients supported (the classic `initialize` handshake)—the two revisions coexist on one server, verified end to end on both stdio and streamable-http, for TypeScript and Python alike. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full decision history.

### What's always on

- **MCP spec conformance**—the SDK-v2 emitter produces spec-conformant tool error handling natively: an unknown-tool call is a genuine JSON-RPC protocol error (`-32602`), and a tool-execution failure sets `isError: true` on the result. (v1 needed a textual patch for both—[ARCHITECTURE.md section 28](ARCHITECTURE.md#28-mcp-spec-conformance-audit--fixes-aug-30-2026)—which is why the cutover shrank klaridian's fragile surface.)
- **Marketplace tool annotations**—every tool gets a `title` and MCP annotations (`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`, derived from its HTTP method), emitted natively by the generator. Per-tool rate limiting and output sanitization were v1-only features with no v2 equivalent yet—tracked as follow-up in [ARCHITECTURE.md section 49](ARCHITECTURE.md#49-mcpfo-21-full-cutover--the-legacy-v1-generation-engine-removed-entirely-sep-4-2026).
- **Structured output**—when an operation's success response is a JSON object, the tool advertises a matching `outputSchema` and returns `structuredContent` (the parsed body) alongside the text result, so clients get typed output instead of re-parsing text. klaridian reads and dereferences the response schema from the spec itself (the tool-data dependency carries no response shape—this is the first piece of the spec klaridian extracts with its own engine). Array/primitive/no-body responses stay text-only. TypeScript and Python at parity. See [ARCHITECTURE.md section 83](ARCHITECTURE.md#83-native-outputschemastructuredcontent-via-klaridian-owned-response-schema-extraction--the-first-own-engine-step-sep-13-2026).
- **JSON Schema 2020-12 dialect**—every tool's input and output schema is emitted in [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/schema), the default dialect for MCP schema definitions (MCP revision 2025-11-25), and declares it with a `$schema` field. Schemas derived from your OpenAPI 3.x spec are converted from their draft-07-style form (e.g. boolean `exclusiveMinimum` → the 2020-12 numeric form). TypeScript and Python at parity. See [ARCHITECTURE.md section 89](ARCHITECTURE.md#89-tool-inputoutput-schemas-re-dialected-to-json-schema-2020-12-mcpfo-91-sep-18-2026).
- **Real `LICENSE` file by default**—every generated server ships with a `LICENSE` file and a `package.json.license` field (`--license mit` default, or `--license apache-2.0`; `--license none` opts out but prints a warning). MCP servers run with real credentials next to an autonomous agent, so being open/auditable by default matters more than for a typical scaffolded project. See [PLAN.md section 7](PLAN.md#7-distribution-norm-why-mcp-servers-are-conventionally-open-source-and-what-that-implies-for-klaridian-aug-30-2026) and [ARCHITECTURE.md section 27](ARCHITECTURE.md#27-generated-server-license--packagejson-license-field-aug-30-2026) for why.
- **SSRF-safe spec parsing**—by default klaridian refuses to fetch **remote http(s) external `$ref` pointers** in your spec, so a malicious or compromised spec can't make klaridian request attacker-controlled or internal-network URLs from your machine or CI runner at generation time. Local-file `$ref`s (real multi-file specs) always resolve. If you trust a spec and need its remote refs fetched, pass `--allow-external-refs`. See [External $ref resolution](https://klaridian.dev/docs/how-to/external-refs) and [ARCHITECTURE.md section 94](ARCHITECTURE.md).

### Plugins and transports

- **Plugins:** `otel` (engineering observability, any OTLP backend) and three product-analytics plugins—`posthog`, `amplitude`, `mixpanel`. One plugin per generated server on the current emitter; multi-plugin composition ([ARCHITECTURE.md section 20](ARCHITECTURE.md#20-second-plugin-posthog-product-observability-and-multi-plugin-composition-aug-30-2026)) was a v1 capability not yet re-implemented ([section 49](ARCHITECTURE.md#49-mcpfo-21-full-cutover--the-legacy-v1-generation-engine-removed-entirely-sep-4-2026)). See [section 26](ARCHITECTURE.md#26-two-more-product-analytics-plugins-amplitude-mixpanel--and-why-product-analytics-needed-more-than-one-unlike-engineering-observability-aug-30-2026) for why product analytics needed three plugins where engineering observability only needed one.
- **Transports:** two, both verified end to end in `emit-e2e.test.ts`:

  | Transport | Flag | Test client | Notes |
  | --- | --- | --- | --- |
  | stdio (default) | `--transport stdio` | MCP Inspector (documented in the generated README) | for local/agent use |
  | streamable-http | `--transport streamable-http --port 3000` | HTML client served at `GET /` | stateless by construction (`createMcpHandler` per request), so the v1 second-request crash (MCPFO-10) is structurally impossible |

  (`--transport web`, the v1 SSE option, was removed in the cutover.) See [ARCHITECTURE.md section 29](ARCHITECTURE.md#29-non-stdio-transports---transport-streamable-httpweb--the-stdio-only-guardrail-lifted-aug-30-2026) and [section 49](ARCHITECTURE.md#49-mcpfo-21-full-cutover--the-legacy-v1-generation-engine-removed-entirely-sep-4-2026).
- **Server metadata:** `--server-description <text>` sets the description in the emitted `server.json`. Cosmetic icon/website metadata (`--icon`/`--website`, [ARCHITECTURE.md section 31](ARCHITECTURE.md#31-cosmetic-branding-metadata-icons-websiteurl-description-aug-30-2026)) was v1-only and is tracked for re-implementation in [section 49](ARCHITECTURE.md#49-mcpfo-21-full-cutover--the-legacy-v1-generation-engine-removed-entirely-sep-4-2026).
- **Deploy:** `klaridian deploy <dir> --target <docker|cloudflare|fly>` emits a platform's native config for a generated streamable-http server, following an emit + shell-out model — klaridian writes the config, you hand it to the platform's CLI. `docker` emits a portable `Dockerfile` + `.dockerignore` (TypeScript or Python); `cloudflare` emits a Worker + `wrangler.toml` (TypeScript, edge); `fly` emits `fly.toml` over the Dockerfile (either language, one-command container deploy). The generated server is deploy-ready: it reads `PORT` and `KLARIDIAN_ALLOWED_HOSTS` from the environment so one build runs unchanged behind a public host (see [Deploy](packages/site/content/docs/how-to/deploy.mdx) and ARCHITECTURE.md sections 78–82).

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
