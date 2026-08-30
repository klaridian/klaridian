# mcpforge

> Generate MCP servers with engineering + product observability built in — no manual instrumentation.

**Status:** Pre-alpha / planning stage. Not yet functional. See [PLAN.md](PLAN.md) for the full strategic plan.

## What is this?

`mcpforge` is a CLI that generates [Model Context Protocol](https://modelcontextprotocol.io) servers — from an OpenAPI spec or a manual tool definition — with observability wired in from the start:

- **Engineering observability** — OpenTelemetry spans for every tool call, exportable to Datadog, Grafana, or any OTel-compatible backend. Latency, errors, and cost per call, with zero manual instrumentation.
- **Product observability** — tool usage events sent to PostHog (or similar), so you can see adoption, usage funnels, and success rates for how agents actually use your server.

You pick the plugins you want at generation time. The server that comes out the other end is already instrumented.

## Why

Building an MCP server today means writing the server, then manually wiring up tracing and analytics — repetitive work every MCP server author does from scratch. Datadog, PostHog, Sentry, and Grafana already ship MCP servers of their own, but those let an agent *query* those platforms — they don't instrument a *new* server you're building. `mcpforge` closes that gap.

## Status & roadmap

This project is in the planning phase. See [PLAN.md](PLAN.md) for:

- The full problem statement and validated market gap
- Business model (open-core, phased — see plan for why we're not committing to a paid tier on day one)
- What a future hosted layer could offer *without* duplicating Datadog/PostHog data
- Open questions and concrete next steps

## License

TBD — planned MIT or Apache-2.0 for the open-core CLI and base plugins (see PLAN.md, section 3).

## Contributing

Not yet open for contributions — still validating the core concept. Star/watch the repo if you want to follow along.
