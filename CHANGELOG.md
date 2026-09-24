# Changelog

All notable changes to klaridian are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While klaridian is pre-1.0, minor versions (`0.x.0`) may carry breaking changes;
these are always called out under **Changed** or **Removed**.

## [Unreleased]

## [0.4.0] - 2026-09-24

### Added

- `--server-version <semver>`: sets the generated server's version. By default it's now derived from the spec's `info.version` when that's valid SemVer, falling back to `1.0.0`, instead of always `1.0.0`. The version is identical in `package.json`/`pyproject.toml`, `server.json`, and the version the running server reports. A non-SemVer value stops generation with an error, because the MCP Registry mis-ranks versions it can't parse.
- Binary and download responses (files, images, audio, PDF documents) are returned MCP-native instead of being decoded into text. A pre-signed redirect becomes a `resource_link` (your API credentials are never sent to the storage host). Small images and audio come back inline. Anything else becomes a link to the upstream URL. TypeScript and Python targets at parity.
- The Python target now emits a registry-ready `server.json` (PyPI package, `uvx` runtime hint) and the PyPI ownership proof (`mcp-name:` in the generated README), so a Python server can be published to the MCP Registry like a TypeScript one.
- Every generated code file now starts with a DO-NOT-EDIT header, including the TypeScript entry point, server factory, and Cloudflare Worker.
- `scripts/verify-no-phone-home.sh`: runs `klaridian generate` from a local spec with no network access and checks that a server is still produced. You can run it yourself. CI runs it on every build.

### Changed

- **Generated servers now require Node.js 22+ or Python 3.11+** (were Node 20+ and Python 3.10+). Node 20 is past end of life and Python 3.10 reaches it on 2026-10-31. klaridian's CI now runs the full end-to-end suite on both the oldest and newest supported line of each runtime. `klaridian deploy` images move to `node:24-slim` and `python:3.13-slim`, and generated TypeScript projects use esbuild 0.28.
- The generated `package.json` is marked `private` and `server.json` omits `packages[]` unless you pass `--registry-name`. The two files no longer disagree about whether the server is publishable.
- The npm and PyPI package pages now describe both generation targets (TypeScript and Python), and the PyPI page shows the full project README, derived from the root README like the npm one, instead of a short stub. PyPI metadata gains OS classifiers, an SPDX license expression, and Documentation/Changelog/Issues links.

## [0.3.0] - 2026-09-18

### Added

- The generated server now serves the modern MCP protocol revision `2026-07-28` (negotiated via `server/discover`) while keeping `2025-11-25` legacy clients supported (the classic `initialize` handshake). The two revisions coexist on one server: a modern client that probes `server/discover` negotiates `2026-07-28`, and a legacy client's `initialize` still negotiates `2025-11-25`. Verified end to end on both stdio and streamable-http. TypeScript opts in via the `@modelcontextprotocol/server` factory's `supportedProtocolVersions`; the Python `mcp` SDK is `2026-07-28`-native and coexists with no per-server opt-in.
- Structured tool output: when an OpenAPI operation's success response is a JSON object, the generated tool advertises a matching `outputSchema` and returns `structuredContent` (the parsed response body) alongside the text result. klaridian reads and dereferences the response schema from the spec itself (including `$ref`s into `components.schemas`). Array, primitive, and no-body responses stay text-only. TypeScript and Python targets at parity.
- Tool `inputSchema` and `outputSchema` are now emitted as JSON Schema 2020-12, the default dialect for MCP schema definitions (spec revisions 2025-11-25 and 2026-07-28), replacing draft-07.
- Built-in HTML test client: a `--transport streamable-http` server now serves a test client at `GET /` that speaks MCP over HTTP (initialize, tools/list, tools/call), so you can exercise a generated server in the browser. For stdio servers, the generated README documents the MCP Inspector (`npx @modelcontextprotocol/inspector`).
- `klaridian deploy --target docker | cloudflare | fly`: emits a Dockerfile, a Cloudflare Worker, or a Fly.io app, then hands off to the platform's own CLI. The streamable-http server's port and allowed hosts are environment-driven.
- OpenTelemetry spans now continue the caller's trace: the OTel plugin propagates W3C trace context from the MCP request `_meta`.
- `--json` failures carry a stable machine-readable `code` and a specific `stage`, for scripts and agents that branch on the error.
- Per-scheme upstream authentication: the generated server now authenticates to the upstream API according to the OpenAPI `securitySchemes` it declares, instead of always sending a bearer token. Supported schemes: `apiKey` (in header, query, or cookie), `http` bearer, `http` basic, and `oauth2` / `openIdConnect` (bearer token from the environment). Each scheme reads its credential from a `KLARIDIAN_*` environment variable; `KLARIDIAN_AUTH_TOKEN` still works for bearer. An operation whose only scheme is `mutualTLS` fails loudly rather than emitting silent, wrong auth. TypeScript and Python targets at parity.
- `--header-passthrough <names>`: forward named inbound request headers to the upstream API (streamable-http), so a client can supply per-user credentials.
- `--auth-hook`: emit an editable auth hook (`src/auth-hook.ts` or `auth_hook.py`) that runs before the built-in auth and can short-circuit it, as an escape hatch for schemes klaridian doesn't emit natively.

### Security

- Remote `http(s)` external `$ref` pointers in a spec are no longer resolved by default. A malicious or compromised spec could otherwise make the parser fetch attacker-controlled or internal-network URLs at generation time (SSRF). Local-file `$ref`s still resolve. Pass `--allow-external-refs` to opt back in to remote resolution; a spec that needs a remote `$ref` under the default fails loudly, naming the reference and the flag.

### Changed

- klaridian now owns the full OpenAPI-to-tool-data pipeline. Parsing, `$ref` dereferencing, validation, and Swagger 2.0 conversion run on the standard `@apidevtools/swagger-parser` and `swagger2openapi` libraries; the operation-to-tool mapping is klaridian's own code. Output is unchanged: the new engine is verified byte-for-byte against the previous one across Stripe, GitHub, Kubernetes, OpenAI, Twilio, and DigitalOcean specs (about 4,200 real operations, OpenAPI 2.0, 3.0, and 3.1).

### Removed

- The `openapi-mcp-generator` runtime dependency. Its role (tool-data extraction) is now handled by klaridian's own engine described above. `@apidevtools/swagger-parser` and `swagger2openapi` are kept.

## [0.2.0] - 2026-09-13

### Added

- OAuth 2.1 resource-server support on the Python target (`--language python --transport streamable-http --oauth-*`), reaching parity with the TypeScript target: RFC 9728 Protected Resource Metadata discovery, JWKS-backed JWT validation (signature, expiry, issuer, RFC 8707 audience), a spec-shaped 401 Bearer challenge, and required-scope enforcement.
- Author-supplied tool annotations via the `x-klaridian` OpenAPI extension, including object-form hints (mapped onto MCP `ToolAnnotations`: `readOnly`, `destructive`, `openWorld`) and an `expose: false` flag to exclude an operation from the generated server.
- Tool-title precedence: `x-klaridian.title` → OpenAPI `summary` → `operationId`, so generated tools carry human-readable titles instead of raw operation IDs.
- An annotated example spec (`examples/annotated/openapi.json`) demonstrating hints, `expose`, and a title override.

### Changed

- klaridian now owns its internal tool-data model (`ToolIR`) behind a single adapter seam, decoupling the emitters from `openapi-mcp-generator`'s tool type. No change to generated output; this is the groundwork for phasing out that dependency.

### Fixed

- The npm package page now renders a README (derived from the root README at publish time, with repo-relative links rewritten to absolute, tag-pinned GitHub URLs).
- The favicon and app icons now use the site's accent green, matching the wordmark instead of the previous cyan drift.

## [0.1.1] - 2026-09-09

### Fixed

- `klaridian --version` now reads the real version from `package.json` instead of a hardcoded literal that had drifted to `0.0.1`; a regression test keeps them in sync. The standalone binary reports the correct version on every channel.
- The Homebrew formula renderer (`render-formula.sh`) is now portable to the stock macOS bash 3.2, replacing a `declare -A` (bash 4+) associative array that silently emitted an empty formula.

## [0.1.0] - 2026-09-09

### Added

- Multi-channel binary distribution: platform-tagged PyPI wheels (install with `pip`/`pipx`, no Node required) and a Homebrew tap (`brew tap klaridian/klaridian && brew install klaridian`), alongside npm.
- Tag-triggered release automation (`release.yml`): npm, PyPI, and a GitHub Release with attached standalone binaries, publishing to PyPI via OIDC trusted publishing.

### Changed

- The project moved to the `klaridian` GitHub organization (`github.com/klaridian/klaridian`); old `ricardocvasconcelos/klaridian` URLs still redirect.

### Fixed

- Dropped the retired `macos-13` runner from the wheel matrix (a retired runner label queues indefinitely instead of failing) and made the npm publish step idempotent so re-firing a tag can complete a partial release.
- Stabilized a flaky stderr assertion in the launch test, and removed a redundant test re-run from `prepublishOnly` so publishing no longer re-runs the full suite.

## [0.0.1] - 2026-09-08

First public release.

### Added

- Generate a Model Context Protocol (MCP) server from an OpenAPI spec, targeting **TypeScript or Python** (`--language`) with full feature parity, built directly from the spec's tool data (SDK v2, protocol 2025-11-25).
- Transports: stdio (default) and `--transport streamable-http`.
- Observability plugins wired in at the `registerTool` boundary: OpenTelemetry, plus product-analytics plugins (Amplitude, Mixpanel, PostHog).
- Native MCP conformance with a two-tier error model (unknown tool → protocol error `-32602`; invalid arguments → tool-error result with `isError: true`).
- `klaridian init` onboarding wizard, `klaridian start` launcher for a generated project, config-file support for `generate`, and `plugins list` / `licenses list` introspection commands.
- A documentation site structured around the Diátaxis framework (tutorials, how-to, reference), with an auto-generated CLI reference.

[Unreleased]: https://github.com/klaridian/klaridian/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/klaridian/klaridian/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/klaridian/klaridian/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/klaridian/klaridian/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/klaridian/klaridian/releases/tag/v0.0.1
