# Competitive Landscape: OpenAPI→MCP Generation & MCP Tooling/Observability
**Date:** 2026-09-03 · **Prepared for:** klaridian roadmap review
**Method:** web search + primary-source verification (official sites, GitHub, npm registry). Star counts and dates are as reported by primary/near-primary sources at time of research; treat third-party star figures as approximate.

---

## 1. Direct competitors: OpenAPI → MCP server generation

### 1.1 Speakeasy (+ Gram)
- **What:** Two offerings. (a) **Standalone MCP generation** via the Speakeasy CLI—self-hostable MCP servers generated from OpenAPI, tied to their SDK-generation pipeline. (b) **Gram** (getgram.ai)—open-source (repo: speakeasy-api/gram) hosted platform, now positioned as an "AI control plane": curate tools, compose custom tools, OAuth 2.1 proxy w/ DCR, RBAC, audit logging, OTel-based observability of token use/costs, SOC 2 Type II + ISO 27001. Gram Functions (custom TS/Python tools) and MCP-server import (unified control plane over third-party servers) shipped per their roadmap.
- **Monetization:** Usage-based, free tier (~1K tool calls at beta launch, Sept 2025); enterprise features (SSO, audit logs) paid. SDK gen is their core paid business.
- **Activity:** Very high. Publishing docs/blog continuously through mid-2026 (e.g., "What is an MCP registry?" Aug 25, 2026). Their catalog is powered by the official MCP Registry.
- **Threat level: HIGH.** They cover generation *and* hosting *and* observability *and* curation, with a funded team. However: their center of gravity is companies already paying for SDK generation; the standalone CLI path is a funnel to Gram. A free, unopinionated, SDK-agnostic OSS generator still has room underneath them.

### 1.2 Stainless
- **What:** MCP servers generated from OpenAPI, but they made a decisive bet: **as of 2026 their generated MCP servers are Code Mode only**—exactly two tools (docs-search + execute-code running TypeScript against the generated SDK in a Deno sandbox). They *removed* all other tool schemes (regular/dynamic per-endpoint tools are gone). Stainless-hosted remote servers and hosted code execution are **deprecated**—they now push self-hosted Docker images or generated Cloudflare Workers (with a built-in OAuth server for APIs lacking DCR).
- **Monetization:** Paid SDK-gen platform; MCP hosting was a paid feature (now deprecated in favor of self-hosting).
- **Activity:** High; active changelog through 2026 (semantic docs search, Code Mode consolidation).
- **Threat level: MEDIUM, and directionally important.** Stainless abandoning per-endpoint tool schemes is the strongest market signal that "one tool per OpenAPI operation" is losing to code-mode architectures for large APIs. It validates curation (their whole pivot is context-window economics) but pressures generators whose output is N-tools-per-spec. Their retreat from hosting also validates the "emit standalone stateless servers" approach.

### 1.3 Mintlify
- **What:** Auto-generates MCP servers from documentation (docs + OpenAPI pages become tools); every Mintlify-hosted docs site gets an MCP server. Ran the `mcpt` registry early on (since wound down in favor of the official registry ecosystem).
- **Monetization:** Bundled into docs-platform subscription; MCP is a retention feature, not a product.
- **Activity:** Moderate; docs-oriented, not competing on generation depth (no code-mode, minimal curation, no observability).
- **Threat level: LOW.** Only threatens klaridian for users whose API is already on Mintlify and whose needs are shallow.

### 1.4 harsha-iiiv/openapi-mcp-generator (the incumbent OSS CLI)
- **What:** The most direct analog: npm CLI, TypeScript output, generates a full standalone Node project. Zod validation, auth via env vars (API key/Bearer/Basic/OAuth2), stdio/SSE(Hono)/StreamableHTTP transports, curation via `x-mcp` OpenAPI vendor extension (root/path/operation precedence) plus `--default-include false`, programmatic API (`getToolsFromOpenApi`).
- **Activity:** Active. **v4.0.1 published to npm ~June 12, 2026** (verified via npm registry timestamp). Stars reported ~565–630 in 2026 sources (up from ~495); ~32K downloads/mo per one ecosystem survey.
- **Key gap (verified from npm):** v4.0.1 still peer-depends on `@modelcontextprotocol/sdk` **^1.10.2**—i.e., **SDK v1**, not the new v2 split packages (`@modelcontextprotocol/server`) that shipped as stable alongside the 2026-07-28 spec. No observability plugins, no server.json/registry emission, no Docker flag, no interactive curation prompts.
- **Threat level: HIGH on mindshare (it owns the obvious npm name), LOW on features.** klaridian's v2-SDK output, PostHog middleware, registry emission and interactive curation are all genuine differentiators today—but the gap is closable by one motivated maintainer.

### 1.5 FastMCP (PrefectHQ / jlowin)—Python ecosystem
- **What:** Dominant Python MCP framework (~24K stars). `OpenAPIProvider` (FastMCP 3.0) turns any OpenAPI spec or FastAPI app into a *runtime* MCP server—no codegen, spec is interpreted at runtime. Plus **FastMCP Cloud** (Prefect's hosted offering) for one-click deployment.
- **Activity:** Extremely high: 3.0 GA Feb 18, 2026 (100K+ pre-release installs); **v4.0 in beta as of Aug 26, 2026** (v4.0.0b4), with Prefect Horizon account integration.
- **Threat level: MEDIUM (different language, different model).** It's runtime-wrapping, not codegen—no standalone artifact, no repo the user owns. It absorbs the Python demand entirely, though; klaridian's market is effectively TypeScript/standalone-artifact users.

### 1.6 Tadata
- **What:** Two things: **fastapi_mcp** (popular OSS—expose FastAPI endpoints as MCP tools with auth) and Python/Node SDKs that **deploy hosted MCP servers from an OpenAPI spec** (upload spec → Tadata hosts the server).
- **Activity:** Moderate; fastapi_mcp remains maintained; the hosted SDK path has low visible traction versus Gram/Composio.
- **Threat level: LOW-MEDIUM.** Hosted-deploy-from-spec overlaps with klaridian's Phase 1 more than Phase 0.

### 1.7 Other OSS / long tail
- **janwilmake/openapi-mcp-server** (~900 stars): most-starred, but it's a *spec exploration* server (search OpenAPI specs via oapis.org), not a generator—adjacent, not competing.
- **openapi-mcpserver-generator**, **mcp-from-openapi** (npm, v2.3.0, last publish ~2 months before Sept 2026): library converting specs to MCP tool definitions—a building block, not a scaffolder.
- **cnoe-io/openapi-mcp-codegen** (Linux Foundation/CNOE): Python codegen, generates MCP servers *and* LangGraph agents; enterprise-platform-engineering flavored.
- **Agoda APIAgent** (~284 stars): universal GraphQL+REST MCP proxy with DuckDB post-processing—the "intelligent runtime proxy" pattern.
- **OpenAPITools/openapi-generator** has an open feature request (#22001) for an MCP generator type—if the canonical generator project ships one, the commodity floor rises sharply.

**Section takeaway:** the generation layer itself is commoditizing (5+ free ways to do the basic transform). Differentiation has moved to: (a) tool curation / context-window economics (Stainless code-mode, Gram curation, Cloudflare Code Mode), (b) auth (OAuth 2.1 proxying), (c) observability, (d) MCP spec/SDK currency (2026-07-28 spec, TS SDK v2). klaridian is current on (d), has a real angle on (c), decent (a); (b) is the weakest flank.

---

## 2. Hosted / gateway approaches (the "you don't need a generator" threat)

| Player | What it is | Maturity / signals | Relevance to a generator |
|---|---|---|---|
| **Cloudflare** | Managed remote MCP servers; Agents SDK; **MCP portals** (Zero Trust access control for MCP); enterprise MCP reference architecture; **Code Mode MCP server** for the entire CF API (2 tools, `search()`+`execute()`, ~1K tokens vs 1.17M—99.9% reduction). Supports the 2026-07-28 spec; "next generation of MCP" (stateful Durable-Object servers). | Shipping constantly; Code Mode had 5 workerd vulns found by Check Point (2 critical)—pattern is powerful but young. | **High conceptual threat.** Code Mode makes N-tools-from-OpenAPI look wasteful for big APIs. But CF hosts *their* API and *your Workers*; someone still has to produce the server. Validates a `--code-mode` output option. |
| **Zapier MCP** | Hosted MCP over 9,000+ apps / 66K+ actions, managed auth. Claims 450K+ MCP servers created, 18.5M+ tool calls. 2 Zapier tasks per tool call, on all plans. | Mature, mass-market, still labeled Beta. | Removes the need to *build* servers for SaaS integrations—but irrelevant for exposing *your own* API. Not a threat to klaridian's core use case. |
| **Composio** | "Integration platform for AI agents": 1,500+ toolkits, MCP gateway, managed OAuth, tool-call logging. Aug 2026 repricing: free 100K calls/mo (per current pricing page; a third-party analysis reports entry-tier cuts and 13–16× overage hikes to $4/1K, self-managed credentials gated at $599/mo). | Well-funded, aggressive; pricing volatility is annoying its users. | Same as Zapier: third-party tool catalog, not your-API exposure. Pricing churn is an argument *for* self-owned OSS-generated servers. |
| **Pipedream** | MCP layer over its automation platform; weaker logging than Composio per comparisons. | Mature company, MCP is a feature. | Low direct threat. |
| **Smithery** | Registry + hosting + router. **Killed free hosting (deadline March 1, 2026)**; rebuilt platform; RPC-metered pricing (Hobby free 50K RPCs, PAYG, Custom). Free observability/insights tab for hosted *and external* servers. | Pivoting; hosting economics clearly hurt them. | The free-hosting retreat validates "emit a server the user runs themselves." Their free observability tab is a small competitive overlap with klaridian's plugin angle. |
| **Glama** | MCP registry + inspector + gateway; free to browse/install, paid to host. | Mature directory, modest hosting business. | Discovery channel more than threat; klaridian's server.json emission plays well here. |
| **Docker MCP Catalog/Toolkit/Gateway** | The emerging **reference runtime stack**: 300+ verified containerized servers, Desktop-integrated Toolkit (profiles, OAuth, secrets), OSS Gateway (container isolation, credential injection, per-tool RBAC, built-in logging/call tracing, dynamic discovery: mcp-find/mcp-add/mcp-exec). Accepts catalog://, OCI, **official MCP Registry references**, and local server.yaml. Gateway module updated May 2026. | High and accelerating; Apache-2.0/MIT. | **Strong validation of `--docker` and server.json emission.** Docker distributes and runs servers; it doesn't generate them from specs. A generator whose output is Docker-Catalog-ready is complementary. Gateway's built-in call tracing partially overlaps observability. |
| **Postman** | MCP Generator (turn public APIs in the API Network into MCP servers), MCP request testing, Postman MCP server for its own platform. | Mature company; generator is for *public network* APIs, geared to lock users into Postman. | Medium: convenient for casual users; produces Postman-flavored servers, not owned artifacts. |
| **Kong** | AI Gateway with MCP support (retrofit of API gateway). | Enterprise; MCP is a checkbox feature. Solo.io publicly attacks the retrofit approach. | Low direct threat; enterprise buyers who have Kong will use Kong. |
| **Solo.io agentgateway** | Purpose-built Rust AI-native gateway, **Linux Foundation project** (July 2025; Microsoft, T-Mobile, Dell backing; 1K+ stars in 6 months). MCP+A2A protocol-aware routing, virtualized/federated MCP servers, Cedar authz, token exchange, tool-poisoning defenses, **can import OpenAPI specs and expose them as governed MCP tools directly**. Enterprise distro Oct 2025; docs at 2026.8.2. Ships Langfuse/OTel tracing of MCP tool calls out of the box. | Very high momentum in enterprise. | **The single biggest architectural threat**: "point the gateway at your OpenAPI spec" removes the generator *and* provides observability. Counterpoint: it's heavyweight K8s-native infra; solo devs and small teams shipping a public MCP server won't run it. |

**Section takeaway:** gateways/hosts compress the value of *running* MCP servers, not of *producing well-curated, owned server artifacts*. Two existential patterns to watch: (1) gateways ingesting OpenAPI directly (agentgateway, Gram), (2) code-mode collapsing tool surfaces (Cloudflare, Stainless, Anthropic Programmatic Tool Calling). Smithery's hosting retreat and Stainless's hosting deprecation both suggest hosted-MCP-server economics are harder than expected—cautionary for klaridian Phase 1's hosted layer, favorable for Phase 0's standalone-artifact stance.

---

## 3. Observability for MCP / agent tooling

- **PostHog**—`@posthog/mcp` npm package (`instrument(server, posthog)`): **v0.13.0, 58 versions, published within hours of this research—extremely active.** Works on MCP TS SDK v1 *and* v2 (runtime shape detection), high- and low-level servers, stateless/multi-pod servers, captures `$mcp_intent` (asks agent why it's calling) and `$mcp_llm_model`. Official tutorial for MCP analytics + error tracking. Free 1M events/mo. **This is both klaridian's biggest validation and its biggest commoditization risk:** the exact "PostHog middleware for MCP" value klaridian ships now exists first-party. klaridian's plugin must be a thin integration + generation-time convenience, not a moat.
- **AgentCat (ex-MCPcat)**—the only dedicated MCP-server analytics startup found. Renamed 2026; SDK wraps server handlers, captures every protocol event, session replay, error fingerprinting/grouping, LLM goal classification, stateless-server session stitching; exporters to OTel/Datadog/Sentry. Pricing: free tier; team tier 2,000 sessions/mo then $40/1K; enterprise with S3/Snowflake/BigQuery export, SSO. **Direct proof of demand for MCP-specific observability—and a direct competitor to klaridian Phase 1's correlation/fleet layer.**
- **Langfuse**—first-class **MCP Tracing** docs: client↔server trace linking via W3C Trace Context in MCP's `_meta` field; structured tool-call data model; coding-agent tracing (Claude Code, Codex hooks). v4 shipped ("165× faster"). OSS + cloud. Mature.
- **Braintrust**—agent observability incl. tool-call tracing/step-level scoring; eval-centric, not MCP-server-side.
- **W&B Weave**—MCP integration docs (client- and server-side tracing of tool calls/resources/prompts); rebuilt agent tracing June 2026 with session/turn/step semantics.
- **Moesif (acquired by WSO2, 2025)**—API analytics repositioned for MCP: observability, security/abuse monitoring, and **MCP monetization** (per-tool-call billing meters → Stripe, outcome-based billing native for MCP). Integrates with gateways (WSO2, Kong, AWS).
- **Gateway-native:** agentgateway (OTel + Langfuse fan-out for every MCP call, zero code changes), Docker MCP Gateway (built-in logging/call tracing), Gram (OTel token/cost observability), Smithery (free insights tab).

**Section takeaway:** MCP observability is no longer a gap—it's a crowded shelf with three delivery models: in-process SDK (PostHog, AgentCat, klaridian plugins), gateway-level (agentgateway, Docker, Gram), and platform tracing (Langfuse, Weave, Braintrust). The open position is **generation-time wiring**: nobody else emits a server with observability pre-integrated, correlated across a *fleet* of generated servers. That's klaridian's Phase 1 thesis, and AgentCat is the company to watch/benchmark against (they built the backend correlation layer klaridian would need).

---

## Honest read for klaridian

**Validations:** Stainless/Smithery retreating from hosting; Docker Catalog + official MCP Registry (still *preview*, GA pending—server.json emission is well-timed but on a moving target); PostHog shipping first-party MCP instrumentation; AgentCat's existence and pricing prove people pay for MCP-server analytics; harsha-iiiv still on SDK v1 leaves a current-SDK gap klaridian already fills.

**Threats, ranked:** (1) Code Mode consuming the per-endpoint-tool paradigm for large APIs—klaridian has no code-mode story; (2) gateways ingesting OpenAPI directly (agentgateway, Gram); (3) PostHog first-party middleware flattening the observability-plugin differentiation; (4) AgentCat already occupying the paid MCP-analytics slot; (5) harsha-iiiv closing the feature gap on the incumbent npm name; (6) a possible official OpenAPITools MCP generator commoditizing the base transform.

---

## Executive summary (10 lines)

1. Basic OpenAPI→MCP generation is a commodity: 5+ free tools do it; value has moved to curation, auth, spec currency, and observability.
2. The market's loudest signal is **code-mode**: Stainless deleted per-endpoint tools entirely; Cloudflare compresses 2,500 endpoints to 2 tools; klaridian needs a position on this.
3. Hosting MCP servers is proving economically hard—Smithery killed free hosting, Stainless deprecated hosted servers—which favors klaridian's standalone-artifact model but warns against a naive Phase 1 hosted play.
4. Enterprise consolidation is happening at the **gateway** (agentgateway/Linux Foundation, Docker MCP Gateway, Cloudflare portals), and gateways increasingly ingest OpenAPI specs directly.
5. Docker's Catalog/Toolkit/Gateway is becoming the distribution+runtime standard; klaridian's `--docker` and server.json emission align with where distribution is consolidating (registry still in preview).
6. Speakeasy/Gram is the most complete commercial competitor (generate+curate+host+observe), but targets funded API companies, leaving OSS/indie space open.
7. MCP observability is crowded: PostHog ships first-party MCP instrumentation (v2-SDK-aware, very active), AgentCat is a dedicated funded product, Langfuse/Weave/Moesif all trace MCP tool calls.
8. klaridian's defensible slice is therefore narrow but real: current-SDK (v2) standalone TS generation with observability, curation, and registry emission wired in at generation time—the incumbent OSS generator is still on SDK v1 with none of that.
9. Phase 1's correlation/fleet layer competes directly with AgentCat and gateway-native tracing; it needs a generator-native angle (fleet of *generated* servers, config-as-code) to justify existing.
10. Net: the OSS generator is validated as a wedge, not a business—monetization pressure points are curation/code-mode economics and fleet observability, and the window before incumbents close the SDK-v2 gap is likely 6–12 months.
