# Spike 021 — SDK v2 stateless Streamable HTTP (MCPFO-21 feasibility)

**Question (Given/When/Then):** Given the official `@modelcontextprotocol/server` v2 SDK, when a stateless `createMcpHandler` server is driven with **sequential** HTTP requests, then it survives past the 2nd request — the exact case where `openapi-mcp-generator`'s v1 session-based `streamable-http.ts` crashes with `ReadableStream is locked` (the MCPFO-10 bug).

**Why it matters:** MCPFO-21 (migrate to spec 2026-07-28 + SDK v2) and MCPFO-10 (fix streamable-http crash) are entangled. If v2 makes the crash structurally impossible AND is the only path to the current spec, then MCPFO-10 should not be "patch the v1 file" — it should be "emit our own v2 transport". This spike tests whether v2 actually delivers that.

## What was verified by direct inspection (no build needed)

- `openapi-mcp-generator@4.0.1` is pinned to SDK **v1** (`package.json` peerDep `@modelcontextprotocol/sdk@^1.10.2`; generated output depends on `^1.10.0`). Last publish **2026-06-14**, no v2, dist-tags `latest: 4.0.1` only. It is effectively frozen.
- `@modelcontextprotocol/sdk` (v1) `latest` is **1.30.0**, `LATEST_PROTOCOL_VERSION = '2025-11-25'` — it does **not** know the `2026-07-28` revision at all.
- v2 is a **different package set**: `@modelcontextprotocol/server` 2.0.0 + `@modelcontextprotocol/core` 2.0.0 (+ optional `@modelcontextprotocol/node`, `/express`, `/fastify`, `/hono` adapters). Uses **zod v4** (v1 uses zod v3). README: "v2 is the stable release line, implementing the 2026-07-28 spec."
- The v1 `streamable-http.ts` crash root cause (read directly): it calls `await c.req.json()` (consuming the Hono body ReadableStream) and then `toReqRes(c.req.raw)` (via `fetch-to-node`) which re-reads the same locked stream → `ReadableStream is locked`. It's a session-based transport (`transports[sessionId]`, `mcp-session-id` header) — a model the 2026-07-28 spec **removed**.

## What was built and run (the part that needed proof)

`server.mjs`: a stateless v2 server — `createMcpHandler(factory)` + `toNodeHandler` + `localhostHost/OriginValidation`, one `echo` tool. Driven with real sequential `curl` POSTs to `http://127.0.0.1:3222/mcp`.

| # | Request | Result |
|---|---------|--------|
| 1 | `initialize` | 200, `text/event-stream`, **no `mcp-session-id` header** (stateless confirmed) |
| 2 | `tools/list` (no session id) | returns `echo` — works with zero session state |
| 3 | `tools/call echo` | ✅ `echo: hello from req 3` — **the request that crashes v1** |
| 4 | `tools/call echo` again | ✅ still works, process alive |
| 5 | `tools/call` with `message:123` (schema violation) | ✅ native `isError:true` + validation message, no crash |

Server process stayed alive through all 5 sequential requests.

## Verdict: VALIDATED

The v2 SDK makes the MCPFO-10 crash **structurally impossible**: there is no per-session transport, no `fetch-to-node` double-read, no `mcp-session-id`. `createMcpHandler`'s factory builds a fresh `McpServer` per request and holds nothing between requests, so "any request can land on any instance" (the spec's stateless design goal) is the default, not something to engineer.

### Surprises
- **`@modelcontextprotocol/server` 2.0.0 reports `LATEST_PROTOCOL_VERSION = '2025-11-25'`, not `2026-07-28`**, despite the README claiming 2026-07-28 support. v2 uses an "era" concept (`DEFAULT_NEGOTIATED_PROTOCOL_VERSION = '2025-03-26'`) and negotiates per request; `2026-07-28` is presumably a selectable era, not the hardcoded latest constant. **This needs its own follow-up check** before claiming full 2026-07-28 conformance — the spike proved statelessness + sequential-request survival, NOT that every 2026-07-28 MUST (server/discover, ttlMs/cacheScope, Mcp-Method/Mcp-Name header validation) is emitted. Do not overclaim.
- v2 returns schema-violation as `isError:true` **natively** — this is exactly what mcpforge's `render/conformance.ts` currently force-patches into v1 output. On v2, half of `conformance.ts` may become unnecessary (needs verification against the unknown-tool → protocol-error case too).
- Official framework adapters exist (`@modelcontextprotocol/hono` etc.) — the v1 generated code hand-rolls Hono+fetch-to-node wiring that these adapters now own and arm host/origin validation by default.

### What this does NOT prove (honest scope limits)
- Nothing about the **OpenAPI→tools mapping** on v2. `openapi-mcp-generator` is v1-only and frozen; this spike used a hand-written tool, not generated output. The real MCPFO-21 question — "how does mcpforge get from an OpenAPI spec to a v2 server" — is untouched here. Options still open: (a) wait for/contribute v2 support upstream, (b) fork it, (c) find another generator, (d) generate the v2 tool layer ourselves from `openapi-mcp-generator`'s `getToolsFromOpenApi()` output (which is just data, SDK-version-agnostic) and drop its code-generation entirely.
- Whether `instrument.ts`'s single-call-site patch model survives v2's `registerTool` shape (v2 has no `executeApiTool` — the whole patch target may not exist).
- Full 2026-07-28 conformance (see surprise #1).

### Recommendation for the real build
1. **Reframe MCPFO-10**: not "patch the v1 streamable-http.ts crash" but "emit a v2 stateless transport" — the crash disappears for free on v2. Keep the upstream `fetch-to-node` fix as an optional good-citizen PR for people staying on v1, not mcpforge's path.
2. **The pivotal MCPFO-21 decision is option (d)**: mcpforge already calls `getToolsFromOpenApi()` (pure data: name/description/inputSchema/tags per operation) for its tool-count check. That function's output is SDK-agnostic. If mcpforge generates the v2 `McpServer` + `registerTool(...)` calls itself from that data — instead of consuming `generateMcpServer()`'s v1 code output — it (a) escapes the frozen v1 generator, (b) lands on the current spec, (c) makes `instrument.ts` a clean wrap at `registerTool` boundaries instead of a fragile textual patch, (d) inherits official host/origin validation and native `isError`. This is a bigger change than a version bump but it's the coherent one, and it aligns exactly with ARCHITECTURE.md §37 Decision 1 ("tool surface generated by us, protocol from the official SDK"). Spike this next (021b): generate a v2 server from `getToolsFromOpenApi(petstore)` output and drive it end to end.
3. Re-verify the `2026-07-28` era is actually reachable/emitted before claiming spec-current (surprise #1).

## Throwaway
Delete `node_modules/` after reading. This is a spike; the real work is a new generation path in `packages/cli`, not this directory.
