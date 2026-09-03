# Spike: OpenAPI -> MCP Server -> OTel Spans (end-to-end mechanic)

**Goal (ARCHITECTURE.md section 9, step 1):** manually generate one MCP server
from the Petstore OpenAPI spec, wire OTel by hand, confirm the mechanics
actually work end to end — before building any generator abstraction.

**Date:** August 30, 2026
**Status:** ✅ Mechanic validated. Two real findings changed the architecture.

## What's here

- `examples/petstore/openapi.json` — real Swagger Petstore v3 OpenAPI spec (fetched from petstore3.swagger.io), used as the test fixture.
- `spike/server.js` — hand-written MCP server exposing 2 tools (`getPetById`, `findPetsByStatus`) mapped manually from 2 OpenAPI operations, calling the real public Petstore API.
- `spike/instrumentation.js` — hand-written OTel wiring: a `wrapTool()` helper that wraps any tool handler in a span (tool name, arguments, status, exceptions).

## How it was tested

Since MCP's stdio transport speaks JSON-RPC over stdin/stdout, the spike was driven by spawning `node server.js` as a child process and writing JSON-RPC messages to its stdin, capturing stdout/stderr separately. This is exactly the shape a real MCP client (Claude Desktop, an agent) would drive it.

Commands sent: `initialize`, `tools/list`, `tools/call` (both tools).

## Results

✅ `initialize` and `tools/list` returned correct, valid JSON-RPC responses.
✅ `tools/call getPetById(petId: 10)` returned real data from the live Petstore API (pet "Rufus").
✅ `tools/call findPetsByStatus` correctly propagated a real upstream API error (500 from the public sandbox, which was flaky on test day — not a bug in our code) as a proper JSON-RPC error response, not a crash.
✅ **stdout stayed valid JSON-RPC only, line by line, in every scenario tested** — including with OTLP export failing silently in the background (no local collector was running). This is the property the whole approach depends on.

## Two real findings that changed the architecture

### Finding 1 (critical): `ConsoleSpanExporter` writes to stdout, not stderr

Initial spike used `ConsoleSpanExporter` (no collector needed, simplest to try first). Verified directly: it prints the full span object via `console.dir`, which goes to **stdout**. For any stdio-transport MCP server, stdout must carry *only* JSON-RPC messages — anything else corrupts the protocol from the client's point of view.

**Consequence for the real plugin:** the OTel plugin's generated instrumentation code must default to `OTLPTraceExporter` (exports over HTTP to a collector, never touches stdout) for any stdio-transport server. If a future "debug output" mode is offered, it must be hard-wired to stderr, never console.log/console.dir. This is now documented directly in `spike/instrumentation.js` as a comment, and should become an explicit rule in `runtime-otel`'s implementation and in its tests (a test asserting stdout stays clean under span export is cheap and high-value).

### Finding 2: span flushing needs explicit handling, not just "start the SDK and go"

The very first spike run produced zero visible spans because the default `BatchSpanProcessor` batches and flushes periodically / on shutdown, and the test process was killed before either happened. Fixed by explicitly calling `sdk.shutdown()` on `SIGINT`/`SIGTERM` in `instrumentation.js`.

**Consequence for the real plugin:** the generated server's instrumentation module needs proper signal handling wired in by default (not left as an exercise for whoever uses the generated server) — this is exactly the kind of easy-to-miss detail that justifies klaridian existing in the first place. Should be covered by an integration test in the real project: start the SDK, emit a span, send SIGTERM, assert the span was exported before process exit.

## What this validates for ARCHITECTURE.md

- The `wrapTool()` pattern (section 5) works as designed — one wrapper, no per-tool custom instrumentation code needed.
- OpenAPI operation -> MCP tool mapping (section 7) is straightforward for well-formed operations (clear `operationId`, simple parameter shapes) — `getPetById` and `findPetsByStatus` both mapped cleanly by hand in a few minutes each.
- stdio transport (open question in section 10) is confirmed workable and is the right default for v0 — no obstacles found.
- No changes needed to the plugin interface design (section 4) — the hand-written `wrapTool()` here is what `runtime-otel`'s real implementation should formalize.

## Not yet tested (left for the next phase)

- No local OTel Collector was running during this spike (Docker wasn't available in this session), so actual span *receipt* on a collector wasn't observed — only that export attempts don't corrupt stdout and don't crash the process. Confirming real OTLP delivery end-to-end (e.g. against a local `otel-collector` + Jaeger UI, or a free Grafana Cloud tier) is a good next validation step before considering the OTel plugin "done," but doesn't block starting the generator build.
- Petstore's public sandbox was flaky on test day (intermittent 500s) — worth re-running the same calls once more, and/or adding a mock server for reliable CI later, rather than depending on a third-party public sandbox for tests long-term.
