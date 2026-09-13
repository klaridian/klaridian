# Spike 061 — `klaridian deploy`: two targets (Fly.io vs Cloudflare Workers)

**Central question (Given/When/Then):** Given a klaridian-generated
streamable-http MCP server, when `klaridian deploy --target <X>` *emits
artifacts + shells out to the platform's native CLI* (rather than reimplementing
infra), then the platform accepts the artifacts and the server is reachable.

This spike validates the **"emit + shell-out"** pattern — the open-core deploy
story recommended over a hand-rolled deploy engine — against two deliberately
contrasting targets: **Fly.io** (container) and **Cloudflare Workers** (edge).

Barrier: **emit + native-CLI validation, no accounts** (user's choice). Real
runtimes were exercised locally (Docker for Fly, workerd for Workers); live
deploys to paid platforms were out of scope.

## Layout

```
061-deploy-targets/
├── server/            # the shared input: klaridian generate --transport streamable-http
├── 061a-fly/          # Dockerfile + fly.toml   (+ README verdict)
└── 061b-cloudflare/   # worker.ts + wrangler.toml (+ README verdict)
```

`server/` was generated with:
`klaridian generate --spec examples/petstore/openapi.json --transport streamable-http --base-url https://petstore3.swagger.io/api/v3`

## Head-to-head

| Dimension | Fly.io (061a) | Cloudflare Workers (061b) |
|---|---|---|
| Unit | Container (Docker) | Edge Worker (workerd) |
| Emitted artifacts | Dockerfile, fly.toml, .dockerignore | worker.ts, wrangler.toml |
| klaridian change needed | 2 env-driven fixes (PORT, allowed-hosts) | **emitter refactor**: split factory ⇄ transport |
| Real validation run | `docker build` ✅ + `docker run` + probe | `wrangler deploy --dry-run` ✅ + `wrangler dev` + probe |
| Live MCP handshake | HTTP 200 (localhost Host) | HTTP 200 over workerd |
| No-account CI gate | weak (needs Docker or login) | **strong** (`--dry-run`, zero auth) |
| Bundle/runtime size | ~200 MB image | 669 KiB / **133 KiB gzip** |
| Cold start / scale-to-zero | seconds / yes (min_machines=0) | **milliseconds** / yes |
| Language coverage | **universal** (TS + Python) | **TS only** (Python can't run on Workers) |
| Best for | any server, stateful, the Python target | TS servers, cheapest global edge |

## Findings that matter beyond this spike

1. **The pattern works.** Both targets are a handful of small, static, emittable
   files + a shell-out. No infra reimplementation. This confirms the open-core
   recommendation: emit artifacts + shell out to `flyctl`/`wrangler`; keep any
   managed runtime for the paid tier.

2. **Two emitter gaps block *real* production traffic on BOTH targets** (found
   live, HTTP-status-proven, not by reading code):
   - **Port is hardcoded** `.listen(3000)` — ignores `process.env.PORT`.
   - **Host-header validation is localhost-only** — a request routed via the
     public hostname (`*.fly.dev`, `*.workers.dev`) gets **HTTP 403 Invalid
     Host**. The container builds and boots, then refuses all production traffic.
   Both are one-line-ish fixes using APIs the SDK already exposes
   (`validateHostHeader`, `hostHeaderValidationResponse`, `KLARIDIAN_ALLOWED_HOSTS`).

3. **Workers needs a refactor, not a file.** klaridian's SDK path is web-standard
   underneath (`createMcpHandler → { fetch }`; `toNodeHandler` is just the Node
   adapter; the SDK ships a `workerd` shim + `cf-worker` validator). The only
   blocker is that the emitter fuses tool-registration and the `node:http`
   `.listen()` bootstrap into one `index.ts`. Splitting them (a `buildServer()`
   factory + per-transport entry files) unlocks Workers AND is the natural place
   to fix the PORT/Host gaps. This refactor is the real prerequisite.

## Overall verdict: VALIDATED — build it, in this order

The "emit + shell-out" deploy story is proven for both a container target and an
edge target. Recommended sequencing for the real feature:

1. **Emitter refactor first**: split `buildServer()` factory from transport
   bootstrap; make PORT and allowed-hosts env-driven. (Fixes prod traffic on
   every target; prerequisite for Workers.)
2. **Ship `--target fly` first** — universal (covers the Python target too),
   smallest conceptual leap (container).
3. **Then `--target cloudflare`** for TS servers — best free-tier + edge story,
   and its `--dry-run` gives a zero-account CI gate the others lack.
4. Keep a **managed klaridian runtime** for the paid tier (not in this spike).

Throwaway: `server/node_modules`, `server/dist`, worker `node_modules`, and
`dist-worker/` are git-ignored. Docker image + containers were torn down.
