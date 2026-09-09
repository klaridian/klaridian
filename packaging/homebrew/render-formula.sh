#!/usr/bin/env bash
# Render the Homebrew formula for a given release by filling in the version and
# per-platform SHA256s from the binaries attached to that GitHub Release, then
# print it to stdout (redirect into the tap's Formula/klaridian.rb).
#
# Usage: packaging/homebrew/render-formula.sh <version>   # e.g. 0.1.0
# Requires: gh (authenticated), shasum. Run after the release assets exist.
#
# NOTE: this depends on the GitHub Release carrying the four bare macOS/Linux
# binaries as assets named klaridian-<os>-<arch>. The release.yml `github-release`
# job uploads them from the build-wheels matrix (the "Stage bare binary for
# release assets" step), so they exist on every tagged release; this script
# fails loudly on a missing asset rather than emitting a broken formula.
#
# Bash 3.2 compatible on purpose: macOS ships bash 3.2, and this script is run
# by hand on the Mac post-release, so it uses parallel indexed arrays rather
# than `declare -A` (a bash 4+ feature that aborts with "unbound variable"
# under /usr/bin/env bash on stock macOS).
set -euo pipefail

VERSION="${1:?usage: render-formula.sh <version>}"
REPO="klaridian/klaridian"
TMPL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/klaridian.rb"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Parallel arrays: KEYS[i] is the __SHA_<KEY>__ placeholder, ASSETS[i] the asset name.
KEYS=(DARWIN_ARM64 DARWIN_X64 LINUX_ARM64 LINUX_X64)
ASSETS=(klaridian-darwin-arm64 klaridian-darwin-x64 klaridian-linux-arm64 klaridian-linux-x64)

out="$(cat "$TMPL")"
out="${out//__VERSION__/$VERSION}"

for i in "${!KEYS[@]}"; do
  key="${KEYS[$i]}"
  asset="${ASSETS[$i]}"
  gh release download "v$VERSION" --repo "$REPO" --pattern "$asset" --dir "$WORK" >/dev/null
  sha="$(shasum -a 256 "$WORK/$asset" | awk '{print $1}')"
  out="${out//__SHA_${key}__/$sha}"
done

printf '%s\n' "$out"
