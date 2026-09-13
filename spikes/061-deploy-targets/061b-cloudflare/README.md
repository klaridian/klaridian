# 061b — Cloudflare Workers deploy target

**Question (Given/When/Then):** Given a klaridian-generated MCP server, when
`klaridian deploy --target cloudflare` emits a Worker entry + wrangler.toml and
shells out to `wrangler`, then Cloudflare's workerd runtime accepts it and serves MCP.

## Approach

- **emit + shell-out**: klaridian writes `worker.ts` + `wrangler.toml`, then would
  run `wrangler deploy`. Validation barrier (no accounts): `wrangler deploy` needs
  a Cloudflare login, so we used `wrangler deploy --dry-run` (runs the REAL
  workerd bundler, no auth) + `wrangler dev --local` (real workerd runtime) and
  probed `/mcp`.

## Key architectural finding (this flipped my prior assumption)

I expected Workers to be incompatible because the generated server uses
`node:http createServer().listen()`. **It's compatible** — because klaridian's
SDK path is web-standard underneath:

- `createMcpHandler(factory)` returns `{ fetch(request: Request): Promise<Response> }`.
- `@modelcontextprotocol/node`'s `toNodeHandler` is just a Node *adapter* over
  that fetch handler.
- The SDK package ships a **`workerd` export condition** (`_shims`) and a
  dedicated **`./validators/cf-worker`** entry.

So a Worker needs NOTHING from `@modelcontextprotocol/node`; it just does
`export default { fetch }` reusing the same tool-registration factory. The ONLY
reason klaridian can't target Workers today is that its emitter bakes the
`node:http` bootstrap into `src/index.ts` as a **top-level `.listen()` side
effect**, so that file can't be imported by a Worker entry.

## What was actually run

1. `npx wrangler deploy --dry-run --outdir dist-worker`
   → **DRYRUN_EXIT=0**, real workerd bundler compiled worker + full MCP SDK + zod:
   **Total Upload 669 KiB / gzip 133 KiB**, both env bindings resolved.
2. `npx wrangler dev --local` (real workerd), then:
   - `GET /mcp` → **405 Method Not Allowed** (correct: MCP requires POST).
   - `POST /mcp initialize` → **HTTP 200**, valid SSE handshake:
     `protocolVersion 2025-11-25`, `capabilities.tools`, `serverInfo` = the
     generated server. End-to-end MCP works on the edge.

## Verdict: VALIDATED (needs an emitter refactor, not just a new file)

### What worked
- SDK bundles and runs on workerd unmodified; 133 KiB gzip is far under the
  3 MiB free-tier limit. Sub-second cold starts, scale-to-zero, global edge — the
  best free-tier story of any target.
- `wrangler.toml` is tiny and fully emittable (`nodejs_compat`, `[vars]`).
- `--dry-run` + `dev --local` give a genuine no-account CI gate — better than Fly,
  where meaningful validation needs Docker or a login.

### What didn't / caveats
- **Requires an emitter refactor, not an additive file.** klaridian must split
  tool-registration (a `buildServer()` factory) from transport bootstrap, then
  emit BOTH a node entry (calls `toNodeHandler` + `.listen`) and a worker entry
  (`export default { fetch }`). Today the two concerns are fused in `index.ts`.
- **Same Host-header gap as Fly** — the worker must set
  `KLARIDIAN_ALLOWED_HOSTS=<name>.workers.dev`. (Not exercised by dry-run; the
  refactored factory must thread allowed-hosts through `createMcpHandler`.)
- **Language-specific.** This target only exists for the TypeScript output. The
  Python target can't go to Workers — it needs a container (Fly). So Workers is a
  TS-only target, Fly is the universal one.
- Statefulness: the modern SDK transport is per-request, so stateless Workers are
  fine; long-lived SSE sessions would need Durable Objects (out of scope here).

### Recommendation for the real build
- Do the factory/transport split first (it's the prerequisite for BOTH a clean
  worker entry AND fixing the node entry's PORT/Host issues).
- `klaridian deploy --target cloudflare` = emit `worker.ts` + `wrangler.toml`
  (with `nodejs_compat`) + `wrangler deploy` shell-out. Gate emit correctness in
  CI with `wrangler deploy --dry-run` — no account required.
