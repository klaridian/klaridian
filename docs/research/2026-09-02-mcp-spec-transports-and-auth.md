# MCP specification, September 2026: what servers must do for transports and authorization

Research pass conducted 2026-09-02 to inform mcpforge's Streamable HTTP work. Scope is strictly the **specification** (modelcontextprotocol.io, the `modelcontextprotocol` GitHub org, SEPs, official blog). No product comparisons.

**How to read this document.** Every normative claim below is tagged:

- **[verified]** — read directly in the primary source cited in the Sources section (the `.md` renderings of the spec pages were fetched with `curl` on 2026-09-02; quotes are verbatim).
- **[inferred]** — my reading of what the verified text implies for an implementer. Not stated in those words by the spec.
- **[not verified]** — I could not confirm it from a primary source; treat as a lead, not a fact.

RFC 2119 keywords (**MUST**, **SHOULD**, **MAY**) are reproduced exactly as the spec uses them. Where the spec says SHOULD and not MUST, this document says SHOULD.

---

## 0. TL;DR for someone who stopped reading MCP news in late 2025

1. **The current stable revision is `2026-07-28`** (released 2026-07-28; GitHub tag `2026-07-28`, commit `5f5440b`). Previous stable was `2025-11-25`. The `draft` changelog is currently empty ("Changes since the most recent release will accumulate here"), so there is no newer in-flight revision as of today. [verified — S1, S2, S3, S24]
2. **It is a breaking release.** The protocol is now **stateless**: no `initialize` handshake, no `Mcp-Session-Id`, no HTTP GET stream, no server-initiated JSON-RPC requests, no SSE resumability. Every request carries its protocol version and client capabilities in `params._meta`. Servers **MUST** implement a new `server/discover` RPC. [verified — S1, S4]
3. **Streamable HTTP is the only non-deprecated HTTP transport**; the 2024-11-05 HTTP+SSE transport is formally *Deprecated* under a new 12-month lifecycle policy. Streamable HTTP POSTs now **MUST** carry `MCP-Protocol-Version`, `Mcp-Method` and (for `tools/call`/`resources/read`/`prompts/get`) `Mcp-Name` headers, and servers **MUST** reject header/body mismatches with HTTP 400 + JSON-RPC `-32020`. [verified — S6]
4. **Authorization is OPTIONAL, and stdio servers SHOULD NOT implement it** — they get credentials from the environment. For HTTP servers that *do* protect themselves, the MCP server is an **OAuth 2.1 resource server** and the hard requirements on it are: serve RFC 9728 Protected Resource Metadata (with `authorization_servers`), validate bearer tokens per OAuth 2.1 §5.2, validate token audience (RFC 8707), return 401/403/400 appropriately, and **never** pass the inbound token through to an upstream API. The authorization server (AS) is explicitly out of scope and "may be hosted with the resource server or a separate entity". [verified — S7, S8, S10]
5. **Dynamic Client Registration (RFC 7591) is formally deprecated** in favor of **Client ID Metadata Documents (CIMD)**; DCR remains for backward compatibility. Both are AS/client concerns, not resource-server concerns. [verified — S1, S9]
6. Tasks moved out of core into an official extension (`io.modelcontextprotocol/tasks`, SEP-2663); OpenTelemetry `traceparent`/`tracestate`/`baggage` keys in `_meta` are now spec-reserved (SEP-414); Roots, Sampling and Logging are deprecated. [verified — S1, S13, S14, S23]

---

## 1. Revision history relevant to 2026 and what changed for servers

### 1.1 Timeline [verified]

| Revision | Status today | Notes |
|---|---|---|
| `2024-11-05` | superseded | HTTP+SSE transport (now Deprecated). |
| `2025-03-26` | superseded | Introduced Streamable HTTP; deprecated HTTP+SSE. [S6] |
| `2025-06-18` | superseded | Introduced `MCP-Protocol-Version` header. [S6] |
| `2025-11-25` | superseded, still widely deployed | Icons (SEP-973), tool-name guidance (SEP-986), CIMD (SEP-991), OIDC discovery, incremental scopes (SEP-835), experimental Tasks (SEP-1686), JSON Schema 2020-12 default (SEP-1613). [S22] |
| **`2026-07-28`** | **current stable** | Stateless core. RC locked 2026-05-21, final 2026-07-28. [S1, S2, S3, S25] |
| `draft` | empty changelog as of 2026-09-02 | [S24] |

The release blog is signed by the two Lead Maintainers, David Soria Parra and Den Delimarsky; Tier 1 SDKs (TypeScript, Python, Go, C#) shipped `2026-07-28` support the same day. TypeScript SDK **v2** (`@modelcontextprotocol/server`, `@modelcontextprotocol/client`, `@modelcontextprotocol/core`, plus `express`/`hono`/`fastify`/`node` adapters, all `2.0.0`) is the stable line for this revision; v1.x (last seen `1.30.0`, 2026-07-27) gets fixes "for at least 6 months after v2's release". [verified — S2, S26, S27]

### 1.2 The `2026-07-28` changelog, from a server developer's perspective [verified — S1 unless noted]

**Major (breaking):**

1. **Sessions removed** (SEP-2567). No `Mcp-Session-Id`. `tools/list`/`resources/list`/`prompts/list` "no longer vary per-connection". Cross-call state = "explicit, server-minted handles passed as ordinary tool arguments".
2. **Handshake removed** (SEP-2575). No `initialize`/`notifications/initialized`. Every request carries `_meta["io.modelcontextprotocol/protocolVersion"]` and `_meta["io.modelcontextprotocol/clientCapabilities"]` (both **required**; a request missing them is malformed and the server **MUST** reject with `-32602`, HTTP 400 on HTTP [S5]). Clients **SHOULD** send `io.modelcontextprotocol/clientInfo`; servers **SHOULD** return `io.modelcontextprotocol/serverInfo` in each result's `_meta`. Version mismatch → `UnsupportedProtocolVersionError` (`-32022`).
3. **`server/discover` added** (SEP-2575). "Servers **MUST** implement this RPC" returning `supportedVersions`, `capabilities`, `instructions`, `serverInfo`. Clients **MAY** call it; on stdio it is the recommended backward-compat probe. [S12]
4. **HTTP GET stream and `resources/subscribe` replaced by `subscriptions/listen`**: one long-lived POST-response SSE stream carrying only opted-in change notifications (`toolsListChanged`, `promptsListChanged`, `resourcesListChanged`, `resourceSubscriptions`). Request-scoped notifications (`notifications/progress`, `notifications/message`) still ride the response stream of their own request.
5. **`ping`, `logging/setLevel`, `notifications/roots/list_changed` removed.** Log level is per-request via `_meta["io.modelcontextprotocol/logLevel"]`; servers **MUST NOT** emit `notifications/message` for requests lacking it.
6. **Tasks moved to an extension** (`io.modelcontextprotocol/tasks`, SEP-2663). See §6.4.
7. **Multi Round-Trip Requests (MRTR)** (SEP-2322) replace server-initiated `elicitation/create`, `sampling/createMessage`, `roots/list`. A server returns `resultType: "input_required"` with `inputRequests`; the client retries the *original* request (with a new JSON-RPC `id`) carrying `inputResponses`.
8. **All results carry a required `resultType`** (`"complete"` or `"input_required"`).
9. **SSE resumability removed** (no `Last-Event-ID`, no event IDs). A broken stream loses the in-flight request; the client re-issues it.

**Minor (but server-relevant):**

- `extensions` field on `ClientCapabilities`/`ServerCapabilities`.
- OTel trace context keys `traceparent`/`tracestate`/`baggage` documented for `_meta` (SEP-414).
- Servers **SHOULD** return tools from `tools/list` in deterministic order.
- Streamable HTTP POSTs **require** `Mcp-Method` and `Mcp-Name` headers; optional `x-mcp-header` schema annotation mirrors tool parameters into `Mcp-Param-{Name}` headers (SEP-2243).
- `ttlMs` and `cacheScope` (`"public"`/`"private"`) are **required** on `tools/list`, `prompts/list`, `resources/list`, `resources/read`, `resources/templates/list` results via a `CacheableResult` interface (SEP-2549).
- Resource-not-found error code changed `-32002` → `-32602`.
- Auth: AS **SHOULD** emit `iss` (RFC 9207) and clients **MUST** validate it (SEP-2468); clients **MUST** set `application_type` in DCR (SEP-837); client credentials are bound to the issuing AS (SEP-2352).
- `inputSchema`/`outputSchema` loosened to any JSON Schema 2020-12 keywords; `structuredContent` may be any JSON value; `$ref` resolution rules and composition bounds added (SEP-2106).
- `notifications/elicitation/complete` and URL-mode `elicitationId` removed (subsumed by MRTR).
- Error-code allocation policy: `-32000..-32019` implementation-defined; `-32020..-32099` reserved for MCP. `HeaderMismatch` = `-32020`, `MissingRequiredClientCapability` = `-32021`, `UnsupportedProtocolVersion` = `-32022`.

**Deprecated (still functional, ≥12-month window, earliest removal in the first revision released on/after 2027-07-28):** Roots, Sampling, Logging (SEP-2577); HTTP+SSE transport (SEP-2596; earliest removal "three months after SEP-2596 reaches Final"); `includeContext: "thisServer"/"allServers"`; **Dynamic Client Registration** (PR #2858). [S1, S23]

**Governance:** formal feature lifecycle (Active/Deprecated/Removed, SEP-2596); PR-based SEP workflow (SEP-1850); Standards Track SEPs cannot reach Final without a conformance-suite scenario (SEP-2484, per the RC blog). [S1, S25]

---

## 2. Transports

### 2.1 The transport model in `2026-07-28` [verified — S4]

A transport is "a **binding**: it defines how messages are framed and delivered, how request metadata is carried, and how cancellation and termination are signaled." Protocol semantics are identical across bindings. Two standard bindings exist: **stdio** and **Streamable HTTP**. Custom transports **MAY** exist and **MUST** preserve the JSON-RPC format, the message patterns and the per-request metadata model; ones over a byte stream (Unix sockets, TCP) **SHOULD** reuse stdio framing.

Message directions are now fixed: "servers do not initiate JSON-RPC requests and clients do not send JSON-RPC responses." All protocol metadata lives in the body (`_meta`); a binding **MAY** mirror it into envelope metadata (HTTP headers), with "the body remains the source of truth".

### 2.2 stdio [verified — S11]

- Client launches the server as a subprocess; server reads JSON-RPC from `stdin`, writes to `stdout`; newline-delimited; messages **MUST NOT** contain embedded newlines.
- Server **MAY** write UTF-8 to `stderr` for any logging. Server **MUST NOT** write anything to `stdout` that is not a valid MCP message. (This is the transport-corruption failure mode mcpforge's e2e tests already guard against — still normative.)
- Server **MUST NOT** write JSON-RPC *requests* to `stdout`; server→client interactions go via `InputRequiredResult` (MRTR).
- No header layer; everything is in `_meta`.
- Cancellation: client sends `notifications/cancelled`; server **SHOULD** stop and **MUST NOT** send further messages for it.
- Shutdown: server **SHOULD** exit promptly when `stdin` closes/EOF ("the primary graceful-shutdown signal and the only portable one").
- Unexpected exit: client **SHOULD** restart; in-flight requests are lost and retried; `subscriptions/listen` streams re-established.
- Backward compat: dual-era clients **SHOULD** probe with `server/discover` first; any non-modern error or timeout → fall back to `initialize`. A **dual-era server** "selects its behavior from how the client opens": modern `_meta` → stateless; `initialize` → legacy semantics. [S16]
- Statelessness applies to stdio too: "an open connection, such as a STDIO process, is not a conversation or session"; servers **MUST NOT** rely on prior requests on the same connection for context. [S5]

### 2.3 Streamable HTTP [verified — S6]

Shape: the server "**MUST** provide a single HTTP endpoint path (… the **MCP endpoint**) that supports POST", e.g. `https://example.com/mcp`. Every client JSON-RPC message is its own POST. Server replies with either `application/json` (single object) or `text/event-stream` (request-scoped SSE: related notifications then the final response; the final response **SHOULD** terminate the stream). Notifications get `202 Accepted` with no body.

**Security & endpoint rules for servers:**

1. Servers **MUST** validate the `Origin` header on all incoming connections; present-and-invalid → **MUST** respond HTTP 403 (body **MAY** be an id-less JSON-RPC error).
2. When running locally, servers **SHOULD** bind only to `127.0.0.1`, not `0.0.0.0`.
3. Servers **SHOULD** implement proper authentication for all connections.

**Required request headers (client MUST send; server MUST validate):**

| Header | Source | Required for |
|---|---|---|
| `MCP-Protocol-Version` | `_meta["io.modelcontextprotocol/protocolVersion"]` | all requests |
| `Mcp-Method` | `method` | all requests |
| `Mcp-Name` | `params.name` or `params.uri` | `tools/call`, `resources/read`, `prompts/get` |
| `Mcp-Param-{Name}` | tool arg annotated with `x-mcp-header` | only if the server's schema opts in |

"These headers are **REQUIRED** for compliance." Servers that process the body **MUST** reject header/body disagreement with HTTP `400` + JSON-RPC `-32020` (`HeaderMismatch`); missing required headers count as a failure. Non-ASCII values use the `=?base64?…?=` sentinel and servers **MUST** decode before comparing. Header names are case-insensitive; values are case-sensitive.

Version handling: unsupported version → `400` + `UnsupportedProtocolVersionError` listing supported versions. Unknown method → `404` + JSON-RPC `-32601`. A server that also supports pre-`2025-06-18` clients **MAY** treat a missing `MCP-Protocol-Version` header as `2025-03-26`; a server that doesn't **MUST** reject it.

Streaming hygiene: servers **SHOULD** send `X-Accel-Buffering: no` on SSE responses; encouraged to emit `:` keep-alive comments on long streams. `Last-Event-ID` is "not supported".

Cancellation: closing the SSE response stream **MUST** be treated by the server as cancellation. There is no client→server notification over HTTP in the core protocol this revision.

Legacy traffic handling for a `2026-07-28`-only server: `GET`/`DELETE` on the MCP endpoint → `405`; ignore `Mcp-Session-Id` (do not mint/echo); ignore `Last-Event-ID`.

### 2.4 HTTP+SSE (2024-11-05) — Deprecated [verified — S6, S23]

"New implementations **SHOULD NOT** adopt it; existing implementations **SHOULD** migrate to Streamable HTTP." Servers wanting old-client support keep hosting the old SSE + POST endpoints alongside the MCP endpoint. Listed in the Deprecated Features registry with migration path Streamable HTTP.

### 2.5 When each is appropriate

**[verified]** The spec's own positioning: stdio is "a client-launched subprocess"; Streamable HTTP is "an independent process that can handle multiple client connections". The Security Best Practices doc tells authors of locally-run servers to "Use the `stdio` transport to limit access to just the MCP client" and, if HTTP is used locally, to "Require an authorization token" or use Unix sockets/IPC. [S11, S6, S10]

**[inferred]** Practical decision rule consistent with the above:

- **stdio**: the server runs on the user's machine, launched by the host (Claude Desktop, IDEs, CLIs); credentials come from env vars/config; no OAuth machinery; one client per process. Best for personal/dev use and for wrapping APIs where the user already holds an API key.
- **Streamable HTTP**: the server is a network service — multi-tenant or shared, deployed behind a load balancer/gateway, reachable by remote hosts. This is what people mean by a **"remote MCP server"**: an HTTPS MCP endpoint that (a) speaks Streamable HTTP, (b) is stateless per `2026-07-28`, and (c) if it protects anything, acts as an OAuth 2.1 resource server per §3. The `2026-07-28` design goal, in the maintainers' words, is that "any request can land on any server instance behind a plain round-robin load balancer without needing shared storage." [S2]
- **Both from the same code**: the binding is only framing/metadata/cancellation; a generator can emit one handler and two adapters. `x-mcp-header` and the `Mcp-*` header validation are HTTP-only concerns; stdio clients **MAY** ignore `x-mcp-header` entirely. [S6, S15]

---

## 3. Authorization: what the spec requires of an HTTP MCP server

Primary sources: the four `basic/authorization/*` pages of `2026-07-28` [S7, S8, S9, S10] and the Security Best Practices tutorial [S17]. The spec is explicit that it "implements a selected subset of [OAuth] features".

### 3.1 Applicability [verified — S7, S5]

> "Authorization is **OPTIONAL** for MCP implementations. When supported:
> - Implementations using an HTTP-based transport **SHOULD** conform to this specification.
> - Implementations using an STDIO transport **SHOULD NOT** follow this specification, and instead retrieve credentials from the environment.
> - Implementations using alternative transports **MUST** follow established security best practices for their protocol."

The base-protocol overview adds: "clients and servers **MAY** negotiate their own custom authentication and authorization strategies." [S5]

**[inferred]** So an unauthenticated public HTTP MCP server is spec-conformant; an HTTP server that uses a static API key header is not *non-conformant* (custom strategies are permitted) but is outside the interoperable OAuth path that MCP clients implement.

### 3.2 Roles — the single most important sentence [verified — S7]

> "A protected *MCP server* acts as an **OAuth 2.1 resource server**, capable of accepting and responding to protected resource requests using access tokens. … The *authorization server* is responsible for interacting with the user (if necessary) and issuing access tokens for use at the MCP server. **The implementation details of the authorization server are beyond the scope of this specification. It may be hosted with the resource server or a separate entity.**"

Standards referenced: OAuth 2.1 (`draft-ietf-oauth-v2-1-13`), RFC 6750 (Bearer), RFC 8414 (AS Metadata), RFC 7591 (DCR), RFC 8707 (Resource Indicators), RFC 9728 (Protected Resource Metadata), RFC 9207 (Issuer Identification), `draft-ietf-oauth-client-id-metadata-document-00` (CIMD), OpenID Connect Discovery 1.0, OIDC Dynamic Client Registration 1.0.

### 3.3 Responsibility matrix

Legend: **RS** = the MCP server as resource server; **AS** = authorization server (external IdP such as Okta/Entra/Auth0/Keycloak, or a co-hosted one); **C** = MCP client (host app). All rows are [verified] against the cited page unless marked.

| Requirement | RS (MCP server) | AS | C | Source |
|---|---|---|---|---|
| Implement OAuth 2.1 "with appropriate security measures for both confidential and public clients" | — | **MUST** | — | S7 §Overview 1 |
| Support Client ID Metadata Documents (CIMD) | — | **SHOULD** | **SHOULD** | S7 §Overview 2 |
| Support Dynamic Client Registration (RFC 7591) | — | **MAY** (deprecated) | **MAY** (deprecated) | S7 §Overview 3, S9 |
| **Implement RFC 9728 Protected Resource Metadata** | **MUST** | — | **MUST** use it for discovery | S7 §Overview 4, S8 |
| PRM document includes `authorization_servers` with ≥1 entry | **MUST** | — | — | S8 |
| Expose PRM via `WWW-Authenticate: Bearer resource_metadata="…"` on 401 **or** at `/.well-known/oauth-protected-resource[/path]` | **MUST** (one of) | — | **MUST** support both | S8 |
| Provide RFC 8414 AS Metadata **or** OIDC Discovery | — | **MUST** (≥1) | **MUST** support both | S7 §Overview 5, S8 |
| AS metadata `issuer` identical to the URL used to fetch it | — | — | **MUST** validate | S8 |
| Include `scope` in `WWW-Authenticate` | **SHOULD** | — | treat as authoritative | S7 §Scope Selection |
| Do not advertise `offline_access` in PRM `scopes_supported` or challenges | **SHOULD NOT** | — | — | S7 §Refresh Tokens |
| PKCE with `S256`; refuse to proceed if `code_challenge_methods_supported` is absent from AS metadata | — | **MUST** include `code_challenge_methods_supported` (OIDC providers) | **MUST** | S10 §Authorization Code Protection |
| `resource` parameter (RFC 8707) in authorization + token requests = canonical MCP server URI | — | (should honor; spec says binding happens "when the AS supports the capability") | **MUST**, "regardless of whether authorization servers support it" | S7 §Resource Parameter, S10 |
| `iss` in authorization responses (RFC 9207); advertise `authorization_response_iss_parameter_supported` | — | **SHOULD** emit; **MUST** advertise if emitting | **MUST** validate | S7 §Authorization Response Validation |
| **Validate access tokens per OAuth 2.1 §5.2** | **MUST** | — | — | S7 §Token Handling |
| **Validate tokens were issued for this server as audience (RFC 8707 §2)**; reject tokens that "do not include them in the audience claim or otherwise verify that they are the intended recipient" | **MUST** | — | — | S7, S10 §Access Token Privilege Restriction |
| Invalid/expired token → HTTP 401 | **MUST** | — | — | S7 |
| "**MUST** only accept tokens that are valid for use with their own resources"; "**MUST NOT** accept or transit any other tokens" | **MUST / MUST NOT** | — | — | S7 §Token Handling |
| Send only tokens issued by the MCP server's AS; use `Authorization: Bearer` header on **every** request; never in query string | — | — | **MUST** | S7 |
| Status codes: 401 (auth required / token invalid), 403 (invalid scopes / insufficient permissions), 400 (malformed) | **MUST** | — | — | S7 §Error Handling |
| Insufficient scope at runtime → 403 + `WWW-Authenticate: Bearer error="insufficient_scope", scope="…", resource_metadata="…"` | **SHOULD** | — | **SHOULD** step-up (union of scopes) | S7 §Scope Challenge Handling |
| Include *all* scopes needed for the operation in one challenge; be consistent | **SHOULD** | — | — | S7 |
| Account for scope hierarchies when deciding sufficiency | **MUST** | — | — | S7 |
| Secure token storage (OAuth 2.1 §7.1) | **MUST** | — | **MUST** | S10 §Token Theft |
| Short-lived access tokens; rotate refresh tokens for public clients | — | **SHOULD** / **MUST** | — | S10 |
| All AS endpoints over HTTPS; redirect URIs `localhost` or HTTPS | — | **MUST** | **MUST** | S10 §Communication Security |
| Exact redirect URI matching | — | **MUST** | **MUST** register | S10 §Open Redirection |
| If the MCP server calls upstream APIs it "may act as an OAuth client to them. The access token used at the upstream API is a separate token, issued by the upstream authorization server. The MCP server **MUST NOT** pass through the token it received from the MCP client." | **MUST NOT** | — | — | S10 §Access Token Privilege Restriction |
| "MCP proxy servers using static client IDs **MUST** obtain user consent for each dynamically registered client before forwarding to third-party authorization servers" | **MUST** (proxy case) | — | — | S10 §Confused Deputy |
| "MCP servers that implement authorization **MUST** verify all inbound requests. MCP servers **MUST NOT** treat possession of a state handle as authentication." | **MUST** | — | — | S17 §State Handle Hijacking |
| Follow OAuth 2.1 §7 Security Considerations | **MUST** | **MUST** | **MUST** | S10 preamble |

**What this means for the split [inferred, but tightly from the table]:**

- If you run the MCP server *only* as a resource server against an external IdP, your entire normative surface is: (1) a PRM JSON document, (2) a 401 challenge with `resource_metadata` (and ideally `scope`), (3) bearer-token validation including signature/expiry/**audience**, (4) 401/403 semantics with `insufficient_scope` challenges, (5) never forwarding the inbound token upstream, (6) not letting state handles substitute for auth. Everything about PKCE, DCR/CIMD, `iss`, redirect URIs, consent screens, refresh-token rotation is on the AS and the client.
- If you *also* host the AS (the "MCP server also acting as authorization server" pattern), you inherit every AS row above: OAuth 2.1 for public + confidential clients, RFC 8414 metadata with `code_challenge_methods_supported`, CIMD support (SHOULD) with SSRF-safe fetching and exact `client_id`-URL matching, `iss` emission, exact redirect-URI validation, refresh-token rotation, HTTPS everywhere — and, if you proxy to a third-party API with a static client ID, the full per-client consent machinery in §5 below. The spec does not forbid this pattern ("may be hosted with the resource server") but it is clearly the heavier path.

### 3.4 Protected Resource Metadata (RFC 9728) details [verified — S8]

- Two discovery mechanisms; the server **MUST** implement at least one; clients **MUST** support both and prefer the `WWW-Authenticate` URL, falling back to well-known probing in this order: path-scoped `https://example.com/.well-known/oauth-protected-resource/public/mcp` (for endpoint `https://example.com/public/mcp`), then root `https://example.com/.well-known/oauth-protected-resource`.
- Multiple `authorization_servers` are allowed; the client selects. Each is independent; clients keep separate registration state per AS.
- The PRM `resource` value should equal the canonical server URI used for RFC 8707 (see §3.5).

### 3.5 Canonical server URI / resource indicator [verified — S7]

Valid examples: `https://mcp.example.com/mcp`, `https://mcp.example.com`, `https://mcp.example.com:8443`, `https://mcp.example.com/server/mcp`. Invalid: missing scheme, fragments. **SHOULD** use the no-trailing-slash form. Clients **SHOULD** send the most specific URI; implementations **SHOULD** accept uppercase scheme/host for robustness. **[inferred]** The RS must therefore know its own externally-visible canonical URI (behind proxies, this is configuration, not something derivable from `Host` alone) in order to (a) publish it in PRM and (b) compare against the token's audience.

### 3.6 AS Metadata discovery (RFC 8414 / OIDC) [verified — S8]

MCP uses the standard `oauth-authorization-server` well-known suffix; no MCP-specific suffix. For issuer `https://auth.example.com/tenant1` the client tries, in order: `/.well-known/oauth-authorization-server/tenant1`, `/.well-known/openid-configuration/tenant1`, `/tenant1/.well-known/openid-configuration`. The returned `issuer` **MUST** be identical to the issuer used to build the URL, otherwise the document **MUST** be rejected. This is purely a client/AS matter; the RS only has to publish the right `authorization_servers` URL(s).

### 3.7 Client registration: CIMD vs. DCR vs. pre-registration [verified — S9, S1]

- Three mechanisms. Client priority order: (1) pre-registered credentials, (2) CIMD if AS metadata has `client_id_metadata_document_supported: true`, (3) DCR if AS metadata has `registration_endpoint`, (4) prompt the user.
- **CIMD**: the `client_id` *is* an HTTPS URL with a path (e.g. `https://app.example.com/oauth/client-metadata.json`) pointing to a JSON document that **MUST** contain `client_id`, `client_name`, `redirect_uris`, with `client_id` equal to the URL. AS **SHOULD** fetch it, **MUST** validate `client_id` match, redirect URIs, and structure; **SHOULD** cache per HTTP headers; **MAY** apply domain trust policies; **MUST** clearly display the redirect URI hostname and **SHOULD** warn on `localhost`-only redirects. CIMD IDs "are portable across authorization servers … No re-registration is needed when the authorization server changes."
- **DCR (RFC 7591)**: "Dynamic Client Registration is deprecated. New implementations should use Client ID Metadata Documents instead. This option remains available for backwards compatibility with authorization servers that do not support Client ID Metadata Documents." Deprecated in `2026-07-28` (PR #2858), earliest removal in the first revision on/after 2027-07-28. Clients using it **MUST** send `application_type` (`"native"` for desktop/CLI/localhost; `"web"` otherwise).
- **AS binding** (SEP-2352): credentials are keyed by issuer; **MUST NOT** be reused across ASes; re-register when the AS changes.
- **Status of the underlying IETF document:** the spec pins `draft-ietf-oauth-client-id-metadata-document-00`, i.e. an IETF *draft*, not an RFC. [verified — S7] Whether a newer draft revision exists at IETF was **[not verified]** in this pass.

**[inferred] Relevance to an RS-only server:** none of §3.7 is your code. It matters for choosing/configuring an external IdP: an IdP that supports neither CIMD nor DCR forces every MCP client to be pre-registered manually, which degrades the "connect to any remote MCP server" experience the spec is designed for.

### 3.8 Scopes and step-up [verified — S7, S17]

- Server **SHOULD** put `scope` in the 401 challenge; `scopes_supported` in PRM "is intended to represent the minimal set of scopes necessary for basic functionality".
- Runtime insufficient scope → **SHOULD** 403 + `error="insufficient_scope"` + `scope="…"` + `resource_metadata`. Client computes the **union** of previously requested scopes and the challenge and re-authorizes; retries are bounded. "Scope accumulation across operations is a client-side responsibility … This allows servers to remain stateless with respect to client scope sets."
- Servers **MUST** honor scope hierarchies when judging sufficiency.
- Best-practice doc: minimal initial scope set, targeted challenges, avoid omnibus scopes (`*`, `all`), and — under "Common Mistakes" — "Treating claimed scopes in token as sufficient without server-side authorization logic".
- `tools/list` **MAY** vary "by the authorization presented on the request — for example, returning only the tools the caller's granted scopes permit — since credentials are per-request input, not connection state." [S15]

### 3.9 Authorization extensions (official, opt-in) [verified — S18, S19, S20]

Live in `github.com/modelcontextprotocol/ext-auth`; negotiated via the `extensions` map in capabilities; "never active by default".

- **OAuth Client Credentials** (`io.modelcontextprotocol/oauth-client-credentials`): M2M, no human. Server-side: validate the JWT signature/claims against the AS's JWKS, check scopes, optionally advertise the extension in `server/discover`.
- **Enterprise-Managed Authorization** (`io.modelcontextprotocol/enterprise-managed-authorization`, "stable" spec path in ext-auth): the enterprise IdP issues an ID-JAG (Identity Assertion JWT Authorization Grant) that the client exchanges at the MCP server's AS for an access token. This is the SEP-990 lineage.

---

## 4. Do stdio servers need any of this?

**Precisely, per spec [verified — S7, S5]:** No. "Implementations using an STDIO transport **SHOULD NOT** follow this specification, and instead retrieve credentials from the environment." That is a SHOULD NOT, so a stdio server implementing OAuth is not *forbidden*, but it is explicitly steered away from it.

What stdio servers *do* have to care about in `2026-07-28` [verified — S11, S5, S12, S17]:

- The stateless `_meta` contract and `server/discover` (same as HTTP).
- `stdout` purity and prompt exit on `stdin` EOF.
- Logging: the `logging` feature is deprecated; the migration path is "Log to `stderr` for stdio transports; use OpenTelemetry for observability". [S23]
- The security guidance for locally-run servers: prefer stdio "to limit access to just the MCP client"; if you *do* expose HTTP locally, bind to `127.0.0.1`, validate `Origin` (DNS rebinding), and require a token or use IPC. [S17, S6]
- Client-side (not server-side) obligations exist around one-click install consent (SEP-1024 lineage) — not the server's job. [S17]

**[inferred]** For mcpforge's current stdio output this means: no OAuth code paths at all; upstream API credentials come from env vars/config as today; the `2026-07-28` work is the stateless/`_meta`/`server/discover`/`resultType`/`ttlMs`/`cacheScope` surface, which the SDK v2 handles if the generator is on it.

---

## 5. Security Best Practices: mandates vs. recommendations

The document at `/docs/2026-07-28/tutorials/security/security_best_practices` [S17] describes itself as "complementing the MCP Authorization specification" and is linked normatively from the authorization pages ("Implementations of this specification **MUST** follow the normative security requirements in Security Considerations" [S7] → [S10], which in turn points to S17 for token passthrough and confused deputy). It uses RFC 2119 language throughout. Extracted by strength:

**MUST / MUST NOT (mandates) — server-side**

- **Token passthrough:** "MCP servers **MUST NOT** accept any tokens that were not explicitly issued for the MCP server." Rationale: security-control circumvention, broken audit trails, trust-boundary collapse, future-compat.
- **Confused deputy (only for MCP *proxy* servers that use a static client ID at a third-party AS and let MCP clients register dynamically):** **MUST** implement per-client consent *before* forwarding to the third-party AS; **MUST** maintain a per-user registry of approved `client_id`s; consent page **MUST** name the client, show third-party scopes and the registered `redirect_uri`, have CSRF protection, and block iframing; consent cookies **MUST** use `__Host-` prefix, `Secure`/`HttpOnly`/`SameSite=Lax`, be signed or server-side, and be bound to the `client_id`; `redirect_uri` **MUST** match exactly (no wildcards); `state` **MUST** be cryptographically random, stored only after consent, set immediately before redirecting, validated exactly at callback, single-use, short-lived.
- **State handle hijacking (new in this revision):** "MCP servers that implement authorization **MUST** verify all inbound requests. MCP servers **MUST NOT** treat possession of a state handle as authentication."
- **Tools page security list [S15]:** "Servers **MUST**: Validate all tool inputs; Implement proper access controls; Rate limit tool invocations; Sanitize tool outputs."
- **Elicitation [S21]:** servers **MUST NOT** use form-mode elicitation for passwords/API keys/tokens/payment credentials; **MUST** use URL mode for those.

**MUST — client/AS-side (listed so you know what your counterparties are held to)**

- Server-deployed MCP *clients* **MUST** consider SSRF when fetching OAuth URLs; clients **MUST** validate authorization URLs (only `http(s)`; reject `javascript:`, `data:`, `file:`…), **MUST NOT** shell out to open URLs, **MUST** sanitize URLs from servers.
- One-click local install: client **MUST** show the exact command and get explicit approval.
- AS: exact redirect URI validation; `code_challenge_methods_supported` present; CIMD `client_id` match; display redirect hostname.

**SHOULD (recommendations) — server-side**

- Use secure, non-deterministic, expiring state handles; bind them server-side to the authenticated user (e.g. key by `<user_id>:<handle>` with the user id from the verified token).
- Locally-run servers **SHOULD** use stdio, or if HTTP, require a token / use Unix sockets.
- Scope minimization: minimal initial scope set, precise challenges, log elevation events, tolerate down-scoped tokens; never publish the entire catalog in `scopes_supported`.
- Proxy services spawning stdio servers **SHOULD** sandbox, restrict FS, log, and require extra authorization for dangerous commands.

**[inferred]** For a generator that produces *resource-server-only* HTTP servers against an external IdP, the confused-deputy block does not apply (no proxy AS, no static third-party client ID minted per MCP client). It **does** apply the moment the generated server both accepts MCP OAuth *and* performs a *user-delegated* OAuth dance with the upstream API on the user's behalf — which is exactly the tempting design for an OpenAPI wrapper whose upstream API is itself OAuth-protected.

---

## 6. 2026 changes to specific server-facing features

### 6.1 Tool naming [verified — S15, S22, S28]

- `2026-07-28` text: "Tool names **SHOULD** be between 1 and 128 characters in length (inclusive)… case-sensitive… only allowed characters: … A-Z, a-z, 0-9, underscore, hyphen, and dot… **SHOULD NOT** contain spaces, commas… **SHOULD** be unique within a server." Identical wording is in `2025-11-25`.
- **Discrepancy worth knowing:** SEP-986 (Final, authored 2025-07-16) proposed **1–64** characters *and* allowed forward slash (`/`). The merged spec text says **128** and does **not** list `/`. The SEP page carries a banner that Final SEPs are "preserved as a historical record … Refer to the current specification". So: **the spec (128, no slash) governs**, not the SEP abstract. Third-party blog posts asserting a hard "64" limit are quoting the SEP or a specific client's validation, not the current spec. [S28, S15]
- All naming rules are SHOULD, not MUST. But `Mcp-Name` is now an HTTP header; names "are only **SHOULD**-constrained to header-safe characters", and anything outside the safe set must be base64-sentinel-encoded by clients. [S6]
- Uniqueness is per-server; aggregators may prefix with a server identifier; `serverInfo.name` "is not guaranteed to be unique across servers and **SHOULD NOT** be relied upon for disambiguation."

### 6.2 Tool annotations [verified — S29, S15]

`ToolAnnotations` in the `2026-07-28` schema: `title?`, `readOnlyHint?` (default `false`), `destructiveHint?` (default `true`; meaningful only when `readOnlyHint == false`), `idempotentHint?` (default `false`; same condition), `openWorldHint?` (default `true`). "NOTE: all properties in `ToolAnnotations` are **hints**." Tools page: "clients **MUST** consider tool annotations to be untrusted unless they come from trusted servers." No changes to the annotation set in 2026 were found in the changelog. [S1]

### 6.3 Icons (SEP-973) [verified — S5, S22]

Introduced in `2025-11-25`; unchanged in `2026-07-28`. `icons: Icon[]` with `src` (HTTPS URL or `data:` URI, required), `mimeType?`, `sizes?` (e.g. `["48x48"]`, `["any"]`), `theme?` (`light`/`dark`). Attachable to `Implementation` (i.e. `serverInfo`), `Tool`, `Prompt`, `Resource`. Clients that render icons **MUST** support PNG and JPEG, **SHOULD** support SVG and WebP; **MUST** reject unsafe schemes; fetch without credentials; verify same-origin as the server; treat MIME as advisory. **[inferred]** For a server that wants icons to actually render, publish PNG at 48x48 (and maybe 96x96) from the server's own origin or as `data:` URIs; SVG is optional-support only.

### 6.4 OpenTelemetry trace propagation (SEP-414) [verified — S5, S14, S1]

SEP-414 is **Final** and landed in `2026-07-28` as a "minor change". In `basic/index` `_meta` reserved keys: "the keys `traceparent`, `tracestate`, and `baggage` are reserved for OpenTelemetry trace context propagation. When present, their values MUST follow W3C Trace Context and W3C Baggage formats respectively. This exception exists to maintain compatibility with existing implementations and OpenTelemetry semantic conventions for MCP." They are an explicit exception to the `_meta` reverse-DNS prefix rule. The SEP notes existing implementations in the C# and Python SDKs, OpenInference (TS + Python), Envoy AI Gateway, Logfire, ToolHive. Its successor SEP-2028 (forwarding `_meta` to HTTP headers) is referenced but its status was **[not verified]** here. **[inferred]** For a server, the useful action is: on inbound `tools/call`, extract `_meta.traceparent` as the parent context for the server span, and inject W3C headers on the outbound upstream HTTP call, so host → MCP server → upstream API is one trace.

### 6.5 Tasks / long-running operations [verified — S1, S13, S30]

- `2025-11-25` had experimental core `tasks/*` (SEP-1686). `2026-07-28` **removes them from core** and ships the official **`io.modelcontextprotocol/tasks` extension** (SEP-2663; repo `ext-tasks`, schema version `2026-07-28` marked *Stable*).
- Model: client advertises the extension in per-request `clientCapabilities.extensions`; server advertises in `server/discover`. Server decides per-request to return `CreateTaskResult` (`resultType: "task"`) with `taskId`, status, TTL, poll interval — "no per-request flag". Client polls `tasks/get`; `input_required` status surfaces `inputRequests` answered via `tasks/update`; `tasks/cancel` is cooperative. `tasks/result` (blocking) and `tasks/list` were removed.
- Statuses: `working`, `input_required`, `completed`, `failed`, `cancelled`.
- **[inferred]** For an OpenAPI wrapper this maps naturally onto upstream APIs that return `202 Accepted` + a job/operation URL; it is opt-in and not needed for v1 of an HTTP transport.

### 6.6 Elicitation [verified — S21, S1]

Still two modes (`form`, `url`), but the *mechanism* changed: servers no longer send `elicitation/create` requests; they return `InputRequiredResult` and the client retries. `notifications/elicitation/complete` and `elicitationId` were removed. Clients declare `elicitation: { form: {}, url: {} }` per request; empty object = form-only. Sensitive credentials **MUST** go via URL mode. **[inferred]** For a generated server, elicitation is the spec-blessed way to ask "confirm this DELETE?" mid-call now that it works statelessly — the Supabase quote in the release blog describes exactly this use. [S2]

### 6.7 Caching / list results [verified — S1, S15, S12]

`ttlMs` and `cacheScope` are **required** on `tools/list` (and the other list/read results) and on `server/discover`. `cacheScope: "public"` permits shared intermediaries to cache; `"private"` does not. Tools **SHOULD** be returned in deterministic order. **[inferred]** Generated servers with a static tool set derived from an OpenAPI document can emit a long `ttlMs` and `"public"` scope *unless* `tools/list` is filtered by the caller's scopes, in which case `"private"` is the correct value.

### 6.8 JSON Schema in tools [verified — S1, S5, S25]

`inputSchema` keeps the `type: "object"` root but now allows composition (`oneOf`/`anyOf`/`allOf`), conditionals, `$ref`/`$defs`; `outputSchema` unrestricted; `structuredContent` any JSON value. Default dialect 2020-12; implementations **MUST** support 2020-12 and **MUST NOT** auto-dereference external `$ref` URIs; should bound schema depth and validation time. Tools with `outputSchema` **MUST** return conforming `structuredContent`; for back-compat **SHOULD** also include the serialized JSON as a `TextContent` block.

### 6.9 Error semantics [verified — S15]

Unknown tool → JSON-RPC protocol error `-32602`. API failures, input validation, business-logic errors → tool result with `isError: true`. (This confirms the two conformance fixes mcpforge already applies in `render/conformance.ts` remain correct under `2026-07-28`.)

---

## 7. Implications for someone building an OpenAPI → MCP server generator

These are [inferred] from the verified material above; each bullet names the section it derives from.

1. **Target `2026-07-28` via TypeScript SDK v2** (`@modelcontextprotocol/server` 2.x). v1.x is a maintenance line with a ≥6-month window. Whether `openapi-mcp-generator` has moved to v2 must be checked before assuming generated output is stateless-conformant. (§1.1)
2. **Assume nothing survives between calls.** No sessions, no `initialize`. Any generator-emitted caching of "client capabilities" or "negotiated version" from a handshake is now a bug; read them from each request's `_meta`. Implement `server/discover` (MUST). (§1.2, §2.2)
3. **Emit `resultType: "complete"` on every result and `ttlMs`/`cacheScope` on `tools/list` and `server/discover`** — these are required fields, not niceties. Static OpenAPI-derived tool sets → long TTL; scope-filtered tool sets → `cacheScope: "private"`. Sort tools deterministically. (§6.7)
4. **For Streamable HTTP, validate the three headers.** `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name` must match the body; mismatch → 400 + `-32020`; decode the `=?base64?…?=` sentinel first. Return 405 on GET/DELETE, ignore `Mcp-Session-Id`/`Last-Event-ID`. (§2.3)
5. **Validate `Origin` (403 on bad), bind to `127.0.0.1` by default for local runs, set `X-Accel-Buffering: no` on SSE.** These are the only transport-level security MUST/SHOULDs and are cheap. (§2.3)
6. **OpenAPI → `x-mcp-header` is a natural mapping.** Operation parameters that OpenAPI marks `in: header` or `in: path` with primitive types (string/integer/boolean, *not* `number`) and that are statically reachable in the schema can be annotated so gateways can route on them. Never annotate secrets (spec says SHOULD NOT). (§2.3, §6.1)
7. **Tool names: keep ≤128 chars, `[A-Za-z0-9_.-]`, unique per server.** Do not use `/` despite SEP-986's abstract; some clients enforce 64 — that is a client policy, not the spec, but a generator that lets users choose a naming strategy and truncation rule avoids the argument. (§6.1)
8. **Derive `ToolAnnotations` from HTTP semantics**: `GET`/`HEAD` → `readOnlyHint: true`; `PUT`/`DELETE` → `idempotentHint: true`; `DELETE` (and often `POST`) → `destructiveHint: true`; anything hitting a third-party API → `openWorldHint: true`. Remember they are hints and clients treat them as untrusted. (§6.2)
9. **Auth for stdio output: none.** Keep API keys/bearer tokens for the *upstream* API in env/config exactly as today. Do not generate OAuth code paths into stdio servers. Log to stderr; don't adopt the deprecated `logging` feature. (§4)
10. **Auth for HTTP output: generate a *resource server*, not an authorization server.** The minimal conformant surface is: a PRM document at `/.well-known/oauth-protected-resource[/<path>]` listing external `authorization_servers` and the canonical `resource` URI; a 401 with `WWW-Authenticate: Bearer resource_metadata="…", scope="…"`; JWT/introspection validation with **audience == canonical server URI**; 403 + `insufficient_scope` challenges; scope-hierarchy awareness. Make the canonical URI and issuer(s) explicit configuration — they cannot be inferred reliably behind proxies. (§3.2–3.5, §3.8)
11. **Never forward the inbound MCP access token to the upstream API.** This is the single most tempting shortcut for an OpenAPI wrapper and the spec's most explicit MUST NOT. Upstream credentials must be a *separate* token: a server-held API key, a client-credentials grant, or — if it must be per-user — a separate delegated token obtained by the MCP server acting as an OAuth client to the upstream AS. (§3.3, §5)
12. **If you do per-user upstream delegation, you are an "MCP proxy server" and the confused-deputy MUSTs apply**: per-client consent registry, consent UI requirements, `__Host-` cookies, exact redirect matching, `state` handling. That is a substantial, security-sensitive body of code; consider making it an explicit opt-in feature, not a default. (§5)
13. **Pick/recommend IdPs by MCP fit**: RFC 8414 or OIDC Discovery metadata, `code_challenge_methods_supported` present, RFC 8707 `resource` honored (so `aud` is meaningful), and ideally CIMD (`client_id_metadata_document_supported`) since DCR is deprecated. None of this is the generated server's code, but a generator's docs/templates should say it. (§3.6, §3.7)
14. **Scope design should map to the OpenAPI surface**: e.g. `scopes_supported` = minimal read scopes; per-operation required scopes emitted in a single 403 challenge; `tools/list` optionally filtered by granted scopes. OpenAPI `security`/`securitySchemes` scopes on operations are a natural input for this. (§3.8)
15. **Observability is now spec-shaped**: read `_meta.traceparent`/`tracestate`/`baggage` as parent context and propagate W3C headers to the upstream HTTP call; don't invent a prefixed key. Logging's official migration path is "use OpenTelemetry", which aligns with an instrumentation-layer product. (§6.4)
16. **Long-running upstream operations (202 + job URL) map onto the Tasks extension**, opt-in via `capabilities.extensions["io.modelcontextprotocol/tasks"]` — worth designing for but not required for a first HTTP release. (§6.5)
17. **Keep the existing conformance fixes**: unknown tool → `-32602` protocol error; execution failures → `isError: true`. Both remain correct in `2026-07-28`. (§6.9)

---

## Sources

All accessed **2026-09-02**. Spec pages were fetched as their `.md` renderings (append `.md` to the URL) via `curl`; blog/GitHub pages via web extraction.

- **S1** — Key Changes (2026-07-28 changelog): https://modelcontextprotocol.io/specification/2026-07-28/changelog
- **S2** — "The 2026-07-28 Specification" (official blog, GA post; also read the Hugo source at `blog/content/posts/2026-07-28-spec-ga/index.md` on GitHub `main`): https://blog.modelcontextprotocol.io/posts/2026-07-28/
- **S3** — GitHub release tag `2026-07-28` (commit `5f5440b`, released by @localden 2026-07-28): https://github.com/modelcontextprotocol/modelcontextprotocol/releases/tag/2026-07-28
- **S4** — Transports overview: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports
- **S5** — Base protocol overview (Statelessness, Auth, `_meta`, JSON Schema usage, `icons`): https://modelcontextprotocol.io/specification/2026-07-28/basic
- **S6** — Streamable HTTP: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- **S7** — Authorization: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- **S8** — Authorization Server Discovery: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery
- **S9** — Client Registration: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration
- **S10** — Authorization Security Considerations: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations
- **S11** — stdio transport: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio
- **S12** — Discovery (`server/discover`): https://modelcontextprotocol.io/specification/2026-07-28/server/discover
- **S13** — Tasks extension overview: https://modelcontextprotocol.io/extensions/tasks/overview
- **S14** — SEP-414: Document OpenTelemetry Trace Context Propagation Conventions (Final): https://modelcontextprotocol.io/seps/414-request-meta
- **S15** — Tools: https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- **S16** — Versioning and Compatibility (era model, compatibility matrix): https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
- **S17** — Security Best Practices (docs tutorial, 2026-07-28): https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices
- **S18** — Authorization Extensions overview: https://modelcontextprotocol.io/extensions/auth/overview
- **S19** — OAuth Client Credentials extension: https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials
- **S20** — Enterprise-Managed Authorization extension: https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization
- **S21** — Elicitation: https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation
- **S22** — 2025-11-25 Key Changes (for the diff baseline): https://modelcontextprotocol.io/specification/2025-11-25/changelog
- **S23** — Deprecated Features registry: https://modelcontextprotocol.io/specification/2026-07-28/deprecated
- **S24** — Draft changelog (empty as of access date): https://modelcontextprotocol.io/specification/draft/changelog
- **S25** — "The 2026-07-28 MCP Specification Release Candidate" (official blog; RC locked 2026-05-21): https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
- **S26** — TypeScript SDK README (`main` = v2, implements 2026-07-28; v1.x support window): https://github.com/modelcontextprotocol/typescript-sdk
- **S27** — TypeScript SDK releases (`@modelcontextprotocol/*@2.0.0`, `1.30.0` on 2026-07-27): https://github.com/modelcontextprotocol/typescript-sdk/releases
- **S28** — SEP-986: Specify Format for Tool Names (Final; proposes 1–64 and `/`, superseded by spec text): https://modelcontextprotocol.io/seps/986-specify-format-for-tool-names
- **S29** — Schema Reference, `ToolAnnotations` (2026-07-28): https://modelcontextprotocol.io/specification/2026-07-28/schema
- **S30** — ext-tasks repository README (schema `2026-07-28` Stable): https://github.com/modelcontextprotocol/ext-tasks
- **S31** — Extensions Overview (identifiers, negotiation, `ext-*` repos): https://modelcontextprotocol.io/extensions/overview
- **S32** — 2025-11-25 Authorization (baseline for DCR/CIMD wording): https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization

Standards referenced by the spec (not independently re-read in this pass): OAuth 2.1 `draft-ietf-oauth-v2-1-13`, RFC 6750, RFC 8414, RFC 7591, RFC 8707, RFC 9728, RFC 9207, RFC 9700, `draft-ietf-oauth-client-id-metadata-document-00`, OpenID Connect Discovery 1.0, OIDC Dynamic Client Registration 1.0, W3C Trace Context, W3C Baggage.

### Things I did not verify

- Whether `openapi-mcp-generator` (mcpforge's upstream) has adopted TypeScript SDK v2 / `2026-07-28`. Out of scope for a spec report; flagged because bullet 1 of §7 depends on it.
- The current IETF status of the CIMD draft beyond the `-00` pinned by the spec.
- The status of SEP-2028 (forwarding `_meta` to HTTP headers).
- Any SDK-specific defaults (e.g. whether SDK v2's HTTP transport validates `Origin` or `Mcp-*` headers by default). The spec requirements are as stated; SDK behavior should be checked in code.
