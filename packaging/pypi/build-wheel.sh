#!/usr/bin/env bash
# Build a klaridian PyPI wheel for the HOST platform, embedding a freshly
# compiled CLI binary. Used locally to prove the packaging chain; CI runs the
# equivalent per-target matrix (see .github/workflows/release.yml).
#
# Usage: packaging/pypi/build-wheel.sh
# Requires: bun on PATH (or ~/.bun/bin), a Python >=3.10, the cli built (tsc).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG_DIR="$REPO_ROOT/packaging/pypi"
CLI_DIR="$REPO_ROOT/packages/cli"

export PATH="$HOME/.bun/bin:$PATH"

echo "==> tsc build of the CLI"
( cd "$CLI_DIR" && npm run build >/dev/null )

echo "==> bun --compile (host target) -> dist/binary/klaridian"
mkdir -p "$REPO_ROOT/dist/binary"
bun build "$CLI_DIR/dist/src/index.js" --compile \
  --outfile "$REPO_ROOT/dist/binary/klaridian"

echo "==> build the wheel (hatchling embeds the binary via hatch_build.py)"
PYBIN="${PYBIN:-python3.11}"
"$PYBIN" -m venv "$PKG_DIR/.buildenv"
"$PKG_DIR/.buildenv/bin/pip" install -q --upgrade pip build hatchling
KLARIDIAN_BINARY="$REPO_ROOT/dist/binary/klaridian" \
  "$PKG_DIR/.buildenv/bin/python" -m build --wheel --outdir "$REPO_ROOT/dist/wheels" "$PKG_DIR"

echo "==> wheels:"
ls -lh "$REPO_ROOT/dist/wheels/"*.whl
