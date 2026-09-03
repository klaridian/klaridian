# Spike 021b — generate a v2 server from getToolsFromOpenApi() DATA (option d)

**Question (Given/When/Then):** Given `openapi-mcp-generator`'s `getToolsFromOpenApi()` output (pure tool data, SDK-version-agnostic), when klaridian emits a v2 `@modelcontextprotocol/server` stateless server directly from that data (instead of consuming the frozen v1 `generateMcpServer()` code output), then a real, buildable, HTTP-drivable server results — validating ARCHITECTURE.md §37 option (d) as the MCPFO-21 path.

## The seam, verified

`getToolsFromOpenApi(petstore)` returns an **array of pure data** per operation:
`{ name, description, inputSchema (JSON Schema), method, pathTemplate, parameters, executionParameters, requestBodyContentType, securityRequirements, operationId, tags, deprecated, baseUrl }`.
No SDK types, no generated code — just the OpenAPI→tool mapping as data. This function is what klaridian already calls today for its tool-count pre-check, so the dependency is already in place and is **not** coupled to the v1 code generator.

## Sub-problem found and solved: schema format

- v2's `registerTool` **rejects a raw JSON Schema object** — it requires a Standard Schema / Zod v4 shape (error: "inputSchema must be a Standard Schema (e.g. z.object({...})) or a raw Zod shape").
- `getToolsFromOpenApi` gives JSON Schema. Bridge: `json-schema-to-zod` (already a peerDep of `openapi-mcp-generator`) converts JSON Schema → a **Zod source-code string** (e.g. `z.object({ "q": z.string() })`). Because it emits *source text*, it fits a generator perfectly: embed the string in the generated file, no runtime conversion in the produced server.

## What was built and run

`gen021b.mjs` (throwaway generator): reads the real petstore spec via `getToolsFromOpenApi`, emits `generated-server.mjs` — a v2 stateless server with one `registerTool(...)` per operation, each carrying: the real Zod schema converted from the operation's JSON Schema, an HTTP-method-derived annotation (`GET→readOnlyHint:true`, `DELETE→destructiveHint:true`), and a stubbed upstream call (the HTTP-proxy half already works in the current stdio path; this spike is about the MCP/transport/schema layer).

Result: **19 tools generated, valid JS syntax, built and driven over real HTTP:**

| # | Request | Result |
|---|---------|--------|
| 1 | `initialize` | 200, `serverInfo: petstore-v2`, no session id (stateless) |
| 2 | `tools/list` | 19 tools; every tool has `inputSchema` + correct `annotations` |
| 3 | `tools/call getPetById` (sequential) | ✅ works — **the v1 crash point**, no crash |
| 4 | `tools/call findPetsByStatus` invalid enum | ✅ native `isError:true` with a precise Zod message |
| 5 | `tools/call noSuchTool` | ✅ JSON-RPC protocol error `-32602 Tool not found` |

Annotations spot-check on `tools/list`: `getPetById` → `{readOnlyHint:true, destructiveHint:false}`, `deletePet` → `{readOnlyHint:false, destructiveHint:true}`, `addPet` → `{readOnlyHint:false, destructiveHint:false}`. Server alive through all 5 sequential requests.

## Verdict: VALIDATED

Option (d) works: klaridian can generate a v2, stateless, HTTP-drivable MCP server directly from `getToolsFromOpenApi()` data, escaping the frozen v1 code generator entirely. Three of klaridian's existing hand-maintained patches become **free/native on this path**:
- **`render/conformance.ts`** — v2 gives `isError:true` on validation failure (req 4) and `-32602` on unknown tool (req 5) **natively**. Both bugs conformance.ts was created to fix are already correct upstream. conformance.ts likely becomes unnecessary on v2.
- **`render/instrument.ts`** — there is no `executeApiTool` textual call site to patch on this path; instrumentation becomes a clean wrap around each `registerTool` handler at generation time (we control the emission), not a fragile string patch against someone else's output.
- **MCPFO-23 (marketplace annotations)** — trivially satisfied because *we* emit the annotations from the HTTP method, rather than hoping the upstream generator does.

### Surprises / caveats (honest scope)
- Still did **not** verify full `2026-07-28` conformance — the v2 package's `LATEST_PROTOCOL_VERSION` constant is still `2025-11-25` (see spike 021), and this spike negotiated `2025-11-25`. The stateless architecture and all the tested behaviors are there, but `server/discover`, `ttlMs`/`cacheScope`, and `Mcp-Method`/`Mcp-Name` header validation were not asserted. Whether they're emitted by the SDK automatically or need explicit opt-in via the "era" mechanism is the remaining open question. **Do not claim "2026-07-28 conformant" yet.**
- The upstream **HTTP proxy call was stubbed**. Re-mapping `executionParameters`/`requestBodyContentType`/`securityRequirements` (all present in the data) into a real `fetch` is real work — but it's the same mapping the current stdio path already does, just re-emitted for v2, not a new unknown.
- `getToolsFromOpenApi` printed `Unresolved $ref` warnings to stderr on the petstore spec (didn't block — all 19 tools mapped). Worth a look, but it's a pre-existing upstream logging quirk (see MCPFO-11), not introduced here.
- This throwaway generator emitted `.mjs` by hand; the real work is emitting a proper TypeScript project (tsconfig, package.json with `@modelcontextprotocol/server`+`/node`+zod v4, build) — mechanical, not risky.

### Recommendation for the real build
1. **MCPFO-21 path is option (d), confirmed**: build klaridian's own v2 emitter over `getToolsFromOpenApi()` data + `json-schema-to-zod`. Stop consuming `generateMcpServer()`'s v1 code output. This is a real rewrite of the generation core, but it's the coherent one and it *shrinks* the fragile surface (kills the textual patches).
2. **MCPFO-10 collapses into MCPFO-21**: the streamable-http crash is a v1-only artifact; the v2 path never has it. Reframe MCPFO-10 as "done-by-migration", keep only the optional upstream fetch-to-node PR as good-citizen work.
3. **Next spike (021c) if continuing**: reach the `2026-07-28` era explicitly and assert `server/discover` + list-result `ttlMs`/`cacheScope`, to close the conformance gap this spike deliberately left open.
4. Re-emit the real upstream `fetch` (not stubbed) for one write tool + one auth-required tool, to prove the proxy half survives the v2 move.

## Throwaway
`node_modules/`, `generated-server.mjs`, `server.mjs` are all disposable. The value is this README + the confirmed seam (`getToolsFromOpenApi` data → `json-schema-to-zod` source → v2 `registerTool`).
