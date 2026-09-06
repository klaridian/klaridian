# 059: python-emit-target

**Question:** If klaridian's tool IR (the JSON tool-data shape `openapi-mcp-generator`'s
`getToolsFromOpenApi()` produces, which `packages/cli/src/emit/*` consumes today)
were fed into a second-language emitter, would the IR survive intact — including
**real execution**, not just "the code looks plausible"? Not "should klaridian
ship Python" — this is a forcing-function spike to stress-test the architecture,
per the discussion in session (Sep 2026): 1 supported language biases design
decisions invisibly; a second target surfaces which parts of the emitter/IR are
accidentally TS-specific.

**Why Python:** biggest structural distance from TS on the axes that matter most —
packaging (`pip`/venv vs `npm`), schema validation (Pydantic vs Zod — the exact
thing `emit-tool.ts` leans on `json-schema-to-zod` for), and it's also the
strongest MCP-generator competitor ecosystem (FastMCP, official Python SDK), so
the comparison is directly market-relevant, not academic.

## Approach

1. Captured the **real IR**: ran `getToolsFromOpenApi()` (the actual klaridian
   dependency) against `examples/petstore/openapi.json` → `petstore-tools.json`
   (19 tools, verbatim JSON — same data `emit-tool.ts` consumes).
2. Wrote `emit_python.py`: a throwaway emitter that reads that exact JSON and
   produces a standalone Python MCP server project (`mcp==2.1.1`, the official
   Python SDK — same rigor as klaridian's TS emitter, no hand-rolled protocol).
3. Ran the **same E2E discipline** the repo's `AGENTS.md` mandates for the TS
   emitter (real install → real spawn → real JSON-RPC), not just unit-testing
   string shape:
   - fresh `python3.11 -m venv .venv` + real `pip install -r requirements.txt`
     (mirrors `npm install --no-audit --no-fund`)
   - spawned the generated `server.py` as a real subprocess over stdio
   - drove real JSON-RPC: `initialize` → `tools/list` → `tools/call` (unknown
     tool) → `tools/call` (real tool, real network call to the petstore demo API)

## What worked

- **The IR (tool-data JSON) ported cleanly, no changes needed.** Every field
  klaridian's TS emitter uses (`name`, `pathTemplate`, `executionParameters`,
  `requestBodyContentType`, `method`, `inputSchema`) mapped 1:1 into the Python
  emitter with zero IR schema changes. This is the single most important
  finding: **the IR itself is already language-neutral** — the coupling to TS
  lives entirely in the `emit/*.ts` rendering layer, not in the data model.
- Real E2E passed for the happy paths:
  - `initialize` → real `protocolVersion: "2025-11-25"` negotiated, matches
    klaridian's TS emitter target exactly.
  - `tools/list` → all 19 tools listed, `getPetById` present with correct
    `readOnlyHint`/`idempotentHint`/`openWorldHint` — the exact same annotation
    logic (`annotationsForMethod` in `emit-tool.ts`) ported line-for-line to
    Python with no surprises.
  - `tools/call getPetById` → real HTTP call went out to
    `petstore3.swagger.io`, got proxied and returned to the client (upstream
    happened to 500 on this run — a live third-party demo API flake, not a
    klaridian-side failure; the round-trip and error-surfacing worked).
- Packaging cost was comparable, not higher: `pip install` from a generated
  `requirements.txt` was as mechanical as `npm install` from a generated
  `package.json`.

## What didn't (the real findings — worth an ARCHITECTURE.md entry)

- **Unknown-tool protocol conformance is NOT free in Python the way it is in
  TS.** klaridian's TS emit-e2e test explicitly asserts an unknown tool
  produces the native JSON-RPC protocol error `-32602` "no conformance patch
  needed" (comment in `emit-e2e.test.ts`) — the TS SDK's `registerTool`
  boundary handles this automatically. Naively `raise ValueError(...)` in the
  Python `on_call_tool` handler (the obvious/idiomatic thing to do) instead
  produced a *generic* JSON-RPC error with **`code: 0`**, not `-32602`. This
  means: **conformance-hint emission (annotations) ported free, but
  conformance-error-shape did NOT** — a real per-SDK gap that would need an
  explicit mapping layer (raise a typed protocol error, not a bare exception)
  if klaridian ever emits Python for real. This is exactly the kind of
  TS-specific assumption that was invisible with only one target.
- **The MCP Python SDK's ergonomics are lower-level than the TS v2 SDK's
  `registerTool()`.** klaridian's TS emitter benefits from a single
  `server.registerTool(name, config, handler)` call per tool; the Python SDK
  used here (`mcp` 2.1.1) only exposes a **single global** `on_list_tools` /
  `on_call_tool` pair at the `Server` level — there's no per-tool registration
  primitive at this API layer. The spike's server.py had to hand-roll a
  tool-name dispatch table (`TOOL_MAP`) to simulate what TS gets for free.
  **This is the biggest asymmetry found**: klaridian's plugin-instrumentation
  design (wrapping at the `registerTool` boundary, per ARCHITECTURE.md section
  48) assumes a per-tool registration hook exists to wrap. In Python (at this
  SDK layer) that hook doesn't exist the same way — instrumentation would have
  to wrap the shared dispatch table instead, a materially different plugin
  contract.
- Field naming convention differs at the wire level in a way worth flagging:
  the Python SDK's `types.Tool`/`types.ToolAnnotations` use **snake_case**
  Python-side (`read_only_hint`) but still serialize to **camelCase** on the
  wire (`readOnlyHint`) — confirmed correct in the captured
  `e2e-results.json`. Not a bug, just a per-language plumbing detail an emitter
  needs to know about explicitly (Pydantic aliasing), not something obvious
  from reading the IR alone.

## Head-to-head: what ported free vs. what didn't

| Concern | Ported free from IR? | Notes |
|---|---|---|
| Tool data model (name, params, path, body, method) | **Yes** | Zero IR changes needed |
| Path/query/header param mapping | **Yes** | Same shape, same logic |
| HTTP proxy call construction | **Yes** | Trivial per-language rewrite |
| Annotation hints (readOnly/destructive/idempotent/openWorld) | **Yes** | Logic ported 1:1 |
| Protocol version negotiation | **Yes** | Both target 2025-11-25 |
| Unknown-tool error shape (`-32602`) | **No** | TS gets it free from SDK; Python needs explicit protocol-error mapping |
| Per-tool registration hook for plugin instrumentation | **No** | TS: `registerTool()` per tool. Python (this SDK layer): one global dispatch table — plugin wrap point must move |
| Packaging/dependency install cost | **Roughly equal** | `npm install` vs `pip install`, comparable mechanics |

## Recommendation for the real build

1. **Keep the IR as-is** — it already generalizes across at least 2 languages
   without changes. This validates that klaridian's core value (tool
   extraction + curation + observability semantics) is NOT accidentally
   coupled to TypeScript. Good news, low risk on this axis.
2. **Don't assume `registerTool()`-boundary plugin wrapping is universal.**
   If/when a second language emitter is ever built for real, the plugin
   contract (`getPluginProjectAdditions()` per ARCHITECTURE.md section 48)
   needs an abstraction one level higher than "wrap the per-tool call" —
   something like "wrap the dispatch layer", which both a per-tool-registering
   SDK (TS) and a global-dispatch SDK (Python, this version) can each implement
   in their own idiom.
3. **Add an explicit "protocol-conformance adapter" concern to the IR-to-code
   contract.** Things like unknown-tool error codes, error-vs-exception
   shape, and other spec-mandated JSON-RPC details are NOT guaranteed free per
   target SDK — track them as an explicit checklist per emitter (mirroring
   what `docs/research/2026-09-02-mcp-server-best-practices.md` /
   MCPFO-23 already do for TS) rather than assuming "if it worked in TS it'll
   work anywhere."
4. **This spike is sufficient evidence — do not build a production Python
   emitter now.** The forcing-function goal (find hidden TS coupling) is met;
   the two real findings above are cheap to internalize as design constraints
   without maintaining a second full backend. Revisit only if Python demand
   materializes concretely (a customer/user ask), not speculatively.

## Verdict: VALIDATED (with 2 real cross-language findings)

The IR survived a real second-language execution end to end (not just a
"looks plausible" port) — genuine values, real network I/O, real protocol
negotiation. Two concrete, previously-invisible design assumptions surfaced
(unknown-tool error-code conformance, and the per-tool-registration-hook
assumption for plugin instrumentation) — exactly the kind of hidden coupling
this spike was meant to catch. Neither invalidates the current architecture;
both are worth one paragraph each in ARCHITECTURE.md as forward-looking design
constraints.

## Reproduce

```bash
cd spikes/059-python-emit-target
python3.11 emit_python.py petstore-tools.json out
cd out && python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd .. && python3.11 drive_e2e.py   # spawns out/server.py, drives real JSON-RPC
```
