# Production MCP Servers — 2026 Best Practices (Research Report)

**Date:** 2026-09-02 · **Audience:** mcpforge maintainers · **Perspective:** the *server developer* (independent of any generator/framework)

**Method.** Web research over official MCP specification pages (2025-11-25 and 2026-07-28), the MCP blog, Anthropic/OpenAI/Cloudflare/Block/Stainless/AWS/Auth0/Docker engineering posts and docs, OWASP, Invariant Labs, Snyk, npm/PyPI docs, arXiv papers, and GitHub issues. Every externally sourced claim carries a numbered citation `[n]` resolving to the Sources section (URL + access date; all accessed 2026-09-02). Claims are tagged:

- **[verified]** — read directly in the cited primary source.
- **[inferred]** — my synthesis/judgement; not stated by a source.
- **[secondary]** — reported by a secondary source (blog/aggregator) that I could not check against the primary.

**Caveats.** (1) Web search hit a rate cap late in the session, so a few intended sources (Speakeasy tool-design posts, the OpenTelemetry MCP span conventions page — it moved to a new repo and the new page did not fetch) are not cited; where I rely on adjacent evidence instead I say so. (2) The `2026-07-28` MCP revision (released five weeks before this report) changes several "best practices" that older blog posts assume. Where guidance differs between spec versions I flag it.

---

## 0. Executive summary

1. **The protocol itself moved under everyone in July 2026.** MCP `2026-07-28` removed the `initialize` handshake, protocol-level sessions and the `Mcp-Session-Id` header, removed SSE resumability, introduced `server/discover`, required `Mcp-Method`/`Mcp-Name` headers, required `ttlMs`/`cacheScope` on list results, deprecated Roots/Sampling/Logging/HTTP+SSE and Dynamic Client Registration, and documented W3C trace-context propagation in `_meta`. [1][2] Anything written about "session handling in Streamable HTTP" before July 2026 is now legacy-lane guidance. **[verified]**
2. **Tool count is the single best-evidenced design lever.** An ICSME 2026 industry paper measures tool-selection accuracy falling below 90% between 10–15 tools (Claude Haiku 4.5) and 20–30 tools (Sonnet 4) [7]; Anthropic reports 58 tools ≈ 55K tokens and up to 134K tokens of tool definitions before optimization [8]; RAG-MCP shows 13.6% baseline selection accuracy in a large-toolset stress test vs 43.1% with retrieval [6]. Block, Anthropic, Cloudflare, Stainless and the FastMCP author all converge on **workflow-first, curated tools, not 1:1 endpoint mapping** [3][4][5][9][10]. **[verified]**
3. **Code execution / "code mode" is now a mainstream alternative, not an experiment.** Anthropic (98.7% token reduction example), Cloudflare (Code Mode) and Stainless (SDK code mode; benchmarked against Cloudflare and Anthropic's approach) all ship it. Stainless explicitly omitted the "one tool per endpoint" server from its benchmark because its shortcomings are "already well documented". [4][9][10] **[verified]**
4. **Security guidance has hardened into MUSTs.** The spec's Security Best Practices page forbids token passthrough, mandates audience-bound tokens, requires secure random session IDs and forbids using sessions for authentication, and adds a scope-minimization section. [11] OWASP now has an MCP Top 10 (beta; next release Oct 2026). [12] The first confirmed malicious MCP server on npm (`postmark-mcp`, Sept 2025) made supply-chain provenance a first-order concern. [13][14] **[verified]**
5. **Marketplaces (Claude Connectors Directory, ChatGPT plugins) enforce concrete server-side rules**: OAuth 2.0 for authenticated services, `title` + `readOnlyHint`/`destructiveHint` on every tool, read/write tools split (a catch-all `api_request(method,...)` tool is rejected), actionable error messages, no conversation-data collection, first-party API ownership, public docs and privacy policy. [15][16][17][18] **[verified]**
6. **Open source is the dominant trust mechanism** but is not sufficient: npm/PyPI provenance attestations prove *where* a package was built, not that it is safe [19][20]; Docker's MCP Catalog now pins every Docker-built server to a Git commit and labels publisher trust levels [21]. **[verified]**
7. **Still painful in 2026:** OAuth client registration interoperability (Claude Code / Codex / OpenCode all have open or recently closed issues about DCR failures) [22][23][24][25]; versioning of tools and servers (no standard; Nordic APIs calls it "the weak point nobody's talking about") [26]; and the migration burden of a breaking spec revision that uses dated versions rather than semver [27]. **[verified]**

---

## 1. Tool design

### 1.1 How many tools is too many? (numbers)

| Source | Finding | Status |
|---|---|---|
| ICSME 2026 industry paper (arXiv 2606.30317; author names "Rodrigues & Vas" reported by [28], not shown in the abstract page I fetched) | Tool-selection accuracy drops below 90% "between 10 and 15 tools per context for Claude Haiku 4.5 and between 20 and 30 tools for Sonnet 4" (observational, production data). Also catalogues four anti-patterns incl. the "God Tool" `do_anything(action, params)`. [7] | verified (abstract); anti-pattern detail and per-model percentages are secondary [28] |
| Anthropic, *Advanced tool use* (Nov 2025) | Five-server example: 58 tools ≈ 55K tokens before conversation; internal tool definitions hit 134K tokens before optimization; most common failures are wrong tool selection and wrong parameters with similar names (`notification-send-user` vs `notification-send-channel`); Tool Search Tool raised Opus 4 MCP-eval accuracy 49%→74% and Opus 4.5 79.5%→88.1%. [8] | verified |
| Gan & Sun, RAG-MCP (arXiv 2505.03275) | In an "MCP stress test", baseline tool-selection accuracy 13.62% vs 43.13% when only retrieved tools are shown; prompt tokens cut >50%. [6] | verified (abstract) |
| MCPGAUGE (arXiv 2508.12566) | Across 6 commercial LLMs and 30 MCP tool suites, automatic MCP access *reduced* accuracy by 9.5% on average and inflated input tokens 3.25×–236.5×. [29] | verified (abstract) |
| Client hard caps (secondary) | Cursor caps 40 tools; GitHub Copilot 128 per request; Playwright MCP's tool list alone consumed ~22% of a 200K context in one measurement. [30] | secondary |
| Anthropic, *Writing tools for agents* | Claude Code restricts tool responses to 25,000 tokens by default. [3] | verified |

**[inferred]** A defensible 2026 rule of thumb for a *single* server: aim for ≤15 tools by default, treat 20–30 as the ceiling for frontier models, and assume the client will be aggregating several servers, so your budget is smaller than it looks. A generator that emits one tool per OpenAPI operation will exceed this for nearly every real API — this is the core critique in [5] and the reason Stainless omitted that design from its benchmark [10].

### 1.2 Workflow-oriented tools vs 1:1 endpoint mapping

- Block (60+ internal MCP servers): "Design top-down from workflows, not bottom-up from API endpoints… Don't expose raw, granular API endpoints like `GET /user` or `GET /file`." Their Linear server went from 30+ endpoint-shaped tools → consolidated `get_issue_info(issue_id, info_category)` → finally two tools `execute_readonly_query` / `execute_mutation_query` taking GraphQL, with the schema supplied via instructions or a `get_linear_graphql_schema` tool. Google Calendar went from thin API wrappers to a DuckDB-backed `query_database` tool with SQL macros. [4] **[verified]**
- Jeremiah Lowin (FastMCP author): "an API built for a human will poison your AI agent… Bootstrap, Don't Deploy… Curate aggressively… Start with the agent story." He reports daily FastMCP issues of the form "the LLM timed out trying to decide between create_invoice and generate_invoice." [5] **[verified]**
- Anthropic: "instead of writing tools and MCP servers the way we'd write functions and APIs for other developers or systems, we need to design them for agents"; principles include choosing which tools *not* to implement, namespacing, returning meaningful context, token-efficient responses, prompt-engineered descriptions. [3] **[verified]**
- Anthropic (Tool Use Examples): JSON schemas "can't express usage patterns" — provide input examples alongside schemas. [8] **[verified]**

### 1.3 Naming and descriptions

- Spec (2025-11-25): names SHOULD be 1–128 chars, case-sensitive, only `A-Za-z0-9_-.`, unique per server. Examples: `getUser`, `DATA_EXPORT_v2`, `admin.tools.list`. [31] **[verified]**
- Claude Connectors Directory: tool names must be ≤64 chars; descriptions must "state precisely what the tool does and when to invoke it" and match actual behavior. [15] Anthropic's internal checklist adds snake/kebab case. [32] **[verified]**
- OpenAI plugin guidelines: names should be verbs (`get_order_status`); descriptions must not favor/disparage other tools, must not encourage over-broad triggering, and unclear descriptions are grounds for rejection. [16] **[verified]**
- Block: "Tool names, descriptions, and parameters are treated as prompts for the LLM"; avoid long names because the model re-generates those tokens on every reference; avoid dynamic content (timestamps) in instructions so prompt-prefix caching works. [4] **[verified]**
- Anthropic: refining tool descriptions alone produced state-of-the-art SWE-bench Verified results for Claude Sonnet 3.5; they discovered Claude appending "2025" to web-search queries and fixed it via the description. [3] **[verified]**

### 1.4 Input schema tightness

- Spec: `inputSchema` MUST be a JSON Schema object; for no-parameter tools the recommended form is `{ "type": "object", "additionalProperties": false }`. Servers MUST validate all tool inputs. [31] In 2026-07-28, `inputSchema`/`outputSchema` may use any JSON Schema 2020-12 keyword, with `$ref` resolution and composition-keyword bounds. [1] **[verified]**
- Block recommends Pydantic-style models with field descriptions for complex parameters. [4] OpenAI requires "minimal and purpose-driven inputs" — no "just in case" context fields, no precise geolocation. [16] **[verified]**
- Block: prefer tools with a single risk level; bundle related *read-only* actions into one tool rather than mixing reads and writes. [4] Claude Directory goes further: a single tool that accepts both safe and unsafe HTTP methods is rejected outright. [15] **[verified]**

### 1.5 Annotations

Schema (2025-11-25) — all four are *hints*, default values in parentheses: `readOnlyHint` (false), `destructiveHint` (true; only meaningful when `readOnlyHint == false`), `idempotentHint` (false), `openWorldHint` (true). "Clients should never make tool use decisions based on ToolAnnotations received from untrusted servers." [33] **[verified]**

How they are actually used in 2026:
- Claude: read-only tools can run without per-call confirmation; destructive tools always prompt; `title` + applicable hint is a hard directory requirement. [15][17] **[verified]**
- OpenAI: `readOnlyHint`, `destructiveHint`, `openWorldHint` must be correct and *justified* at submission; "incorrect or missing action labels are a common cause of rejection"; any action that sends data outside the boundary must be surfaced as a write action. [16] **[verified]**
- Block/Goose uses annotations for "smart approval" and server `instructions` for the system prompt. [4] **[verified]**
- **[inferred]** Because the spec defaults `destructiveHint` to `true`, an un-annotated write tool is treated as destructive — a generator should emit explicit annotations for every tool (e.g. GET→`readOnlyHint:true`; PUT/idempotent DELETE→`idempotentHint:true`; POST create→`destructiveHint:false`), and always `openWorldHint:true` for tools that call an external API.

### 1.6 Structured outputs / `outputSchema`

- Spec: `structuredContent` is a JSON object returned alongside `content`; for backwards compatibility a tool returning structured content SHOULD also return the serialized JSON in a text block. If `outputSchema` is provided, servers MUST conform and clients SHOULD validate. It is explicitly "unrelated to LLM 'structured outputs'". [31] **[verified]**
- Block warns that LLMs are weak at emitting strict-grammar JSON and that Markdown/XML *responses* are often more token-efficient than raw JSON; "if JSON is necessary… keep a simple schema and avoid long lists." [4] **[verified]**
- **[inferred]** `outputSchema` is valuable for downstream code (code mode, client validation, typed SDK generation) more than for the model reading the result. Emitting one generated from the OpenAPI response schema is low-risk *provided* the server actually validates/conforms; emitting a schema the upstream API violates would breach a spec MUST.

### 1.7 Code mode / code execution as an alternative

- Anthropic, *Code execution with MCP* (Nov 2025): present MCP servers as code APIs on a filesystem; "reduces the token usage from 150,000 tokens to 2,000 tokens—a time and cost saving of 98.7%"; benefits: progressive disclosure, filtering results before they reach the model, control flow in code, privacy-preserving intermediate results, state persistence. Cost: needs a sandbox with resource limits and monitoring. [9] **[verified]**
- Cloudflare *Code Mode*: convert MCP tool schemas into a TypeScript API with doc comments; the agent gets one `execute` tool; code runs in an internet-isolated V8 isolate whose only egress is the MCP RPC bindings. Rationale: "LLMs have seen a lot of code. They have not seen a lot of 'tool calls'." [10] **[verified]**
- Stainless *SDK code mode*: model calls `docs_search` then `execute` with SDK code, type-checked before execution. On 31 Increase-API tasks with Claude Opus: Stainless 98% completeness / 95% efficiency / 53% factuality / 48.5s; Anthropic Code Mode 94/82/46/68.7s; Cloudflare 90/95/43/55.9s; a "Dynamic" meta-tool server (`list_api_endpoints`/`get_api_endpoint_schema`/`invoke_api_endpoint`) 70/86/33/65.1s. Vendor-run benchmark — treat as indicative. [10] **[verified; vendor benchmark]**
- Anthropic's API-side answer (Tool Search Tool with `defer_loading`, Programmatic Tool Calling, Tool Use Examples) is client/platform-side, not something a server controls, but servers can help by shipping a small `search_tools`-style discovery tool. [8][9] **[verified]**
- **[inferred]** For an OpenAPI→MCP generator this suggests a third output mode besides "N tools" and "curated M tools": a *code-mode server* exposing `search_docs` + `execute` over a generated typed SDK. It shifts risk from tool bloat to sandboxing.

### 1.8 Pagination and response-size control

- Anthropic: implement "some combination of pagination, range selection, filtering, and/or truncation with sensible default parameter values" for any tool whose responses could be large; offer a `response_format: detailed|concise` enum (their example: 206 vs 72 tokens). [3] **[verified]**
- Block: check byte/char/token size before returning; choose between raising a tool error with a recovery hint (Goose's file tool errors above 400 KB and tells the model to use `sed -n`), truncating with an explicit note, or paginating. [4] **[verified]**
- Claude Directory: "Keep responses reasonably sized for the task. Do not return a full database dump when a summary was requested." [15] **[verified]**
- 2026-07-28: list results MUST carry `ttlMs` and `cacheScope`; `tools/list` SHOULD be deterministic to improve prompt-cache hits; `cacheScope:"public"` on tenant-specific data is a disclosure risk — default to `"private"`. [1][34][35] **[verified]**

### 1.9 Error handling: `isError` vs protocol errors

- Spec: two mechanisms. **Protocol errors** (JSON-RPC) for unknown tools, malformed requests, server errors. **Tool execution errors** (`isError: true` in the result) for API failures, input validation and business-logic errors — these "contain actionable feedback that language models can use to self-correct". Clients SHOULD pass tool execution errors to the model; MAY pass protocol errors. [31] **[verified]**
- 2026-07-28 partitions JSON-RPC server-error codes: `-32000..-32019` implementation-defined, `-32020..-32099` reserved for MCP; resource-not-found moved from `-32002` to `-32602`. [1] **[verified]**
- Anthropic: "prompt-engineer your error responses to clearly communicate specific and actionable improvements, rather than opaque error codes or tracebacks." [3] Both directories reject generic errors ("Internal Server Error", "Bad Request" with no detail). [15][16] **[verified]**
- Security caveat: error messages must not leak internal topology or secrets (see SSRF section of [11]). **[verified]**

---

## 2. Security

### 2.1 Threat catalogue

**OWASP MCP Top 10 (v0.1, beta; next release Oct 2026):** MCP01 Token Mismanagement & Secret Exposure; MCP02 Privilege Escalation via Scope Creep; MCP03 Tool Poisoning (incl. rug pulls, schema poisoning, tool shadowing); MCP04 Supply Chain & Dependency Tampering; MCP05 Command Injection & Execution; MCP06 Prompt Injection via Contextual Payloads / Intent Flow Subversion; MCP07 Insufficient AuthN/AuthZ; MCP08 Lack of Audit & Telemetry; MCP09 Shadow MCP Servers; MCP10 Context Injection & Over-Sharing. [12] **[verified]**

**MCP spec Security Best Practices (2025-11-25):** Confused Deputy (static client ID + DCR + consent cookie), Token Passthrough, SSRF via OAuth metadata, Session Hijacking (prompt injection via shared event queues; impersonation), Local MCP Server Compromise (`npx malicious-package && curl … @~/.ssh/id_rsa`), OAuth Authorization URL validation, stdio in proxy scenarios, Scope Minimization. [11] **[verified]**

**Invariant Labs, Tool Poisoning (Apr 2025):** hidden instructions in tool descriptions ("read `~/.cursor/mcp.json`… pass its content as 'sidenote'"), **rug pulls** (description changed after approval), **shadowing** (a malicious server's description alters behavior of a trusted server's `send_email`). Demonstrated against Cursor. [36] **[verified]**

**Supply chain incident:** `postmark-mcp` on npm added a hidden BCC around v1.0.16 (Sept 2025), exfiltrating every outbound email; described by Snyk as "perhaps the first media coverage case… involving a known and tracked malicious MCP Server". [13][14] **[verified]** The HN thread on the 2026-07-28 release still contains a rant that MCP's `npx …` install culture is indistinguishable from an attacker's payload. [27] **[verified]**

### 2.2 Mitigations the *server* owns

| Risk | Server-side mitigation | Source |
|---|---|---|
| Token passthrough / confused deputy | MUST NOT accept tokens not issued for this server (validate audience); do not forward the client's token upstream; if proxying a third-party API with a static client ID, obtain per-client user consent before forwarding. | [11] |
| Excessive scopes | Progressive, least-privilege scopes; minimal initial set; incremental `WWW-Authenticate scope=` challenges; accept down-scoped tokens; never publish full catalog in `scopes_supported`; never use `*`/`all`; don't treat token scopes as sufficient — enforce server-side authorization. | [11] |
| Session hijack (legacy lane) | Verify authorization on every request; MUST NOT use sessions for auth; secure random session IDs; bind session to user identity. Under 2026-07-28 the session disappears entirely; instead enforce ownership on every server-minted handle and protect `requestState` with HMAC/AEAD. | [11][1][35] |
| Prompt injection via tool results | Spec: servers MUST "sanitize tool outputs"; clients SHOULD validate results before passing to the LLM. Marketplace policy: descriptions must not instruct the model, pull instructions from external sources, or contain hidden/encoded content. Treat upstream API responses as untrusted text. | [31][15] |
| SSRF | Applies mostly to clients fetching OAuth metadata, but a server that fetches user-supplied URLs must allowlist schemes/hosts, block private ranges and cloud metadata IPs, and handle DNS rebinding/redirects. Also: validate `Origin`, bind local servers to 127.0.0.1. | [11][37] |
| Rug pulls | Publish immutable versions; pin dependencies; sign releases; avoid changing descriptions silently; version tool changes (see §3.5). | [36][21][19] |
| Secrets | Never plaintext; use OS keyring for local servers; short-lived scoped credentials; secret scanning; no secrets in logs or tool descriptions. | [4][12] |
| Command injection | Never build shell commands from model-supplied strings; validate all inputs against schema at the boundary. | [12][35] |

### 2.3 Per-user vs shared service credentials

- Block: "Use OAuth whenever possible… trigger the OAuth flow only upon an extension's first use… request the minimum necessary scopes… store tokens in the platform keyring… invalidate stored tokens if an extension is removed or access is revoked." [4] **[verified]**
- Anthropic's directory checklist: OAuth (DCR or CIMD) or `none`; "Static bearer tokens are private-deploy only and block listing. Authless is valid for public-data servers — the server holds any upstream API keys." [32] **[verified]**
- Spec anti-pattern: a server acting as a "pure proxy" that forwards client tokens loses audit attribution and bypasses downstream controls. [11] **[verified]**
- **[inferred]** Rule: a single shared upstream API key is acceptable only when the server exposes public/non-user data or is deployed privately; anything user-specific needs per-user OAuth with the MCP server as its own OAuth resource server.

### 2.4 Containers / sandboxing

- Docker: containerization "provides strong isolation and limits the blast radius of malfunctioning or compromised servers"; the Catalog builds and signs local servers, records SBOMs, and pins each to a Git commit. [21][38] **[verified]**
- Cloudflare runs model-written code in isolates with no internet egress; Anthropic notes code execution "requires a secure execution environment with appropriate sandboxing, resource limits, and monitoring." [10][9] **[verified]**
- Spec: local servers have "direct access to the user's system"; clients MUST show the exact command before one-click install. [11] **[verified]**

### 2.5 Signing and provenance for open-source servers

- **npm:** trusted publishing via OIDC (GitHub Actions, GitLab, CircleCI; npm ≥11.5.1, Node ≥22.14) removes long-lived tokens and auto-generates provenance attestations; otherwise `npm publish --provenance` on a cloud runner with `id-token: write`. Attestations are Sigstore-signed and logged to a public transparency ledger; consumers verify with `npm audit signatures`. Provenance "does not guarantee the package has no malicious code". [19][39] **[verified]**
- **PyPI:** attestations are generated automatically by `pypa/gh-action-pypi-publish` under trusted publishing (keyless Sigstore); "An attestation will tell you where a PyPI package came from, but not whether you should trust it." The March 2026 `litellm` incident (malicious versions uploaded outside the project's CI) is the motivating case for recording publisher identity in lockfiles. [20][40] **[verified; litellm detail is secondary]**
- **Reference implementation:** `modelcontextprotocol/servers` publishes via "OIDC trusted publishing from CI — no registry tokens", ships `SECURITY.md`, and is transitioning MIT→Apache-2.0. [41] **[verified]**
- **Docker MCP Catalog:** `source.commit` pin enforced in CI, propagated into `org.opencontainers.image.revision`; publisher trust levels (official/verified vs community); agentic review of updates. [21] **[verified]**
- **[inferred]** SLSA level language is rarely used in MCP docs; in practice "SLSA-ish" for an MCP server means: build in hosted CI, trusted publishing, provenance attestation, pinned lockfile, commit-pinned container build.

---

## 3. Operations

### 3.1 Transport choice

- Two standard transports: stdio and Streamable HTTP; HTTP+SSE is deprecated (since 2025-03-26, formally Deprecated under the 2026 lifecycle policy). [37][1] **[verified]**
- Streamable HTTP MUST expose a single endpoint (e.g. `/mcp`), MUST validate `Origin` (403 on mismatch), SHOULD bind localhost when local, SHOULD authenticate. [37] **[verified]**
- Marketplaces require remote servers over HTTPS Streamable HTTP; Anthropic says SSE "may" work "for the time being". [17][18] **[verified]**
- **[inferred]** stdio remains right for local, single-user, filesystem/desktop tools and for MCPB/desktop-extension packaging; Streamable HTTP is mandatory for anything multi-user or marketplace-listed. A generator should emit both from one core.

### 3.2 Statelessness and session handling

- **2025-11-25 (legacy lane):** optional `Mcp-Session-Id` assigned at `initialize`; sessions must be secure-random; clients echo the header; servers may expire sessions (404) and support resumability via SSE event IDs / `Last-Event-ID`. Horizontal scaling needed sticky routing or a shared session store. [37][42] **[verified]**
- **2026-07-28:** no handshake, no session header, every request carries protocol version + client capabilities in `_meta`; `server/discover` is mandatory server-side; cross-call state uses server-minted handles passed as ordinary tool arguments; SSE resumability removed — clients re-issue broken calls, so **tools should be idempotent**; server-initiated requests replaced by Multi Round-Trip Requests (`resultType:"input_required"` + opaque `requestState`). [1][2][42] **[verified]**
- AWS: "stateless describes the protocol, not your application"; delete ALB stickiness and DynamoDB/ElastiCache session stores once pre-2026 clients are gone; route/throttle on `Mcp-Method`/`Mcp-Name` headers; Lambda becomes a natural fit. Keep the legacy lane until old-client traffic reaches zero, and log protocol version per request. [42] **[verified]**
- A practitioner on HN reports running ~46 tools stateless (GET→405, everything POST) before the spec allowed it; "most clients coped"; auth got simpler. [27] **[verified; anecdote]**

### 3.3 Rate limiting

- Spec: servers MUST "rate limit tool invocations". [31] **[verified]**
- 2026-07-28 headers enable per-operation throttling at gateways without body parsing. [1][42] **[verified]**
- Anthropic's directory checklist points to abuse-protection guidance (rate limits, IP tiering) for public authless endpoints. [32] **[verified]**
- **[inferred]** Practical layers: per-identity (token subject) limits, per-tool limits (write tools stricter), and upstream-429 translation into an `isError` result with a retry-after hint rather than a protocol error, so the model can back off.

### 3.4 Observability

- 2026-07-28 documents W3C Trace Context (`traceparent`, `tracestate`, `baggage`) in `_meta` (SEP-414) and deprecates protocol-level logging in favor of stderr/OpenTelemetry. [1] **[verified]**
- OpenTelemetry GenAI semantic conventions (including MCP spans) moved to the `semantic-conventions-genai` repository; the original page now redirects. I could not fetch the MCP span page itself. [43] **[verified that it moved; content unverified]**
- OWASP MCP08: maintain detailed, immutable logs of tool invocations, context changes and user-agent interactions. [12] Spec: clients SHOULD log tool usage for audit. [31] **[verified]**
- Anthropic: analyze tool-calling metrics — redundant calls suggest pagination/limit tuning; invalid-parameter errors suggest description fixes. [3] MCP blog quotes vendors saying statelessness "makes it easier for us to add analytics for our customers' MCP servers". [2] **[verified]**
- **[inferred]** Minimum viable telemetry per tool call: tool name, duration, `isError`, response size (bytes/tokens), upstream status, caller identity hash, trace id — with PII redaction before export (see §5).

### 3.5 Versioning without breaking clients

- The protocol uses dated versions, not semver; a one-year-old issue requests semver. [27] The spec now has a feature lifecycle with a minimum 12-month deprecation window and a deprecated-features registry. [1] **[verified]**
- Tool-level versioning has no standard. Spec example names include `DATA_EXPORT_v2`. [31] Issue #1915 ("Document recommended tool versioning and naming patterns…") exists but is closed and its body did not render. [44] Nordic APIs: "an MCP server I use… shipped a breaking API change, and my entire workflow broke"; recommends contract validation, version pinning, resilience testing. [26] **[verified]**
- Spec mechanics available: `notifications/tools/list_changed` (2025-11-25) / `subscriptions/listen` (2026-07-28); `ttlMs` on `tools/list`; deterministic ordering. [31][1] **[verified]**
- Registry `server.json` carries a version and package coordinates so aggregators can track releases. [45] **[verified]**
- **[inferred]** Practical policy: additive changes (new optional params, new tools) are safe; renaming or changing semantics → add a new tool (or `_v2`) and keep the old one for ≥1 release with a deprecation note in its description; publish a CHANGELOG; never silently change scope semantics [11].

### 3.6 Health checks, testing, conformance

- `server/discover` (2026-07-28) doubles as a cheap liveness/capability probe. [1] Older servers: `ping` existed but was removed in 2026-07-28. [1] **[verified]**
- **MCP Inspector**: both directories tell you to "exercise every tool through the MCP Inspector" before submitting. [15] **[verified]**
- **Official conformance suite** (`npx @modelcontextprotocol/conformance server --url …`): suites `active`/`all`/`draft`/`pending`, `--spec-version`, YAML expected-failures baselines with strict exit-code semantics (a passing test still in the baseline fails CI), and a composite GitHub Action. Since 2026 no Standards-Track SEP reaches Final without a conformance scenario. [46][42] **[verified]**
- Anthropic: build an evaluation set of realistic prompt/response pairs and let Claude Code optimize descriptions against it. [3] Stainless open-sourced its eval harness. [10] **[verified]**

---

## 4. Distribution and open source

### 4.1 Why most MCP servers are open source

- The reference servers are MIT/Apache-2.0 and explicitly "educational examples… not production-ready solutions." [41] The Registry supports closed-source servers but requires publicly installable packages or publicly reachable remote URLs; private servers are out of scope. [45] **[verified]**
- Anthropic's directory: plugins "must link a public GitHub repo; closed-source is not accepted"; MCPB open-source clause is "required and not waivable". Remote connectors are not required to be open source. [15] **[verified]**
- Trust argument as practitioners state it: tool descriptions are prompts the user never sees [36]; local servers run with the user's privileges [11]; so the ability to read the code (and verify the published artifact matches it via provenance) is the main lever users have. Even so, an HN commenter argues auditing "would take more time than it takes to actually write it". [27] **[verified quotes; the synthesis is inferred]**

### 4.2 License choice

- The MCP project itself is moving MIT → Apache-2.0 for new contributions (spec, SDKs, reference servers). [41] `openapi-mcp-generator` (mcpforge's upstream) is MIT. **[verified]**
- **[inferred]** Apache-2.0's explicit patent grant and NOTICE handling suit corporate adopters and align with the MCP org's direction; MIT maximizes simplicity. Either is fine for a generated server; matching the MCP org (Apache-2.0) is the defensible default for a template, MIT for maximum permissiveness. mcpforge already supports both (`--license`).

### 4.3 What a trustworthy open-source MCP server repo looks like (2026)

Drawn from the reference repo layout, the directory policies, and supply-chain docs:

1. `README.md` with: what the server does, the **full tool list with annotations**, install/run for stdio *and* HTTP, required scopes/credentials and how they are stored, a **Privacy Policy section** (required for local connectors) and link to public docs. [15][17][41]
2. `SECURITY.md` with a disclosure channel. [41]
3. `LICENSE` (MIT or Apache-2.0). [41]
4. `RELEASING.md` documenting OIDC trusted publishing with no registry tokens. [41]
5. Lockfile committed; dependencies "reasonably current" (Anthropic policy for local servers). [18]
6. CI that runs the official conformance suite and publishes with provenance. [46][19]
7. `server.json` for the MCP Registry, with DNS-verified namespace. [45]
8. A `Dockerfile` and (optionally) a Docker MCP Registry entry with `source.commit` pin. [21]
9. CHANGELOG and a stated tool-versioning policy (§3.5).
10. No OAuth client secrets or API keys in the repo — see 4.5.

**[inferred]** Items 1–7 are directly evidenced; 8–10 are my consolidation.

### 4.4 Publishing channels

- **npm/PyPI** with trusted publishing + provenance (see §2.5). [19][20]
- **Docker MCP Catalog**: 300+ servers; local servers are built and signed by Docker with SBOM; remote entries supported; custom catalogs for orgs. [38][21]
- **Official MCP Registry** (preview): metadata only, points to npm/PyPI/Docker/remote URL; DNS-verified namespaces; consumed by aggregators/marketplaces. [45]
- **Vendor directories**: Claude Connectors Directory (Team/Enterprise org required to submit; community vs verified labels; "verification is not a security audit") [17]; ChatGPT/Codex plugins (verified developer identity, support contact, test credentials). [16]

### 4.5 OAuth secrets in open-source servers

- **The MCP server is an OAuth *resource server*, not the client.** It hosts `/.well-known/oauth-protected-resource` pointing at an external authorization server; the client (ChatGPT, Claude) registers itself via CIMD, DCR or a pre-registered client. [47][48] Therefore a well-designed server repo needs *no* OAuth client secret at all for its own auth. **[verified]**
- CIMD (client ID = HTTPS URL to a JSON metadata document) is now the recommended registration path; DCR is deprecated but kept as fallback; pre-registration for known relationships. Clients use `token_endpoint_auth_method: "none"` + PKCE in the example. [48][49] **[verified]**
- Where the server must itself be an OAuth *client* to an upstream third-party API (proxy pattern), the upstream `client_id`/`client_secret` are deployment configuration (env/secret manager), never committed, and the server must implement its own consent step to avoid the confused-deputy problem. [11] **[verified]**
- Both Claude and ChatGPT allow the *deployer* to supply their own OAuth client ID/secret in connector settings if the server does not support CIMD/DCR. [50][47] **[verified]**
- **[inferred]** Generator implication: emit an authorization-server-agnostic resource-server layer (PRM document, token audience validation, scope challenges) configured entirely by environment variables; ship a `.env.example` and never a default secret.

---

## 5. Multi-tenant / marketplace-ready servers

What changes when strangers connect via claude.ai or ChatGPT:

1. **Identity moves from "the deployer" to "each end user".** Per-user OAuth is mandatory for authenticated services in both directories; static bearer tokens block listing. [17][32] The server must map every tool call to a user identity and enforce ownership on every identifier it minted. [35] **[verified]**
2. **Token storage and revocation.** Access/refresh tokens for upstream APIs must be stored encrypted, keyed by user, refreshed proactively, and invalidated on disconnect/revocation. [4] Client credentials must be keyed by issuer and never reused across authorization servers. [1] Scope elevation events should be logged with correlation IDs. [11] **[verified]**
3. **Audit logs.** OWASP MCP08 and the spec both call for per-invocation logs; marketplaces additionally forbid collecting conversation data "even for logging purposes" and forbid metadata profiling (timestamps, IPs, query patterns) unless disclosed and narrowly scoped. [12][18][16] **[verified]**
4. **Data minimization is a listing requirement, not a nicety.** Tools may not request full chat history or precise location; the server "must not pull, reconstruct, or infer the full chat log". [16][18] **[verified]**
5. **Operational bar.** Public HTTPS domain matching your service; CSP for any UI; test account with populated data; public documentation by launch; predictable errors; low latency; ongoing compliance reviews and health/usage dashboards. [15][16][17][51] **[verified]**
6. **GDPR / EU residency.** Guidance from integration vendors: the LLM host and every hop that can read or replay personal data is a (sub-)processor needing a DPA, SCCs and a transfer impact assessment; recommended architecture is a pass-through (no sync/cache) MCP layer, EU-pinned configuration storage, field-level PII minimization before results reach the model, zero-retention LLM contracts, and EU inference regions (OpenAI EU data-residency projects; Claude via Bedrock/Vertex EU). Residency ≠ sovereignty (CLOUD Act). [52][53] **[secondary — vendor content; legal claims not independently verified]**
7. **Caching pitfalls.** `cacheScope:"public"` on tenant-specific list results lets shared intermediaries leak one tenant's tool list to another; default `"private"`. [42][34] **[verified]**

**[inferred]** For a generator this means: multi-tenant is not "the same server with OAuth switched on". It needs a pluggable identity/session-less user context, an encrypted token store abstraction, structured audit events with redaction, and configuration for data-residency-sensitive logging. Those are runtime concerns that argue for a shared, maintained runtime library rather than re-generated code in every project.

---

## 6. What the community says is still painful in 2026

1. **OAuth interop.** Claude Code fails against servers whose AS lacks DCR ("Incompatible auth server: does not support dynamic client registration"; Slack's official server, Apr 2026) [24]; Codex has the same class of issue open since Mar 2026 [23]; OpenCode's auto-connect path was broken for all OAuth servers (Mar 2026) [25]; a Claude connector failure traced to a PRM `resource` mismatch on the *server publisher's* side (Jul 2026) [22]. CIMD adoption is meant to fix this but is only weeks old as the recommended path. [48] **[verified]**
2. **Tool bloat and auto-generated servers.** Lowin's "Stop converting your REST APIs to MCP" [5], Block's rewrites [4], Perplexity's CTO reportedly moving away from MCP internally over schema overhead (Mar 2026) [54 — secondary], and MCPGAUGE's finding that MCP access *reduced* accuracy on average [29]. **[verified except where marked]**
3. **A breaking protocol revision.** 2026-07-28 removed the handshake, sessions, resumability, `ping`, `logging/setLevel`, and deprecated Roots/Sampling/Logging/DCR; servers must opt in via SDK upgrade; dual-lane operation is needed until old clients disappear; dated versions rather than semver make compatibility hard to track. [1][42][27] **[verified]**
4. **Versioning of tools/servers has no standard**; clients have no reliable way to learn a server updated. [26][44] **[verified]**
5. **Supply-chain trust of `npx`-installed servers.** Real incident (`postmark-mcp`) [13]; HN commentary that the install culture is indistinguishable from malware delivery [27]; Docker's response is commit pinning + trust labels [21]. **[verified]**
6. **Directory friction.** Anthropic's submission portal requires a Team/Enterprise org; verification "is not a security audit"; both directories reject a large class of generated servers by policy (catch-all `api_request` tools, generic errors, missing annotations). [17][15][16] **[verified]**
7. **outputSchema value is debated** (Reddit thread titled "outputSchema in MCP: useful feature or token tax") — I did not read the thread body, so treat as a signal only. [55] **[secondary]**

---

## 7. Implications for mcpforge (generator vs runtime) — [inferred]

- **Standalone generated code wins** for: transparency (users can read every line — the trust argument in §4.1), licensing simplicity, zero runtime dependency on mcpforge, and marketplace review (reviewers see exactly what runs).
- **A runtime framework wins** for: keeping up with breaking spec revisions (the 2026-07-28 migration is exactly the kind of change you want to ship once, not re-generate into N repos), OAuth resource-server plumbing, token stores, audit/telemetry with redaction, rate limiting, conformance-tested transport code.
- **The evidence points to a hybrid**: generate the *thin, reviewable part* (tool catalog, schemas, annotations, upstream call mapping, README/SECURITY/LICENSE/server.json scaffolding) and depend on a *versioned, provenance-signed runtime package* for transport/auth/observability. That is roughly what Stainless and Speakeasy do commercially, and what `openapi-mcp-generator` + the official SDK already approximate.
- **Non-negotiable generator defaults suggested by the evidence**: curated tool selection (never all operations by default), explicit annotations on every tool, split read/write tools, `isError` on every upstream failure, size limits on responses, deterministic `tools/list` with `ttlMs`/`cacheScope:"private"`, no secrets in output, trusted-publishing CI templates, and a conformance-suite step in the generated project's CI.

---

## Production-readiness checklist (2026)

### MUST (blocks production or marketplace listing)
1. ≤ ~15–20 tools per server by default; curate from workflows, not endpoints. [7][4][5]
2. Every tool has `title`, `description` that matches behavior, and explicit `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`. [15][16][33]
3. Read and write operations live in separate tools; no catch-all `api_request(method, path)`. [15]
4. All inputs validated against a tight JSON Schema (`additionalProperties:false` where possible). [31][35]
5. Tool failures return `isError:true` with actionable text; protocol errors only for unknown tool / malformed request. [31]
6. Never accept or forward tokens not issued to this server (audience check); no token passthrough. [11]
7. Per-user OAuth 2.0 for any user-specific data; server acts as resource server with PRM document; no client secrets in the repo. [17][47][48]
8. Least-privilege, progressive scopes; never wildcard scopes. [11]
9. Streamable HTTP over HTTPS for remote; validate `Origin`; bind localhost for local. [37]
10. No collection of conversation data beyond tool inputs; no secrets or PII in logs. [18][16][12]
11. Response-size guardrails (pagination/truncation/limits) on every potentially large tool. [3][4]
12. Dependencies pinned via lockfile and kept current; publish with trusted publishing + provenance. [18][19][20]

### SHOULD (expected of a well-run server in 2026)
13. Target MCP `2026-07-28`: stateless, `server/discover`, `Mcp-Method`/`Mcp-Name`, `ttlMs`/`cacheScope`, MRTR instead of server-initiated requests; keep a legacy lane only while old clients exist. [1][42]
14. Make write tools idempotent (clients now re-issue broken calls). [1][42]
15. Deterministic `tools/list` ordering; `cacheScope:"private"` for anything tenant-specific. [1][34]
16. Emit `outputSchema` + `structuredContent` (with text fallback) where a stable response schema exists. [31]
17. Rate limit per identity and per tool; translate upstream 429s into retryable `isError` results. [31]
18. OpenTelemetry traces with W3C trace-context propagation from `_meta`; structured audit events per call. [1][12]
19. Run the official conformance suite in CI with an expected-failures baseline; exercise every tool in MCP Inspector before release. [46][15]
20. Publish `server.json` to the MCP Registry; provide `SECURITY.md`, `RELEASING.md`, CHANGELOG, privacy-policy section. [45][41][17]
21. Tool versioning policy: additive changes only; new tool/`_v2` for semantic changes; deprecation window ≥ one release. [26][11]
22. Encrypted per-user token store with refresh and revocation on disconnect. [4]

### NICE (differentiators)
23. Offer a code-mode surface (`search_docs` + sandboxed `execute` over a typed SDK) for large APIs. [9][10]
24. Ship a Docker image with commit-pinned build and SBOM; list in Docker MCP Catalog. [21][38]
25. Provide an agent-eval set (realistic prompts + expected outcomes) and iterate descriptions against it. [3]
26. Tool Use Examples / input examples alongside schemas. [8]
27. EU-region deployment option, PII field-level redaction before results reach the model, documented data-flow for DPA reviews. [52][53]

---

## Sources

All accessed 2026-09-02.

1. MCP specification 2026-07-28 — Key Changes (changelog). https://modelcontextprotocol.io/specification/2026-07-28/changelog
2. MCP Blog — "The 2026-07-28 Specification" (release post). https://blog.modelcontextprotocol.io/posts/2026-07-28/
3. Anthropic Engineering — "Writing effective tools for agents — with agents" (Sep 11, 2025). https://www.anthropic.com/engineering/writing-tools-for-agents
4. Block Engineering — "Block's Playbook for Designing MCP Servers". https://engineering.block.xyz/blog/blocks-playbook-for-designing-mcp-servers
5. Jeremiah Lowin — "Stop Converting Your REST APIs to MCP". https://jlowin.dev/blog/stop-converting-rest-apis-to-mcp
6. Gan & Sun — "RAG-MCP: Mitigating Prompt Bloat in LLM Tool Selection via Retrieval-Augmented Generation" (arXiv 2505.03275). https://arxiv.org/abs/2505.03275
7. Rodrigues & Vas — "MCP Server Architecture Patterns for LLM-Integrated Applications" (arXiv 2606.30317, ICSME 2026 industry track). https://arxiv.org/abs/2606.30317
8. Anthropic Engineering — "Introducing advanced tool use on the Claude Developer Platform" (Nov 2025). https://www.anthropic.com/engineering/advanced-tool-use
9. Anthropic Engineering — "Code execution with MCP: building more efficient agents" (Nov 4, 2025). https://www.anthropic.com/engineering/code-execution-with-mcp
10. Cloudflare Blog — "Code Mode: the better way to use MCP". https://blog.cloudflare.com/code-mode/ ; Stainless Blog — "SDK code mode shows SotA accuracy and performance for agents using APIs". https://www.stainless.com/blog/sdk-code-mode
11. MCP specification 2025-11-25 — Security Best Practices. https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices
12. OWASP — "OWASP MCP Top 10" (v0.1 beta). https://owasp.org/www-project-mcp-top-10/
13. Snyk — "Malicious MCP Server on npm postmark-mcp Harvests Emails". https://snyk.io/blog/malicious-mcp-server-on-npm-postmark-mcp-harvests-emails/
14. The Hacker News — "First Malicious MCP Server Found Stealing Emails in Rogue Postmark-MCP Package". https://thehackernews.com/2025/09/first-malicious-mcp-server-found.html
15. Claude Docs — Connectors Directory "Pre-submission checklist / review criteria". https://claude.com/docs/connectors/building/review-criteria
16. OpenAI Developers — "Plugin guidelines" (MCP servers and optional UI in published plugins). https://developers.openai.com/plugins/app-guidelines (also served at https://developers.openai.com/apps-sdk/app-submission-guidelines)
17. Claude Docs — "Submitting to the Connectors Directory" and "Connectors Directory" overview. https://claude.com/docs/connectors/building/submission ; https://claude.com/docs/connectors/directory
18. Anthropic — "Anthropic Software Directory Policy". https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy
19. npm Docs — "Generating provenance statements". https://docs.npmjs.com/generating-provenance-statements/
20. PyPI Docs — "Attestations: Security Model and Considerations". https://docs.pypi.org/attestations/security-model
21. Docker Blog — "Securing the Docker MCP Catalog: Commit Pinning, Agentic Auditing, and Publisher Trust Levels" (Dec 3, 2025). https://www.docker.com/blog/enhancing-mcp-trust-with-the-docker-mcp-catalog/
22. anthropics/claude-ai-mcp issue #560 — DCR failure traced to PRM `resource` mismatch (Jul 2026). https://github.com/anthropics/claude-ai-mcp/issues/560
23. openai/codex issue #15818 — "Remote HTTP MCP OAuth login fails when authorization server does not support dynamic client registration" (Mar 2026). https://github.com/openai/codex/issues/15818
24. anthropics/claude-code issue #52638 — "HTTP MCP servers with OAuth fail when auth server doesn't support dynamic client registration" (Apr 2026). https://github.com/anthropics/claude-code/issues/52638
25. anomalyco/opencode issue #15546 — "Remote MCP servers with OAuth fail with 'No OAuth state saved'" (Mar 2026). https://github.com/anomalyco/opencode/issues/15546
26. Nordic APIs — "The Weak Point in MCP Nobody's Talking About: API Versioning". https://nordicapis.com/the-weak-point-in-mcp-nobodys-talking-about-api-versioning/
27. Hacker News — "MCP 2026-07-28 Specification: transport going stateless" discussion. https://news.ycombinator.com/item?id=49088058
28. ResearchAudio — summary of arXiv 2606.30317 including tool-count table and anti-patterns (secondary). https://researchaudio.io/p/a-new-mcp-patterns-paper-sets-a-10-15-tool-ceiling-most-production-servers-are-already-over-it
29. "Help or Hurdle? Rethinking Model Context Protocol-Augmented Large Language Models" (MCPGAUGE, arXiv 2508.12566). https://arxiv.org/html/2508.12566v1
30. Stefano Demiliani — "Model Context Protocol and the 'too many tools' problem" (Sep 2025). https://demiliani.com/2025/09/04/model-context-protocol-and-the-too-many-tools-problem/
31. MCP specification 2025-11-25 — Server Features: Tools. https://modelcontextprotocol.io/specification/2025-11-25/server/tools
32. anthropics/claude-plugins-official — mcp-server-dev skill, "Connector-directory submission checklist". https://github.com/anthropics/claude-plugins-official/blob/66799ffb/plugins/mcp-server-dev/skills/build-mcp-app/references/directory-checklist.md
33. MCP specification 2025-11-25 — Schema Reference (`ToolAnnotations`). https://modelcontextprotocol.io/specification/2025-11-25/schema
34. MCP specification 2026-07-28 — Server Utilities: Caching. https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching
35. AWS Architecture Blog — "MCP went stateless: Is your AWS MCP server deployment well-architected?" (Aug 2026). https://aws.amazon.com/blogs/architecture/mcp-went-stateless-is-your-aws-mcp-server-deployment-well-architected/
36. Invariant Labs — "MCP Security Notification: Tool Poisoning Attacks" (Apr 1, 2025). https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks
37. MCP specification 2025-11-25 — Transports. https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
38. Docker Docs — "Docker MCP Catalog". https://docs.docker.com/ai/mcp-catalog-and-toolkit/catalog/
39. npm Docs — "Trusted publishing for npm packages". https://docs.npmjs.com/trusted-publishers/
40. pydevtools — "Why pylock.toml Includes Digital Attestations" (litellm March 2026 incident; secondary). https://pydevtools.com/handbook/explanation/why-pylock-toml-includes-digital-attestations
41. GitHub — modelcontextprotocol/servers README and LICENSE (MIT→Apache-2.0 transition; OIDC trusted publishing; SECURITY.md). https://github.com/modelcontextprotocol/servers ; https://github.com/modelcontextprotocol/servers/blob/main/LICENSE
42. Same as 35 (AWS) — session-infrastructure table, self-check, migration path.
43. OpenTelemetry — "Moved: Generative AI semantic conventions" (redirect notice to semantic-conventions-genai repo). https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/
44. modelcontextprotocol/modelcontextprotocol issue #1915 — "Document recommended tool versioning and naming patterns for MCP servers" (closed; body not rendered in fetch). https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1915
45. MCP — "The MCP Registry" (about). https://modelcontextprotocol.io/registry/about
46. GitHub — modelcontextprotocol/conformance README. https://github.com/modelcontextprotocol/conformance
47. OpenAI Developers — Apps SDK "Authenticate your users". https://developers.openai.com/apps-sdk/build/auth
48. MCP specification 2026-07-28 — Authorization: Client Registration (CIMD / pre-registration / DCR deprecated). https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration
49. Auth0 Blog — "Client ID Metadata Documents Are the Future of MCP Client Registration" (Nov 24, 2025). https://auth0.com/blog/cimd-vs-dcr-mcp-registration
50. Claude Docs — "Custom connectors: remote MCP" (OAuth options: hosted CIMD, DCR, own client; header-based API keys). https://claude.com/docs/connectors/custom/remote-mcp.md
51. OpenAI Help — "Prepare and maintain an app for plugin submission" (MCP server requirements: public domain, CSP, universal URL). https://help.openai.com/en/articles/20001040
52. Truto — "EU Data Residency and GDPR Compliance for MCP Servers (2026 Guide)" (vendor; secondary). https://truto.one/blog/how-to-handle-eu-data-residency-and-gdpr-compliance-for-mcp-servers/
53. Frends — "MCP for regulated enterprises: EU data residency, GDPR and sovereign AI integration" (vendor; secondary). https://frends.com/insights/model-context-protocol-mcp-for-regulated-enterprises-eu-data-residency-gdpr-and-sovereign-ai-integration
54. Albato — "How Too Many MCPs Break Your AI Agent" (reports Perplexity CTO remarks, Mar 2026; secondary). https://albato.com/blog/publications/embedded-mcp-context-bloat-hallucinations
55. Reddit r/mcp — "outputSchema in MCP: useful feature or token tax with no…" (title only; not read). https://www.reddit.com/r/mcp/comments/1tauwhh/outputschema_in_mcp_useful_feature_or_token_tax

### Sources searched for but not obtained
- Speakeasy engineering posts on MCP tool design/curation (search rate-limited; only their generator-comparison post surfaced, not used).
- OpenTelemetry GenAI MCP span conventions page in the new `semantic-conventions-genai` repository (fetch failed).
- Full text of arXiv 2606.30317 (abstract only) and 2505.03275 (abstract only).
