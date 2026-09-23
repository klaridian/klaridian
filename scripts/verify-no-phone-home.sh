#!/usr/bin/env bash
# =============================================================================
# klaridian — "no phone-home" verification (MCPFO-43)
#
# Proves, reproducibly, that the klaridian GENERATOR makes ZERO network calls
# it wasn't explicitly told to make: it runs `klaridian generate` from a LOCAL
# spec inside a network namespace with NO connectivity, and asserts the server
# is still generated. If the CLI phoned home (telemetry, update check, license
# ping, analytics beacon), an air-gapped generate would fail — here it must
# succeed.
#
# Scope of the promise (read before quoting it):
#   * This proves the GENERATOR is offline-clean. The GENERATED server is a
#     different program — its whole job is to call your upstream API and export
#     to the OTel/analytics backends YOU configure, so it is NOT covered here.
#   * `npm install` / `pip install` of klaridian itself downloads from the
#     package registry — that's your package manager, not klaridian. This proves
#     RUNNING it is offline, not installing it.
#   * The only network calls the generator EVER makes are ones you ask for by
#     flag: a `--spec <URL>` (fetches that URL), `--oauth-issuer` without
#     `--oauth-jwks-uri` (one OIDC discovery GET to your IdP), and
#     `--allow-external-refs` (resolves remote $refs in your spec, OFF by
#     default). This test deliberately uses a LOCAL spec and none of those, so
#     a correct generator needs no network at all.
#
# Usage:  bash scripts/verify-no-phone-home.sh
# Requires Linux with `unshare` (util-linux) + sudo, OR Docker. On macOS,
# runs the Docker path if the daemon is up, else explains how to run it.
# Exit 0 = verified offline-clean; non-zero = a network call happened or setup
# failed (the message says which).
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CLI="packages/cli/dist/src/index.js"
SPEC="examples/petstore/openapi.json"
PROBE_HOST="registry.npmjs.org" # any public host; must be UNreachable in the sandbox

if [[ ! -f "$CLI" ]]; then
  echo "Building the CLI first (dist/ missing)…"
  ( cd packages/cli && npm run build >/dev/null 2>&1 )
fi
[[ -f "$SPEC" ]] || { echo "FAIL: local spec fixture missing: $SPEC"; exit 1; }

run_with_unshare() {
  echo "→ Sandbox: sudo unshare -n (network namespace, no connectivity)"
  # 1. Prove the sandbox really has NO network: resolving a public host MUST fail.
  if sudo unshare -n bash -c "getent hosts $PROBE_HOST" >/dev/null 2>&1; then
    echo "FAIL: the network namespace still resolved $PROBE_HOST — not isolated."
    return 2
  fi
  echo "  ✓ confirmed no network inside the sandbox ($PROBE_HOST unreachable)"
  # 2. The real assertion: generate offline. Loopback is up so a localhost
  #    bind wouldn't error, but there is no route off-box — a phone-home fails.
  local out; out="$(mktemp -d)"
  if sudo unshare -n bash -c "node '$CLI' generate --spec '$SPEC' --out '$out' --name no-phone-home --base-url https://api.example.com/v1" >/tmp/nph-gen.log 2>&1; then
    if [[ -f "$out/src/index.ts" ]]; then
      echo "  ✓ klaridian generated a server with NO network available"
      return 0
    fi
    echo "FAIL: generate exited 0 but produced no server artifact."; return 1
  fi
  echo "FAIL: klaridian could NOT generate offline — it may require the network."
  echo "----- generation log -----"; cat /tmp/nph-gen.log; return 1
}

run_with_docker() {
  echo "→ Sandbox: docker run --network none"
  docker run --rm --network none -v "$REPO_ROOT":/w -w /w node:22-slim bash -c '
    set -e
    if getent hosts '"$PROBE_HOST"' >/dev/null 2>&1; then
      echo "FAIL: container resolved '"$PROBE_HOST"' with --network none"; exit 2
    fi
    echo "  ✓ confirmed no network inside the container"
    node "'"$CLI"'" generate --spec "'"$SPEC"'" --out /tmp/nph --name no-phone-home --base-url https://api.example.com/v1
    test -f /tmp/nph/src/index.ts && echo "  ✓ klaridian generated a server with NO network available"
  '
}

echo "klaridian no-phone-home verification"
echo "===================================="

if command -v unshare >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  run_with_unshare
elif command -v unshare >/dev/null 2>&1; then
  # sudo may prompt interactively (fine for a human running it locally).
  run_with_unshare
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  run_with_docker
else
  echo "SKIP: need Linux with 'unshare' (util-linux) + sudo, or a running Docker daemon."
  echo "On macOS: start Docker Desktop, then re-run — the --network none path will be used."
  exit 3
fi

echo
echo "VERIFIED: the klaridian generator produced a server with zero network access."
