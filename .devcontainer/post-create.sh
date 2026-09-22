#!/usr/bin/env bash
# .devcontainer/post-create.sh
#
# Runs once after the devcontainer is built. Installs dependencies so a
# contributor can immediately run the same commands CI runs
# (.github/workflows/ci.yml) without a manual setup step.
set -euo pipefail

echo "==> Installing packages/cli dependencies (npm)"
(cd packages/cli && npm install --no-audit --no-fund)

echo "==> Done. Try:"
echo "    cd packages/cli && npm test"
