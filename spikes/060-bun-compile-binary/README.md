# Spike 060: `bun build --compile` produces a working standalone CLI binary

**Plane:** MCPFO-69 · **Gates:** ARCHITECTURE.md §64 (binary distribution strategy) · **Date:** Sep 8, 2026

## Question (Given/When/Then)

Given klaridian's full TypeScript CLI and its pure-JS dependency graph (`openapi-mcp-generator`, `@modelcontextprotocol/sdk`, `@apidevtools/swagger-parser`, …), **when** compiled to a standalone binary with `bun build --compile`, **then** the binary generates an MCP server byte-identical to the `node`-run output, and that server actually installs and runs.

This is the load-bearing assumption under the whole PyPI-wheels + Homebrew-tap distribution plan. If it fails, the plan reopens (Go rewrite vs. Python reimplementation both re-enter the picture).

## Approach

1. Install bun (1.4.2) via the official installer (`~/.bun/bin/bun`, no sudo).
2. `tsc` build the CLI as usual, then `bun build ./dist/src/index.js --compile --outfile klaridian`.
3. Generate the **same** petstore server twice — once from the compiled binary, once from `node dist/src/index.js` — with identical flags (`--language python --plugin otel --plugin-config otel.serviceName=… --base-url …`).
4. `diff -r` the two output trees + compare tree-level sha256.
5. Prove the binary's output is not just identical bytes but a *working* server: real `pip install` → spawn → JSON-RPC over stdio (same discipline as spike 059 / AGENTS.md §9).

## Results

| Check | Result |
|---|---|
| Compile | ✅ clean — 344 modules bundled, **0 warnings**, ~0.3s |
| Binary | 61 MB, `Mach-O 64-bit executable arm64` |
| Cold start (`--version`) | 0.80s real (first run; warm runs faster) |
| `generate` via binary | ✅ 19 tools, "official mcp Python SDK, stateless + otel" |
| `diff -r` binary-output vs node-output | ✅ **exit 0 — identical** |
| Tree sha256 (both sides) | ✅ **`d85db592…fba6f562` — match** |
| Generated server installs + runs | ✅ `initialize` → `petstore-parity v1.0.0`, protocol `2025-11-25` |
| `tools/list` | ✅ 19 |
| Unknown-tool conformance | ✅ `{"code": -32602, "message": "Unknown tool: __nope__"}` |

## Verdict: VALIDATED

### What worked
- `bun build --compile` swallowed the entire pure-JS dependency graph with zero warnings and no configuration. `openapi-mcp-generator`'s `getToolsFromOpenApi()` (the section-16 dependency, the main risk) works inside the compiled binary exactly as under node.
- Output is **byte-identical** to the node build (tree hash match), so no "compiled build drifts from source build" risk — the binary is a drop-in.
- The generated server is genuinely runnable, not just textually identical: real pip-install + stdio JSON-RPC drive passed, including `-32602` conformance.

### What didn't
- Nothing failed. Only cosmetic notes below.

### Surprises / notes
- **Entry point is `dist/src/index.js`** (the tsc output), not `src/index.ts` directly — compiling the already-transpiled JS is the clean path and matches the `bin` field. Bun can also compile the `.ts` directly, but using the tsc artifact keeps one source of truth for the build.
- **Binary size 61 MB** — expected (embeds the Bun runtime). Comparable to other runtime-embedding compilers; smaller than a bundled-Node-runtime wheel would be, larger than a Go binary (~10-15 MB). Acceptable for an occasionally-run CLI; irrelevant to correctness.
- **`bun` was not preinstalled** on the dev machine; `deno` and `node` v22 were. The official bun installer is non-invasive (`~/.bun`).

### Recommendation for the real build (MCPFO-70)
- **Proceed with the binary-distribution plan.** The gate is green.
- Use the **tsc output as the compile input** in CI, not the raw `.ts`.
- For the platform matrix, use bun's `--target` cross-compile flags (`bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`, `bun-linux-arm64`, `bun-windows-x64`) — this spike only proved the host target (macos-arm64); the follow-up ticket must prove each target compiles *and* its binary runs, not assume cross-compile parity from one host result.
- Wheel packaging: a ~10-line `__main__.py` that `os.execv`s the embedded per-platform binary, platform-tagged, via a `hatchling` build hook — no maturin/Rust needed.
- Keep this spike's byte-identical-output assertion as a CI check for the binary build (compiled output must match a node reference), so a future bun upgrade that changes output is caught.
