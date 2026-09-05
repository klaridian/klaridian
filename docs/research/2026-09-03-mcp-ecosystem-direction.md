# MCP Ecosystem Direction Report—September 3, 2026
*Input for the klaridian roadmap review. Primary sources cited inline.*

## 1. Spec status: 2026-07-28 is out, and the TS SDK v2 stable HAS shipped conformance

**2026-07-28 is the latest spec revision** (RC published 2026-05-21, final 2026-07-28). Maintainers call it "the largest revision since launch." Key changes (source: blog.modelcontextprotocol.io/posts/2026-07-28, by David Soria Parra & Den Delimarsky):

- **Stateless protocol core** (SEP-2575, SEP-2567): `initialize`/`initialized` handshake and `Mcp-Session-Id` header removed. Every request is self-describing—protocol version, client info, and capabilities travel in `_meta` on each request. Optional `server/discover` RPC replaces up-front capability exchange. Any request can hit any instance behind a plain round-robin LB.
- **Header-based routing**: `Mcp-Method` and `Mcp-Name` HTTP headers let gateways route/authorize without parsing bodies.
- **MRTR (Multi Round-Trip Requests)**: server-to-client interactions (sampling, elicitation) redesigned via `InputRequiredResult`, removing the need for always-open bidirectional streams.
- **Caching**: `ttlMs` + `cacheScope` on list results and resource reads (SEP-2549); deterministic list ordering to keep prompt caches stable.
- **Extensions framework formalized**: Tasks, MCP Apps, and Enterprise Managed Authorization are official extensions.
- **Auth hardening**: RFC 9207 issuer validation required; DCR deprecated in favor of CIMD (see §4).
- **Formal lifecycle policy**: Active/Deprecated/Removed with a 12-month minimum deprecation window. Deprecated in this release: **Roots, Sampling, Logging, DCR, and legacy HTTP+SSE transport**.

**TypeScript SDK v2 conformance: YES, shipped.** `@modelcontextprotocol/server` **2.0.0 stable was published 2026-07-27** (npm; alphas since April, betas through July), released alongside the spec. It's the stable release line implementing 2026-07-28; the monolithic `@modelcontextprotocol/sdk` v1.x (latest 1.30.0, also 27 Jul) gets bug/security fixes only for ≥6 months. v2 splits into `@modelcontextprotocol/core` / `server` / `client` / `node`, with framework adapters (`express`, `fastify`, `hono`) and a **`@modelcontextprotocol/codemod`** package for automated v1→v2 migration. Weekly downloads of the server package are already ~5M; repo is limiting new-contributor PRs while v2 settles. Notes: requires zod v4; TS ≥6.0 needs `"types": ["node"]`. Community reports (mcp-use/Manufact, quoted in the official blog) cite ~83% package-size reduction and ~25% speedup from the client/server split.
→ **klaridian's blocker is gone**: it can move off 2025-11-25 negotiation to v2.0.0 / 2026-07-28 now. Its stateless-server architecture is exactly what the new spec rewards.

**Spec roadmap next 6–12 months** (modelcontextprotocol.io/development/roadmap, updated 2026-08-22), five priority areas:
1. **Agentic messaging primitives**—Tasks (SEP-2663) toward core, server-initiated events/webhooks, `subscriptions/listen`, composition review.
2. **HTTP-native transport unification**—Streamable HTTP as the *single* binding, including **HTTP/2 over stdio for local servers**; ETag-based caching of tool-call results.
3. **Agent identity & enterprise security**—DPoP finalization; workload identity federation (SEP-1933), ID-JAG, RFC 8693 token exchange (Agent Identity WG forming).
4. **Improved primitives**—redesign of `tools/call` result shape (content vs structuredContent confusion); **progressive discovery** (server-side, clients learn tools as needed); annotation cleanup.
5. **SDK DX**—spec-derived generated SDKs validated against a conformance test suite ("generated-artifacts experiment").

## 2. Code mode / programmatic tool calling: search+execute is winning for large APIs

- **Anthropic** (engineering blog "advanced tool use," building on the Nov 2025 "code execution with MCP" post): three GA platform features—**Tool Search Tool** (`defer_loading: true`, ~85% token reduction), **Programmatic Tool Calling** (Claude invokes tools from code in a sandbox), **Tool Use Examples**. Headline stat: 150K→2K tokens (98.7%) via code execution with MCP.
- **Cloudflare Code Mode** (blog.cloudflare.com/code-mode, and **server-side Code Mode** ~Feb 20, 2026): the flagship example is the **Cloudflare API exposed as exactly two tools—`search` (query the pre-resolved OpenAPI spec) and `execute` (run generated JS against the API)** in an isolated Worker. Claimed 99.9% input-token reduction ("an entire API in 1,000 tokens"). Now documented as an official Cloudflare Agents pattern (developers.cloudflare.com/agents/model-context-protocol/codemode).
- **OpenAI** ships the same primitive: `defer_loading: true` on MCP server tool definitions in the Responses API, paired with tool search.
- **The spec itself is converging on it**: "progressive discovery" is a named 2026 roadmap deliverable (Core Primitives WG), and 2026-07-28's `ttlMs` caching exists to make cached/partial tool catalogs viable.

**Verdict**: for large APIs (>~30–50 endpoints), one-tool-per-endpoint is effectively dead at the frontier. Three converging families: (a) tool search / deferred loading, (b) code-as-API in a sandbox (search+execute or generated typed SDK), (c) server-side progressive disclosure. For an OpenAPI→MCP generator, the Cloudflare server-side pattern is the most directly relevant: **the server itself exposes `search` + `execute` over the OpenAPI spec**, needing no client cooperation—it works in any MCP client today, while `defer_loading` requires host support.

## 3. Registry & distribution

- **Official MCP Registry** (registry.modelcontextprotocol.io): still **in preview** as of Sept 2026 (about page warns of breaking changes/data resets; GA "will follow later"). ~9.6K latest server records / ~29K server+version records (May 2026 API pull; Anthropic cites >10K active public servers). Backed by Anthropic, GitHub, PulseMCP, Microsoft.
- **server.json** is the record format: reverse-DNS name (`io.github.user/x`), package pointer (npm/PyPI/Docker/remote URL), execution instructions, discovery metadata. **Namespaces are authenticated (GitHub/DNS/HTTP challenge); code is not scanned**—the registry is a metaregistry over npm/PyPI/Docker Hub/GitHub. Public servers only; private → self-host a subregistry.
- **Where discovery actually happens**: client built-in directories dominate real distribution—**Claude Connectors Directory (439 entries by June 2026)**, **ChatGPT App Directory (opened to third parties Dec 2025, 60+ apps early 2026, remote-HTTP only)**, Cursor/VS Code one-click installs, Docker MCP Catalog, plus aggregators (PulseMCP, Smithery, mcp.directory) that ingest the official registry. The official registry is upstream plumbing; the directories are the storefronts.
→ klaridian already emitting server.json is right; treat registry publish as table stakes, directories as the launch channel.

## 4. Auth direction

- **MCP servers are formally OAuth 2.1 resource servers** (introduced 2025-11-25, tightened in 2026-07-28). Requirements: serve **RFC 9728 Protected Resource Metadata** (`/.well-known/oauth-protected-resource`), validate **audience** (`aud` must match server identifier; RFC 8707 `resource` parameter mandatory on client side; token passthrough explicitly forbidden), validate **issuer** (RFC 9207, SEP-2468), 401 + `WWW-Authenticate` with `resource_metadata` pointer. PKCE S256 mandatory. STDIO servers SHOULD NOT implement this spec.
- **CIMD replaces DCR**: DCR deprecated (12-month window) in favor of **Client ID Metadata Documents**—client hosts a JSON metadata file at a stable HTTPS URL and uses that URL as `client_id`; the AS fetches and validates on demand. Motivated partly by an arXiv study finding 96.6% of tested servers had DCR flaws. CIMD is mostly client/AS-side; the **server's** job stays narrow: PRM + audience + issuer validation.
- **Who ships auth—server or gateway?** Both, split by segment. The **gateway pattern is the dominant enterprise architecture** (Bifrost, Kong AI Gateway, Azure APIM, AWS Bedrock AgentCore, IBM ContextForge): gateway terminates OAuth, does token exchange (RFC 8693), tool-level authz, audit; servers behind it run authless. But **direct-to-client distribution (Claude.ai/ChatGPT connectors) requires the server itself to be a compliant resource server**—clients will not connect otherwise. The next wave (roadmap area 3) is agent identity: DPoP, ID-JAG, workload identity federation.
→ A generator should emit the narrow resource-server contract (PRM + audience/issuer validation + WWW-Authenticate) with a "delegate to gateway / authless" mode as a flag—not build an authorization server.

## 5. Fatigue vs growth

**Growth signals dominate; consolidation is happening at the governance layer, not the demand layer.**
- ~**0.5B downloads/month across Tier 1 SDKs**; TS and Python SDKs each past 1B total (official blog, July 2026). Monthly SDK downloads went ~2M (Nov 2024) → 97M+ (Mar 2026).
- **Anthropic donated MCP to the Agentic AI Foundation (Linux Foundation) in Dec 2025**, backed by OpenAI, Google, Microsoft, AWS—vendor-neutral standard status.
- **All three major hosts committed, divergent on posture**: Claude = local stdio + deepest protocol support + MCP Apps; ChatGPT = remote-HTTP-only, Apps SDK converging onto the MCP Apps open standard (OpenAI now documents "build MCP Apps standard first, `window.openai` as optional extension"); Google = managed/governed MCP in Gemini Enterprise Agent Platform (GA June 30, 2026, 50+ managed servers) plus Gemini CLI. Microsoft: registry backer, GitHub MCP server, Foundry endorsement quoted in the official 2026-07-28 post.
- **Real fatigue signals are about context bloat, security, and long-tail server quality**—not the protocol: 55–134K-token tool preambles (Anthropic's own numbers), Claude Code issue #11364 (67K tokens from 7 servers), DCR vulnerability studies, registry spam moderation. The ecosystem's answer is exactly §2 (progressive disclosure/code mode) and §4 (auth hardening). Some commentary notes long-tail one-off servers consolidating into gateways, catalogs, and code-mode front-ends—which favors generators that produce *well-curated* servers over hand-written ones.

---

## The 5 bets for klaridian (next 6 months), ranked

1. **Ship SDK v2 / 2026-07-28 support now, with stateless as the headline.** The blocker cleared on 2026-07-27; klaridian's stateless-server design is precisely what the spec rewrote itself around—being early to "deploy behind a plain LB, no session store" is a marketing gift with a 12-month deprecation clock pushing everyone to migrate.
2. **Make search+execute (server-side code mode) a first-class output mode, defaulting on for specs >~40 operations.** Cloudflare proved the 2-tool `search`+`execute` pattern for exactly klaridian's input artifact (an OpenAPI spec), it works in every client without host support, and one-tool-per-endpoint is visibly losing for large APIs.
3. **Emit the narrow OAuth 2.1 resource-server contract (RFC 9728 PRM + audience + RFC 9207 issuer validation + WWW-Authenticate), plus an explicit `--auth=gateway` authless mode.** Direct connector distribution hard-requires it, enterprises will strip it for gateways—supporting both segments is a flag, not a fork; skip DCR entirely (deprecated) and document CIMD compatibility.
4. **Publish to npm and the official MCP Registry immediately, but spend launch effort on client directories (Claude Connectors, Cursor, Docker MCP Catalog).** The registry is preview-stage plumbing that aggregators ingest for free; the 439-entry Claude directory and client one-click installs are where users actually discover servers.
5. **Lean into curation + `ttlMs`/deterministic-ordering cache hints as the observability/quality story.** The ecosystem's loudest pain is context bloat and low-quality long-tail servers; a generator that emits cache-hinted, curated, annotated tool catalogs (and is positioned for the spec's coming "progressive discovery" and generated-SDK conformance work) sells quality, not just conversion.
