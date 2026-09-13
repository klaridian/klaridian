# 061a — Fly.io deploy target

**Question (Given/When/Then):** Given a klaridian-generated streamable-http MCP
server, when `klaridian deploy --target fly` emits a Dockerfile + fly.toml and
shells out to `flyctl`, then Fly accepts the artifacts and the container serves MCP.

## Approach

- **emit + shell-out** (the pattern under test): klaridian writes `Dockerfile`,
  `fly.toml`, `.dockerignore`, then would run `flyctl deploy`. It does NOT
  reimplement Fly's API.
- Validation barrier for this spike: **no accounts**. `flyctl deploy` /
  `fly config validate` need auth, so instead we proved the artifact for real by
  `docker build` + `docker run` + probing `/mcp` (a Fly Machine is exactly this
  container), plus offline structural validation of `fly.toml`.

## What was actually run

1. `docker build -f 061a-fly/Dockerfile -t klaridian-deploy-demo:spike server/`
   → **BUILD_EXIT=0**, image built (multi-stage node:22-slim, esbuild bundle
   copied into runtime stage).
2. `docker run -e PORT=8080 -e KLARIDIAN_BIND_HOST=0.0.0.0 ...`
   → logs: `MCP server (streamable-http) on http://0.0.0.0:3000/mcp`
   → **binds 3000, NOT the injected PORT=8080** (finding #1, live).
3. Re-run with `-p 8080:3000`, POST `initialize` to `/mcp`:
   - Host `127.0.0.1:8080` → **HTTP 200** (works locally).
   - Host `klaridian-deploy-demo.fly.dev` → **HTTP 403 `Invalid Host`**
     (finding #2, live — public routing rejected).
4. `fly.toml` parsed with `tomllib` → all required sections present
   (`app`, `build.dockerfile`, `http_service.internal_port`, `vm`).

## Verdict: VALIDATED (with two required emitter changes)

### What worked
- The emit + shell-out pattern is sound: a container is Fly's native unit, and
  the generated ESM/esbuild bundle builds and boots in a slim node image with
  zero hand-holding.
- `KLARIDIAN_BIND_HOST=0.0.0.0` already exists and correctly widens the bind
  interface — the emitter anticipated containerization halfway.
- `fly.toml` is a small, static, fully-emittable file. `auto_stop_machines` +
  `min_machines_running=0` gives scale-to-zero, so an idle demo server costs ~€0.

### What didn't (both are klaridian emitter gaps, NOT Fly problems)
- **Port is hardcoded `.listen(3000)`** — ignores `process.env.PORT`. Fly's
  `internal_port` can be pinned to 3000 so this happens to work, but it's fragile
  and breaks any platform that injects `PORT` (Render, Railway, Cloud Run).
- **Host-header allow-list is localhost-only** (`localhostHostValidation()`), so
  every request routed via the public `*.fly.dev` hostname is 403'd. This is the
  real blocker: the container builds and boots but refuses all production traffic.

### Recommendation for the real build
- Emitter: read `process.env.PORT ?? KLARIDIAN_PORT ?? 3000`, and make the
  allowed-host set configurable via `KLARIDIAN_ALLOWED_HOSTS` (the SDK already
  exposes `validateHostHeader` + `hostHeaderValidationResponse` for exactly this
  — no localhost hard-wall needed).
- `klaridian deploy --target fly` = emit these 3 files + `flyctl deploy` shell-out.
  Set `KLARIDIAN_ALLOWED_HOSTS=<app>.fly.dev` and `KLARIDIAN_BIND_HOST=0.0.0.0`
  in `[env]` at emit time.
- Barrier to entry: user needs Docker OR Fly's remote builder + a flyctl login.
  Container = any-language-friendly (works identically for the Python target).
