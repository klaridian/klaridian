# mcpforge

> Generate MCP servers with engineering + product observability built in — no manual instrumentation.

**Status:** Working v0. Generates real, runnable MCP servers from an OpenAPI spec, optionally instrumented with OpenTelemetry. See [PLAN.md](PLAN.md) for the strategic plan and [ARCHITECTURE.md](ARCHITECTURE.md) for technical design + validation history.

## What is this?

`mcpforge` is a CLI that generates [Model Context Protocol](https://modelcontextprotocol.io) servers — from an OpenAPI spec — with observability wired in from the start:

- **Engineering observability** (available now) — OpenTelemetry spans for every tool call, exportable to Datadog, Grafana, or any OTel-compatible backend via OTLP. Latency, errors, and status per call, with zero manual instrumentation.
- **Product observability** (planned) — tool usage events sent to PostHog (or similar), so you can see adoption, usage funnels, and success rates for how agents actually use your server.

You pick the plugins you want at generation time. The server that comes out the other end is already instrumented.

## Why

Building an MCP server today means writing the server, then manually wiring up tracing and analytics — repetitive work every MCP server author does from scratch. Datadog, PostHog, Sentry, and Grafana already ship MCP servers of their own, but those let an agent *query* those platforms — they don't instrument a *new* server you're building. `mcpforge` closes that gap.

## Quickstart

```bash
cd packages/cli
npm install
npm run build

# Generate an MCP server from an OpenAPI spec, with OTel instrumentation:
node dist/src/index.js generate \
  --spec ../../examples/petstore/openapi.json \
  --out /tmp/my-generated-server \
  --name my-petstore-server \
  --plugin otel \
  --plugin-config otel.serviceName=my-petstore-server

# Then run the generated server:
cd /tmp/my-generated-server
npm install && npm run build
export MCPFORGE_BASE_URL=https://petstore3.swagger.io/api/v3   # only needed if the spec's server URL is relative
npm start
```

Omit `--plugin otel` to generate a plain, un-instrumented server.

## Repository layout

```
mcpforge/
├── packages/
│   └── cli/                # the mcpforge CLI — parser, mapper, templating, plugins
│       ├── src/
│       │   ├── openapi/    # OpenAPI parsing + OpenAPI-operation -> MCP-tool mapping
│       │   ├── render/     # generates the actual server source + project files
│       │   ├── plugins/    # ObservabilityPlugin interface + the otel plugin
│       │   └── commands/   # the `generate` CLI command
│       └── test/           # end-to-end tests (real npm install + build + run)
├── examples/
│   └── petstore/           # real OpenAPI spec used as the test fixture throughout
├── spike/                  # throwaway hand-written spike that validated the core mechanic first
├── PLAN.md                 # business/strategy plan
├── ARCHITECTURE.md         # technical design, decisions, and validation history
└── CLAUDE.md               # working agreements for AI agents contributing to this repo
```

## Status & roadmap

This project has a working v0: OpenAPI → MCP server generation, plus a real, tested OpenTelemetry plugin. See [ARCHITECTURE.md](ARCHITECTURE.md) sections 9–13 for exactly what's built, what's tested, and what real findings changed the design along the way.

**Real-world validation:** we checked whether mcpforge could generate a server comparable to the production [`Wavix/wavix-mcp-server`](https://github.com/Wavix/wavix-mcp-server) from its real OpenAPI spec (122 operations, heavy `allOf` usage, auth, binary responses). Verdict and prioritized gap list in [ARCHITECTURE.md section 14](ARCHITECTURE.md#14-real-world-validation-case-could-mcpforge-replacegenerate-a-wavix-compatible-mcp-server-aug-30-2026). **Update:** `allOf` merging and authentication support (the top 2 gaps) are now implemented — mcpforge generates and compiles a real **120-tool, auth-wired MCP server from the unmodified Wavix spec**. See [section 15](ARCHITECTURE.md#15-allof-schema-merging--implemented-and-validated-against-the-real-wavix-spec-aug-30-2026) and [section 16](ARCHITECTURE.md#16-authentication-support--implemented-and-validated-end-to-end-against-the-real-wavix-spec-aug-30-2026).

Next up (see ARCHITECTURE.md section 9 build order): an explicit OpenAPI 3.1 test fixture, binary/streaming response handling, and `multipart/form-data` support are the remaining post-v0 priorities.

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

This runs real end-to-end tests: generating a project, `npm install`-ing it for real, building it with `tsc`, spawning it, and driving it over stdio JSON-RPC — not just unit tests on generated strings.

## License

TBD — planned MIT or Apache-2.0 for the open-core CLI and base plugins (see PLAN.md, section 3).

## Contributing

Not yet open for contributions — still validating the core concept. Star/watch the repo if you want to follow along.
