# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report it privately via [GitHub Security Advisories](https://github.com/ricardocvasconcelos/klaridian/security/advisories/new) for this repository. You should receive an acknowledgment within a few days.

Please include:
- A description of the vulnerability and its potential impact
- Steps to reproduce (a minimal OpenAPI spec or config that triggers it, if applicable)
- Any suggested fix, if you have one

## Scope

klaridian generates MCP servers from OpenAPI specs and provides observability plugins/middleware. Security-relevant areas include:

- **The generator itself** (`packages/cli`) — spec parsing (delegated to [`openapi-mcp-generator`](https://github.com/harsha-iiiv/openapi-mcp-generator), which has its own SSRF protections for external `$ref`s), the instrumentation patch (`render/instrument.ts`), and generated server code.
- **The observability plugins** (`plugins/otel`, `plugins/posthog`) — how they handle credentials (`KLARIDIAN_AUTH_TOKEN`, `POSTHOG_API_KEY`, OTLP endpoints), and whether generated servers leak sensitive data (auth tokens, request/response bodies) into traces or events.
- **The Python middleware** (`packages/python-posthog-middleware`) — same category of concern, applied to FastMCP servers.

**Out of scope:** vulnerabilities in the upstream API a generated server calls, or in `openapi-mcp-generator`/`FastMCP`/`posthog-node`/`posthog` themselves — please report those to their respective maintainers. We'll happily help triage whether an issue is upstream or in klaridian's own code if you're unsure.

## Known design constraints (not vulnerabilities, but worth knowing)

- Generated servers read auth tokens from environment variables in plaintext at runtime — this is a deliberate, documented simplification for v0 (see ARCHITECTURE.md section 17), not a secrets-management solution. Don't commit `.env` files with real tokens.
- The `otel` plugin sends trace data (including tool names and arguments) to whatever OTLP endpoint you configure — review what you're sending before pointing it at a third-party collector.
- The `posthog` plugin sends tool-call metadata (name, duration, success/error) to PostHog — same review applies.
