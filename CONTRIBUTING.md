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

Versioning is manual for now (no automated changelog tooling yet—revisit if release frequency picks up):

1. Bump the relevant `package.json`/`pyproject.toml` version(s).
2. `git tag vX.Y.Z && git push origin vX.Y.Z`
3. Create a GitHub Release from the tag (Releases → Draft a new release → pick the tag), with notes describing what changed. GitHub can auto-generate a first draft from merged PRs/commits since the last tag—edit for clarity before publishing.

Packages (`klaridian` on npm, `klaridian-posthog-middleware` on PyPI) are not published yet—both are marked private/pre-release until that's decided.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## Reporting security issues

See [SECURITY.md](SECURITY.md)—please don't open a public issue for security vulnerabilities.
