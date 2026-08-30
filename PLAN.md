# MCP Server Generator with Built-in Observability Plugins — Strategic Plan

> Product/business planning document. This is not a code implementation plan —
> it exists to guide decisions before writing a single line of code.

**Date:** August 30, 2026
**Author:** Ricardo Vasconcelos (with Hermes)
**Status:** Initial draft — validate hypotheses before building

---

## 1. Problem

Anyone building an MCP server today to expose their own API/product to agents has to:
1. Write the server by hand (or generate it from an OpenAPI spec — this already exists, e.g. FastMCP, Speakeasy)
2. Manually instrument every tool call for engineering observability (OTel spans to Datadog/Grafana/etc.)
3. Manually instrument product events (PostHog, Amplitude) to know which tools get used, by whom, with what success rate

Steps 2 and 3 are repetitive friction that **every** MCP server developer runs into, and today there's no tool that combines "generate the server" with "out-of-the-box instrumentation" in a single flow.

**What already exists and doesn't solve this:**
- Datadog, PostHog, Sentry, and Grafana all have their own MCP servers — but those let an agent *query* those platforms, not automatically instrument a brand-new server you're building.
- MCP generators from OpenAPI specs exist, but without built-in observability plugins.
- SEP-414 (an official MCP spec) already formalizes OpenTelemetry trace-context propagation — it provides the technical plumbing, but nobody has packaged it as a generator plugin.

**Gap validated by research (Aug 30, 2026):** we found no product combining these two pieces. This is a real gap, not an academic exercise.

---

## 2. Value proposition

An **MCP server generator/CLI** where, at server-creation time (from an OpenAPI spec or a manual tool definition), the user picks observability plugins that get wired up automatically:

- **Datadog plugin** (or Grafana/generic OTel) → engineering observability: latency, errors, cost per tool call, distributed spans.
- **PostHog plugin** (or Amplitude) → product observability: tool adoption, agent usage funnels, who's using what.

The generated server is born instrumented. Zero manual integration code.

---

## 3. Business model: Open Core

### Guiding principle
Don't decide the paid layer now — **there isn't enough information yet to know what's worth paying for.**
Building that too early is the most common and most expensive open-core mistake.

### Phase 0 — 100% Open Source (month 1-2)
**Everything free, MIT/Apache 2.0 license:**
- Generator CLI (from OpenAPI spec + manual definition)
- Core plugins: generic OTel, Datadog, PostHog (the 2-3 most requested)
- Server templates (Node and Python at minimum)

**This phase's only goal: adoption and feedback, not revenue.**

**Validation mechanism (without building anything paid):**
- Anonymous opt-in telemetry in the CLI (how many servers generated, which plugins used most)
- Built-in waitlist in the CLI: "want a hosted dashboard to see all this aggregated? [yes/no]"
- Don't build the dashboard until we have ~20-50 real users explicitly asking for it

**Decision (Aug 30, 2026): NOT building CLI telemetry, even opt-in.** Reversing the original plan above. Rationale: mcpforge targets developers who may generate servers for sensitive/regulated APIs (healthcare, finance, EU data) where auditability and trust matter — the same principle already stated below ("infrastructure touching production data... needs to be auditable"). A CLI that phones home at all, even anonymously and opt-in, is exactly the kind of thing a security/compliance-conscious team flags when evaluating whether to use a tool, undermining that positioning before it's even established. The signal we'd get from it (usage counts, popular plugins) is also cheaply approximated without it — GitHub stars, npm/PyPI download counts, issues, direct community feedback — so the trust cost isn't justified by the data value. If real demand for aggregate usage insight emerges later, the correct mechanism is a clearly-documented, default-off, no-PII opt-in with the exact payload published in the README — not something to build speculatively now. Validation for Phase 1 (whether to build a paid layer) should rely on the waitlist prompt and direct community engagement instead, not CLI-collected telemetry.

### Phase 1 — Paid layer (only after validation, not before)
See section 4 for what the paid layer should actually be.

Decision trigger to move forward: clear demand signal (critical mass on the waitlist, or users actively asking for something that doesn't exist yet).

### Why open-core makes sense here specifically
- This is infrastructure touching production data (traces, telemetry) — nobody trusts that to a closed binary from an unknown startup. It needs to be auditable.
- The defensible value isn't the generator itself (a commodity, easily replicated) — it's the ongoing maintenance of plugins as third-party APIs change, plus the aggregation layer (see section 4).
- Open source is also the best distribution strategy in such a niche space (MCP developers): GitHub stars, community-contributed plugins.

### Risk to watch
If the product is just "scaffolder + plugins," it's easy to replicate (Anthropic itself could ship this inside `mcp init` tomorrow). The moat has to live in the hosted aggregation layer, never in the generator itself.

---

## 4. What the paid layer (Phase 1) should be — without overlapping Datadog/PostHog

**Key design principle: don't duplicate data.** The dashboard should NOT store traces/analytics itself — Datadog and PostHog already do that well, and duplicating it is expensive and destroys trust ("why do I need to hand my analytics data to yet another third party?").

Instead, be a **correlation and control layer, one level up**, surfacing things no individual tool can see on its own:

### a) Cross-server correlation of agent tasks
A real agent often calls multiple MCP servers within a single task. Server A's Datadog has no idea about server B. Only a layer above can say: "this agent task took 4.2s, cost $0.03 in tokens, called 3 servers, failed on the third." — genuinely new, no possible overlap.

### b) Fleet inventory / control plane
Which servers were generated, which plugin version each one runs, configuration drift, stale scopes/permissions. Fleet management, not data observability — no overlap possible because Datadog has no notion that your servers exist as a category.

### c) Unified cost attribution
LLM token cost (which neither tool sees natively) plus infrastructure cost per tool call, rolled into one metric: end-to-end cost per agent task.

### d) Smart routing, not storage
Instead of duplicating data: deep links to the right place. Click on a suspicious task → jump straight into Datadog already filtered by the right trace ID, or the right funnel in PostHog. Only correlation metadata gets stored (IDs, timestamps, links) — cheaper to run, more legally defensible, and solves the overlap concern at the root.

### Final positioning
Not "yet another observability dashboard." It's the **control and correlation plane for fleets of MCP servers**, sitting *between* the generator and the observability tools, never duplicating what they already do well.

---

## 5. Open questions / to validate

- [x] Generator tech stack: **TypeScript/Node** (decided Aug 30, 2026 — stronger OpenAPI-generator ecosystem, most published MCP servers are Node-based)
- [x] First plugin to build: **generic OpenTelemetry** (decided Aug 30, 2026). Rationale: OTel is the underlying standard (aligns with MCP's own SEP-414), and every major backend (Datadog, Grafana, Honeycomb, New Relic) consumes OTLP — building on OTel first means one plugin works with all of them via exporter config, avoiding vendor lock-in for users and duplicate work per backend. A Datadog-specific plugin can follow later as a thin, pre-configured wrapper over the OTel exporter (API key + auto-tagging convenience), not a separate instrumentation path.
- [x] Input format: **OpenAPI spec only** for v0 (decided Aug 30, 2026). Manual tool definitions (YAML/JSON schema) deferred until there's signal it's needed — keeps v0 scope tight.
- [ ] Where to launch for initial validation: Hacker News, r/mcp (if it exists), Anthropic Discord/community, X? — **still undecided, revisit closer to a working v0.**
- [x] Project name: **mcpforge** (decided Aug 30, 2026)
- [ ] Concrete metrics for "enough signal" to move to Phase 1 (define the number upfront, not mid-hype)
- [ ] **Differentiation path after the FastMCP feature-matrix finding (Aug 30, 2026)** — see ARCHITECTURE.md sections 21-24. FastMCP (the dominant Python MCP framework, ~16M weekly PyPI downloads) already ships native, zero-config OpenTelemetry by default; a competing generator (`mcp-generator-3.x`) already combines OpenAPI→FastMCP generation with OTel, OAuth2/JWT auth, middleware, and MCP Resources. mcpforge's OTel plugin is therefore **not differentiated** for anyone already on FastMCP/Python — only the PostHog (product observability) plugin remains a clearly unique offering across the whole space (Python or TypeScript). Five candidate paths recorded in ARCHITECTURE.md section 22: (a) multi-language — **first step shipped** (section 23): a native FastMCP middleware (`packages/python-posthog-middleware/`) attaches PostHog product-observability capture to any FastMCP server, layering on top of FastMCP's own native OTel rather than competing with it; (b) go deeper on product observability itself (per-argument analytics, funnels, MCP-specific dashboards) rather than spreading into new languages; (c) usage-driven tool curation/pruning — **superseded by a broader, better-validated decision, see below**; (d) stay the course on the existing hosted correlation/fleet layer (section 4), gated on the existing 20-50-user signal threshold; (e) the most radical option — stop being a generator at all, become a generator-agnostic post-processing `instrument` command that attaches PostHog (and OTel) to *any* already-generated MCP server, sidestepping the "whose generator is best" competition entirely. Path (a) is now partially validated with real code; (b), (d), (e) still open.

- [x] **Tool curation — mechanism decided, not yet implemented (Aug 30, 2026, ARCHITECTURE.md section 24).** Deep market research (4 parallel research passes: MCP ecosystem trajectory, developer pain points from forums/issue trackers, competitive/funding landscape, enterprise adoption blockers) converged on "tool bloat / context overload" as the single strongest, most independently corroborated pain point in the whole MCP ecosystem — stronger signal than product-analytics demand, and specifically called out for OpenAPI→MCP generators (mcpforge's own category) as producing servers that are "technically correct but behaviorally poor." This supersedes the original narrower "usage-driven pruning" framing of path (c) above: **the user explicitly rejected LLM-suggested curation and usage-data-gated curation as the primary mechanism** (chicken-and-egg problem — usage data doesn't exist on day one) in favor of **user-chosen filtering at generation time**. Investigated and ruled out OAuth consent-screen-style or MCP-client-side tool toggles as something mcpforge could build (both are client/transport responsibilities outside a stdio-only generator's control — see section 24 for the full investigation). Mechanism validated with real code: `openapi-mcp-generator`'s `x-mcp: false` spec extension is already respected by `generateMcpServer()` — confirmed by generating a real test spec and inspecting output. Planned (not yet built): interactive tag/operation checkbox prompt at `mcpforge generate` time, plus `--include-tags`/`--exclude-tags`/`--exclude-operation-ids` flags for scripting, applied by pre-processing the spec's `x-mcp` values before generation. This is a generation-time concern, complementary to (not competing with) the `otel`/`posthog` plugins — curation controls what tools exist, instrumentation observes how existing tools get used. A later iteration could feed real PostHog usage data back into curation as an optional, still user-approved suggestion — but that's an enhancement once real users exist, not a blocker to shipping the user-chosen mechanism now.

---

## 6. Concrete next steps (once there's time / full connectivity)

1. Technical validation: build a minimal prototype (spike, not a product) — generate one simple MCP server from a small OpenAPI spec, with a generic OTel plugin wired in manually, to confirm the technical mechanics work before designing the CLI architecture.
2. Decide stack and repo structure.
3. Write README + public positioning before code (clarity forces focus).
4. Ship a minimal CLI with 1 plugin (don't wait to have 5 plugins ready — launch early, learn from real usage).
