#!/usr/bin/env bash
# Render the Homebrew formula for a given release by filling in the version and
# per-platform SHA256s from the binaries attached to that GitHub Release, then
# print it to stdout (redirect into the tap's Formula/klaridian.rb).
#
# Usage: packaging/homebrew/render-formula.sh <version>   # e.g. 0.1.0
# Requires: gh (authenticated), shasum. Run after the release assets exist.
#
# NOTE: this depends on the GitHub Release carrying the four bare macOS/Linux
# binaries as assets named klaridian-<os>-<arch>. The release job must upload
# them (a follow-up to the current wheel-only artifact flow); until then this
# script fails loudly on a missing asset rather than emitting a broken formula.
set -euo pipefail

VERSION="${1:?usage: render-formula.sh <version>}"
REPO="klaridian/klaridian"
TMPL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/klaridian.rb"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

declare -A ASSETS=(
  [DARWIN_ARM64]="klaridian-darwin-arm64"
  [DARWIN_X64]="klaridian-darwin-x64"
  [LINUX_ARM64]="klaridian-linux-arm64"
  [LINUX_X64]="klaridian-linux-x64"
)

out="$(cat "$TMPL")"
out="${out//__VERSION__/$VERSION}"

for key in "${!ASSETS[@]}"; do
  asset="${ASSETS[$key]}"
  gh release download "v$VERSION" --repo "$REPO" --pattern "$asset" --dir "$WORK" >/dev/null
  sha="$(shasum -a 256 "$WORK/$asset" | awk '{print $1}')"
  out="${out//__SHA_${key}__/$sha}"
done

printf '%s\n' "$out"
