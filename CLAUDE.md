# CLAUDE.md

Guidance for AI agents (Claude Code, Hermes, or others) working in this repository.

## What this project is

`mcpforge` generates [Model Context Protocol](https://modelcontextprotocol.io) servers from an OpenAPI spec, with observability plugins (starting with OpenTelemetry) wired in automatically. Read [PLAN.md](PLAN.md) for the business/strategy context and [ARCHITECTURE.md](ARCHITECTURE.md) for technical design before making non-trivial changes — both are kept up to date as living documents, not one-off planning artifacts.

**This is Ricardo's personal project** (github.com/ricardocvasconcelos/mcpforge), unrelated to his employer (Wavix). Do not confuse it with, or leak details from, Wavix repositories/work.

**Architecture pivot (Aug 30, 2026, ARCHITECTURE.md section 16):** mcpforge no longer parses OpenAPI or generates server code itself. That's delegated to [`openapi-mcp-generator`](https://github.com/harsha-iiiv/openapi-mcp-generator), a mature MIT-licensed library that does it better than the earlier hand-rolled implementation (sections 9-15, kept as historical reference — don't resurrect it). mcpforge's own code is now entirely the *instrumentation* layer: a small textual patch (`render/instrument.ts`) that rewrites the one call site `openapi-mcp-generator` always generates (`executeApiTool`) to route through an `ObservabilityPlugin`.

## Working agreements

- **ARCHITECTURE.md is the source of truth for design decisions and their rationale.** When you make an architectural choice, a real finding, or a scope decision, add it as a new numbered section at the end of ARCHITECTURE.md (don't rewrite history — append, the same way the project's own ADR convention works in spirit, even though this repo doesn't use a separate `docs/adr/` yet). Include *why*, not just *what*.
- **PLAN.md is for business/strategy decisions** (open-core model, plugin priorities, launch channel, etc.), not technical ones. Keep the two documents separate.
- **Every non-trivial change should be validated end to end, not just unit-tested.** This project's tests intentionally do real `npm install` + `tsc build` + spawn-and-drive-over-stdio-JSON-RPC, because the riskiest failure mode (corrupting the MCP stdio transport) only shows up at that level — see `spike/FINDINGS.md` for why. Follow that pattern for new plugins/features rather than only testing generated string content.
- **"Fail loudly, don't guess" still applies to the instrumentation patch itself**, even though the OpenAPI mapping/generation is now delegated: `instrument.ts` throws `InstrumentationPatchError` if the expected `executeApiTool` call site or import marker isn't found verbatim in `openapi-mcp-generator`'s output, rather than silently producing an uninstrumented server. If you bump the `openapi-mcp-generator` version, re-verify this patch still matches its generated shape — its code isn't a contract we control.
- **v0 scope is deliberately narrow** — see ARCHITECTURE.md section 8's guardrails (OpenAPI-only input, stdio-only transport, 0-or-1 plugins, TypeScript/Node only, no hosted dashboard). Don't casually expand scope; if a change would cross one of these guardrails, flag it explicitly rather than just doing it.
- **`npm audit` on a cloned dependency's repo overstates real risk** — always re-check from a clean `npm install <package>` as a real consumer before treating a dependency's reported vulnerabilities as blocking (see ARCHITECTURE.md section 18 item 1: `openapi-mcp-generator`'s 19 reported vulnerabilities were entirely in its own `devDependencies`, 0 as an actual consumer).

## Repository layout (see README.md for the full picture)

- `packages/cli/src/render/instrument.ts` — patches `openapi-mcp-generator`'s generated server source to route tool calls through an `ObservabilityPlugin`. This is the trickiest logic in the project now; it's coupled to the exact shape of `openapi-mcp-generator`'s generated code (the `executeApiTool` call site and the `zod` import line) — if either changes upstream, this needs updating, and it will fail loudly (not silently) if it can't find what it expects.
- `packages/cli/src/plugins/` — the `ObservabilityPlugin` interface and individual plugins (currently `otel/`). New plugins implement this interface; see ARCHITECTURE.md section 4 for why it's shaped the way it is.
- `packages/cli/src/commands/` + `src/index.ts` — the actual `mcpforge` CLI, built with `commander`. Calls `openapi-mcp-generator`'s `getToolsFromOpenApi()` (for a tool-count sanity check) and `generateMcpServer()` (to actually write the project), then `instrument.ts` if a plugin was requested.
- `examples/petstore/` — the real Swagger Petstore OpenAPI spec, used as the test fixture throughout.
- `spike/` — a throwaway, hand-written proof of the OpenAPI → MCP → OTel mechanic, built *before* any generator (hand-rolled or `openapi-mcp-generator`), specifically to catch integration risks early. Keep it as historical reference (see `spike/FINDINGS.md`); don't build new features into it. Its core finding (never `ConsoleSpanExporter`, always `OTLPTraceExporter`) still applies and is encoded in `plugins/otel/otel.plugin.ts`.

## Commands

```bash
cd packages/cli
npm install
npm run build            # tsc -p tsconfig.json
npm test                 # builds, then runs real end-to-end tests (npm install/build/run a generated server)

# Manually exercise the CLI:
node dist/src/index.js generate --spec ../../examples/petstore/openapi.json --out /tmp/out --name my-server --base-url https://petstore3.swagger.io/api/v3 [--plugin otel --plugin-config otel.serviceName=my-server]
```

## Known project-specific gotchas

- The compiled entrypoint is `dist/src/index.ts` → `dist/src/index.js` (not `dist/index.js`) because `tsconfig.json`'s `rootDir` is `.` (it needs to include both `src/` and `test/`). Double-check `package.json`'s `bin` field stays in sync if this ever changes.
- `ConsoleSpanExporter` writes to **stdout**, which corrupts the MCP stdio JSON-RPC stream — never use it in generated servers or in this CLI's own OTel plugin. Always `OTLPTraceExporter`; route any OTel diagnostics to stderr. This was a real bug caught in `spike/FINDINGS.md` — don't reintroduce it.
- `openapi-mcp-generator` dispatches every tool call through one shared `executeApiTool()` function — this is why `instrument.ts` only needs a single textual patch, not a codemod per tool. Don't assume this if `openapi-mcp-generator`'s internals ever change to per-tool-function generation; re-verify against its actual output first.
- Test suite no longer has fixture-based unit tests for OpenAPI edge cases (`allOf`/`oneOf`/binary responses/auth/3.1) — those were retired along with the hand-rolled mapper they tested (ARCHITECTURE.md sections 15/17, superseded by section 16). `openapi-mcp-generator` has its own test suite for that; mcpforge's tests (`test/generate.test.ts`) now focus on the instrumentation patch and end-to-end CLI behavior.
