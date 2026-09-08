# Contributing to klaridian

Thanks for considering a contribution! klaridian is early—the project is still validating its core direction (see [PLAN.md](PLAN.md) and [ARCHITECTURE.md](ARCHITECTURE.md) for the current thinking), so please open an issue to discuss non-trivial changes before investing time in a PR.

## Ground rules

- **ARCHITECTURE.md is the source of truth for technical design decisions.** Read it before making non-trivial changes—it documents not just what was built, but why, including dead ends and reversed decisions.
- **PLAN.md is for business/strategy**, not technical design. Keep the two separate.
- **"Fail loudly, don't guess."** If a change hits something ambiguous (an unsupported schema shape, a missing config value), it should produce a clear error or warning, never silently do something subtly wrong.
- **Every non-trivial change should be validated end to end**, not just unit-tested. This project's own tests do real `npm install`/`tsc build`/spawn-and-drive-over-stdio for the TypeScript CLI, and a real FastMCP server + client round-trip for the Python middleware—because the riskiest failure modes only show up at that level.
- **Documentation follows the Microsoft Writing Style Guide**—see [STYLE.md](STYLE.md) for the rule, the licensing basis for adopting it, project-specific exceptions, and how to lint with Vale before submitting a docs change.
- **`packages/site/content/docs/reference/cli-reference.mdx` is generated, never hand-edited.** It's produced from the real `klaridian generate` command (see `packages/cli/scripts/generate-cli-docs.mjs`) so the docs can't silently drift from the actual CLI flags. After changing a flag in `packages/cli/src/commands/generate.ts`, run `npm run docs:gen` (from `packages/cli`) and commit the regenerated file—CI and the pre-push hook both fail the build (`npm run docs:check`) if it's out of sync.

## Development setup

### TypeScript CLI (`packages/cli`)

```bash
cd packages/cli
npm install
npm run build
npm test
```

### Python middleware (`packages/python-posthog-middleware`)

```bash
cd packages/python-posthog-middleware
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest tests/
```

## Submitting changes

1. Open an issue first for anything beyond a small bug fix—this saves everyone time if the direction doesn't fit.
2. Keep PRs focused—one change, one PR.
3. Add tests. If you're fixing a bug, add a test that would have caught it.
4. Update ARCHITECTURE.md if you're making a design decision, not just a code change.

## Releases

Versioning follows [semantic versioning](https://semver.org). The project is pre-1.0, so the public API and CLI flags may still change between minor versions; breaking changes bump the minor (`0.x`), and the `1.0.0` line is reserved for the first release with a stability commitment. A release is **triggered by pushing a version tag** — `.github/workflows/release.yml` does the rest (no manual `npm publish`):

1. Bump the version in **all three** places the release gate checks: `packages/cli/package.json`, `packaging/pypi/pyproject.toml`, and `packaging/pypi/src/klaridian/__init__.py` (a mismatch fails the release loudly).
2. `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The workflow gates on the real test suite, then publishes in parallel: the **npm** package (`packages/cli`, via OIDC Trusted Publishing, provenance attached) and the **PyPI** wheels — the CLI compiled to a standalone binary per platform (`bun build --compile`) and wrapped in platform-tagged wheels, so `pip install klaridian` needs zero Node (ARCHITECTURE.md §64). Both use OIDC, so there are no stored tokens.
4. After both publish, it cuts a **GitHub Release** from the tag with auto-generated notes, attaching the bare per-platform binaries as assets (the Homebrew tap formula downloads these).

The `klaridian` CLI is published on npm (`npm i -g klaridian`, or `npx klaridian`) and on PyPI (`pip install klaridian` / `uv tool install klaridian` / `pipx install klaridian`). A Homebrew tap serving the same binary is rendered from `packaging/homebrew/klaridian.rb` (see `render-formula.sh`). The Python `klaridian-posthog-middleware` package is a separate FastMCP add-on and is not published to PyPI.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## Reporting security issues

See [SECURITY.md](SECURITY.md)—please don't open a public issue for security vulnerabilities.
