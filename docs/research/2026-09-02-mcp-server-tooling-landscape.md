# MCP server tooling landscape: build, generate, host, secure, observe, test (Sept 2, 2026)

Research pass conducted 2026-09-02 to inform klaridian positioning (PLAN.md / ARCHITECTURE.md). Unlike the 2026-08-30 files in this folder (raw subagent JSON), this one is written as a structured report because the request was for a reference map, not a single decision input.

**How to read the evidence labels.** Every non-obvious claim is tagged:

- **[V]** = *verified* directly against a primary source on 2026-09-02 (official docs/pricing page, GitHub API, npm/PyPI registry API). Numbers from GitHub/npm/PyPI APIs were pulled by script the same day, not copied from third-party blogs.
- **[I]** = *inferred* — reasonable conclusion from verified facts, or a claim taken from a secondary source (vendor blog about a competitor, aggregator site) that could not be confirmed on the primary page. Treat these as leads, not facts.
- **[U]** = *unverified / not found* — searched, could not confirm. Stated so gaps are visible rather than papered over.

Pricing changes constantly; every figure here is "as observed on 2026-09-02" and should be re-checked before being quoted externally.

---

## 0. Protocol context that reshapes the whole tooling map (verified)

Three protocol facts from mid-2026 matter more than any individual tool, because they invalidate a lot of 2025-era tooling comparisons:

1. **MCP 2026-07-28 made the protocol stateless.** The `initialize`/`initialized` handshake and `Mcp-Session-Id` header are retired (SEP-2575/2567). Streamable HTTP requests must carry `Mcp-Method` and `Mcp-Name` headers so gateways can route/authorize without parsing JSON bodies (SEP-2243). Roots, Sampling, Logging and the legacy HTTP+SSE transport are deprecated with a 12-month minimum window. Tasks moved to an extension. **[V]** — [MCP blog, 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/).
2. **Dynamic Client Registration (DCR) is formally deprecated in favour of Client ID Metadata Documents (CIMD).** DCR still works for back-compat "but will be removed in a future version." Authorization servers should return `iss` per RFC 9207; client credentials are issuer-bound (SEP-2352). **[V]** — same source. This means any auth vendor comparison that ranks on "supports DCR" (most 2025 blog posts, including WorkOS's own) is now measuring the wrong thing; the question in Sept 2026 is **CIMD + PRM (RFC 9728) + Resource Indicators (RFC 8707) + PKCE**.
3. **Official SDKs are now tiered by conformance.** Tier 1 requires 100% conformance-test pass; Tier 2 requires 80%; Tier 1→2 relegation on *any* failing test. **[V]** — [SDK Tiering System](https://modelcontextprotocol.io/community/sdk-tiers). Rust was promoted to Tier 1 on 2026-08-21 (67/67 server, 50/50 client scenarios), making five Tier 1 SDKs: TypeScript, Python, C#, Go, Rust. **[I]** — third-party write-up of PR #3287 ([digitalapplied.com](https://www.digitalapplied.com/blog/mcp-sdk-conformance-tiers-what-tier-1-means)); the PR itself was not fetched.

The [new roadmap](https://blog.modelcontextprotocol.io/posts/mcp-roadmap) (post-July 2026) names five priorities: agentic messaging primitives, HTTP-native transport unification, **agent identity & enterprise security (DPoP, Workload Identity Federation)**, improved result types, and SDK DX/conformance. **[V]**

Ecosystem scale, for calibration: an independent census crawl (registry + GitHub + npm + PyPI, snapshot 2026-07-07) counted **15,382 servers, 47% remote; 16% have a verified problem** (1,880 gone repos, 218 deprecated npm packages, 299 stale 6+ months); only **127 servers have >1k stars, 9,207 have <10**. **[V]** for the page contents — [mcpcensus.pages.dev/report](https://mcpcensus.pages.dev/report) — **[I]** for methodology quality (single unaffiliated source).

---

## A. Official SDKs

Maturity numbers below are from the GitHub REST API and npm/PyPI download APIs on 2026-09-02. "Last push" = `pushed_at`; "latest release" = `/releases/latest`.

| SDK | Stars | License | Latest release | Last push | Monthly downloads | Tier |
|---|---|---|---|---|---|---|
| `modelcontextprotocol/typescript-sdk` | 13,310 | MIT (npm `license` field; GitHub reports NOASSERTION) | `@modelcontextprotocol/server` 2.0.0 (2026-07-27); v1 line at 1.30.0 | 2026-09-02 | **`@modelcontextprotocol/sdk` (v1): 203.97M**; `@modelcontextprotocol/server` (v2): 14.47M; `/client`: 9.80M | 1 |
| `modelcontextprotocol/python-sdk` (`mcp`) | 24,188 | MIT | v2.1.1 (2026-08-25) | 2026-09-02 | **317.28M** (PyPI, last month) | 1 |
| `modelcontextprotocol/go-sdk` | 5,053 | (NOASSERTION on GitHub) | v1.7.0 (2026-07-28) | 2026-09-02 | n/a | 1 |
| `modelcontextprotocol/java-sdk` | 3,682 | MIT | v2.0.1 (2026-08-19); 2.0.0 GA 2026-06-11 | 2026-09-01 | n/a | 2 **[I]** |
| `modelcontextprotocol/kotlin-sdk` | 1,447 | (NOASSERTION) | — | 2026-09-01 | n/a | 2 **[I]** |
| `modelcontextprotocol/csharp-sdk` | 4,515 | (NOASSERTION) | v2.2.0 (2026-08-13); v2.0 announced by .NET blog | 2026-08-27 | n/a | 1 |
| `modelcontextprotocol/rust-sdk` (`rmcp`) | 3,864 | (NOASSERTION) | rmcp-v3.2.0 (2026-08-31) | 2026-09-02 | n/a | 1 (since 2026-08-21) |
| `modelcontextprotocol/ruby-sdk` | 900 | (NOASSERTION) | — | 2026-09-01 | n/a | 2/3 **[U]** |
| `modelcontextprotocol/php-sdk` | 1,598 | (NOASSERTION) | — | 2026-09-01 | n/a | 2/3 **[U]** |
| `modelcontextprotocol/swift-sdk` | 1,482 | (NOASSERTION) | — | **2026-05-07** (4 months stale) | n/a | 2/3 **[U]** |

All **[V]** via API except the Tier column for non-Tier-1 SDKs, which I could not confirm from the tiers page (it lists requirements, not current assignments).

**Read on the numbers.** The v1 TypeScript package still gets ~14× the downloads of the v2 `server` package five weeks after v2 GA — the ecosystem is overwhelmingly on v1 and will be for months. The TS repo README itself says "v1.x continues to receive bug fixes and security updates for at least 6 months after v2's release" and that PRs are limited to 1 per new contributor "while v2 settles." **[V]** This matters for klaridian: `openapi-mcp-generator`'s output depends on v1 (`@modelcontextprotocol/sdk`), and the v2 migration guide documents a `@modelcontextprotocol/codemod`, split packages (`/server`, `/client`, `/core`, framework adapters `/express`, `/fastify`, `/hono`, `/node`), `zod ^4.2` requirement, `McpError`→`ProtocolError` rename, and `setRequestHandler(Schema,…)`→`setRequestHandler('method/string',…)`. **[V]** — [upgrade guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html). Any textual patch coupled to v1 output shape (like `render/instrument.ts` and `render/conformance.ts`) will break on a v2-generating upstream.

### Built-in OAuth helpers per SDK

- **TypeScript (v1):** ships `mcpAuthRouter`, `ProxyOAuthServerProvider` (proxy an upstream AS), `requireBearerAuth` middleware, and client-side `OAuthClientProvider`. **[I]** — well documented in v1 era; v2 migration guide confirms "OAuth error-class consolidation — `instanceof InvalidGrantError` → `OAuthError` + `OAuthErrorCode`", so the auth module survives into v2 with renames. **[V]** The README lists "auth helpers" for server and "OAuth helpers" for client. **[V]** Whether v2 still ships a full `ProxyOAuthServerProvider` (i.e. lets the MCP server *be* an AS) vs resource-server-only was **[U]** — not confirmed on the v2 API reference in this pass.
- **Python (`mcp` v2):** explicitly resource-server-only by design. Docs: "your server is a **resource server**. It never signs anyone in and it never issues a token." You implement `TokenVerifier.verify_token()` (one async method) and pass `AuthSettings(issuer_url=…, resource_server_url=…, required_scopes=…)`; the SDK then serves RFC 9728 PRM at `/.well-known/oauth-protected-resource/<path>` and emits `WWW-Authenticate: Bearer … resource_metadata=…` on 401. An `IntrospectionTokenVerifier` (RFC 7662) example is in `examples/servers/simple-auth/`. v2.0.0 also added RFC 9207 issuer validation, the SEP-990 identity-assertion flow, and client-credentials extension on the client side. **[V]** — [py.sdk authorization docs](https://py.sdk.modelcontextprotocol.io/v2/run/authorization/), [v2.0.0 release notes](https://github.com/modelcontextprotocol/python-sdk/releases). v1.x `mcp.server.auth` had an `OAuthAuthorizationServerProvider` interface allowing the server to act as AS; v2 docs no longer lead with it. **[I]**
- **Go:** `auth.RequireBearerToken` middleware + `auth.ProtectedResourceMetadataHandler` + `GetAuthServerMetadata`; client-side automatic OAuth flow. Resource-server-only. **[V]** — [pkg.go.dev auth package](https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk/auth).
- **C#:** builds on ASP.NET Core; v2 defaults `HttpServerTransportOptions.Stateless = true`; adds `[McpHeader]` attribute (emits `x-mcp-header` schema keyword) and `UrlElicitationRequiredException` for out-of-band OAuth consent in stateless flows. Auth itself is delegated to ASP.NET Core's standard JWT bearer / resource-server middleware. **[V]** — [.NET blog v2.0 announcement](https://devblogs.microsoft.com/dotnet/announcing-v20-of-the-official-mcp-csharp-sdk).
- **Java:** 2.0.0 GA 2026-06-11; CHANGELOG lists 2.0.x as tracking spec **2025-11-25**, not 2026-07-28 (as of 2.0.1, 2026-08-19). Auth is delegated to Spring Security (see B). **[V]** for changelog line; **[I]** that this is why it isn't Tier 1.
- **Rust/Kotlin/Ruby/PHP/Swift:** auth helpers **[U]** — not examined in this pass.

**Standalone vs framework:** SDKs are, by definition, a runtime dependency. Streamable HTTP: all Tier 1 SDKs. OTel: Python v2 release notes list "Extension APIs, **OpenTelemetry**, and a standalone types package" as a highlight **[V]**; the TS SDK has no built-in OTel (instrumentation is left to Sentry/PostHog/AgentCat wrappers, see F) **[I]**. Tool curation: none at the SDK level beyond what you code.

---

## B. Frameworks

| Framework | Lang | Stars | License | Latest | Last push | Monthly dl |
|---|---|---|---|---|---|---|
| FastMCP (`PrefectHQ/fastmcp`, jlowin) | Python | **27,494** | Apache-2.0 | **v4.0.1 (2026-09-02)** | 2026-09-02 | **83.9M** PyPI |
| FastMCP TS (`punkpeye/fastmcp`) | TypeScript | 3,259 | MIT | v4.19.0 (2026-09-01) | 2026-09-01 | 2.28M npm |
| `mcp-use/mcp-use` (Manufact) | TS (+Python) | 10,553 | MIT | mcp-use@2.4.0 (2026-09-02) | 2026-09-02 | 181.9k npm |
| `basementstudio/xmcp` | TypeScript | 1,325 | MIT | @xmcp-dev/compiler@1.1.2 (2026-08-29); `xmcp` 1.1.2 | 2026-09-02 | 103.9k npm |
| `QuantGeekDev/mcp-framework` | TypeScript | 928 | MIT | 0.2.22 (**2026-04-16**) | **2026-04-16** | 241.6k npm |
| `zcaceres/easy-mcp` (EasyMCP) | TypeScript | 196 | MIT | — | **2025-01-20** | 137 npm |
| `wong2/litemcp` | TypeScript | 185 | MIT | 0.9.0 | **2025-04-27** | 671 npm |
| Spring AI MCP (`spring-projects/spring-ai`) | Java | 9,393 (whole Spring AI) | Apache-2.0 | — | 2026-09-01 | n/a |
| `quarkiverse/quarkus-mcp-server` | Java | 200 | Apache-2.0 | 2.0.0 line (release notes) | 2026-09-01 | n/a |

All numbers **[V]** via API.

### FastMCP (Python) — the de facto standard

- **Versions:** v3.0 stable was "two betas, two release candidates, 21 new contributors, 100,000+ pre-release installs" and rebuilt around *components / providers / transforms* (`OpenAPIProvider`, `FileSystemProvider`, `SkillsProvider`, remote proxies). **v4.0.0 went GA around 2026-09-01/02** (v4.0.1 released 2026-09-02) on top of MCP Python SDK v2: "stateful MCP applications work on the sessionless protocol while one deployment continues serving handshake-era clients." v4 removed the v2-era shims: `FastMCPOpenAPI`, `fastmcp.server.openapi`, `import_server()`, `add_tool_transformation()`, `FASTMCP_DECORATOR_MODE=object`. `from_openapi()` → `FastMCP("x", providers=[OpenAPIProvider(spec, client)])`. **[V]** — [updates](https://gofastmcp.com/updates), [upgrading from v2](https://gofastmcp.com/getting-started/upgrading/from-fastmcp-2).
- **Auth model:** three layers. (a) `TokenVerifier` / `JWTVerifier` — resource-server-only, validate JWT via JWKS or introspection. (b) `RemoteAuthProvider` — for IdPs that support DCR (docs name Descope and WorkOS AuthKit); server serves PRM and points at the external AS. (c) **`OAuthProxy`** — "presents a DCR-compliant interface to MCP clients while using your pre-registered credentials with the upstream provider" for GitHub/Google/Azure/AWS/Discord etc. that lack DCR; maintains "full OAuth 2.1 and PKCE." Concrete providers exist for GitHub, Google, Azure, AWS Cognito, Auth0, WorkOS, Descope, Scalekit, Supabase, etc. v3.4.7 added CIMD `private_key_jwt` support to OAuthProxy. **[V]** — [OAuth Proxy](https://gofastmcp.com/v3/servers/auth/oauth-proxy), updates page. The OAuthProxy makes FastMCP one of the few frameworks that lets the *MCP server itself* act as a (proxying) authorization server.
- **Security churn worth noting:** 3.4.x shipped SSRF hardening (NAT64/6to4/Teredo smuggling), Host/Origin validation for DNS rebinding, a Starlette CVE floor (CVE-2026-48710), and the OAuth client storage moved from `DiskStore` to `FileTreeStore` over a pickle deserialization CVE in `diskcache` (CVE-2025-69872). **[V]** This is the security surface you inherit by running a framework that acts as an AS.
- **OTel:** "MCP-compliant OTEL instrumentation" landed in v3.3.0. **[V]**
- **Tool curation:** visibility API (tag-based filtering, per-session visibility), `SearchProvider`/search transforms, and **Code Mode** (v3.1: meta-tools to search/inspect tools then write sandboxed Python chaining `call_tool()`). **[V]**
- **Hosting/pricing — FastMCP Cloud has been renamed Prefect Horizon.** Docs: "Horizon includes a **free personal tier for FastMCP users**… Horizon is free for personal projects. Enterprise governance features are available for teams deploying to thousands of users." Four pillars: Deploy, Registry, Gateway (RBAC, tool-level access, audit), Agents. Requires a GitHub repo. Paid tier prices are at `prefect.io/pricing?product=horizon` and were **[U]** in this pass (page not fetched). **[V]** for the free tier — [Prefect Horizon docs](https://gofastmcp.com/deployment/prefect-horizon).
- **Limitations:** framework lock-in (your server *is* a FastMCP object); Python only; v2→v3→v4 in ~12 months means non-trivial migration churn (the upgrade doc is long); the OAuthProxy's security is your responsibility to keep patched.

### FastMCP TypeScript (punkpeye)

- Unrelated to PrefectHQ's project beyond the name. v4.19.0. Supports stdio, SSE, and `httpStream` (Streamable HTTP). Added an **OAuth 2.1 Proxy with RFC 7591 DCR and token-swap/JWT issuance** (commit #210) — so, like the Python one, it can act as a proxying AS. **[V]** — repo file listing.
- **Directly relevant to klaridian: in Aug–Sept 2026 it added `fromOpenAPI()` "converter v1 for OpenAPI 3.x specs + real-world benchmark suite" (#349) and follow-up fixes for form-urlencoded bodies and GET→resource mapping (#350, 2026-09-01).** **[V]** — commit messages on the repo landing page. This is a runtime OpenAPI→tools converter inside a TS framework — the TypeScript analogue of FastMCP Python's `OpenAPIProvider`, and a new competitor to `openapi-mcp-generator`'s code-generation approach.
- OTel: **[U]**. Pricing: free/MIT, no hosted offering.

### mcp-use (Manufact, YC S25)

- TS-first (with a Python package) framework + CLI + **Manufact Cloud** hosting. Pitch: React widgets in `resources/` auto-register as tools rendering in ChatGPT/Claude (MCP Apps); built-in Inspector at `/inspector`; "Cloud Inspector: trace, replay, and debug MCP traffic in production." **[V]** — [manufact.com/mcp-use](https://manufact.com/mcp-use).
- **Manufact Cloud pricing (verified):** Free: 1 project, 30k requests/mo, 7-day analytics, 1 seat; Hobby: 2 projects, 300k req/mo, 30-day analytics; Startup: 20 projects, 3M req/mo, 365-day analytics, 10 seats, US/EU/APAC regions; Enterprise from **$1,000/mo**. Metered credit pool (1 credit = $0.01): requests **$0.10/1k**, eval runs $1, end-to-end checks (ChatGPT & Claude) $2, build minutes $0.07, egress $0.15/GB, LLM output tokens $5/1M. Free tier returns `402 Payment Required` once the monthly credit grant is exhausted. Hobby/Startup dollar prices were not on the fetched billing page. **[V]** — [docs.manufact.com/dashboard/billing](https://docs.manufact.com/dashboard/billing).
- OAuth/OTel details **[U]** in this pass (the repo has a `skills/mcp-builder/references/authentication/keycloak.md`, implying resource-server-with-external-IdP guidance **[I]**).

### xmcp (basement.studio)

File-system-routed TS framework (Next.js-style `tools/` dir), first-class Vercel deployment. MIT. Streamable HTTP yes (Vercel doc). Auth/OTel **[U]**. Modest but healthy adoption (~104k/mo). **[V]** for numbers.

### mcp-framework (QuantGeekDev)

Feature-rich TS framework with CLI scaffolding, SSE + `http-stream` transports, and built-in `OAuthAuthProvider` doing **RFC 9728 PRM, RFC 6750 WWW-Authenticate, JWT (JWKS) or introspection validation** — resource-server-only, external AS required. **[V]** — README. **Maturity risk: last push and last release 2026-04-16 (4.5 months stale)** despite 241k monthly downloads — treat as unmaintained until proven otherwise. **[V]**

### EasyMCP, LiteMCP

Both effectively dead: last pushes 2025-01 and 2025-04, <1k downloads/month. **[V]** Listed only because the task asked.

### Spring AI MCP (Java)

- Boot starters for stdio, WebMVC/WebFlux Streamable HTTP, and a **stateless** starter. The SSE transport is "deprecated… not supported" by the security module. **[V]**
- **Spring AI MCP Security** (community module): `McpServerOAuth2Configurer.mcpServerOAuth2()` on top of `spring-boot-starter-oauth2-resource-server` (resource server); OAuth2 client support for MCP clients (auth code, client credentials, hybrid); and an "**MCP Authorization Server** — Enhanced Spring Authorization Server with MCP-specific features" — i.e. you *can* run your own AS. Limitations stated: no WebFlux server support, **opaque tokens not supported (JWT only)**, RFC 8707 handled via configurable resource indicator. **[V]** — [MCP Security reference](https://docs.spring.io/spring-ai/reference/api/mcp/mcp-security.html). DCR/CIMD support in the Spring Authorization Server piece: **[U]**.
- `mcp-annotations` module migrated into Spring AI proper (PR #5567). **[V]** OTel: via Micrometer/Spring Boot Actuator **[I]**.

### Quarkus MCP Server (quarkiverse)

Build-time discovery ("zero reflection… ~30MB RAM"), stdio + Streamable HTTP/SSE via `quarkus-mcp-server-sse`; multiple named endpoints each with its own OIDC tenant; PRM route enabled per tenant (`quarkus.oidc.resource-metadata.enabled`). Uses Quarkus OIDC as resource server against Keycloak etc.; the blog notes Keycloak lacked RFC 8707 so audience mapping was manual, and that MCP Inspector OAuth was "somewhat unstable between versions." A follow-up on DCR via `quarkus-oidc-proxy` was promised. 2.0.0 removed JSON-RPC batching per spec. **[V]** — [Quarkus blog](https://quarkus.io/blog/secure-mcp-server-oauth2), Quarkiverse release notes.

---

## C. OpenAPI → MCP generators and converters

This is klaridian's own category. The critical axis is **standalone code generation** (you own the output, no runtime dependency on the generator) vs **runtime conversion** (a server reads the spec at startup/request time; you depend on the converter forever). See §"Standalone vs runtime" for the synthesis.

| Tool | Approach | Lang | License | Stars | Latest | Last push | Pricing |
|---|---|---|---|---|---|---|---|
| `harsha-iiiv/openapi-mcp-generator` | **codegen** (standalone TS project) | TS | MIT | 632 | npm 4.0.1 (2026-06-14) | **2026-06-15** | free |
| Speakeasy standalone MCP | **codegen** (standalone TS repo) | TS | proprietary generator, generated code yours | 438 (CLI repo) | — | 2026-09-02 | see below |
| Speakeasy Gram / "AI control plane" | **runtime**, hosted | — | Gram OSS (`speakeasy-api/gram`) **[I]** | — | — | — | Enterprise "Tailored" |
| Stainless MCP | **codegen** (subpackage of TS SDK) | TS | proprietary generator | (repo 404) | — | — | Free ≤5 generators / ≤25 endpoints |
| liblab MCP Generator | hosted **runtime** (remote URL) + download | — | proprietary | — | — | — | 100 calls/mo free (first year only), then $5/100 calls |
| MCPize | hosted **runtime** + marketplace | — | proprietary | — | — | — | marketplace rev-share 80/20 |
| AWS Labs `openapi-mcp-server` | **runtime** (reads spec at start) | Python | Apache-2.0 (awslabs/mcp: 9,654★) | — | monthly | 2026-09-02 | free |
| Apollo MCP Server | **runtime** (GraphQL) | Rust | MIT | 308 | v1.17.0 (2026-07-30) | 2026-09-02 | free OSS; Apollo GraphOS paid tiers separate |
| Agoda `api-agent` | **runtime**, LLM-agent-in-the-middle | Python | MIT | 287 | — | **2026-06-19** | free (needs OpenAI key) |
| `cnoe-io/openapi-mcp-codegen` | **codegen** (Python package) | Python | Apache-2.0 | 43 | 0.2.4 (**2025-09-03**) | 2026-08-03 | free |
| `mattt/emcee` | **runtime** CLI | Swift | MIT | 332 | — | 2026-07-04 | free |
| `Vizioz/Swagger-MCP` | **runtime** (spec-exploration tools) | TS | MIT | 163 | — | **2025-12-03** | free |
| `ivo-toby/mcp-openapi-server` | **runtime** | TS | MIT | 289 | — | 2026-06-15 | free (16.2k npm/mo) |
| `janwilmake/openapi-mcp-server` | **runtime** | TS | MIT | 899 | — | 2026-07-07 | free |
| IBM ContextForge | gateway, **runtime** REST→MCP | Python | Apache-2.0 | 4,409 | v1.0.9 (2026-09-01) | 2026-09-02 | free OSS; IBM Elite Support paid |
| Kong AI MCP Proxy | gateway plugin, **runtime** | Lua/Go | Kong Gateway OSS Apache-2.0; plugin tier **[U]** | — | — | — | Konnect: 30-day trial, Plus per-gateway, Enterprise |
| Tyk MCP Gateway | gateway, **runtime** proxy | Go | OSS gateway (MPL) **[I]** | — | — | — | "full feature set… in the OSS gateway"; upstream OAuth client-credentials Enterprise-only |
| Zuplo MCP Server handler | gateway, **runtime** | TS | proprietary | — | — | — | Free forever tier; Builder; Enterprise |
| Apigee MCP | gateway, **runtime** | — | proprietary | — | — | — | Subscription / PAYG / 60-day eval |
| Azure APIM "export REST as MCP" | gateway, **runtime** | — | proprietary | — | — | — | Classic Dev/Basic/Std/Premium and v2 tiers |
| Postman MCP Generator | hosted + download, **runtime** | TS | proprietary | — | — | — | Postman plans |
| `mcp-generator` 3.x (Python/FastMCP) | — | — | — | — | — | — | **[U]** not found under that name |

Numbers **[V]**; approach classification **[V]** from docs unless noted.

### openapi-mcp-generator (harsha-iiiv) — klaridian's upstream

- v4.0.1 on npm (2026-06-14), **51,570 downloads/month**, 632★, MIT. **Last push 2026-06-15 — 2.5 months without a commit** at the time of writing. **[V]** Not yet stale by the census's 6-month rule, but worth watching; it has no GitHub Releases (`/releases/latest` returns 404), so version history is npm-only. **[V]**
- Features (README): stdio / `web` (SSE via Hono) / `streamable-http` transports; auth via env vars (API key, bearer, basic, OAuth2 client-credentials, `--oauth-creds-in-body`); `--custom-auth` generates an editable `src/auth.ts` hook; `--header-passthrough` for per-user API keys over HTTP; `x-mcp` extension + `--default-include` for **spec-level tool filtering**; `--max-tool-name-length` (Claude Desktop 64-char cap); `--generate-lib`; SSRF-safe external `$ref` disabled by default; programmatic `getToolsFromOpenApi()` with `excludeOperationIds`/`filterFn`. **[V]** — [README](https://github.com/harsha-iiiv/openapi-mcp-generator).
- Output is standalone: generated `package.json` depends on `@modelcontextprotocol/sdk` (v1), `zod`, `axios`, and transport deps (Hono, uuid) — not on the generator. **[V]**
- Limitations: v1 SDK only (see §A); no OAuth 2.1 *inbound* auth (PRM/token verification) for the generated HTTP server — inbound auth is a hook you write; no OTel; SSE transport still generated despite spec deprecation. **[V]/[I]**

### Speakeasy (standalone generator + Gram)

- Standalone generation "produces a full TypeScript MCP server with one tool per API endpoint… every tool definition lives in its own file"; `x-speakeasy-mcp` OpenAPI extension for **scope-based tool filtering**; auto-generated **OAuth proxy** "that handles the full token lifecycle — acquisition, caching, refresh, and retry" with "out-of-the-box integrations with WorkOS, Auth0, Clerk, and Descope"; JQ response filters; CLI "runs without network egress for air-gapped generation"; deploy targets Cloudflare Workers, Docker, Lambda, Node. **[V]** for the claims as *Speakeasy's own statements* — [comparison blog](https://www.speakeasy.com/blog/comparison-mcp-server-generators) (vendor-authored, pro-Speakeasy; treat the Stainless/Postman criticisms in it as **[I]**).
- **Gram** = hosted MCP platform + gateway ("centralized routing, unified OAuth across servers, real-time logging, cross-server tool curation"). Now branded "AI control plane"; the open-source stack is `speakeasy-api/gram` **[I]**. Pricing page (2026-09-02) shows only **"Enterprise — Tailored"** for the AI control plane, plus FAQ defining a "request" as one LLM tool call and stating "LLM performance starts to drop significantly when an MCP server has 30-40 tools." **[V]** — [speakeasy.com/pricing](https://www.speakeasy.com/pricing) (server-rendered text only; the JS-rendered SDK-generation tiers were not captured). A third-party page claims a Gram free tier of 1,000 tool calls in beta **[I]**.
- Rationale published: [Self-hostable MCP servers — generate with the Speakeasy CLI](https://www.speakeasy.com/blog/release-standalone-mcp) (2025-07-30): standalone generation exists for teams that need self-hosting/air-gap; Gram remains "the fastest way." **[V]** title/date; body **[I]**.

### Stainless MCP — the 2-tool code-execution approach

- Verified from official docs: "Stainless-generated MCP servers include **two tools: a code execution tool and a docs search tool**. This architecture is more accurate and token-efficient than architectures that expose one tool per API method. A small number of tools take up less space in an LLM's context window, and multiple operations can be performed in a single code tool call." The LLM writes TypeScript that runs against the generated SDK in a **Deno sandbox**; `stainless-sandbox` hosted execution mode is **deprecated** in favour of local Deno. Servers are generated at `packages/mcp-server` inside the TS SDK and published as `<pkg>-mcp` on npm. Remote deployment: Stainless-hosted, self-hosted `--transport=http`, `oauth_resource_metadata.authorization_servers` config for PRM, and `generate_cloudflare_worker: true` producing a Workers OAuth proxy "for APIs without OAuth support." **[V]** — [docs/mcp](https://www.stainless.com/docs/mcp/), [remote](https://www.stainless.com/docs/mcp/remote), [changelog](https://www.stainless.com/changelog/mcp-code-execution-tool).
- Marketing rationale (products page): "Many MCP servers expose one tool per endpoint (or rely on dynamic discovery). This floods the context window with hundreds of static definitions or forces slow, multi-step discovery loops." **[V]**
- Pricing: **Free — $0, up to 5 generators** ("a generator is any single SDK, Docs site or MCP server"), 5 seats, **≤25 endpoints**, 100 preview builds/mo; Starter/Pro/Enterprise tiers exist but dollar amounts are JS-rendered and were not captured. **[V]** partial — [stainless.com/pricing](https://www.stainless.com/pricing).
- Limitation: MCP server is a *subpackage of the TS SDK* — you must adopt Stainless for SDK generation to get MCP; Speakeasy's (biased) comparison claims code mode fails ~15–20% of the time and adds cost for single-call lookups **[I]**.

### liblab

"FREE 100 MCP calls each month… **Free tier (100 calls/month) available for first year only**"; then **$5 per 100 calls**. Hosted "remote MCP" URL model; SDK generation billed separately. **[V]** — [liblab.com/pricing](https://liblab.com/pricing). Very expensive per call relative to everything else here; positioned as a convenience layer for existing liblab SDK customers. **[I]**

### MCPize

Marketplace + hosting: "950+ MCP servers… Publishers keep 80% of every subscription"; CLI `mcpize init/deploy`; "Create MCP servers from OpenAPI specs, Postman collections, or code." **[V]** for the site copy — [mcpize.com](https://mcpize.com/), [docs](https://docs.mcpize.com/). No public per-request pricing found **[U]**.

### AWS Labs `openapi-mcp-server`

Python runtime server (`uvx awslabs.openapi-mcp-server@latest`) that "dynamically creates MCP tools and resources from OpenAPI specifications" at startup; **tag-based filtering**; operation-specific and API-documentation **prompts** auto-generated; Prometheus metrics (`ENABLE_PROMETHEUS`); SSRF protections (DNS pinning, private-network deny by default, `--allowed-spec-dirs`); multi-spec via `ADDITIONAL_SPECS`. Auth outbound only (basic/bearer/api_key). **[V]** — [awslabs.github.io/mcp/servers/openapi-mcp-server](https://awslabs.github.io/mcp/servers/openapi-mcp-server). Note awslabs/mcp deprecates servers periodically (discussion #2615, "Updated March 2026") — this one is not on the list as of the fetch **[V]**.

### Apollo MCP Server (GraphQL)

Rust, MIT, v1.17.0 (2026-07-30), actively pushed. Runtime: exposes GraphQL operations (persisted queries / operation files / introspection) as tools. **[V]** for repo facts; feature detail **[I]**. Pricing: OSS free; GraphOS plans separate **[I]**.

### Agoda APIAgent

"Universal MCP server for GraphQL and REST": point at a GraphQL endpoint or OpenAPI 3.x/Swagger 2.0 spec; an *internal LLM agent* (OpenAI Agents SDK) plans calls, stores results in DuckDB and runs SQL post-processing; **OpenTelemetry tracing opt-in via `opentelemetry-instrument`** with `debug.trace_id` in responses; transports `http`/`streamable-http`/`sse`. **[V]** — [README](https://github.com/agoda-com/api-agent). Architecturally different: it is an *agent* exposed as one MCP server, not a tool-per-endpoint mapping. Last push 2026-06-19.

### cnoe-io openapi-mcp-codegen

Python codegen (`uvx --from git+…`) producing a Python package "with tools, models, and client code." Apache-2.0, 43★, last release 0.2.4 (2025-09-03), last push 2026-08-03. **[V]** Small, CNCF-adjacent (CNOE) audience.

### emcee, Swagger-MCP, ivo-toby, janwilmake

- `emcee` (Swift CLI by mattt): runtime wrapper around any OpenAPI JSON; 332★; MIT. **[V]**
- `Vizioz/Swagger-MCP`: exposes tools *for exploring a Swagger file* (list endpoints, generate model code) rather than proxying the API — a different use (helping an agent write client code). 163★, last push 2025-12-03. **[V]**
- `ivo-toby/mcp-openapi-server` (`@ivotoby/openapi-mcp-server`, 16.2k npm/mo) and `janwilmake/openapi-mcp-server` (899★): TS runtime converters. **[V]** numbers only.

### API-gateway MCP features (Kong / Tyk / Zuplo / Apigee / Azure APIM / IBM)

- **Kong:** "AI MCP Proxy plugin: turn any API into an MCP server… does **not require an LLM**"; aggregation of tools across plugins; MCP Registry (tech preview). **[V]** — [developer.konghq.com/mcp](https://developer.konghq.com/mcp/). Konnect pricing: 30-day free trial, "Plus" per-gateway-per-month with included requests, Enterprise custom; a third party quotes paid plans from $105/seat/mo **[I]**.
- **Tyk MCP Gateway:** "Per-tool rate limiting with independent consumer counters. No other gateway ships this today"; **filtered discovery** (`tools/list` scoped per consumer policy); five rate-limit levels (policy/proxy/method/tool/resource-or-prompt); **OAuth 2.1 with PRM** so "spec-compliant clients discover the authorisation server automatically"; **two MCP-specific OTel metrics `tyk.mcp.requests.total` and `tyk.mcp.primitive.duration`**; Kubernetes CRDs via Tyk Operator; claims compliance with spec 2025-11-25 (not yet 2026-07-28). "The full feature set… is in the OSS gateway"; upstream OAuth client-credentials is Enterprise. **[V]** — [tyk.io/tyk-mcp-gateway](https://tyk.io/tyk-mcp-gateway/) (vendor page). Tyk's own framing: "The MCP Gateway is just the API Gateway growing a new limb." **[V]** title.
- **Zuplo:** MCP Server handler configured from `operations` (older `files/prompts/resources` config deprecated); OAuth via existing `oauth-inbound` policy with `oAuthResourceMetadataEnabled: true` + `OAuthProtectedResourcePlugin` (PRM); docs recommend an AS that supports DCR (written pre-CIMD). "MCP Gateway, AI Gateway, and the developer portal are included in every plan"; "free forever for individuals"; Builder tier with 2 custom domains; Enterprise for >2 seats. Dollar figures are slider-driven and were not captured. **[V]** — [zuplo.com/docs/handlers/mcp-server](https://zuplo.com/docs/handlers/mcp-server), [pricing](https://zuplo.com/pricing).
- **Apigee:** API hub ingests OpenAPI, assigns "MCP" API style, maps operations to tools; hosted MCP endpoints support **OAuth 2.1/OIDC with PRM** and client-identity-based tool restriction; Apigee Analytics for tool usage. **Limits: 1,000 MCP tools per org; OpenAPI 3.0.0–3.0.3 only (no 3.1); regional capacity constraints.** Available on Subscription, PAYG, and Evaluation orgs. **[V]** — [Apigee MCP overview](https://docs.cloud.google.com/apigee/docs/api-platform/apigee-mcp/apigee-mcp-overview).
- **Azure API Management:** expose REST APIs as MCP tools or front an existing MCP server; Streamable HTTP at `/mcp`; rate limits/quotas per subscription; key or OAuth policies. Available in **Classic (Developer, Basic, Standard, Premium) and v2 (Basic v2, Standard v2, Premium v2)** tiers — i.e. not Consumption. **[V]** — [learn.microsoft.com APIM MCP overview](https://learn.microsoft.com/en-us/azure/api-management/mcp-server-overview).
- **IBM ContextForge:** "open source registry and proxy that federates MCP, A2A, and REST/gRPC APIs"; REST/gRPC→MCP translation; virtual servers; 40+ plugins; **OTel tracing to Phoenix/Jaeger/Zipkin/OTLP**; Redis-backed multi-cluster federation; Helm charts. Apache-2.0, 4,409★, v1.0.9 (2026-09-01), 3,162 commits. IBM sells "Elite Support for MCP Context Forge." DCR for OAuth-protected MCP clients is an open feature request (issue #5720). **[V]** — [repo](https://github.com/IBM/mcp-context-forge).

### Others with a code-mode / two-tool architecture (not generators but relevant to positioning)

- **Cloudflare Code Mode** (April 2026): its MCP server exposes only `search()` and `execute()` ("two tools, roughly 1,000 tokens, and coverage of every endpoint in the API"), running JS in a V8 isolate against the OpenAPI document; Cloudflare claims 32% token savings for simple tasks and 81% for complex batch operations. **[V]** — [Cloudflare blog](https://blog.cloudflare.com/code-mode-mcp/), [Agents docs API reference](https://developers.cloudflare.com/agents/tools/codemode/api-reference); percentages **[I]** (via WorkOS recap).
- **FastMCP Code Mode** (Python, v3.1) — see §B.

Together with Stainless, that is three independent, well-resourced teams converging on "don't expose one tool per endpoint" in 2026.

---

## D. Hosting / deployment

| Platform | Model | Free tier | Paid | MCP-specific bits | OAuth story |
|---|---|---|---|---|---|
| **Cloudflare Workers + Agents SDK** | serverless (managed) | Workers Free (100k req/day shared; KV 100k reads/day) | Workers Paid **$5/mo** min, includes Durable Objects, 10M req/mo included, +$0.30/M | `agents` npm (5,508★, **6.03M dl/mo**); `McpAgent` (Durable Objects, stateful) and stateless `createMcpHandler`; "supports the spec from day zero" (2026-07-28) | `@cloudflare/workers-oauth-provider` 0.10.3, MIT, 1,868★, **3.08M dl/mo**: full OAuth 2.1 *provider* (authorize/token/**register (DCR)** endpoints, PKCE, resource indicators) backed by KV; 4 modes: Cloudflare Access as IdP, third-party IdP (GitHub/Google), BYO IdP (Stytch/Auth0/WorkOS), or self-contained. Issues its own bound token to the MCP client. |
| **Prefect Horizon** (ex-FastMCP Cloud) | managed PaaS | free personal tier | enterprise (prices [U]) | FastMCP-only; Registry, Gateway RBAC at tool level, audit | built-in OAuth ("Horizon handles all the OAuth complexity") |
| **Manufact Cloud** | managed PaaS | 1 project / 30k req/mo | Hobby, Startup, Enterprise from $1,000/mo; $0.10/1k req | mcp-use only; Cloud Inspector, evals, ChatGPT/Claude e2e checks, "submission pack" | [U] |
| **Alpic** | managed PaaS | **$0: 10k req/mo, 7-day analytics** | **Pro $30/mo: 200k req/mo, custom domains, OAuth DCR proxy**; Enterprise custom, BYO cloud; overage **$150/M req** | "Git-native CI/CD, MCP-native observability, playground distribution" | **OAuth DCR proxy (Pro+)** |
| **Smithery** | registry + hosting | External-server listing free | [U] | registry, "Zero OAuth configuration" for consumers | consumer-side OAuth handled by Smithery |
| **Vercel `mcp-handler`** | serverless (managed) | Hobby $0 (1M function invocations) | Pro $20/mo (10M incl., +$2/M) | `mcp-handler` 2.1.1, Apache-2.0, **3.57M dl/mo**; built on SDK v2; "serves 2026-07-28 natively while transparently falling back to stateless Streamable HTTP for 2025-era clients"; SSE removed in 2.x; **Redis no longer needed** | `protectedResourceHandler` serves RFC 9728 PRM; resource-server-only, AS external; CIMD is "advertised and implemented by your authorization server" |
| **Netlify** | serverless | Free $0 (300 credits/mo) | Personal 1,000 credits; Pro | guide uses SDK `StreamableHTTPServerTransport` in a stateless function + `mcp-remote` for old clients | [U] (bring your own) |
| **Fly.io** | VMs (Machines) | pay-as-you-go, no monthly minimum (~$2–5/mo small apps [I]) | usage | official "Deploying Remote MCP Servers" blueprint, `fly mcp` tooling | Descope partnership blog [I] |
| **AWS Bedrock AgentCore Gateway** | managed MCP gateway | AWS Free Tier credits | **Gateway $0.005/1k invocations; Search API $0.025/1k; tool indexing $0.02/100 tools/mo**; Identity free when via Gateway; Runtime $0.0895/vCPU-h + $0.00945/GB-h (active-consumption); Observability = CloudWatch rates | targets: Lambda, OpenAPI, Smithy, **existing MCP servers**; "supports the MCP 2026-07-28 spec" | AgentCore Identity (inbound/outbound OAuth) |
| **AWS Lambda** | serverless | Free Tier | standard | no MCP-specific product beyond AgentCore [I] | BYO |
| **Azure API Management** | gateway | none (no Consumption tier support) | Basic v2 upward | REST→MCP export; front existing MCP | key/OAuth policies |
| **Azure Functions MCP extension** | serverless | Free grant | standard | MCP trigger binding; **Streamable HTTP at `/runtime/webhooks/mcp`**; SSE deprecated | BYO (Easy Auth / APIM) [I] |
| **Google Cloud Run** | serverless containers | 2M req/mo always-free [I] | usage | official tutorial for Streamable HTTP MCP servers; Cloud Run "at Next '26" MCP mentions | IAM / BYO |
| **Docker MCP Gateway / Toolkit** | local runtime | free with Docker Desktop (Personal $0) | Pro $9–11, Team $15–16, Business $24 /user/mo (Docker subs, not MCP-specific) | `docker/mcp-gateway` MIT 1,551★; catalog, per-container 1 CPU / 2 GB limits, secrets, `--transport streaming`; **"MCP Gateway as part of Docker AI Governance is an invite-only feature"** | handles OAuth for catalog servers (GitHub/Notion/Linear) |

All **[V]** except where tagged. Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [CF Agents authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/), [workers-oauth-provider](https://github.com/cloudflare/workers-oauth-provider), [Alpic plans](https://docs.alpic.ai/pricing/plans), [Manufact billing](https://docs.manufact.com/dashboard/billing), [vercel/mcp-handler](https://github.com/vercel/mcp-handler), [Vercel pricing](https://vercel.com/pricing), [AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/), [APIM MCP](https://learn.microsoft.com/en-us/azure/api-management/mcp-server-overview), [Azure Functions MCP bindings](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-mcp), [Docker MCP Gateway docs](https://docs.docker.com/ai/mcp-catalog-and-toolkit/mcp-gateway), [Docker pricing](https://www.docker.com/pricing/), [Cloud Run MCP tutorial](https://docs.cloud.google.com/run/docs/tutorials/deploy-remote-mcp-server), [Netlify MCP guide](https://developers.netlify.com/guides/write-mcps-on-netlify), [Fly MCP docs](https://fly.io/docs/mcp/).

**Observations.** (1) Every hyperscaler now has a first-party "MCP on our serverless" doc; the differentiator is *not* hosting but the auth + gateway layer above it. (2) Cloudflare is the only one whose OAuth library is a genuine open-source *authorization server* with DCR and 3M+ monthly installs — that is the de facto reference implementation for "my MCP server issues its own tokens." WorkOS's (competitor) assessment: "the de facto open source OAuth proxy in the MCP ecosystem… Cloudflare's own documentation explicitly recommends layering a real identity platform… on top… CIMD support and the latest spec revisions require the developer to track and implement." **[I]** (competitor claim). (3) Small MCP-native PaaSes (Alpic, Manufact, Horizon) converge on the same shape: free tier ~10–30k req/mo, $30-ish Pro, analytics retention as the upsell lever, OAuth DCR proxy as a paid feature. **[V]** for Alpic/Manufact.

---

## E. Auth / identity for MCP

What "out of the box for MCP" must mean in Sept 2026: **(a)** acts as OAuth 2.1 AS with PKCE; **(b)** accepts self-identifying clients — **CIMD** (preferred) and/or DCR (deprecated but still what many clients send); **(c)** honours **RFC 8707 resource indicators** and mints audience-bound tokens; **(d)** gives you a resource-server helper that serves **RFC 9728 PRM** and 401 challenges. Column "MCP OOTB" below scores (a)–(d).

| Provider | Free tier | Paid entry | MCP OOTB (a/b/c/d) | Notes |
|---|---|---|---|---|
| **Auth0 "Auth for MCP"** (GA May 2026) | **25,000 MAU**, 1 custom domain, "Secure Agentic AI workflows", 1 enterprise connection | Essentials B2C $35/mo, B2B $150/mo (500 MAU); Professional $240/$800 | a ✓, b **CIMD ✓ (admin pre-approves client URL)**, DCR [I], c ✓ ("resource identifiers… natively"), d ✗ (use SDK) | Adds **On-Behalf-Of token exchange** for downstream APIs (Token Vault). Owned by Okta. |
| **WorkOS AuthKit / Connect** | **1M MAU free** | +$2,500/mo per extra 1M MAU; SSO connections $125 each; custom domain $99/mo; Scale $1,000/mo | a ✓, b **CIMD ✓ (off by default; enable in dashboard)** + DCR ✓, c ✓ (Resource Indicators config + "default resource indicator" for non-compliant clients), d ✗ (use SDK) | **Standalone Connect** = use AuthKit as AS in front of your *existing* login (no migration). Speakeasy/FastMCP/Stainless integrate it by name. |
| **Clerk** | **50,000 MRU** free | Pro $25/mo (+$0.02/MRU >50k); Enterprise $300/mo | a ✓, b **CIMD beta (contact support)** + DCR ✓, c [U], d ✗ | Configurable default OAuth scopes (changelog 2026-07-22); "prefer CIMD over DCR." |
| **Stytch Connected Apps** | **10,000 MAU, 1,000 M2M tokens, 5 SSO/SCIM connections** free; "no hard caps or pricing cliffs" | usage above free; branding $99; SSO $125/connection | a ✓, b DCR ✓ (toggle "Allow dynamic client registration"), CIMD [U], c ✓ [I], d ✗ | Public Cloudflare partnership for remote MCP [I]. |
| **Descope Agentic Identity Hub** | **7,500 MAU** Free Forever | Essentials from **$249/mo** (10k MAU); Pro from **$799/mo** (25k MAU) | a ✓, b **DCR + CIMD ✓ "with agent risk assessment flows"**, c ✓ [I], d ✗ | Inbound Apps (your MCP server) + Outbound Apps (agent→3rd-party APIs). Hub 2.5 press release 2026. |
| **Scalekit** | Free: 5,000 tool calls/mo (AgentKit) ; Full-stack auth free tier [U] | Growth **$99/mo**, 100k tool calls, +$0.50/1k; EU residency +$99 | a ✓, b/c/d [U] — MCP auth documented, spec-level detail not verified | Named as a FastMCP auth provider (issuer update in v4.0.0b3). |
| **Keycloak** (self-hosted) | free, Apache-2.0, 36,563★ | support via Red Hat/Phase Two | a ✓, b DCR ✓ (OIDC registration; anonymous DCR must be enabled), **CIMD experimental (`--features=cimd`) with client-policy executor & trusted domains**, c **✗ native — "Keycloak cannot recognize `resource` parameter"; use audience mapper**, d n/a | Official Keycloak MCP guide exists and documents VS Code and Claude Code CIMD URLs. |
| **Ory Hydra** (self-hosted / Ory Network) | free OSS, Apache-2.0, 17,514★ | Ory Network plans [U] | a ✓, b DCR ✓ (`/oauth2/register`, first-class since #2909), CIMD [U], c [U], d via `@ory/mcp-oauth-provider` npm | Publishes Ed25519 JWKS by default (FastMCP had to fix key-cache poisoning for it). |
| **Logto** (OSS MPL-2.0 / cloud) | **50,000 MAU** free; 50k tokens | Pro **$24/mo**; third-party app consent $8 each; API resources 3 incl. | a ✓, b [U], c ✓ (API resources), d via `mcp-auth` library | Positions "MCP server as resource server… scoped access with user sign-in and consent." |
| **Better Auth MCP plugin** (`@better-auth/mcp`) | free, MIT, 29,804★ (whole project), **154.9k npm dl/mo** | — | a ✓ (built on OAuth 2.1 Provider plugin + JWT plugin), b **CIMD via `@better-auth/cimd` companion; "MCP deprecates DCR, so Better Auth never enables DCR implicitly"**, c ✓ ("resource-bound access tokens"), d ✓ (serves RFC 9728 PRM) | Requires official TS SDK **v2**. The only self-hosted library option that is CIMD-first and 2026-07-28-aligned. |
| **Cloudflare workers-oauth-provider** | Workers Free | Workers Paid $5/mo | a ✓, b DCR ✓ (`clientRegistrationEndpoint`), CIMD [U], c ✓ (resource indicators parsed), d ✓ (issues bound token) | See D. |
| **Pomerium** | Personal free (OSS core Apache-2.0, 4,988★) | Business **$7/user/mo** (annual) | gateway, not AS: RFC 9728 auto-discovery of upstream, upstream-OAuth brokering per user per route, **`mcp_tool` policy criterion** for allow/deny by tool name, service accounts, `ssh -R 0 pom.run` dev tunnel | Identity-aware proxy in front of MCP servers. |
| **Okta** (XAA / "Okta for AI Agents") | Integrator free plan | enterprise | Cross App Access (ID-JAG tokens, enterprise-IdP-brokered access to MCP resource servers); "Manual MCP registration is Beta" (Identity Engine release notes 2026.08.3) | Enterprise SSO-centric; not a developer-tier MCP AS. |

Sources **[V]**: [Auth0 GA post](https://auth0.com/blog/auth0-auth-for-mcp-servers-generally-available/), [Auth0 pricing](https://auth0.com/pricing), [WorkOS MCP docs](https://workos.com/docs/authkit/mcp), [WorkOS pricing](https://workos.com/pricing), [Clerk MCP guide](https://clerk.com/docs/nextjs/guides/ai/mcp/build-mcp-server), [Clerk pricing](https://clerk.com/pricing), [Stytch pricing](https://stytch.com/pricing), [Stytch MCP guide](https://stytch.com/docs/guides/connected-apps/mcp-servers), [Descope AI](https://www.descope.com/use-cases/ai), [Descope pricing](https://www.descope.com/pricing), [Scalekit pricing](https://www.scalekit.com/pricing), [Keycloak MCP authz guide](https://www.keycloak.org/securing-apps/mcp-authz-server), [Ory Hydra MCP guide](https://www.ory.com/blog/mcp-server-oauth-with-ory-hydra-authentication-ai-agent-integration-guide), [Logto pricing](https://logto.io/pricing), [Logto AI](https://logto.io/ai), [Better Auth MCP plugin](https://better-auth.com/docs/plugins/mcp), [Pomerium MCP](https://pomerium.com/docs/capabilities/mcp), [Pomerium pricing](https://pomerium.com/pricing), [Okta XAA](https://developer.okta.com/docs/concepts/xaa/), [Okta 2026 release notes](https://developer.okta.com/docs/release-notes/2026-okta-identity-engine/). Secondary (competitor-authored) ranking used only for cross-checks: [WorkOS "best MCP auth providers 2026"](https://workos.com/blog/best-mcp-server-authentication-providers) **[I]**.

**Takeaways.** (1) The generous free tiers (WorkOS 1M MAU, Clerk 50k, Logto 50k, Auth0 25k) make "bring your own IdP" nearly free for any MCP server below serious scale; the paid upsell is enterprise SSO connections, not MAU. (2) **CIMD support is the 2026 dividing line**: verified GA in Auth0 and WorkOS; beta in Clerk; experimental in Keycloak; library-native in Better Auth; **[U]** for Stytch, Descope (claimed), Scalekit, Ory, Logto. Any tool still describing DCR as the requirement is describing the 2025 spec. (3) Nobody in this table gives you the *resource-server half* except Better Auth and Cloudflare; the PRM/401 plumbing comes from the SDK or framework (§A/§B). That gap between "IdP" and "generated server" is exactly where a generator can add value.

---

## F. Observability / analytics for MCP specifically

| Vendor | MCP-specific offering | Mechanism | Free tier | Paid | Notes |
|---|---|---|---|---|---|
| **OpenTelemetry semconv** | `docs/gen-ai/mcp.md` in `semantic-conventions-genai`: `mcp.method.name` (required), `mcp.session.id` (recommended), `rpc.response.status_code`, span name `{mcp.method.name} {target}`, metric `mcp.server.session.duration` | spec, not a product | — | — | **Status: Development** (not Stable). Issue #437 (open) asks to align with 2026-07-28: drop `initialize` examples, make `mcp.session.id` conditional, add `server/discover`/`subscriptions/listen`, add `mcp.server.name/version` attributes. **[V]** |
| **Sentry** | "MCP server monitoring": `Sentry.wrapMcpServerWithSentry(server)` (JS) / `MCPIntegration()` (Python); spans with `op: "mcp.server"`, `mcp.tool.name`, `mcp.method.name`; dashboards by transport/tool/resource | wrapper around official SDK server object; **"built on OpenTelemetry MCP semantic conventions… if you're using another MCP server library and it follows OTel semconv for MCP, you'll get this out of the box"** | Developer plan free (1 user; span quota limited) | Team/Business (PAYG spans) | Requires `@sentry/node` ≥10.70.0 for SDK v2, ≥9.46.0 for v1. `@sentry/node` 128M dl/mo. **[V]** — [Sentry blog](https://blog.sentry.io/introducing-mcp-server-monitoring/), [Node MCP docs](https://docs.sentry.io/platforms/javascript/guides/node/mcp-monitoring/) |
| **PostHog** | "MCP Analytics": which tools get called, what the agent was trying to do, failures, "capabilities agents asked for that you don't offer yet" | `@posthog/mcp` SDK `instrument(server)` (TS: SDK v1 or v2; Python: `mcp>=1.26,<3` and jlowin `fastmcp`); wraps `_registeredTools` proxy | 1M events/mo free | usage | **In-app views behind a feature preview; SDK is 0.x "don't depend on it for production reporting yet."** The old `PostHog/mcp-analytics` repo is archived (1★). **[V]** — [docs](https://posthog.com/docs/mcp-analytics), [install](https://posthog.com/docs/mcp-analytics/installation) |
| **AgentCat (formerly MCPcat**, renamed 2026-07-04) | "Analytics and observability for Claude Connectors and ChatGPT Apps": session tracing, agent intent, replays; injects a `session_id` into every tool call (<1% context overhead) | SDKs `agentcat` (PyPI 2.1.0, 2026-08-31, MIT) / TS (116★) | **500 sessions/mo, 60-day history, 1 project, 3 teammates** | Growth **$160/mo** (2,000 sessions), then **$40/1k sessions**; intent classification add-on $90/mo | Session-priced, not event-priced. **[V]** — [agentcat.com/pricing](https://agentcat.com/pricing/), [rename post](https://agentcat.com/blog/mcpcat-is-now-agentcat) |
| **Datadog** | "Agent Observability" MCP **client** monitoring: auto-instruments the MCP *Python client* library; `call_tool` spans linked to LLM spans; aggregates error/latency by server/tool | ddtrace auto-instrumentation | "free for Datadog customers submitting up to 40,000 LLM spans per month" | LLM Observability usage pricing | Client-side, not server-side. Server-side MCP support **[U]**. **[V]** — [Datadog blog](https://www.datadoghq.com/blog/mcp-client-monitoring) |
| **Langfuse** (ClickHouse-owned since Jan 2026 [I]) | "MCP tracing": propagate W3C trace context via MCP `_meta` to link client and server traces | OTel context propagation recipe | Hobby free 50k units/mo [I] | Core $29, Pro $199, Enterprise $2,499 [I]; MIT self-host | Recipe-level, not a product surface. **[V]** for doc existence |
| **Arize Phoenix / AX** | `openinference-instrumentation-mcp` (PyPI 2.0.8, 2026-08-28): "does not generate any of its own telemetry. Instead, it enables context propagation between MCP clients and servers" | OTel context propagation | Phoenix self-host free (**Elastic License 2.0**, not OSI); AX Free 25k spans/mo | AX Pro/Enterprise | **[V]** — [Phoenix MCP tracing](https://arize.com/docs/phoenix/integrations/python/mcp-tracing), [license](https://arize.com/docs/phoenix/self-hosting/license) |
| **Helicone** | ships *its own* MCP server (`@helicone/mcp`) for querying Helicone; no MCP-server-monitoring product found | — | 10k req/mo free [I] | Pro $79/mo [I] | Third parties describe the product as "in maintenance mode" [I]. **[U]** for MCP server monitoring |
| **Moesif** | two blog guides: "How to Setup Observability for your MCP Server" and "Monitoring MCP Security and Agent Behavior" — API-analytics middleware applied to the MCP HTTP endpoint | HTTP middleware | free tier [U] | usage | Not an MCP-native product; generic API analytics. **[V]** for guides |
| **Treblle** | ships a Treblle MCP server; MCP-server observability = its generic API observability | HTTP SDK | ~250k req/mo free [I] | Core ~$233/mo [I] | **[U]** for anything MCP-specific |
| **Tyk / Apigee / AgentCore / Alpic / Manufact / Horizon / IBM ContextForge** | gateway/PaaS-side MCP analytics (see C/D) | at the proxy | varies | varies | Only works if traffic flows through their gateway |

**Takeaways.** (1) The only vendor-neutral standard is OTel's MCP semconv and it is still *Development* status and lagging the protocol by one revision — anyone emitting `mcp.session.id` for a 2026-07-28 server is emitting a field that no longer exists. (2) Two families of server-side instrumentation exist: *wrap the SDK server object* (Sentry, PostHog, AgentCat) vs *emit OTel and let the backend render* (Sentry claims both; FastMCP native OTel; Tyk gateway metrics). (3) Product analytics for MCP is a real, distinct category (PostHog, AgentCat) priced on events/sessions, not spans — and both are young (0.x / renamed 2 months ago). (4) No vendor offers **cross-server correlation across independently operated MCP servers** — consistent with the 2026-08-30 fleet-landscape finding.

---

## G. Testing / QA / security scanning

| Tool | What | License | Stars | Latest | Monthly dl | Notes |
|---|---|---|---|---|---|---|
| **MCP Inspector** (`modelcontextprotocol/inspector`) | official visual + CLI + **TUI** tester; monorepo `clients/{web,cli,tui,launcher}`, shared `core/auth` (OAuth providers, discovery, mid-session re-auth); `--catalog`/`--config` server configs; test-servers with presets incl. OAuth; supports both legacy and 2026-07-28 "modern" eras | MIT (npm) | 10,815 | **2.5.0 (2026-09-02)** | **1.01M** | Inspector V2 working group active (meeting notes 2026-08-19). **[V]** |
| **MCPJam Inspector** | third-party inspector + eval platform: LLM playground, **OAuth Debugger with "guided MCP OAuth conformance checks across protocol versions 03-26, 06-18, 11-25, and 2026-07-28; DCR, client pre-registration, and CIMD"**, CLI, CI/CD conformance + E2E + evals, SDK | Apache-2.0 | 2,183 | v3.3.5 (2026-09-02) | 20.8k | Also sells hosted (compare page vs Alpic). **[V]** |
| **`@modelcontextprotocol/conformance`** | official conformance harness: `npx @modelcontextprotocol/conformance server --url … --scenario …`; suites `all/core/extensions/backcompat/auth/metadata/draft/sep-835`; `--spec-version 2025-11-25|2026-07-28|draft`; this is what gates SDK tiers (67 server / 50 client scenarios per the Rust promotion) | (NOASSERTION) | 112 | — | [U] | SEP-2484 proposes requiring conformance tests for all Standards-Track SEPs. **[V]** |
| **`@wong2/mcp-cli`** | CLI inspector; OAuth for SSE + Streamable HTTP; non-interactive mode for scripting | **GPL-3.0** | 443 | — | 134.6k | GPL matters if you embed it. **[V]** |
| **mcp-scan → Snyk Agent Scan** | `invariantlabs-ai/mcp-scan` **now redirects to `snyk/agent-scan`** (2,999★, Apache-2.0, v0.6.1 2026-08-31): scans MCP configs/servers/skills for tool poisoning, toxic flows, prompt injection; proxy mode | Apache-2.0 | 2,999 | v0.6.1 | `mcp-scan` PyPI 5.3k (legacy name; 0.4.3 from 2026-03) | README: "CLI output is experimental… may change without notice"; enterprise path is Snyk "Evo". **[V]** |
| **MCP Trust Checker** (`mcptrustchecker`) | "local-first, deterministic security scanner": Capability-Flow Trust Model, cross-tool toxic-flow graph (untrusted ingress → sensitive source → external sink), A–F grade, reads published npm/PyPI source, `--login` performs full OAuth (discovery→DCR→PKCE) to scan protected endpoints, SARIF/badge/`--fail-under`, TOFU pinning (`pin`/`diff`); benchmark corpus of 64 labeled servers, CI gate ≥90% P/R; hosted API free | MIT | [U] | methodology 1.9 | [U] | Single-author project; **calibration claims ("30,000+ servers") are the author's** [I]. **[V]** for README contents |
| **Snyk MCP server** | `snyk mcp -t stdio` in Snyk CLI ≥1.1298.0 — exposes Snyk scanning *to* agents (not a scanner *of* MCP servers) | Snyk CLI license | — | — | — | Local only, "does not offer a hosted, remote version." **[V]** |
| **Semgrep** | `semgrep/mcp` repo **archived 2025-10-28**, moved into the `semgrep` binary; Semgrep's "Security Engineer's Guide to MCP" documents tool poisoning/shadowing/rug-pull threat model | MIT (archived) | 685 | — | — | No published Semgrep *ruleset for MCP servers* found **[U]**. **[V]** for archive |
| Contract testing | No dedicated OpenAPI↔MCP contract-testing tool found. Closest: conformance harness (protocol), MCPJam evals (behaviour), Manufact "end-to-end checks (ChatGPT & Claude) $2/run" | — | — | — | — | **[U]** — a gap |

Sources: [inspector repo](https://github.com/modelcontextprotocol/inspector), [MCPJam](https://github.com/MCPJam/inspector), [conformance](https://github.com/modelcontextprotocol/conformance), [wong2/mcp-cli](https://github.com/wong2/mcp-cli), [snyk/agent-scan](https://github.com/snyk/agent-scan), [MCP Trust Checker README](https://github.com/dmore/mcptrustchecker-deterministic-security-scanner-mcp-servers/blob/main/README.md), [Snyk MCP cheat sheet](https://snyk.io/articles/snyk-mcp-cheat-sheet), [semgrep/mcp](https://github.com/semgrep/mcp).

---

## Summary table by category

| Category | Free & mature (safe default) | Paid / managed leaders | Standalone-code output? | OAuth 2.1 story | OTel | Where it is thin |
|---|---|---|---|---|---|---|
| **A. SDKs** | TS (v1 203M/mo; v2 14M/mo), Python (317M/mo), Go, C#, Rust — all Tier 1 | — | n/a (runtime dep) | Resource-server helpers (PRM + verifier) in Py/Go/TS; TS also has proxy-AS helpers | Python v2 built-in; others via wrappers | v1→v2 TS migration cliff; Java/Kotlin one spec revision behind |
| **B. Frameworks** | FastMCP Py (27.5k★, 84M/mo, v4), FastMCP TS (v4.19), mcp-use, xmcp | Prefect Horizon (free personal), Manufact Cloud (free 30k req) | no — framework lock-in | FastMCP Py/TS: **OAuthProxy = server acts as DCR-fronting AS**; RemoteAuthProvider for DCR/CIMD IdPs; Spring: resource server + optional AS | FastMCP Py native; Spring via Micrometer; others [U] | mcp-framework stale since Apr-2026; EasyMCP/LiteMCP dead |
| **C. OpenAPI→MCP** | `openapi-mcp-generator` (codegen, 51.6k/mo, last push Jun-2026), awslabs (runtime), FastMCP `OpenAPIProvider` / punkpeye `fromOpenAPI()` (runtime) | Speakeasy (codegen + Gram, Enterprise-priced), Stainless (2-tool codegen, free ≤25 endpoints), liblab ($5/100 calls), gateways (Kong/Tyk/Zuplo/Apigee/APIM) | **only** harsha-iiiv, Speakeasy, Stainless, cnoe-io | Speakeasy: generated OAuth proxy + IdP integrations; Stainless: PRM config + CF Worker proxy; harsha-iiiv: outbound only, inbound via hook; gateways: PRM via policy | Agoda, awslabs (Prometheus), IBM, Tyk have it; **no codegen tool emits OTel** | inbound OAuth in generated code; OpenAPI 3.1 (Apigee stops at 3.0.3); tool-count control |
| **D. Hosting** | Cloudflare Workers ($5/mo paid), Vercel `mcp-handler` (3.6M/mo), Cloud Run, Fly | Alpic ($30 Pro), Manufact ($1k Enterprise), Horizon, AgentCore ($0.005/1k), APIM, Docker AI Governance (invite-only) | n/a | CF `workers-oauth-provider` = full AS w/ DCR (3.1M/mo); Vercel = PRM only; PaaSes sell "OAuth DCR proxy" as paid | AgentCore→CloudWatch; PaaS built-in analytics | CIMD in workers-oauth-provider [U]; PaaS free tiers tiny (10–30k req) |
| **E. Auth** | WorkOS (1M MAU), Clerk (50k), Logto (50k), Auth0 (25k), Stytch (10k), Descope (7.5k); Keycloak/Ory/Better Auth self-host | Descope Pro $799, Auth0 Pro $240+, WorkOS Scale $1k | n/a | **CIMD GA: Auth0, WorkOS; beta: Clerk; experimental: Keycloak; native lib: Better Auth**; DCR everywhere | n/a | Keycloak lacks RFC 8707; nobody ships the resource-server half except Better Auth/CF |
| **F. Observability** | OTel semconv (Development status), Sentry wrapper (free dev plan), PostHog `@posthog/mcp` (0.x, 1M events free), AgentCat (500 sessions free) | Sentry Team/Business, AgentCat $160/mo, Datadog (client-side only), Arize AX | n/a | n/a | semconv lags 2026-07-28 (issue #437) | server-side Datadog; cross-server correlation; stable semconv |
| **G. Testing** | MCP Inspector 2.5 (1M/mo), conformance harness, MCPJam (Apache), Snyk agent-scan (Apache), MCP Trust Checker (MIT) | MCPJam hosted, Snyk Evo, Manufact e2e checks ($2/run) | n/a | Inspector & MCPJam debug OAuth incl. CIMD | — | OpenAPI↔MCP contract tests; Semgrep rules for MCP servers |

---

## What most production teams actually use in 2026 (evidence-weighted)

The download data is the least gameable signal available and it is lopsided. **The official Python `mcp` package (317M/mo) and `@modelcontextprotocol/sdk` v1 (204M/mo) dwarf everything**; FastMCP Python (84M/mo, 27.5k★ — more stars than any official SDK) is the only framework at the same order of magnitude, and it *wraps* the official Python SDK, so those numbers partly overlap. In TypeScript, the second tier is hosting adapters rather than frameworks: Cloudflare `agents` (6.0M/mo), Vercel `mcp-handler` (3.6M/mo) and `@cloudflare/workers-oauth-provider` (3.1M/mo) — meaning a large share of TS remote servers are built directly on the SDK plus a platform adapter, not on a framework. TS frameworks are an order of magnitude smaller (punkpeye FastMCP 2.3M, mcp-framework 242k, mcp-use 182k, xmcp 104k). **[V]** all numbers. For OpenAPI→MCP specifically, `openapi-mcp-generator` at 51.6k/mo is the most-installed *standalone* generator I could measure, but runtime converters embedded in frameworks (FastMCP `OpenAPIProvider`, and since Aug-2026 punkpeye `fromOpenAPI()`) are invisible in this metric because they ride on the framework's downloads — so "most teams generate code" is **not** supported by the data; the data is consistent with most Python teams converting at runtime inside FastMCP. **[I]** On auth, vendor-neutral usage numbers don't exist; the strongest indirect evidence is which IdPs the *frameworks* bother to ship providers for: WorkOS, Auth0, Descope, Scalekit, Clerk appear repeatedly across FastMCP, Speakeasy and Cloudflare docs, and Cloudflare's own OAuth library is the reference for self-issued tokens. **[V]** for the name-drops, **[I]** for the inference. On observability, Sentry is the only mainstream APM with a shipped server-side MCP product; PostHog's is explicitly not production-ready; AgentCat is small but MCP-native. The census's 16% dead-server rate and 9,207 sub-10-star servers say the long tail is hobby code — the "production teams" segment is a small fraction of the 15k servers and is concentrated on the official SDKs + FastMCP + a hyperscaler adapter + an IdP with a big free tier. **[I]**

---

## Standalone code generation vs runtime framework: what the market actually does

**Standalone code generation (you own the output; no dependency on the generator at runtime):**

- `harsha-iiiv/openapi-mcp-generator` — emits a TS project depending only on SDK v1 + zod + axios (+Hono). No published rationale beyond "generate… servers"; the `--generate-lib` and `--custom-auth` flags show the intent that users edit the output. **[V]**
- **Speakeasy standalone** — emits a full TS repo, "every tool definition lives in its own file, and developers can modify behavior directly"; rationale (2025-07-30 release post title): self-hostable, air-gapped generation for teams that cannot use hosted Gram. But Speakeasy's *commercial* centre of gravity has moved to Gram (hosted runtime + gateway), and its pricing page in Sept 2026 lists only an Enterprise AI control plane. **[V]** for docs; **[I]** for the reading that standalone is the on-ramp and hosted is the business.
- **Stainless** — emits code but *as a subpackage of the generated SDK*, and the runtime behaviour is deliberately minimal: two tools + Deno sandbox. Their published rationale is token efficiency and accuracy: one-tool-per-endpoint "floods the context window… or forces slow, multi-step discovery loops." **[V]**
- `cnoe-io/openapi-mcp-codegen` — Python codegen; tiny adoption. **[V]**

**Runtime conversion (spec read at startup; you depend on the converter's package forever):**

- FastMCP Python `OpenAPIProvider` (formerly `from_openapi()`); punkpeye FastMCP TS `fromOpenAPI()` (new, Aug–Sep 2026); AWS Labs `openapi-mcp-server`; Kong AI MCP Proxy; Tyk; Zuplo; Apigee; Azure APIM; IBM ContextForge; liblab hosted; MCPize; Postman; emcee; ivo-toby; janwilmake; Agoda (agent-in-the-middle). **[V]**
- Published rationale, where any exists, is operational: no build step, hot-swap the spec, one gateway policy surface for auth/rate-limits/observability (Tyk: "The MCP Gateway is just the API Gateway growing a new limb"; Kong: "does not require an LLM and provides full control over production workloads"). **[V]** titles/quotes.

**What this means.** By count and by momentum the market is going *runtime*: every API gateway vendor, every framework, and every hosted PaaS converts at runtime, because that is where they can attach auth, metering and analytics — the things they charge for. Standalone codegen is held by three players (harsha-iiiv, Speakeasy, Stainless) and two of them are SDK companies for whom MCP is an adjacent output. The honest reading is that standalone codegen's value proposition — *no vendor in the request path, auditable code, your CI, your license* — is real but under-served commercially, precisely because it is hard to monetise. The two SDK vendors monetise via adjacent SDK/docs generation; nobody monetises standalone MCP codegen alone. **[I]**

Two 2026 shifts cut both ways for a codegen tool: (1) the stateless 2026-07-28 protocol makes a generated server "an ordinary HTTP workload," lowering hosting friction for standalone output; (2) the industry's move to two-tool/code-mode architectures (Stainless, Cloudflare, FastMCP Code Mode) means "one tool per operation" — which every OpenAPI codegen tool including `openapi-mcp-generator` produces by default — is increasingly described by well-resourced vendors as the *wrong default* for large specs. Speakeasy's own FAQ puts the cliff at 30–40 tools. **[V]** for their statements.

---

## Gaps nobody fills well (candid)

1. **Inbound OAuth 2.1 in *generated* code.** No standalone generator emits a server that, out of the box, serves RFC 9728 PRM, validates JWTs against a configured issuer, honours RFC 8707 audience, and advertises CIMD — you get outbound API-key/OAuth plumbing (harsha-iiiv), or an OAuth *proxy* for the upstream API (Speakeasy, Stainless), but the resource-server half is left to the developer or a hosted gateway. The SDKs have the primitives (Python `AuthSettings`, Go `auth.RequireBearerToken`, TS auth router); nobody wires them into generated output with IdP-specific presets. **[V]** absence in docs checked; **[I]** that no one does it anywhere.
2. **OpenTelemetry in generated code.** Zero codegen tools emit OTel instrumentation; the OTel MCP semconv is Development-status and one spec revision behind (issue #437). Runtime gateways (Tyk, IBM) and frameworks (FastMCP) have it; codegen does not. klaridian is, as far as this pass could find, alone in patching OTel/product-analytics into generated servers. **[V]/[I]** as above.
3. **Tool-count control for large specs in codegen.** Filtering exists everywhere (`x-mcp`, `x-speakeasy-mcp`, AWS tag filters, Tyk filtered discovery) but *automatic* curation — grouping, search-then-call, or code-mode — is only in Stainless/Cloudflare/FastMCP and only at runtime. A generator that emits a two-tool or search+execute server from an OpenAPI spec as standalone code does not exist. **[I]**
4. **OpenAPI ↔ MCP contract testing.** Nothing verifies that a generated/converted server's tool schemas and behaviour still match the spec after regeneration, or that the upstream API still matches the tools (drift). The official conformance harness tests the *protocol*, MCPJam tests *behaviour with an LLM*, Trust Checker tests *security*. **[U]** after targeted search.
5. **Stable, protocol-current observability semantics.** See F. Anyone building dashboards on `mcp.session.id` today is building on a deprecated field. **[V]**
6. **Cross-server / cross-vendor correlation.** Every observability product assumes it instruments the server (or the gateway) itself; none correlates traces across independently operated servers a client talks to. Consistent with the 2026-08-30 fleet-landscape finding. **[I]**
7. **v1→v2 TypeScript SDK migration for generated servers.** The ecosystem's most-installed codegen tool (`openapi-mcp-generator`) still targets SDK v1, whose support window is "at least 6 months" from late July 2026; upstream has no commits since 2026-06-15. Any downstream tool coupled to its output (klaridian's `instrument.ts`/`conformance.ts`) carries that risk. **[V]** dates; **[I]** risk assessment.
8. **Honest pricing transparency in the MCP PaaS layer.** Speakeasy, Stainless (paid tiers), Zuplo, Smithery, Horizon and Scalekit all hide dollar figures behind JS sliders, "contact sales", or unlisted pages; only Alpic, Manufact, AgentCat, liblab, AWS AgentCore and the IdPs publish complete numbers. **[V]** for what was and wasn't retrievable.
9. **Semgrep/Snyk-style static rules *for MCP server source*.** Snyk's agent-scan and Trust Checker analyse tool manifests, toxic flows and published packages; Semgrep archived its MCP repo; no maintained SAST ruleset targeting MCP-server code patterns (e.g. unvalidated `arguments`, missing `isError`, tool-description injection) was found. **[U]**

---

## Sources (accessed 2026-09-02 unless noted)

Protocol
- https://blog.modelcontextprotocol.io/posts/2026-07-28/
- https://blog.modelcontextprotocol.io/posts/mcp-roadmap
- https://modelcontextprotocol.io/community/sdk-tiers
- https://www.digitalapplied.com/blog/mcp-sdk-conformance-tiers-what-tier-1-means (secondary)
- https://mcpcensus.pages.dev/report (snapshot 2026-07-07)

SDKs
- https://github.com/modelcontextprotocol/typescript-sdk ; /releases
- https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.html
- https://py.sdk.modelcontextprotocol.io/v2/run/authorization/
- https://github.com/modelcontextprotocol/python-sdk/releases (v2.0.0, v2.0.0rc1, v2.1.x)
- https://devblogs.microsoft.com/dotnet/announcing-v20-of-the-official-mcp-csharp-sdk
- https://pkg.go.dev/github.com/modelcontextprotocol/go-sdk/auth
- https://github.com/modelcontextprotocol/java-sdk/blob/main/CHANGELOG.md
- GitHub REST API `repos/{owner}/{repo}` and `/releases/latest` for all repos listed (via `gh api`, 2026-09-02)
- npm: https://api.npmjs.org/downloads/point/last-month/{pkg} and https://registry.npmjs.org/{pkg} (window 2026-07-31→2026-08-29)
- PyPI: https://pypistats.org/api/packages/{pkg}/recent and https://pypi.org/pypi/{pkg}/json

Frameworks
- https://gofastmcp.com/updates ; https://gofastmcp.com/getting-started/upgrading/from-fastmcp-2 ; https://gofastmcp.com/v3/servers/auth/oauth-proxy ; https://gofastmcp.com/servers/auth/remote-oauth ; https://gofastmcp.com/deployment/prefect-horizon
- https://github.com/punkpeye/fastmcp
- https://github.com/QuantGeekDev/mcp-framework
- https://github.com/basementstudio/xmcp ; https://vercel.com/docs/frameworks/backend/xmcp
- https://manufact.com/mcp-use ; https://docs.manufact.com/dashboard/billing
- https://docs.spring.io/spring-ai/reference/api/mcp/mcp-security.html
- https://quarkus.io/blog/secure-mcp-server-oauth2 ; https://docs.quarkiverse.io/quarkus-mcp-server/dev/release-notes.html

Generators / gateways
- https://github.com/harsha-iiiv/openapi-mcp-generator ; https://www.npmjs.com/package/openapi-mcp-generator
- https://www.speakeasy.com/blog/comparison-mcp-server-generators (vendor-authored) ; https://www.speakeasy.com/pricing ; https://www.speakeasy.com/blog/release-standalone-mcp
- https://www.stainless.com/docs/mcp/ ; https://www.stainless.com/docs/mcp/remote ; https://www.stainless.com/changelog/mcp-code-execution-tool ; https://www.stainless.com/pricing ; https://www.stainless.com/products/mcp/
- https://liblab.com/pricing ; https://liblab.com/products/mcp
- https://mcpize.com/ ; https://docs.mcpize.com/
- https://awslabs.github.io/mcp/servers/openapi-mcp-server ; https://github.com/awslabs/mcp/discussions/2615
- https://github.com/apollographql/apollo-mcp-server
- https://github.com/agoda-com/api-agent
- https://github.com/cnoe-io/openapi-mcp-codegen
- https://github.com/mattt/emcee ; https://github.com/Vizioz/Swagger-MCP
- https://github.com/IBM/mcp-context-forge
- https://developer.konghq.com/mcp/ ; https://konghq.com/pricing
- https://tyk.io/tyk-mcp-gateway/
- https://zuplo.com/docs/handlers/mcp-server ; https://zuplo.com/pricing
- https://docs.cloud.google.com/apigee/docs/api-platform/apigee-mcp/apigee-mcp-overview
- https://learn.microsoft.com/en-us/azure/api-management/mcp-server-overview
- https://learning.postman.com/docs/postman-api-network/showcase/publish/mcp-servers/overview
- https://blog.cloudflare.com/code-mode-mcp/ ; https://developers.cloudflare.com/agents/tools/codemode/api-reference

Hosting
- https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/ ; https://developers.cloudflare.com/workers/platform/pricing/ ; https://github.com/cloudflare/workers-oauth-provider
- https://docs.alpic.ai/pricing/plans
- https://smithery.ai/docs
- https://github.com/vercel/mcp-handler ; https://vercel.com/pricing
- https://developers.netlify.com/guides/write-mcps-on-netlify ; https://www.netlify.com/pricing/
- https://fly.io/docs/mcp/
- https://aws.amazon.com/bedrock/agentcore/pricing/ ; https://aws.amazon.com/blogs/machine-learning/how-agentcore-gateway-supports-the-mcp-2026-07-28-spec/
- https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-mcp
- https://docs.cloud.google.com/run/docs/tutorials/deploy-remote-mcp-server
- https://docs.docker.com/ai/mcp-catalog-and-toolkit/mcp-gateway ; https://docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit/ ; https://github.com/docker/mcp-gateway ; https://www.docker.com/pricing/

Auth
- https://auth0.com/blog/auth0-auth-for-mcp-servers-generally-available/ ; https://auth0.com/pricing
- https://workos.com/docs/authkit/mcp ; https://workos.com/pricing ; https://workos.com/blog/best-mcp-server-authentication-providers (vendor-authored)
- https://clerk.com/docs/nextjs/guides/ai/mcp/build-mcp-server ; https://clerk.com/pricing
- https://stytch.com/docs/guides/connected-apps/mcp-servers ; https://stytch.com/pricing
- https://www.descope.com/use-cases/ai ; https://www.descope.com/pricing
- https://www.scalekit.com/pricing
- https://www.keycloak.org/securing-apps/mcp-authz-server
- https://www.ory.com/blog/mcp-server-oauth-with-ory-hydra-authentication-ai-agent-integration-guide ; https://github.com/ory/hydra/issues/2909
- https://logto.io/pricing ; https://logto.io/ai
- https://better-auth.com/docs/plugins/mcp
- https://pomerium.com/docs/capabilities/mcp ; https://pomerium.com/pricing
- https://developer.okta.com/docs/concepts/xaa/ ; https://developer.okta.com/docs/release-notes/2026-okta-identity-engine/

Observability
- https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/mcp.md ; https://github.com/open-telemetry/semantic-conventions-genai/issues/437
- https://blog.sentry.io/introducing-mcp-server-monitoring/ ; https://docs.sentry.io/platforms/javascript/guides/node/mcp-monitoring/
- https://posthog.com/docs/mcp-analytics ; https://posthog.com/docs/mcp-analytics/installation ; https://posthog.com/pricing
- https://agentcat.com/pricing/ ; https://agentcat.com/blog/mcpcat-is-now-agentcat ; https://pypi.org/project/agentcat/
- https://www.datadoghq.com/blog/mcp-client-monitoring
- https://langfuse.com/docs/observability/features/mcp-tracing
- https://arize.com/docs/phoenix/integrations/python/mcp-tracing ; https://arize.com/docs/phoenix/self-hosting/license ; https://arize.com/pricing/
- https://docs.helicone.ai/integrations/tools/mcp
- https://moesif.com/blog/monitoring/model-context-protocol/How-to-Setup-Observability-For-Your-MCP-Server-with-Moesif

Testing / security
- https://github.com/modelcontextprotocol/inspector ; https://github.com/modelcontextprotocol/inspector/releases
- https://github.com/MCPJam/inspector
- https://github.com/modelcontextprotocol/conformance
- https://github.com/wong2/mcp-cli
- https://github.com/snyk/agent-scan (redirect target of invariantlabs-ai/mcp-scan)
- https://github.com/dmore/mcptrustchecker-deterministic-security-scanner-mcp-servers/blob/main/README.md
- https://snyk.io/articles/snyk-mcp-cheat-sheet
- https://github.com/semgrep/mcp (archived 2025-10-28) ; https://semgrep.dev/blog/2025/a-security-engineers-guide-to-mcp

Not retrievable in this pass (JS-rendered or capped): Speakeasy SDK-tier prices, Stainless Starter/Pro prices, Zuplo dollar tiers, Smithery hosting plans, Prefect Horizon paid tiers, Scalekit full-stack-auth MAU tier, Stytch CIMD status, Datadog server-side MCP support.
