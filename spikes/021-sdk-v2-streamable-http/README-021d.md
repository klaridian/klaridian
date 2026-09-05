# Spike 021d—real upstream fetch on a v2-emitted handler (Task 0.1 gate)

**Question:** Does a v2-emitted `registerTool` handler actually proxy to a real upstream HTTP API—correctly mapping `executionParameters` (path/query/header), `requestBody`, and auth—or was spike 021b's stub hiding real complexity?

## Verdict: VALIDATED—the Phase-1 gate is open

`gen021d.mjs` emits real `fetch`-based handlers from `getToolsFromOpenApi()` data (no stub). Driven against a mock upstream (`mock-upstream.mjs`, port 3900) that echoes the received request shape. Four tools, one per parameter style, all correct—confirmed on BOTH the client result and the upstream server log:

| Tool | Param style | Upstream received |
|------|-------------|-------------------|
| `getPetById` | path + auth | `GET /pet/42`, `Authorization: Bearer secret-tok-123` |
| `findPetsByStatus` | query | `GET /pet/findByStatus?status=pending` |
| `addPet` | JSON body | `POST /pet`, `Content-Type: application/json`, body `{"name":"Rex","photoUrls":["x"]}` |
| `deletePet` | path + header | `DELETE /pet/7`, header `api_key: hdr-key-xyz` |

## The mapping that works (lock this into emit-tool.ts, Task 1.3)

`executionParameters` is `[{name, in}]` where `in ∈ {path, query, header}`. Emit:
- **path**: `path = path.replace("{name}", encodeURIComponent(String(args[name])))`
- **query**: `if (args[name] !== undefined) url.searchParams.set(name, String(args[name]))`
- **header**: `if (args[name] !== undefined) headers[name] = String(args[name])`
- **body**: present iff `requestBodyContentType` is set; value is `args.requestBody`; sets `Content-Type`
- **auth**: iff `securityRequirements` non-empty, add `Authorization: Bearer ${KLARIDIAN_AUTH_TOKEN}` (mirrors the current stdio path's env-var convention: `KLARIDIAN_BASE_URL` + `KLARIDIAN_AUTH_TOKEN`)
- **result**: `{ content: [{type:"text", text}], isError: !resp.ok }`—upstream non-2xx surfaces as a tool error, not a crash.

## Caveats / not-covered (carry into the real build, don't silently assume)
- Only Bearer + one header-key style exercised. Multiple/alternative security schemes (OAuth scopes vs `api_key` as an actual credential vs both offered) were present in the data (`securityRequirements: [{api_key:[]}, {petstore_auth:[...]}]`) but the emitter just attaches a Bearer token—real per-scheme credential mapping (e.g. `api_key` in header vs query) is still a TODO for MCPFO-22 (inbound) and for a richer outbound-auth story. For v1-parity this Bearer+env approach matches what the current stdio path already does—acceptable for MCPFO-21 scope, flag for later.
- `cookie` params not present in petstore; not exercised. Add handling + a fixture when a real spec needs it (YAGNI now, but note in emit-tool.ts).
- Body assumed JSON. `multipart/form-data` / non-JSON bodies remain the documented limitation they already are (ARCHITECTURE.md §14 lineage).

## Conclusion
Task 0.1 PASSES. The real upstream fetch is mechanical from `getToolsFromOpenApi()` data, exactly as the plan predicted—no hidden blocker. **Phase 1 (build the real emitter in `packages/cli/src/emit/`) is cleared to start.** Reuse this exact mapping in `emit-tool.ts`.

## Throwaway
`generated-real.mjs`, `mock-upstream.mjs`, `gen021d.mjs`, `node_modules/` all disposable.
