# klaridian

[![CI](https://github.com/klaridian/klaridian/actions/workflows/ci.yml/badge.svg)](https://github.com/klaridian/klaridian/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![MCP protocol](https://img.shields.io/badge/MCP-2026--07--28-8A2BE2.svg)](https://modelcontextprotocol.io)

![klaridian: OpenAPI spec to MCP server, instrumented with engineering observability (OTel → any OTLP backend) and product analytics (PostHog/Amplitude/Mixpanel), plus tool curation](assets/banner.png)

> ⚡ Generate MCP servers with engineering + product observability built in—no manual instrumentation.

**Status:** v0.3.0. `klaridian` is a CLI that turns an OpenAPI spec into a real, runnable [Model Context Protocol](https://modelcontextprotocol.io) server—in TypeScript or Python—with observability and tool curation wired in from the start. See [PLAN.md](PLAN.md) for strategy and [ARCHITECTURE.md](ARCHITECTURE.md) for design + decision history.

**Contents:** [What you get](#what-you-get) · [Why](#why) · [Install](#install) · [Quickstart](#quickstart) · [Upstream auth](#upstream-authentication) · [Repository layout](#repository-layout) · [Tests](#running-the-tests) · [Development](#development-environment) · [License](#license) · [Contributing](#contributing)

## What you get

- **Two languages, one feature set**—TypeScript (default) or Python (`--language python`): identical tools, annotations, curation, and instrumentation.
- **Every OpenAPI flavor**—3.1, 3.0, and Swagger 2.0 (converted automatically). klaridian owns the whole spec→server pipeline (on `@apidevtools/swagger-parser` + `swagger2openapi`).
- **The latest MCP protocol**—serves `2026-07-28` (via `server/discover`) and keeps `2025-11-25` clients working, on one server.
- **Observability, one flag**—OpenTelemetry (`--plugin otel`, spans over OTLP to Datadog/Grafana/Honeycomb/New Relic/any OTLP backend) or product analytics (`--plugin posthog|amplitude|mixpanel`, an event per tool call). One plugin per server today.
- **Tool curation**—choose which operations become tools by tag, path, or HTTP method, or interactively—so a large spec doesn't ship every operation as a tool.
- **Structured, annotated tools**—each tool advertises an `outputSchema` + returns `structuredContent` (JSON Schema 2020-12), and carries a title plus read-only / destructive / idempotent / open-world hints.
- **Real upstream auth**—the generated server authenticates using each operation's actual OpenAPI `securityScheme`, from environment variables. [Details below.](#upstream-authentication)
- **Ships where you deploy**—a built-in HTML test client for streamable-http servers, plus `deploy --target docker|cloudflare|fly`.
- **Runs everywhere**—one CLI on npm, PyPI, and Homebrew, with prebuilt native binaries for macOS, Linux, and Windows.
- **Open by default**—a real `LICENSE` file in every generated server.

You can also curate and annotate from inside the spec with the `x-klaridian` extension (klaridian's own `x-<vendor>` field): `expose: false` hides an operation, `title` overrides the tool name, and `readOnly`/`destructive`/`openWorld` set the matching MCP annotations.

```yaml
paths:
  /books/{id}:
    delete:
      x-klaridian:
        title: "Remove a book from the catalog"   # overrides the generated tool name
        destructive: true                          # sets destructiveHint
    get:
      x-klaridian: { readOnly: true }              # sets readOnlyHint
  /internal/admin:
    post:
      x-klaridian: { expose: false }               # never surfaced as a tool
```

## Why

Building an MCP server means writing the server, then hand-wiring tracing and analytics from scratch. Datadog, PostHog, and Grafana ship MCP servers that let an agent *query* their platforms—they don't instrument a *new* server you're building. `klaridian` closes that gap.

## Install

klaridian is one CLI on every major channel—pick whichever fits your toolchain:

```bash
# npx (Node.js) — run once, nothing installed; recommended for a generator
npx klaridian generate --spec ./api.yaml --out ./my-server

# npm (Node.js) — install the command globally
npm install -g klaridian

# PyPI — prebuilt native binary, no Node.js required
pip install klaridian           # or: uv tool install klaridian / pipx install klaridian

# Homebrew (macOS + Linux) — prebuilt native binary
brew tap klaridian/klaridian && brew install klaridian
```

The PyPI and Homebrew channels ship a **standalone native binary** (compiled with `bun --compile`, byte-identical to the Node build), so they run with zero Node.js—the same pattern [ruff](https://pypi.org/project/ruff/) and [uv](https://pypi.org/project/uv/) use. Every [GitHub Release](https://github.com/klaridian/klaridian/releases/latest) also attaches a raw binary per platform (macOS arm64/x64, Linux arm64/x64, Windows x64). To build from source, see [Development](#development-environment).

## Quickstart

```bash
# Generate an MCP server from an OpenAPI spec, with OTel instrumentation:
klaridian generate \
  --spec ./openapi.json \
  --out /tmp/my-server \
  --name my-petstore-server \
  --base-url https://petstore3.swagger.io/api/v3 \
  --plugin otel --plugin-config otel.serviceName=my-petstore-server

# Then run it:
cd /tmp/my-server && npm install && npm run build && npm start
```

Prefer Python? Add `--language python` for an official `mcp` SDK project (`requirements.txt`, `pyproject.toml`, `server.py`)—same tools and instrumentation. Run it with `pip install -r requirements.txt` then `python server.py` (set `KLARIDIAN_BASE_URL`).

Omit `--plugin` for a plain server. Curate with `--include-tags`/`--exclude-tags`/`--exclude-operation-ids` (tag-based) or `--include-paths`/`--exclude-paths`/`--include-methods`/`--exclude-methods` (regex/method, works even with zero OpenAPI tags), or `--interactive`. Every server ships a real `LICENSE` by default (`--license mit`/`apache-2.0`; `--license none` opts out with a warning; `--author` sets the copyright holder).

Publishing to the MCP Registry? `--registry-name io.github.you/server` sets the reverse-DNS name and marks the project publishable; the version is derived from your spec's `info.version` (or `--server-version`). See [Publishing to the MCP Registry](https://klaridian.dev/docs/how-to/mcp-registry).

For the full flag reference: [CLI reference](https://klaridian.dev/docs/reference/cli-reference). Machine-readable output for scripts/agents: `--json` (single result + stable `stage` tag on error), `--quiet`, `--force`.

## Upstream authentication

The generated server authenticates to the upstream API using **the actual OpenAPI `securityScheme`** each operation declares—not a one-size-fits-all bearer. Credentials come from environment variables, so one build points at different deployments without a rebuild (TypeScript and Python emit identical wiring):

| Scheme | Environment variable(s) | What the server sends |
|---|---|---|
| `http` `bearer` | `KLARIDIAN_AUTH_TOKEN` | `Authorization: Bearer …` |
| `apiKey` (header/query/cookie) | `KLARIDIAN_API_KEY` | the named header, query param, or `Cookie` entry |
| `http` `basic` | `KLARIDIAN_BASIC_USER` + `KLARIDIAN_BASIC_PASS` | `Authorization: Basic …` |
| `oauth2` / `openIdConnect` | `KLARIDIAN_OAUTH_TOKEN` | `Authorization: Bearer …` (you supply the token) |

`mutualTLS` is unsupported (a client cert can't come from an env var)—klaridian fails loudly if an operation offers only that. Two flags cover the rest: **`--forward-headers`** forwards named inbound headers from the MCP client to the upstream (streamable-http only), for per-user credentials; **`--auth-hook`** emits an editable pre-auth hook for request signing, token exchange, or any scheme not emitted natively. Full guide: [Upstream authentication](https://klaridian.dev/docs/how-to/upstream-auth).

## Repository layout

```
klaridian/
├── packages/
│   ├── cli/                        # the klaridian CLI
│   │   ├── src/
│   │   │   ├── emit/               # emits the stateless SDK-v2 MCP server project from tool data
│   │   │   ├── plugins/            # ObservabilityPlugin interface + otel/posthog/amplitude/mixpanel
│   │   │   ├── curation/           # tool curation + interactive prompt
│   │   │   └── commands/           # generate, deploy, start, init
│   │   └── test/                   # end-to-end tests (real npm install + build + run)
│   └── python-posthog-middleware/  # FastMCP-native PostHog middleware (see ARCHITECTURE.md §23)
├── examples/                       # petstore (test fixture) + annotated (x-klaridian demo)
├── spikes/                         # throwaway spikes that validated risky mechanics
├── PLAN.md                         # business/strategy plan
├── ARCHITECTURE.md                 # technical design, decisions, validation history
└── AGENTS.md                       # working agreements for AI agents (CLAUDE.md symlinks here)
```

## Running the tests

```bash
cd packages/cli && npm test
```

Real end-to-end tests: emit a project, wire in a plugin, `npm install` it for real, build with `tsc`, spawn it, and drive it over stdio JSON-RPC—not just unit tests on generated strings.

## Development environment

A [devcontainer](.devcontainer/devcontainer.json) is provided, pinned to the Node/Python versions [CI](.github/workflows/ci.yml) runs against (Node 22, Python 3.11) plus `gh`. Open in VS Code / GitHub Codespaces and "Reopen in Container"—dependencies for both packages install automatically.

## License

[MIT](LICENSE) for the open-core CLI and base plugins—see [PLAN.md](PLAN.md) §3 for the open-core model this sits within.

## Contributing

Early-stage, but open to issues and discussion—see [CONTRIBUTING.md](CONTRIBUTING.md). Please open an issue before a non-trivial PR, since the core direction is still being validated. Documentation follows the Microsoft Writing Style Guide—see [STYLE.md](STYLE.md).
