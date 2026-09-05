# Spike 021c—reach the `2026-07-28` era on SDK v2 and assert the missing MUSTs

**Question (Given/When/Then):** Given `@modelcontextprotocol/server@2.0.0` (the current stable v2), when a client requests the `2026-07-28` protocol era and calls `server/discover`, then the server speaks `2026-07-28` and satisfies its MUSTs (`server/discover`, list-result `ttlMs`/`cacheScope`)—closing the conformance gap spikes 021/021b deliberately left open before klaridian claims "spec-current".

## Verdict: INVALIDATED (for now)—v2.0.0 stable does NOT implement `2026-07-28`

Driven against the real running v2 server over HTTP:

| Probe | Expected if `2026-07-28`-conformant | Actual |
|-------|-------------------------------------|--------|
| `server/discover` RPC | a result advertising versions/capabilities (a **MUST**) | `-32601 Method not found` |
| `initialize` requesting `protocolVersion: "2026-07-28"` | negotiate `2026-07-28` | negotiates **down to `2025-11-25`** |
| `tools/list` result shape | includes `ttlMs` + `cacheScope` (new MUSTs) | only `{ tools }`—neither present |

Corroborated by static inspection of the installed dist:
- `@modelcontextprotocol/core@2.0.0`: `LATEST_PROTOCOL_VERSION = "2025-11-25"`; `SUPPORTED_PROTOCOL_VERSIONS` tops out at `2025-11-25` (then 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07).
- The string `2026-07-28` appears in the v2 dist **only inside a `@deprecated … as of protocol version 2026-07-28 (SEP-2577)` docstring**—i.e. the code is *aware* of the revision but does not negotiate it as a live era.
- `server/discover`, `Mcp-Method`, `Mcp-Name`, `ttlMs`, `cacheScope` string tokens DO exist in the dist (scaffolding is present), but the running server does not expose the behaviors—consistent with partial, not-yet-wired support.

## The correction this forces on the section 37/38 record

The subagent research report (section 37) and the v2 package README both assert "v2 is the stable release line, implementing the 2026-07-28 spec." **That claim is not true of the published `@modelcontextprotocol/server@2.0.0` as it actually runs** (verified 2026-09-03). What is true:
- v2 is a real, stable, **stateless** architecture (proven in 021/021b—the MCPFO-10 crash is structurally gone).
- v2's *current* wire behavior is the **`2025-11-25`** protocol, not `2026-07-28`.
- `2026-07-28` support is scaffolded but not yet negotiated by the stable release; no newer stable (`>2.0.0`) or non-legacy tag exists on npm/GitHub as of today (dist-tag `latest: 2.0.0`; recent tags are `v2.0.0-beta.1`, the `server-legacy@2.0.0` line, and the `v1.x` maintenance line).

This does **not** reverse the 021/021b decision—option (d) (klaridian emits a v2 server from `getToolsFromOpenApi()` data) is still the right path, and it still kills the MCPFO-10 crash and shrinks the patch surface. It only corrects the **timeline/claim**: migrating to v2 lands klaridian on a **stateless `2025-11-25`** server today—already ahead of the frozen v1 generator (which is stuck one revision further back and crashes on HTTP), but **not** `2026-07-28`-conformant yet. Full `2026-07-28` conformance is gated on the official SDK actually shipping it, which is upstream's timeline, not klaridian's.

## Implications for MCPFO-21 (recorded, not yet actioned)

1. **Do not market/claim `2026-07-28` conformance.** The honest claim after a v2 migration is "stateless, SDK-v2, protocol `2025-11-25`, HTTP-safe"—a real step up from v1, short of the newest spec.
2. **The `2026-07-28`-specific MUSTs (`server/discover`, `ttlMs`/`cacheScope`, `Mcp-Method`/`Mcp-Name` validation) are the official SDK's job, not klaridian's.** Because option (d) delegates the protocol layer to the SDK (section 37 Decision 1), klaridian inherits `2026-07-28` for free *when the SDK ships it*—no generator change needed for those MUSTs, just an SDK version bump + re-verify. This is exactly the payoff of not vendoring the transport.
3. **Add a lightweight SDK-era canary** (mirrors the existing `canary-generator-shape.test.ts` idea): assert the SDK's negotiated `LATEST_PROTOCOL_VERSION` so a future `@modelcontextprotocol/server` bump that flips to `2026-07-28` is noticed deliberately, and the "which era do we emit" docs/claims get updated in lockstep.
4. **MCPFO-21 scope should say v2/stateless first, `2026-07-28` second (SDK-gated).** Don't block the whole migration on a conformance level the upstream SDK doesn't offer yet.

## Throwaway
Same dir as 021/021b; `node_modules/` disposable. Value = this verdict + the three-probe method for re-checking era support after any future SDK bump.
