# CLAUDE.md

Guidance for AI agents (Claude Code, Hermes, or others) working in this repository.

## What this project is

`mcpforge` generates [Model Context Protocol](https://modelcontextprotocol.io) servers from an OpenAPI spec, with observability plugins (starting with OpenTelemetry) wired in automatically. Read [PLAN.md](PLAN.md) for the business/strategy context and [ARCHITECTURE.md](ARCHITECTURE.md) for technical design before making non-trivial changes — both are kept up to date as living documents, not one-off planning artifacts.

**This is Ricardo's personal project** (github.com/ricardocvasconcelos/mcpforge), unrelated to his employer (Wavix). Do not confuse it with, or leak details from, Wavix repositories/work.

## Working agreements

- **ARCHITECTURE.md is the source of truth for design decisions and their rationale.** When you make an architectural choice, a real finding, or a scope decision, add it as a new numbered section at the end of ARCHITECTURE.md (don't rewrite history — append, the same way the project's own ADR convention works in spirit, even though this repo doesn't use a separate `docs/adr/` yet). Include *why*, not just *what*.
- **PLAN.md is for business/strategy decisions** (open-core model, plugin priorities, launch channel, etc.), not technical ones. Keep the two documents separate.
- **Every non-trivial change should be validated end to end, not just unit-tested.** This project's tests intentionally do real `npm install` + `tsc build` + spawn-and-drive-over-stdio-JSON-RPC, because the riskiest failure mode (corrupting the MCP stdio transport) only shows up at that level — see `spike/FINDINGS.md` for why. Follow that pattern for new plugins/features rather than only testing generated string content.
- **"Fail loudly, don't guess"** is a hard rule (ARCHITECTURE.md section 7/8): when the OpenAPI mapper or generator hits something it can't confidently handle (unsupported schema shape, ambiguous name, missing config), it must produce a clear warning/error, never silently generate something subtly wrong.
- **v0 scope is deliberately narrow** — see ARCHITECTURE.md section 8's guardrails (OpenAPI-only input, stdio-only transport, 0-or-1 plugins, TypeScript/Node only, no hosted dashboard). Don't casually expand scope; if a change would cross one of these guardrails, flag it explicitly rather than just doing it.

## Repository layout (see README.md for the full picture)

- `packages/cli/src/openapi/` — spec parsing (`parse.ts`) and OpenAPI-operation → MCP-tool mapping (`map-tools.ts`). The trickiest logic in the project; changes here need the fixture-based edge-case tests in `test/map-tools.test.ts` kept in sync.
- `packages/cli/src/render/` — generates actual server source code (`generate-server-code.ts`) and writes the full project to disk (`render-project.ts`).
- `packages/cli/src/plugins/` — the `ObservabilityPlugin` interface and individual plugins (currently `otel/`). New plugins implement this interface; see ARCHITECTURE.md section 4 for why it's shaped the way it is.
- `packages/cli/src/commands/` + `src/index.ts` — the actual `mcpforge` CLI, built with `commander`.
- `examples/petstore/` — the real Swagger Petstore OpenAPI spec, used as the test fixture throughout. Prefer testing against this over inventing new fixtures where it's sufficient; add fixture-based tests (see `map-tools.test.ts`) only for edge cases the real spec doesn't happen to exercise.
- `spike/` — a throwaway, hand-written proof of the OpenAPI → MCP → OTel mechanic, built *before* the real generator, specifically to catch integration risks early. Keep it as historical reference (see `spike/FINDINGS.md`); don't build new features into it.

## Commands

```bash
cd packages/cli
npm install
npm run build            # tsc -p tsconfig.json
npm test                 # builds, then runs real end-to-end tests (npm install/build/run a generated server)

# Manually exercise the CLI:
node dist/src/index.js generate --spec ../../examples/petstore/openapi.json --out /tmp/out --name my-server [--plugin otel --plugin-config otel.serviceName=my-server]
```

## Known project-specific gotchas

- The compiled entrypoint is `dist/src/index.ts` → `dist/src/index.js` (not `dist/index.js`) because `tsconfig.json`'s `rootDir` is `.` (it needs to include both `src/` and `test/`). Double-check `package.json`'s `bin` field stays in sync if this ever changes.
- `ConsoleSpanExporter` writes to **stdout**, which corrupts the MCP stdio JSON-RPC stream — never use it in generated servers or in this CLI's own OTel plugin. Always `OTLPTraceExporter`; route any OTel diagnostics to stderr. This was a real bug caught in `spike/FINDINGS.md` — don't reintroduce it.
- OpenAPI `servers[0].url` can be a relative path (the real Petstore spec uses `/api/v3`, not a full domain) — generated servers require an explicit `MCPFORGE_BASE_URL` env var in that case rather than guessing a host.
