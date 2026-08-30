# mcpforge

> Generate MCP servers with engineering + product observability built in — no manual instrumentation.

**Status:** Working v0, now built on [`openapi-mcp-generator`](https://github.com/harsha-iiiv/openapi-mcp-generator) as the generation engine. Generates real, runnable MCP servers from an OpenAPI spec, optionally instrumented with OpenTelemetry. See [PLAN.md](PLAN.md) for the strategic plan and [ARCHITECTURE.md](ARCHITECTURE.md) for technical design + validation history.

## What is this?

`mcpforge` is a CLI that generates [Model Context Protocol](https://modelcontextprotocol.io) servers — from an OpenAPI spec — with observability wired in from the start:

- **Engineering observability** (`otel` plugin) — OpenTelemetry spans for every tool call, exportable to Datadog, Grafana, or any OTel-compatible backend via OTLP. Latency, errors, and status per call, with zero manual instrumentation.
- **Product observability** (`posthog` plugin) — a PostHog event per tool call (`tool_name`, `duration_ms`, `success`), so you can see adoption and usage patterns for how agents actually use your server.

You pick the plugins you want at generation time — `--plugin otel`, `--plugin posthog`, or both together (`--plugin otel --plugin posthog`, composed automatically). The server that comes out the other end is already instrumented.

mcpforge doesn't parse OpenAPI or generate server code itself — that's delegated to [`openapi-mcp-generator`](https://github.com/harsha-iiiv/openapi-mcp-generator), a mature, MIT-licensed library that handles the OpenAPI→MCP mapping (including `allOf`/`oneOf`/`anyOf`, OAuth2, the MCP 64-char tool-name limit, and multiple transports) better than we could by hand-rolling it. mcpforge's own code is entirely the instrumentation layer on top: a small, targeted patch to the one call site `openapi-mcp-generator` always generates (`executeApiTool`), wiring it through an `ObservabilityPlugin`.

## Why

Building an MCP server today means writing the server, then manually wiring up tracing and analytics — repetitive work every MCP server author does from scratch. Datadog, PostHog, Sentry, and Grafana already ship MCP servers of their own, but those let an agent *query* those platforms — they don't instrument a *new* server you're building. `mcpforge` closes that gap.

## Quickstart

```bash
cd packages/cli
npm install
npm run build

# Generate an MCP server from an OpenAPI spec, with OTel + PostHog instrumentation:
node dist/src/index.js generate \
  --spec ../../examples/petstore/openapi.json \
  --out /tmp/my-generated-server \
  --name my-petstore-server \
  --base-url https://petstore3.swagger.io/api/v3 \
  --plugin otel --plugin posthog \
  --plugin-config otel.serviceName=my-petstore-server

# Then run the generated server:
cd /tmp/my-generated-server
npm install && npm run build
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces   # optional, has a default
export POSTHOG_API_KEY=phc_your_project_key
npm start
```

Omit `--plugin` entirely to generate a plain, un-instrumented server (still via `openapi-mcp-generator`).

## Repository layout

```
mcpforge/
├── packages/
│   └── cli/                # the mcpforge CLI
│       ├── src/
│       │   ├── render/instrument.ts  # patches openapi-mcp-generator's output to wire in a plugin
│       │   ├── plugins/    # ObservabilityPlugin interface + plugins (otel, posthog)
│       │   └── commands/   # the `generate` CLI command (delegates generation to openapi-mcp-generator)
│       └── test/           # end-to-end tests (real npm install + build + run)
│   └── python-posthog-middleware/  # FastMCP-native PostHog middleware (Python) — no generation/patching, see ARCHITECTURE.md section 23
├── examples/
│   └── petstore/           # real OpenAPI spec used as the test fixture throughout
├── spike/                  # throwaway hand-written spike that validated the core mechanic first
├── PLAN.md                 # business/strategy plan
├── ARCHITECTURE.md         # technical design, decisions, and validation history
└── CLAUDE.md               # working agreements for AI agents contributing to this repo
```

## Status & roadmap

This project has a working v0 built on `openapi-mcp-generator`: OpenAPI → MCP server generation (delegated), plus a real, tested OpenTelemetry instrumentation layer patched on top. See [ARCHITECTURE.md](ARCHITECTURE.md) sections 16–18 for the pivot rationale, and sections 9–15 for the original hand-rolled implementation's history (superseded, kept for context).

**Real-world validation:** checked against the production [`Wavix/wavix-mcp-server`](https://github.com/Wavix/wavix-mcp-server)'s real OpenAPI spec (122 operations, heavy `allOf` usage, auth, binary responses). Via `openapi-mcp-generator`, mcpforge now generates **all 122 operations** (vs. 120/122 with the earlier hand-rolled mapper) as a working, compilable, OTel-instrumented server, from the unmodified real-world spec. See [ARCHITECTURE.md section 16](ARCHITECTURE.md#16-strategic-pivot-adopt-openapi-mcp-generator-as-the-generation-engine-instead-of-maintaining-our-own-aug-30-2026) for the pivot decision and [section 18](ARCHITECTURE.md#18-new-build-order-after-the-section-16-pivot) for validation details.

**Plugins available:** `otel` (engineering observability) and `posthog` (product observability) — composable together on the same server (`--plugin otel --plugin posthog`). See [ARCHITECTURE.md section 20](ARCHITECTURE.md#20-second-plugin-posthog-product-observability-and-multi-plugin-composition-aug-30-2026) for how composition works and what it validated.

**Competitive check (Aug 30, 2026):** FastMCP (the dominant Python MCP framework) ships native, zero-config OpenTelemetry by default, and a competing generator already combines OpenAPI→FastMCP with OTel, OAuth2/JWT auth, and middleware — so mcpforge's OTel plugin isn't differentiated for anyone already on FastMCP/Python. The PostHog plugin remains the one clearly unique offering in the whole space. See [ARCHITECTURE.md section 21](ARCHITECTURE.md#21-competitive-feature-matrix-mcpforge-vs-fastmcp-aug-30-2026) for the full matrix and [section 22](ARCHITECTURE.md#22-differentiation-paths-under-consideration-aug-30-2026) for candidate differentiation paths under discussion (multi-language support, deeper product observability, usage-driven tool curation, the hosted correlation layer, or an instrumentation-only generator-agnostic pivot) — no direction chosen yet.

**Python/FastMCP support (Aug 30, 2026):** first step on the multi-language path — [`packages/python-posthog-middleware/`](packages/python-posthog-middleware/) ships `PostHogMiddleware`, a native FastMCP middleware (not a generator, not a patch) that attaches product-observability event capture to ANY FastMCP server via `mcp.add_middleware(PostHogMiddleware(...))`. Deliberately doesn't ship an `otel`-equivalent for Python — FastMCP already has that natively. See [ARCHITECTURE.md section 23](ARCHITECTURE.md#23-multi-language-expansion-pythonfastmcp-via-a-native-middleware-aug-30-2026) for the full validation.

Next up: decide whether to publish the Python package to PyPI, and continue evaluating the other differentiation paths in section 22.

See [PLAN.md](PLAN.md) for:
- The full problem statement and validated market gap
- Business model (open-core, phased — see plan for why we're not committing to a paid tier on day one)
- What a future hosted layer could offer *without* duplicating Datadog/PostHog data
- Open questions and concrete next steps

## Running the tests

```bash
cd packages/cli
npm test
```

This runs real end-to-end tests: generating a project via `openapi-mcp-generator`, patching in the OTel plugin, `npm install`-ing it for real, building it with `tsc`, spawning it, and driving it over stdio JSON-RPC — not just unit tests on generated strings.

## License

TBD — planned MIT or Apache-2.0 for the open-core CLI and base plugins (see PLAN.md, section 3).

## Contributing

Not yet open for contributions — still validating the core concept. Star/watch the repo if you want to follow along.
