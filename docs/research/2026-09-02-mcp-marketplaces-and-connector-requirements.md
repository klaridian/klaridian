# MCP marketplaces, directories and connector programs — what each requires from a server developer (Sep 2, 2026)

Research pass conducted to answer one question for mcpforge: **what does a generated MCP server need to look like (transport, auth, metadata, licensing, hosting) to be listable in the places users actually discover servers** — in particular the two consumer-scale surfaces, claude.ai's Connectors Directory and ChatGPT's plugin/app directory — and whether "open source" is ever a hard requirement.

Method: `web_search` + `web_extract` against official documentation wherever it exists (Anthropic, OpenAI, MCP Registry, Docker, Smithery, Glama, Microsoft Learn, Cursor, GitHub, Cloudflare, Google, Composio). Third-party blog posts were used only for orientation and are marked as such. All URLs and access dates are in the Sources section. Every claim is tagged **[verified]** (read directly on an official page) or **[inferred]** (my reading between the lines, or an undocumented gap).

> Unlike the 2026-08-30 files in this folder (raw subagent JSON dumps), this one is written as prose because the goal is a checklist the generator can be built against, not a signal-strength survey. Source traceability is kept via inline URLs.

---

## 0. Executive answers

1. **Open source is NOT a hard requirement on any of the consumer-scale surfaces (claude.ai Connectors Directory, ChatGPT plugins directory, official MCP Registry, Docker MCP Catalog remote servers, Smithery URL publishing, Glama hosted connectors).** [verified] The official MCP Registry states outright that it "supports both open-source and closed-source servers". Anthropic's directory requires a public GitHub repo **only for plugins**, not for remote MCP servers ("Plugins must link a public GitHub repo; closed-source is not accepted" appears in the plugin-specific bullet of the pre-submission checklist). OpenAI's plugin guidelines never mention source availability.
   - Where open source / public repo **is** effectively required: Docker MCP Catalog *local (containerized)* servers (needs a source repo with a Dockerfile and a permissive license — "MIT or Apache 2 are great, GPL is not"), Glama's *open-source* listing track (clones the GitHub repo and builds it), Cursor plugins (public Git repo), Gemini CLI extensions gallery (public GitHub repo with topic tag), and Anthropic MCPB desktop extensions (the checklist says the "MCPB open-source ... clauses in the Software Directory Terms are required and not waivable" — see §1 caveat). [verified]
   - Net: **open source is a hard requirement only for the local/stdio-style distribution channels; for remote HTTP servers it is irrelevant everywhere.** A closed-source SaaS can be listed in every consumer-facing directory. [verified]

2. **Remote (Streamable HTTP over HTTPS) is the required transport for every consumer-scale directory.** claude.ai's portal "accepts remote MCP servers only" (stdio goes via MCPB bundles or plugins instead); ChatGPT requires "a stable, publicly reachable HTTPS endpoint" that supports Streamable HTTP; Copilot Studio supports only Streamable HTTP; Smithery URL publishing requires Streamable HTTP; Docker's remote type accepts streamable-http or sse. stdio/local is accepted by: the official MCP Registry (npm/PyPI/NuGet/Cargo/OCI/MCPB packages), Docker MCP Catalog local servers, Glama (wraps stdio automatically), Smithery (as an MCPB bundle), Cursor/VS Code/Claude Code/Gemini CLI configs, Anthropic via MCPB. [verified]
   - Rough tally across the 12 targets: **~7 of 12 require or strongly prefer remote HTTP** (Claude Directory, ChatGPT, Copilot Studio/M365 certification, Smithery-URL, Composio Custom MCP, Cloudflare portals, Google Agent Registry endpoints); **~5 accept stdio/local as a first-class path** (MCP Registry, Docker Catalog local, Glama OSS, Cursor/VS Code/Gemini CLI, Anthropic MCPB). SSE is tolerated but deprecated everywhere it is mentioned.

3. **"No auth" (authless) servers are accepted by:** claude.ai Connectors Directory (auth type `none` is "Supported"), ChatGPT developer mode and plugin submission (per-tool `securitySchemes` `noauth`; "Many plugin MCP servers can operate in a read-only, anonymous mode"), the official MCP Registry (auth isn't part of the schema), Docker MCP Catalog (remote servers "without OAuth"), Smithery ("OAuth support (if auth required)"), Copilot Studio wizard (`None` option), Composio Custom MCP (`NO_AUTH`), Cloudflare portals ("support both unauthenticated MCP servers and ... OAuth"). [verified] In other words, **an authless read-only server is listable everywhere**; auth only becomes a gate when the server fronts a user-specific upstream.

4. **When auth IS needed, OAuth 2.1 authorization-code + PKCE (S256) with RFC 9728 protected-resource metadata and RFC 8414 AS metadata is the universal contract.** Both Anthropic and OpenAI now **prefer Client ID Metadata Documents (CIMD, SEP-991/SEP-3149) over Dynamic Client Registration (DCR)**, while still falling back to DCR. Both also offer a "pre-registered / static client credentials held by the platform" path (Anthropic: `oauth_anthropic_creds` by emailing `mcp-review@anthropic.com`; OpenAI: "predefined OAuth client" entered in the portal). Neither supports machine-to-machine `client_credentials`. Static API keys/bearer headers: Anthropic supports them as `static_headers` (beta, org-admin-entered); ChatGPT does **not** accept custom API keys for published plugins; Copilot Studio and Composio accept API-key-in-header. [verified]

5. **Fees / revenue share:** none documented on Anthropic, OpenAI, MCP Registry, Docker, Smithery, Glama directory listing, Cursor, GitHub, Gemini CLI. The only fee found is **mcp.so's optional $39 one-time "paid submission"** for immediate publishing + badge (free submission with review exists too). OpenAI restricts commerce inside plugins to physical goods via its Agentic Commerce Protocol; Anthropic bans financial-transaction connectors entirely. [verified]

---

## 1. Anthropic — Claude Connectors Directory (claude.ai / Desktop / Mobile / Cowork / Claude Code) + Claude Code MCP config

Official pages: `claude.com/docs/connectors/building/submission`, `.../review-criteria`, `.../authentication`, `.../directory-vs-custom`, `.../verification`, Software Directory Policy & Terms (support.claude.com). All read 2026-09-02.

| Dimension | Finding | Status |
|---|---|---|
| (a) Open source / public repo | **Not required for remote MCP servers.** The checklist requires a public GitHub repo only for *plugins* ("closed-source is not accepted" is in the Plugins bullet). For MCPB desktop extensions the checklist says "MCPB open-source and 'spec will evolve' clauses in the Software Directory Terms are required and not waivable" — but the current Terms page text does not literally contain an open-source clause; the requirement is presumably enforced via the separate MCPB submission form. | verified (remote); **unclear** (MCPB — clause referenced but not found in Terms text) |
| (b) Transport | Portal "accepts remote MCP servers only"; server URL must be `https://`; transport selectable as **streamable HTTP or SSE**; Policy §5.F: remote servers *should* support Streamable HTTP, SSE "may" be supported "for the time being" and "will be deprecated". Local servers go through **MCPB** (`.mcpb` zip with `manifest.json`) or plugins. | verified |
| (c) Auth | Supported types: `oauth_cimd` (out of the box), `oauth_anthropic_creds` (Anthropic-held static client id/secret — email `mcp-review@anthropic.com`), `custom_connection` (user supplies URL/creds; per-partner), `static_headers` (API key / bearer entered once by org admin; beta; `authorization` and `x-api-key` header names pre-approved, others reviewed), `none` (supported; partial-auth mode experimental). Policy §5.D: authenticated remote servers **must use OAuth 2.0** with certs from recognized CAs. **PKCE S256 is always sent** and the AS must advertise `code_challenge_methods_supported: ["S256"]`. **CIMD is selected only if AS metadata has both `client_id_metadata_document_supported: true` and `"none"` in `token_endpoint_auth_methods_supported`; otherwise falls back to DCR.** DCR discouraged for high-traffic servers (one client registration per fresh connection). Machine-to-machine `client_credentials` **not supported**. Tokens in URL query strings not recommended / prohibited by spec. Must return **401 + `WWW-Authenticate: Bearer resource_metadata="…"`** (401 on 200 is ignored). PRM `resource` must exactly match the URL the user enters. Only the **first** `authorization_servers` entry is used. `/token` must accept `application/x-www-form-urlencoded`. Refresh tokens: rotate or sender-constrain for public clients; `offline_access` appended if advertised. **Redirect URIs to allow:** `https://claude.ai/api/mcp/auth_callback` (all hosted surfaces); Claude Code uses RFC 8252 loopback `http://localhost:<ephemeral>/callback` and `http://127.0.0.1/callback` — AS must accept both with the port ignored; Claude Code identifies itself via its own CIMD at `https://claude.ai/oauth/claude-code-client-metadata`. Discovery/registration/token endpoints must answer within **10 s** (refresh 30 s) and be reachable from Anthropic's published egress IPs. Directory connectors use a **single shared OAuth app** per connector (no per-org client); custom connectors may take an admin-supplied client id/secret. | verified |
| (d) Hosting | You host it. No managed hosting offered. "Anthropic does not run a third-party connector's servers." Per-tenant URLs (`{tenant}.mcp.example.com`) are not templated — handled as separate entries or `custom_connection`. | verified |
| (e) Review | Submission portal at `claude.ai/admin-settings/directory/submissions/new` — requires a **Team or Enterprise organization** and Owner (or Enterprise custom role with Directory permission). Submitted servers are **auto-scanned for policy compliance and listed by default as "Community"**; Anthropic may **escalate high-value listings to "Verified" review** (functional test of every tool, "higher touch and slower") — escalation is automatic, no action needed. "Review times vary with queue volume"; no SLA published. Escalation email `mcp-review@anthropic.com`. Reviewer needs a **fully populated test account** with credentials that work end to end. 7 mandatory policy attestations. Listing slug is permanent. Post-publication dashboard shows health and usage metrics. Anthropic "may remove … at any time for any reason". | verified |
| (f) Cost | No fee, no revenue share documented. Prohibited: connectors that transfer money/crypto or execute financial transactions; AI image/video/audio generation as primary purpose; ads/sponsored content. Grants Anthropic a royalty-free license to display your name/logo/descriptions. | verified |
| (g) Branding / metadata | Listing fields: server name ≤100 chars, tagline ≤55, description ≤2,000, 1–5 categories, documentation URL, privacy-policy URL, support contact, icon, URL slug. MCP Apps additionally need 3–5 PNG carousel screenshots ≥1000 px wide (no prompt in image, paired prompt text, no video/GIF). Icon format/size **not specified** in docs. Public documentation (blog post or help article is enough) required by publish date. Must follow Anthropic Trademark Guidelines; no implying partnership. | verified (fields); icon spec: **undocumented** |
| (h) Tool-design rules enforced | **Every tool needs `title` + applicable `readOnlyHint` / `destructiveHint`** (missing annotations are flagged in the portal before you can submit). **Tool names ≤ 64 chars.** **A catch-all tool that mixes safe (GET/HEAD/OPTIONS) and unsafe (POST/PUT/PATCH/DELETE) HTTP methods is rejected** — "Do not ship a catch-all `api_request` tool with a `method` parameter"; split reads from writes, ideally create/update/delete separately. Freeform-query tools must name/link the target API. Descriptions must be narrow, accurate, non-manipulative (no instructing Claude to call other tools, no hidden/encoded instructions). Token frugality (§5.B). Generic "Internal Server Error" responses fail review. Must call your own first-party API (or one you legitimately proxy) and the MCP domain should match your service. No maximum tool count published. | verified |

**Claude Code specifics** (`code.claude.com/docs/en/mcp`): `claude mcp add --transport http <name> <url>` is the recommended path (Streamable HTTP; `streamable-http` accepted as alias for `http` in JSON); `--transport sse` supported but deprecated; stdio via command; `--header "Authorization: Bearer …"` for static tokens; OAuth flow runs locally with loopback redirect (see (c)). Directory connectors "use the same MCP infrastructure as Claude Code". [verified]

**Key implication for mcpforge:** an OpenAPI → MCP mapping that emits one tool per operation already satisfies the read/write split *provided* annotations are set correctly (`readOnlyHint: true` for GET-derived tools, `destructiveHint: true` for DELETE and ideally destructive PUT/PATCH/POST). Anything resembling a generic `call_api(method, path)` tool is an automatic rejection. [inferred from verified rules]

---

## 2. OpenAI — ChatGPT plugins / Apps SDK directory, developer-mode MCP, Deep Research connectors

Official pages: `developers.openai.com/plugins/deploy/submission`, `/plugins/deploy/app-review`, `/plugins/app-guidelines`, `/plugins/build/auth`, `/plugins/build/mcp-server`, `help.openai.com/.../developer-mode-and-mcp-apps-in-chatgpt`. Read 2026-09-02. Note: as of 2026 "apps" are submitted and published as **plugins**; a plugin can be MCP-only, skills-only or both, and lands in a **universal Plugins Directory shared by ChatGPT and Codex**.

| Dimension | Finding | Status |
|---|---|---|
| (a) Open source | **Not required.** No mention of source availability anywhere in guidelines or submission docs. What *is* required is **verified developer or business identity** in the OpenAI Platform dashboard (publishing under an unverified name → rejection). | verified |
| (b) Transport | "Deploy the MCP server at a stable, publicly reachable HTTPS endpoint … must support the MCP streamable HTTP transport, respond at a stable URL typically ending in `/mcp`." Local servers cannot be connected directly; **Secure MCP Tunnel** exists for private servers in developer mode but "does not satisfy public submission requirements". Origin (scheme/host/port) change = new plugin. | verified |
| (c) Auth | OAuth 2.1 authorization-code + **PKCE S256** (AS must publish `code_challenge_methods_supported: ["S256"]`). Client identification options: **CIMD (preferred)**, **DCR**, or a **predefined OAuth client** (you enter client id/secret in the portal). CIMD document: stable `https://chatgpt.com/oauth/client.json` when your AS supports RFC 9207 issuer identification, else `https://chatgpt.com/oauth/{callback_id}/client.json`. **Redirect URIs:** stable `https://chatgpt.com/connector_platform_oauth_redirect` (if AS supports `authorization_response_iss_parameter_supported: true` and returns `iss`), else callback-ID-specific `https://chatgpt.com/connector/oauth/{callback_id}` — copy the exact value shown in the app management page. Token endpoint auth: `none` (public) or `private_key_jwt` (ChatGPT publishes JWKS at `/oauth/jwks.json`). Must host RFC 9728 PRM on the MCP server, echo `resource` into `aud`, verify token per request. **No machine-to-machine grants (client_credentials, service accounts, JWT bearer), no custom API keys, no customer mTLS certs** — but OpenAI *offers* OpenAI-managed mTLS so your server can verify the caller is ChatGPT. Per-tool `securitySchemes`: `noauth` and/or `oauth2` — anonymous read-only tools are explicitly fine. Refresh tokens: advertise `offline_access` or users get logged out. Enterprise workspace domain restrictions need an OIDC UserInfo endpoint returning `email` + `email_verified`. | verified |
| (d) Hosting | You host it. No managed hosting. Any infra (serverless/container/edge) as long as it streams and is reachable; publish IP allowlist ranges available. **Domain verification** required: serve the exact token at `https://<mcp-host or parent>/.well-known/openai-apps-challenge`. **Template (per-tenant) URLs** (`https://{workspace}.example.com/mcp`) only for "trusted developers with whom we have an established relationship"; everyone else submits one universal URL. **EU-data-residency projects cannot submit** (use a global-residency project). | verified |
| (e) Review | Portal at `platform.openai.com/plugins`; needs `api.apps.write`. "Scan Tools" snapshots tool names/descriptions/schemas/annotations/`_meta`/server `instructions` — the published plugin runs against this **frozen metadata snapshot**; changing tools = new version + re-review. Must supply **≥5 positive and ≥3 negative test cases**, demo credentials that work **without MFA/SMS/email confirmation/private network**, starter prompts, country availability. Automated scans + manual review; "Review timelines may vary … do not contact support to request expedited review." Email notification on approve/reject; appeal by replying. After approval **you** press Publish. One version in review and one published at a time per server. Press releases must be coordinated with `press@openai.com`. Developer-mode (Business/Enterprise/Edu; Pro read-only) lets an org run unpublished servers privately with no review. | verified |
| (f) Cost | No listing fee or revenue share documented. Commerce **only for physical goods** via external checkout / Agentic Commerce Protocol; digital goods, subscriptions, tokens, credits forbidden inside the plugin; no ChatGPT-specific surcharges; no ads. Trial/demo plugins rejected. "Unofficial connectors to third-party services, including pass-through intermediary layers" are **not approvable**. | verified |
| (g) Branding / metadata | Plugin name, short + long description, **logo** ("production-ready brand assets"; no pixel spec found), category, website, support URL, privacy-policy URL, terms URL — all public and matching publisher identity. Screenshots optional and *only* for plugins with UI. Names must not be generic dictionary words unrelated to the brand. Suitable for ages 13+. | verified (icon spec undocumented) |
| (h) Tool-design rules enforced | Every tool must have accurate **`readOnlyHint`, `openWorldHint`, `destructiveHint`** with a written justification per tool; wrong/missing labels are "a common cause of rejection" and justifications cannot override server-advertised values. Tool names unique, verb-like plain language (`get_order_status`), no promotional/comparative names (`best`, `official`). No fields that manipulate model selection of other plugins ("fair play"). **Response minimization**: no telemetry/internal IDs (session/trace/request IDs, timestamps, logs) in tool output unless needed. **Input minimization**: no "just in case" fields; never request raw location. No Restricted Data (PCI, PHI, gov IDs, credentials). Must not reconstruct chat history. `search`/`fetch` tools are **no longer required** (only for Deep Research / company-knowledge use). No max tool count published. | verified |

**Deep Research / connectors nuance:** Deep research can use custom apps for read/fetch only; Agent mode does not use custom apps; OpenAI-built first-party apps are search-only. [verified]

**Key implication for mcpforge:** OpenAI's "response minimization" rule directly conflicts with returning raw upstream API payloads verbatim — a generated server that echoes full JSON responses including internal IDs/timestamps may be rejected. mcpforge's tool-curation and (future) response-shaping features are relevant here. [inferred]

---

## 3. Official MCP Registry (`registry.modelcontextprotocol.io`) and `server.json`

Official pages: `modelcontextprotocol.io/registry/{about,quickstart,authentication,package-types,faq}`, repo docs `official-registry-requirements.md`, `generic-server-json.md`. Still labelled **preview** ("breaking changes or data resets may occur"). Read 2026-09-02.

| Dimension | Finding | Status |
|---|---|---|
| (a) Open source | **Explicitly not required**: "supports both open-source and closed-source servers … as long as the installation method is publicly available (npm package, public Docker image) *or* the server itself is publicly accessible (remote server not restricted to private networks)." Private-network servers and private package registries are not accepted. `repository` field is optional. | verified |
| (b) Transport | Both. `packages[]` entries carry `transport.type` = `stdio` (or `streamable-http`/`sse` for packages that run an HTTP server locally); `remotes[]` entries carry `type: streamable-http` / `sse` + `url`. Package types supported: **npm (registry.npmjs.org only), PyPI, NuGet, Cargo/crates.io, OCI (Docker Hub, ghcr.io, *.pkg.dev, *.azurecr.io, mcr.microsoft.com), MCPB (GitHub/GitLab Releases)**. | verified |
| (c) Auth | Auth is **not modelled** beyond `environmentVariables[].isSecret` / headers for remotes; the registry is metadata only and does not connect to your server. Publisher authentication is what matters: **GitHub OAuth device flow** → namespace `io.github.<user-or-org>/*`; or **domain auth** via DNS TXT (`v=MCPv1; k=ed25519; p=…`) or HTTP `/.well-known/mcp-registry-auth` → reverse-DNS namespace `com.example/*`. Keys can live in Google KMS / Azure Key Vault. | verified |
| (d) Hosting | Registry hosts **metadata only**, never artifacts. You publish the package to npm/PyPI/etc. or host the remote yourself. Not designed for self-hosting the registry itself (private registries should implement the OpenAPI spec instead). | verified |
| (e) Review | **No human review.** Validation is automated: namespace ownership, **package ownership proof** (npm: `mcpName` field in `package.json` must equal the server name; PyPI/NuGet: `mcp-name: <server-name>` string in README — may be an HTML comment; Cargo: must be *visible* text since crates.io strips comments; OCI: `io.modelcontextprotocol.server.name` image label), restricted registry base URLs, `_meta` limited to `io.modelcontextprotocol.registry/publisher-provided`, **4 KB JSON size limit**, strict character limits/regex on free-form fields. Versions are immutable once published; "delete" is a soft status (`mcp-publisher status --status deleted`). Moderation policy allows manual takedown of spam/malicious entries. Security scanning is delegated to the package registries and downstream aggregators. | verified |
| (f) Cost | Free. | verified |
| (g) Branding / metadata | `name` (reverse-DNS namespace/name), `description`, optional `title`, `websiteUrl`, `repository{url,source,subfolder}`, `version`, `packages[]`/`remotes[]`, `$schema` (current `2025-12-11`), `icons` supported in recent schema. No review of icon quality. | verified (icons field: **inferred** from schema evolution — verify against `server.schema.json` before relying on it) |
| (h) Tool rules | None — the registry does not introspect tools. | verified |

**Ecosystem role:** intended to be consumed by aggregators (GitHub MCP Registry, PulseMCP, Glama, Docker community registry all ingest it) rather than by end-user clients directly. **Publishing here does NOT surface a server in claude.ai** ("The Anthropic Directory is independent of the open MCP Registry … Publishing to those does not surface your server in Claude") and does not surface it in ChatGPT. It **does** auto-populate GitHub's MCP Registry / VS Code "MCP" gallery and PulseMCP. [verified]

**Key implication for mcpforge:** generating a `server.json` (npm package type + optional `remotes[]` entry), setting `mcpName` in the generated `package.json`, and documenting `mcp-publisher login github && mcp-publisher publish` is a cheap, high-leverage feature — it is the single upstream feed for GitHub/VS Code, PulseMCP, Glama and Docker's community registry. [inferred]

---

## 4. Docker MCP Catalog / MCP Toolkit (`hub.docker.com/mcp`, `github.com/docker/mcp-registry`)

Official pages: `docker/mcp-registry/CONTRIBUTING.md`, `docs.docker.com/ai/mcp-catalog-and-toolkit/catalog/`. Catalog is labelled **Beta**. Read 2026-09-02.

| Dimension | Finding | Status |
|---|---|---|
| (a) Open source | **Local (containerized) servers: yes in practice** — "Require a Dockerfile in the source repository"; PR process says "Make sure that the license of your MCP Server allows people to consume it. (MIT or Apache 2 are great, GPL is not)"; `source.project` + `source.commit` point at a GitHub repo Docker builds from (you may instead supply your own pre-built `--image`, which relaxes the source requirement but loses Docker-built signatures/SBOM/provenance). **Remote servers: no source required** — just a public HTTPS endpoint, docs URL, transport, OAuth yes/no. | verified |
| (b) Transport | Local: stdio inside a container (Docker builds and runs it, lists tools at build time or reads a `tools.json`). Remote: `streamable-http` or `sse`. | verified |
| (c) Auth | Local: env vars + secrets declared in `server.yaml` (`config.secrets`, `config.env`); users enter them in Docker Desktop UI. Remote: `oauth:` block (provider/secret/env) → Toolkit runs `docker mcp oauth authorize` through the browser; **no-OAuth remote servers are fine** (example: Cloudflare Docs). No DCR/CIMD details documented in CONTRIBUTING. | verified |
| (d) Hosting | Local: Docker builds and hosts the image in Docker Hub `mcp/` namespace (signed, SBOM, provenance, auto security updates) unless you bring your own image. Remote: you host. | verified |
| (e) Review | GitHub PR to `docker/mcp-registry` with `servers/<name>/server.yaml` (+ `tools.json`, `readme.md` for remote). CI must pass; **every PR requires Docker team review**; test credentials via a Google Form. "Upon approval your entry … will be available in 24 hours" in the catalog, Docker Desktop MCP Toolkit and Hub `mcp` namespace. Wizards `task wizard` / `task remote-wizard`; Claude Code helper `cat add_mcp_server.md \| claude`. | verified |
| (f) Cost | Free; contributions licensed MIT. | verified |
| (g) Branding / metadata | `about.title`, `about.description`, `about.icon` (URL — examples use GitHub avatar or favicon service), `meta.category`, `meta.tags`, docs URL. No icon size spec. | verified |
| (h) Tool rules | Build step must be able to `tools/list` (or provide `tools.json`). No design rules published. | verified |

---

## 5. Smithery (`smithery.ai`)

Official page: `smithery.ai/docs/build/publish`. Read 2026-09-02.

| Dimension | Finding | Status |
|---|---|---|
| (a) Open source | **Not required.** Two paths: (1) **URL** — "Bring your own hosting — Smithery Gateway proxies to your upstream server"; (2) **Local (MCPB bundle)** — upload a `.mcpb`. Neither asks for source. | verified |
| (b) Transport | URL path: **Streamable HTTP** required. Local path: stdio packaged as MCPB. | verified |
| (c) Auth | "OAuth support (if auth required)". **"No client registration needed. Smithery handles client registration automatically via Client ID Metadata Documents."** Server must return **401 (not 403)** to unauthenticated requests so RFC 9728 discovery works. Custom config schema (`--config-schema`) for API-key style session config. | verified |
| (d) Hosting | URL path: you host (docs point to xmcp framework or **Gram** for hosting). Smithery's own container hosting from GitHub existed historically (DeepWiki mentions `smithery.yaml` custom containers) but the current Publish doc only documents URL + MCPB; treat hosted deployment as **unclear/possibly deprecated**. | verified (current doc); hosting status **unclear** |
| (e) Review | Automated scan of tools/prompts/resources (`SmitheryBot/1.0`, from Cloudflare Workers IPs — WAF/Bot Fight Mode blocks it; whitelist or serve a static server card). Fallback: `/.well-known/mcp/server-card.json` (SEP-1649). Post-publish "Settings → Verification" gives an automatic official-vendor checklist. No human review described. | verified |
| (f) Cost | None documented for listing. | verified |
| (g) Metadata | Name `@org/server`, homepage, GitHub link, config schema; icon not specified. | verified |
| (h) Tool rules | None enforced. | verified |

---

## 6. Glama (`glama.ai`)

Official pages: `glama.ai/mcp/methodology`, `glama.ai/mcp/hosting`. Read 2026-09-02.

| Dimension | Finding | Status |
|---|---|---|
| (a) Open source | Two tracks. **Open-source servers:** maintainer must authenticate with GitHub OAuth and have write/admin on the repo; Glama clones the repo, builds it from a Dockerfile (authored or AI-inferred) in a Firecracker microVM, and **withholds distribution if the build fails**. **Hosted connectors:** closed-source remote servers indexed by connecting as an MCP client with maintainer-provided **sandbox credentials**. So: OSS required for the OSS track only. Glama also ingests the entire official MCP Registry ("superset"). | verified |
| (b) Transport | OSS: stdio (run in sandbox). Connectors: `streamable-http`. Glama hosting wraps stdio servers into Streamable HTTP automatically. | verified |
| (c) Auth | Connectors implementing **OAuth 2.1 DCR (RFC 7591) are auto-registered without human intervention**; otherwise API keys/OAuth tokens/test accounts supplied by maintainer. Glama hosting gateway manages OAuth 2.1 with refresh and per-profile access tokens. | verified |
| (d) Hosting | Optional **managed hosting** (Dockerfile/npm/PyPI or GitHub repo → dedicated machine + Gateway endpoint `https://glama.ai/endpoints/<profile>/mcp`, private by default, flip to public = directory listing). Pricing not found in the docs read. | verified (hosting exists); price **not found** |
| (e) Review | Fully automated continuous pipeline: protocol introspection (`tools/list` etc. incl. annotations), syscall/network behavioural analysis (Malicious → internal review/de-list; Risky → shown publicly), schema-drift + prompt-injection diffing for connectors, re-scan on every commit. | verified |
| (f) Cost | Directory listing free; hosting presumably paid (not verified). | inferred |
| (g) Metadata | From repo/`glama.json`; all scores public. | verified |
| (h) Tool rules | **Tool Definition Quality Score (TDQS)** — six 1–5 dimensions (Purpose Clarity, Usage Guidelines, Behavioral Transparency, Parameter Semantics, Conciseness, Contextual Completeness) plus tool-set coherence and server cohesiveness scores, displayed publicly with gap analysis. Not a gate, but a ranking signal. Glama's own research: "97% of tools contain at least one defect … well-written descriptions are selected 260% more often". | verified |

---

## 7. Aggregators — mcp.so and PulseMCP

**mcp.so** (`mcp.so/submit?type=server`, read 2026-09-02): form takes **Repository URL (required)** + name. Free submission with review, or **paid submission: $39 one-time** → "publish immediately without review", verified badge, featured placement, dofollow link. Open source not formally required but the form's required field is a repo URL, so remote-only closed-source servers fit awkwardly. No transport/auth requirements (it's a link directory). [verified]

**PulseMCP** (`pulsemcp.com/submit`, read 2026-09-02): "submissions and changes are temporarily paused … until mid-August [2026]" while ingestion is reworked; the page still showed the notice on 2026-09-02. Their instruction: **"publish it to the Official MCP Registry … we will pick it up automatically once we are back."** PulseMCP also sells an enriched partner REST API. No requirements of their own beyond the official registry's. [verified]

---

## 8. Cursor, VS Code, GitHub Copilot / GitHub MCP Registry

**Cursor** (`cursor.com/docs/mcp`, `cursor.com/docs/reference/plugins`, read 2026-09-02): supports `stdio`, `SSE`, `Streamable HTTP`; remote transports use OAuth; stdio auth "Manual". Discovery is via the **Cursor Marketplace (official plugins, reviewed by the Cursor team)** and the community-run **cursor.directory**. Marketplace reviews **plugins, not bare MCP servers**: plugin = `.cursor-plugin/plugin.json` (or Agent Plugins standard `plugin.json`) in a **public Git repository**, with `mcp.json`, `${VAR}` placeholders declared in a `variables` schema (secrets never in repo), logo committed to repo as relative path, README, unique kebab-case name. No review SLA, no fee documented. → Public repo required (the plugin repo, which can point at a remote MCP URL — the *server* itself need not be open source). [verified]

**VS Code / GitHub Copilot** (`code.visualstudio.com/mcp` = `github.com/mcp`, GitHub blog, docs.github.com, read 2026-09-02): the **GitHub MCP Registry** (~251 servers on 2026-09-02) is the curated list shown in VS Code's MCP gallery with one-click install; "each server is backed by its GitHub repository", sorted by stars. GitHub stated developers "self-publish to the OSS MCP Community Registry [and] those servers will automatically appear in the GitHub MCP Registry". There is no separate submission form; the path is the official registry. Enterprises can also point Copilot at a **private registry** implementing the `v0.1` MCP Registry API (`GET /v0.1/servers`, `/versions/latest`, `/versions/{version}`) with CORS headers. VS Code itself accepts stdio, Streamable HTTP and SSE with OAuth. [verified]

---

## 9. Microsoft Copilot Studio / M365 Copilot / Azure

Official pages: `learn.microsoft.com/.../mcp-add-existing-server-to-agent` (updated 2026-05-28), `learn.microsoft.com/.../mcp-certification` (preview, updated 2026-07-17). Read 2026-09-02.

**Bring-your-own (uncertified) in Copilot Studio:** wizard takes name, description, **Server URL**; transport **Streamable HTTP only** ("no longer supports SSE for MCP after August 2025"); auth **None / API key (header or query) / OAuth 2.0** with three OAuth sub-modes: *Dynamic discovery* (DCR + discovery), *Dynamic* (DCR without discovery — endpoints entered manually), *Manual* (static client id/secret etc.). Alternatively register via Agents 365 CLI + M365 Admin Center ("BYO MCP server"). [verified]

**Microsoft MCP server certification (preview):** the only formal "connector program" in this list with a partner-style bar.
- (a) Open source: **not required**, but **publisher must be a verified Partner Center business, enrolled in the M365 & Copilot program, and must own or control the MCP endpoint** — "independent publishers who don't own the underlying service are not eligible". [verified]
- (b) Transport: remote (endpoint URL in manifest); Streamable HTTP by implication of Copilot Studio support. [verified/inferred]
- (c) Auth: OAuth2 / Azure AD with **static client credentials stored in an Azure Key Vault** the publisher owns (`ClientId`, `ClientSecret`, `TokenUrl`, `AuthorizationUrl`, optional `RefreshUrl`, `Scopes`, `AzureActiveDirectoryResourceId`), read by Microsoft's service principal `8e91e74f-afe9-41cd-8c3f-17a9562a74ea` during validation. No DCR/CIMD mentioned. [verified]
- (d) Hosting: you host. [verified]
- (e) Review: Partner Center offer type **"Apps and Agents for M365 and Copilot"**; package = Teams-style **manifest JSON** (`MicrosoftTeams.schema.json` devPreview), tool definitions file, `intro.md`, icons, support/privacy/terms links, test credentials, optional evaluation evidence; **automated validation** then manual review; ASCII-only header names. No timeline published. Publishes to Copilot Studio, **Azure Foundry**, M365 Admin Center. Resubmit on tool additions or significant behaviour changes. [verified]
- (f) Cost: none documented (Partner Center account required). [verified]
- (g) Branding: must follow **Teams Store icon guidance** (color + outline icons, sizing, safe area, contrast). [verified]
- (h) Tool rules: none beyond "test MCP tools before submission". [verified]

---

## 10. Cloudflare

Official pages: `developers.cloudflare.com/agents/model-context-protocol/...`, `developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/`. Read 2026-09-02.

Cloudflare runs **no public third-party MCP directory**. What exists: (1) Cloudflare's *own* catalog of ~13+ managed remote MCP servers (`mcp.cloudflare.com/mcp`, docs, etc.); (2) Workers templates (`remote-mcp-authless`, OAuth-enabled) and the `agents` SDK for **hosting** your remote MCP server — i.e. Cloudflare is a hosting option, not a listing; (3) **MCP server portals** (Cloudflare One / Zero Trust) — an *enterprise-internal* aggregator that fronts multiple upstream servers (authless or OAuth) behind one Access-protected endpoint with Streamable HTTP/SSE auto-detection, tool aliasing, "Code Mode" (collapses all tools into one `code` tool to keep context fixed), and 2-hourly tool sync. Requirements for an upstream server to be added to a portal: public or Access-reachable URL, Streamable HTTP (`/mcp`) or SSE, return 401 + `WWW-Authenticate` if OAuth. No open-source, review or fee dimension applies. [verified]

---

## 11. Google Gemini / Vertex AI

**Gemini CLI extensions gallery** (`geminicli.com/docs/extensions/releasing/`, read 2026-09-02; ~1,588 extensions listed): extensions bundle MCP servers + prompts/commands. Listing is **fully automatic**: public GitHub repo, add repo topic **`gemini-cli-extension`**, `gemini-extension.json` at repo root; crawler runs daily and lists if validation passes. No submission form, no review, no fee. → **public repo required** (the extension; the MCP server it points to can be a remote URL). Installation via Git or GitHub Releases archives. [verified]

**Gemini Enterprise Agent Platform / Vertex AI**: Google's **Agent Registry** (`docs.cloud.google.com/agent-registry/overview`, updated 2026-08-17) is a *per-customer* governed catalogue of `McpServer`, `Endpoint`, `Skill`, `Agent`, `Publisher` resources inside a Google Cloud project — an enterprise inventory, not a public marketplace. Google also ships managed remote MCP servers for its own services (Agent Platform MCP at `aiplatform.googleapis.com`, plus GCE/BigQuery/Maps/GKE per community posts). **No public third-party directory found.** [verified for registry scope; absence of directory is inferred from search]

---

## 12. Zapier / Composio-style aggregators (brief)

**Zapier MCP** (`zapier.com/mcp`): a *client-facing* aggregator — one Zapier-hosted MCP endpoint exposing the user's existing 9,000+ Zapier app connections to Claude/ChatGPT/Cursor. Third parties get in by building a **Zapier integration** on the Zapier Developer Platform (REST-based, not MCP); there is no path to list an MCP server on Zapier MCP. [verified page; integration path inferred]

**Composio** (`docs.composio.dev/docs/extending-sessions/custom-mcp`, read 2026-09-02): built-in toolkits are Composio-authored. **Custom MCP (experimental, API-only)** lets a Composio customer register an external remote MCP server: **public HTTPS URL**, auth scheme `NO_AUTH`, `API_KEY` (header template containing `{{generic_api_key}}`), or **DCR OAuth**; first tool sync automatic, later syncs manual. This registers the server into *that customer's* project, not a public catalogue. [verified]

Pattern: aggregators compete with directories rather than list you — they are a distribution channel only if you are a big enough SaaS for them to build a toolkit for. [inferred]

---

## 13. Comparison table

Legend: ✅ required · ⚪ accepted/optional · ❌ not accepted · — n/a · ? undocumented

| Surface | Open source / public repo | stdio / local | Remote Streamable HTTP | SSE | No-auth accepted | OAuth 2.1 + PKCE | DCR | CIMD | Static client creds / API key | Human review | Fee | Public repo of *server* needed? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Claude Connectors Directory (remote) | ❌ not required | ❌ (use MCPB) | ✅ | ⚪ deprecated | ✅ (`none`) | ✅ if authed | ⚪ fallback | ✅ preferred | ⚪ `oauth_anthropic_creds` (by email) / `static_headers` (beta) | auto-scan → Community; escalated → Verified | none | No |
| Claude MCPB desktop extension | ✅ (open-source clause "not waivable") | ✅ | — | — | ⚪ | — | — | — | env/config | form + review | none | Yes |
| ChatGPT / Codex plugins directory | ❌ not required (identity verification instead) | ❌ | ✅ | ❌ | ✅ (`noauth`) | ✅ if authed | ⚪ | ✅ preferred | ⚪ predefined OAuth client; ❌ API keys | auto + manual, 5+3 test cases | none | No |
| Official MCP Registry | ❌ ("open- and closed-source") | ✅ | ✅ (`remotes[]`) | ⚪ | ✅ (not modelled) | — | — | — | — | none (automated) | none | No (public package or public URL) |
| Docker MCP Catalog — local | ✅ (Dockerfile in repo, permissive license) | ✅ | — | — | ⚪ | — | — | — | env/secrets | Docker team PR review, live ≤24 h | none | Yes (unless own image) |
| Docker MCP Catalog — remote | ❌ | — | ✅ | ⚪ | ✅ | ⚪ | ? | ? | ? | Docker team PR review | none | No |
| Smithery (URL) | ❌ | ⚪ via MCPB | ✅ | ❌ | ✅ | ✅ if authed | — | ✅ (Smithery uses CIMD) | ⚪ config schema | automated scan | none | No |
| Glama — OSS track | ✅ (GitHub OAuth + repo write access) | ✅ | — | — | ⚪ | — | — | — | — | automated (build + behaviour + TDQS) | none | Yes |
| Glama — hosted connector | ❌ | — | ✅ | — | ⚪ | ✅ | ✅ auto-register | ? | ⚪ sandbox creds | automated | none | No |
| mcp.so | ⚪ repo URL is the required field | ⚪ | ⚪ | ⚪ | — | — | — | — | — | free w/ review or **$39** skip | $0 / $39 | de facto |
| PulseMCP | ❌ (paused; ingests official registry) | ✅ | ✅ | ⚪ | — | — | — | — | — | editorial | none | No |
| Cursor Marketplace (plugin) | ✅ plugin repo public | ✅ | ✅ | ⚪ | ✅ | ✅ | ? | ? | `${VAR}` variables | Cursor team | none | Plugin yes; server no |
| GitHub MCP Registry / VS Code | via official registry | ✅ | ✅ | ⚪ | ✅ | ✅ | ? | ? | headers | curation on top of registry | none | No |
| Copilot Studio BYO | ❌ | ❌ | ✅ only | ❌ | ✅ | ✅ | ✅ (discovery or manual endpoints) | ? | ✅ API key header/query; manual OAuth | none (admin adds) | none | No |
| Microsoft MCP certification | ❌ but verified partner + must own endpoint | ❌ | ✅ | ❌ | ? | ✅ | ? | ? | ✅ static creds in Azure Key Vault | Partner Center validation + review | none | No |
| Cloudflare portals | ❌ | ❌ | ✅ | ⚪ | ✅ | ✅ | — | — | Access service tokens | admin-internal | Cloudflare One pricing | No |
| Gemini CLI gallery (extension) | ✅ public repo + topic tag | ✅ | ✅ | ⚪ | ✅ | ⚪ | ? | ? | env | none (crawler) | none | Extension yes; server no |
| Google Agent Registry | ❌ | ⚪ | ✅ | ? | ? | ? | ? | ? | ? | customer-internal | GCP | No |
| Composio Custom MCP | ❌ | ❌ | ✅ | ? | ✅ | ✅ | ✅ DCR | ? | ✅ API key header | none (customer-scoped) | Composio plan | No |

---

## 14. Practical checklist for a server that wants to be listed everywhere

Ordered by what unlocks the most surfaces. Items marked ★ are things a generator (mcpforge) can emit or enforce automatically.

### Transport
- ★ Ship **Streamable HTTP at a stable `https://…/mcp` URL** as the primary transport (Claude, ChatGPT, Copilot Studio, Smithery, Docker-remote, Composio, Cloudflare). Keep SSE off or as a legacy alias only. [verified]
- ★ Also ship a **stdio entry point** in the same package (MCP Registry, Docker-local, Glama-OSS, Cursor/VS Code/Claude Code/Gemini CLI) — mcpforge already supports both via `openapi-mcp-generator` (ARCHITECTURE.md §29).
- ★ Support **stateless operation behind a load balancer** (2026-07-28 spec direction; Glama/Anthropic both note session gotchas). Return proper `401` before the transport handler on `POST /mcp`. [verified]
- Return **401 (never 403) with `WWW-Authenticate: Bearer resource_metadata="…"`** for unauthenticated requests — required by Anthropic, Smithery, Cloudflare portal detection, and the spec. [verified]
- Don't put WAF bot-protection in front of the MCP or `.well-known` paths without allowlisting `SmitheryBot/1.0`, Anthropic's and OpenAI's published egress ranges. [verified]

### Auth
- If the upstream API is public/read-only: **ship authless** — accepted by every consumer surface, and it avoids review friction. Declare per-tool `securitySchemes: [{type:"noauth"}]` (OpenAI reads it). [verified]
- If auth is needed, implement **OAuth 2.1 authorization-code + PKCE S256** as a *resource server* fronting an authorization server (yours or Auth0/Stytch/WorkOS/Entra):
  - ★ Serve **RFC 9728 PRM** at `/.well-known/oauth-protected-resource[/mcp]` with `resource` = exact public MCP URL and `authorization_servers[0]` = your issuer (only the first entry is used by Claude). [verified]
  - AS metadata (RFC 8414 / OIDC discovery) must advertise: `code_challenge_methods_supported: ["S256"]`, `client_id_metadata_document_supported: true`, `token_endpoint_auth_methods_supported` including `"none"` (and optionally `private_key_jwt` for ChatGPT), `authorization_response_iss_parameter_supported: true` + `iss` in responses (lets ChatGPT use its stable redirect), `scopes_supported` including `offline_access` (refresh tokens for both). [verified]
  - **Prefer CIMD; keep DCR (`registration_endpoint`) as fallback**; DCR-only is discouraged by Anthropic for high traffic. Also be able to accept a **pre-registered static client** (Anthropic-held creds / OpenAI predefined client / Copilot Studio manual / Microsoft Key Vault). [verified]
  - **Redirect URI allowlist:** `https://claude.ai/api/mcp/auth_callback`; `http://localhost/callback` and `http://127.0.0.1/callback` **with port ignored** (Claude Code); `https://chatgpt.com/connector_platform_oauth_redirect` and `https://chatgpt.com/connector/oauth/{callback_id}` (copy from portal); plus whatever Copilot Studio / Cursor / VS Code display. [verified]
  - Echo `resource` into the token `aud`; verify `aud`, `exp`, scopes on every call. Token endpoint must accept `application/x-www-form-urlencoded`; DCR endpoint takes JSON. Rotate or sender-constrain refresh tokens. Answer discovery/token within 10 s. [verified]
  - Do **not** rely on `client_credentials` / service-account grants (unsupported by Claude and ChatGPT). Do **not** accept tokens in query strings. [verified]
- Optional static-secret path for enterprise/self-hosted users: honour `Authorization: Bearer` / `x-api-key` request headers (Claude `static_headers` beta, Claude Code `--header`, Copilot Studio, Composio). ★ Make header name configurable. [verified]

### Tool design (this is where generated servers get rejected)
- ★ **One tool per operation; never a generic `request(method, path)` tool.** Anthropic rejects mixed safe/unsafe tools outright. [verified]
- ★ **Annotations on every tool**: `title`; `readOnlyHint: true` for GET/HEAD-derived tools; `destructiveHint: true` for DELETE (and destructive PUT/PATCH/POST); `idempotentHint` where the OpenAPI method is idempotent; `openWorldHint: true` for anything touching external systems (OpenAI requires it). Both Anthropic and OpenAI treat wrong/missing hints as a top rejection reason. [verified]
- ★ **Tool names ≤ 64 chars**, unique, lowercase verb-first (`get_order_status`), no marketing words. [verified]
- ★ **Descriptions**: state precisely what the tool does and when to call it; for any freeform-query tool, link the upstream API docs. No instructions aimed at the model's behaviour, no references to other tools. Glama's TDQS six dimensions are a good rubric to lint against. [verified]
- ★ **Response minimization**: strip internal IDs, trace/request IDs, timestamps, telemetry, debug payloads from tool output unless the user asked for them (OpenAI hard rule; Anthropic "token frugality"). Offer a way to exclude verbose fields. Return structured, actionable errors (`isError: true` + message) — never bare "Internal Server Error". [verified]
- ★ **Input minimization**: don't add optional "just in case" parameters; never request raw location or credentials as tool inputs. [verified]
- Keep the tool set coherent and small enough to be useful — no hard count limit anywhere, but Cloudflare's Code Mode and Glama's "tool-set coherence" score exist because bloat is the #1 complaint (see 2026-08-30 developer-pain-points research). mcpforge's tool-curation feature (§24) matters for listability, not just UX. [inferred]

### Metadata & packaging
- ★ `server.json` (schema `2025-12-11`) with `packages[]` (npm, `transport.type: stdio`) and `remotes[]` (streamable-http URL); `mcpName` in `package.json`; publish via `mcp-publisher login github|dns|http` + `mcp-publisher publish`. Keep under 4 KB. This feeds GitHub/VS Code, PulseMCP, Glama, Docker community registry. [verified]
- ★ Serve `/.well-known/mcp/server-card.json` (SEP-1649 shape: `serverInfo`, `authentication`, `tools`, `resources`, `prompts`) — lets Smithery and others index an auth-walled server without credentials. [verified]
- ★ Be ready to serve a **domain-verification token** at `/.well-known/openai-apps-challenge` (ChatGPT) and `/.well-known/mcp-registry-auth` (MCP Registry HTTP auth). [verified]
- ★ Emit an MCPB manifest (`manifest.json` v0.2+ with `privacy_policies[]`) and a Dockerfile so the stdio build is one step from Claude Desktop extensions, Smithery-local, Docker-local and Glama-OSS. [verified]
- Have ready before submitting anywhere: **icon/logo** (no pixel spec published by Anthropic/OpenAI; Microsoft uses Teams Store icon rules — color + outline, safe area), name ≤100 / tagline ≤55 / description ≤2,000 chars (Anthropic limits), 1–5 categories, **public documentation URL**, **privacy-policy URL** (HTTPS; covers collection, use/storage, third-party sharing, retention, contact), terms URL (OpenAI, Microsoft), support contact, company name + website, ≥3 example prompts (Anthropic) / ≥5 positive + ≥3 negative test cases (OpenAI), and a **fully populated test account without MFA**. [verified]
- For MCP Apps (UI): 3–5 PNG screenshots ≥1000 px (Anthropic); CSP `frameDomains` avoided (OpenAI). [verified]

### Licensing
- Remote server code can stay closed; **choose MIT or Apache-2.0 for anything you want in Docker-local / Glama-OSS / Cursor / Gemini CLI** ("GPL is not [great]" — Docker). mcpforge's `--license mit|apache-2.0|none` default of MIT already fits. [verified]
- You must **own or legitimately proxy the upstream API** and the MCP domain should match your brand: Anthropic (§3.F, "API ownership"), OpenAI ("unofficial connectors … cannot be approved"), Microsoft (must own endpoint). **This is the real gate for an OpenAPI-to-MCP generator's users: third parties wrapping someone else's API will be rejected by all three big-vendor directories** — only the API owner (or an authorised partner) can list. [verified]

### Hosting
- You host everywhere except: Docker builds/hosts local images; Glama offers paid managed hosting + gateway; Smithery proxies (Gateway) but you still host; Cloudflare Workers is a hosting option, not a listing. None of Anthropic/OpenAI/Microsoft/Google host third-party servers. [verified]
- Organisational prerequisites that are easy to miss: **Claude Team/Enterprise org** (individual plans cannot submit); **OpenAI verified individual/business identity** + non-EU-residency project; **Microsoft Partner Center** business verification + M365/Copilot program enrolment; GitHub account (MCP Registry, Glama, Cursor, Gemini CLI). [verified]

---

## 15. Open questions / gaps found (do not assume)

- Anthropic: exact icon dimensions/format; whether the MCPB "open-source clause" is enforced via the form or the Terms (text not in current Terms page); Verified-review SLA. [undocumented]
- OpenAI: logo spec; review SLA; whether `_meta.ui` requirements apply to MCP-only plugins (appears not). [undocumented]
- Smithery: whether their own container hosting (`smithery.yaml`) is still offered — current Publish doc only lists URL + MCPB. [unclear]
- Glama hosting price. [not found]
- MCP Registry `icons` field: present in newer schema drafts per aggregator descriptions, not confirmed in the 2025-12-11 schema during this pass. [unverified]
- Google: no public third-party MCP directory found for Gemini app / Vertex; absence inferred from search, not from an official statement. [inferred]

---

## Sources (all accessed 2026-09-02)

**Anthropic / Claude**
- https://claude.com/docs/connectors/building/submission
- https://claude.com/docs/connectors/building/review-criteria
- https://claude.com/docs/connectors/building/authentication
- https://claude.com/docs/connectors/building/directory-vs-custom
- https://claude.com/docs/connectors/verification
- https://claude.com/docs/connectors/directory
- https://claude.com/docs/connectors/building/managing-your-listing
- https://claude.com/docs/connectors/building/lazy-authentication
- https://claude.com/docs/connectors/building/mcpb
- https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy
- https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms
- https://support.claude.com/en/articles/11697081-anthropic-mcp-directory-terms-and-conditions (prior version)
- https://code.claude.com/docs/en/mcp

**OpenAI / ChatGPT**
- https://developers.openai.com/plugins/deploy/submission (also `.md`)
- https://developers.openai.com/plugins/deploy/app-review (also `.md`)
- https://developers.openai.com/plugins/app-guidelines (also `.md`; formerly apps-sdk/app-submission-guidelines)
- https://developers.openai.com/plugins/build/auth (also `.md`)
- https://developers.openai.com/plugins/build/mcp-server (also `.md`)
- https://developers.openai.com/plugins/concepts/mcp-server
- https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt

**Official MCP Registry**
- https://modelcontextprotocol.io/registry/about
- https://modelcontextprotocol.io/registry/quickstart
- https://modelcontextprotocol.io/registry/authentication
- https://modelcontextprotocol.io/registry/package-types
- https://modelcontextprotocol.io/registry/faq
- https://raw.githubusercontent.com/modelcontextprotocol/registry/main/docs/reference/server-json/official-registry-requirements.md
- https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/generic-server-json.md
- https://raw.githubusercontent.com/modelcontextprotocol/registry/main/docs/modelcontextprotocol-io/faq.mdx

**Docker**
- https://raw.githubusercontent.com/docker/mcp-registry/main/CONTRIBUTING.md
- https://docs.docker.com/ai/mcp-catalog-and-toolkit/catalog/

**Smithery**
- https://smithery.ai/docs/build/publish

**Glama**
- https://glama.ai/mcp/methodology
- https://glama.ai/mcp/hosting

**Aggregators**
- https://mcp.so/submit?type=server
- https://www.pulsemcp.com/submit
- https://www.pulsemcp.com/servers

**Cursor / VS Code / GitHub**
- https://cursor.com/docs/mcp
- https://cursor.com/docs/reference/plugins
- https://code.visualstudio.com/mcp (mirrors https://github.com/mcp)
- https://github.blog/ai-and-ml/github-copilot/meet-the-github-mcp-registry-the-fastest-way-to-discover-mcp-servers
- https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-mcp-usage/configure-mcp-registry
- https://code.visualstudio.com/docs/agent-customization/mcp-servers

**Microsoft**
- https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent
- https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-certification

**Cloudflare**
- https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/
- https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/
- https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/

**Google**
- https://geminicli.com/docs/extensions/releasing/
- https://geminicli.com/extensions/ (gallery count)
- https://docs.cloud.google.com/agent-registry/overview

**Zapier / Composio**
- https://zapier.com/mcp
- https://docs.composio.dev/docs/extending-sessions/custom-mcp

**Third-party orientation only (not used for requirements claims)**
- https://securecoders.com/blog/mcp-server-registry-guide (2026-03-25)
- https://studiomeyer.academy/recipes/9.3-mcp-marketplaces
- https://medium.com/@TheTechDude/how-to-submit-to-anthropic-connectors-directory-the-full-guide-da0bfed4d21c
