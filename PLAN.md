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

**Decision (Aug 30, 2026): NOT building CLI telemetry, even opt-in.** Reversing the original plan above. Rationale: klaridian targets developers who may generate servers for sensitive/regulated APIs (healthcare, finance, EU data) where auditability and trust matter — the same principle already stated below ("infrastructure touching production data... needs to be auditable"). A CLI that phones home at all, even anonymously and opt-in, is exactly the kind of thing a security/compliance-conscious team flags when evaluating whether to use a tool, undermining that positioning before it's even established. The signal we'd get from it (usage counts, popular plugins) is also cheaply approximated without it — GitHub stars, npm/PyPI download counts, issues, direct community feedback — so the trust cost isn't justified by the data value. If real demand for aggregate usage insight emerges later, the correct mechanism is a clearly-documented, default-off, no-PII opt-in with the exact payload published in the README — not something to build speculatively now. Validation for Phase 1 (whether to build a paid layer) should rely on the waitlist prompt and direct community engagement instead, not CLI-collected telemetry.

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
- [ ] Where to launch for initial validation — **tracked in Plane: MCPFO-15.**
- [x] Project name: **klaridian** (decided Aug 30, 2026) — **superseded, see section 13 below: name collision found (real npm package + real GitHub project both already named `klaridian`), rebrand decided Sep 3, 2026 to `klaridian`, tracked in Plane MCPFO-13.**
- [ ] Concrete metrics for "enough signal" to move to Phase 1 — **tracked in Plane: MCPFO-16.**
- [ ] **Differentiation path after the FastMCP feature-matrix finding (Aug 30, 2026)** — see ARCHITECTURE.md sections 21-24. FastMCP (the dominant Python MCP framework, ~16M weekly PyPI downloads) already ships native, zero-config OpenTelemetry by default; a competing generator (`mcp-generator-3.x`) already combines OpenAPI→FastMCP generation with OTel, OAuth2/JWT auth, middleware, and MCP Resources. klaridian's OTel plugin is therefore **not differentiated** for anyone already on FastMCP/Python — only the PostHog (product observability) plugin remains a clearly unique offering across the whole space (Python or TypeScript). Five candidate paths recorded in ARCHITECTURE.md section 22: (a) multi-language — **shipped** (section 23): a native FastMCP middleware (`packages/python-posthog-middleware/`) attaches PostHog product-observability capture to any FastMCP server, layering on top of FastMCP's own native OTel rather than competing with it; (b) go deeper on product observability itself — **tracked in Plane: MCPFO-17**; (c) usage-driven tool curation/pruning — **superseded by a broader, better-validated decision, see below**; (d) hosted correlation/fleet layer (section 4) — **tracked in Plane: MCPFO-19**, gated on the existing 20-50-user signal threshold; (e) generator-agnostic post-processing `instrument` command — **tracked in Plane: MCPFO-18**.

- [x] **Tool curation — mechanism decided and implemented (Aug 30, 2026, ARCHITECTURE.md sections 24-25; superseded in current priority by MCPFO-8, tag-independent curation).** Deep market research (4 parallel research passes: MCP ecosystem trajectory, developer pain points from forums/issue trackers, competitive/funding landscape, enterprise adoption blockers) converged on "tool bloat / context overload" as the single strongest, most independently corroborated pain point in the whole MCP ecosystem — stronger signal than product-analytics demand, and specifically called out for OpenAPI→MCP generators (klaridian's own category) as producing servers that are "technically correct but behaviorally poor." This supersedes the original narrower "usage-driven pruning" framing of path (c) above: **the user explicitly rejected LLM-suggested curation and usage-data-gated curation as the primary mechanism** (chicken-and-egg problem — usage data doesn't exist on day one) in favor of **user-chosen filtering at generation time**. Investigated and ruled out OAuth consent-screen-style or MCP-client-side tool toggles as something klaridian could build (both are client/transport responsibilities outside a stdio-only generator's control — see section 24 for the full investigation). Mechanism validated with real code: `openapi-mcp-generator`'s `x-mcp: false` spec extension is already respected by `generateMcpServer()` — confirmed by generating a real test spec and inspecting output. **Tracked in Plane: MCPFO-9** (interactive checkbox prompt + `--include-tags`/`--exclude-tags`/`--exclude-operation-ids` flags, applied by pre-processing the spec's `x-mcp` values before generation). This is a generation-time concern, complementary to (not competing with) the `otel`/`posthog` plugins — curation controls what tools exist, instrumentation observes how existing tools get used. A later iteration could feed real PostHog usage data back into curation as an optional, still user-approved suggestion — but that's an enhancement once real users exist, not a blocker to shipping the user-chosen mechanism now.

---

## 6. Concrete next steps (once there's time / full connectivity)

**Done — superseded by actual build progress (sections 7+ below, and the current Plane backlog).** This original 4-item bootstrap list (spike → stack decision → README → minimal CLI) was the pre-code starting point; all of it has since happened. Kept here only as historical context for how the project started, not as a live task list.

---

## 7. Distribution norm: why MCP servers are conventionally open source, and what that implies for klaridian (Aug 30, 2026)

Prompted by a direct question: MCP servers in the wild are overwhelmingly open source (Datadog's, PostHog's, Wavix's own published server, the reference servers in the MCP org) — worth understanding *why*, not just following the convention, because the reason determines which parts of klaridian's own distribution it actually constrains.

**The real reason (not just industry habit):** an MCP server runs with real operational credentials (API keys, DB connections, write access) *and* sits directly in the decision loop of an autonomous agent that chooses when to invoke it. That combination — real credentials + non-human, non-deterministic caller — is a materially higher trust bar than a normal backend service a human calls deliberately. A closed-source binary of unknown provenance running with production credentials next to an agent is a much harder sell than the same thing behind a human-reviewed API call. Open source (or at minimum, fully readable generated source) is the cheapest way to earn that trust: anyone can audit exactly what a tool call does before wiring it to their credentials. This is the same principle already recorded in section 3 above (\"infrastructure touching production data... needs to be auditable\") — this section makes explicit that it applies not just to the klaridian CLI itself, but to *the servers it generates*.

**What this confirms (already the right call, now with an explicit reason) — no changes:**
- CLI + all plugins (`otel`, `posthog`, `amplitude`, `mixpanel`) as MIT/Apache: already decided (section 3), now grounded in a concrete mechanism rather than \"open-core is common in dev tooling.\"
- The paid layer (section 4, hosted fleet/correlation dashboard) can stay closed **because it never runs inside the generated server** — it's an external, opt-in SaaS that never touches the agent's credential path. No tension with the norm above; the norm is about what runs *next to the agent*, not about klaridian's own business model.

**What this newly locks down as an explicit architectural rule (previously an accidental pattern, not a stated principle):**
- **Plugin runtime code must always ship as vendored source inside the generated project, never as an opaque compiled npm dependency.** `render/instrument.ts`'s `getTemplateContributions()` already does this today (writes `src/instrumentation/<plugin-id>.ts` as literal, readable, comment-annotated source into the output) — but this was an implementation detail, not a documented constraint. Recording it here as a rule: a tempting future \"simplification\" (publish `@klaridian/otel-runtime` on npm and `import` it instead of vendoring the file) would silently recreate exactly the trust gap this section describes — the generated server's actual tool-call-wrapping logic would become an opaque dependency again, even though the generator itself stayed open source. Any new plugin, and any refactor of existing plugins, must preserve vendored-source-in-output as a hard constraint, not an implementation convenience that can be optimized away.

**Concrete gap identified and closed the same day (see ARCHITECTURE.md section 27 for the technical implementation):** the generated server itself shipped with no `LICENSE` file and no `license` field in its `package.json` — a real, visible inconsistency against the norm described above for anyone inspecting a freshly generated project. Fixed via a new `--license <mit|apache-2.0|none>` flag on `klaridian generate` (default `mit`), writing a real `LICENSE` file and setting `package.json`'s `license` field accordingly; `--license none` is supported but prints an explicit warning rather than silently omitting the file, consistent with the project's \"fail loudly, don't guess\" principle applied to omission, not just errors.

**Not addressed by this section, deliberately left as a follow-up:** whether the `klaridian` CLI itself is published to the npm registry for `npx klaridian generate ...` zero-install usage — a separate, real distribution question that affects discoverability/adoption friction but not the open-source-trust argument this section is about. **Tracked in Plane: MCPFO-14** (also blocked on the rebrand, MCPFO-13).

**Premise correction (Sep 2, 2026 — from the four-report research pass, see ARCHITECTURE.md section 37 and `docs/research/2026-09-02-*.md`):** an earlier working assumption in this project was that "open source is a requirement in many marketplaces," which is why the trust/auditability argument above felt doubly load-bearing. The research corrected this. Open source is **NOT** required by the major remote connector programs — claude.ai Connectors, ChatGPT Apps, the official MCP Registry ("supports both open-source and closed-source"), Docker (remote), Smithery, Glama connectors, or Copilot Studio. It is required only for **local/stdio distribution channels**: Anthropic MCPB extensions and plugins, Docker-local, the Glama OSS track, Cursor plugins, and Gemini CLI extensions. The real hard gate across Anthropic, OpenAI and Microsoft is **API ownership** — the publisher must own or legitimately proxy the upstream API ("unofficial connectors … cannot be approved"), which cannot be satisfied by a third party wrapping someone else's OpenAPI spec. Two consequences for klaridian's positioning: (1) the target user is sharpened to **the owner of an API** making it agent-callable, not an integrator wrapping a foreign spec; (2) the trust/auditability argument (sections 3/7) does not *lose* value — it stops being about clearing a listing checkbox and becomes purely about what it always really was: earning the confidence of the people who run the generated server with production credentials next to an autonomous agent. Separately, because an MCP server is an OAuth **resource server** (not an OAuth client), an open-source server ships **no client secret** — so "open source" and "OAuth 2.1 support" are not in tension, contrary to a mid-discussion assumption. The generator-vs-framework question that prompted this pass was answered in favor of **staying a standalone code generator** (with the protocol/transport layer coming from the official MCP SDK, the tool surface generated), recorded in full in ARCHITECTURE.md section 37 rather than duplicated here — it is a technical/architecture decision, not a business one.

## 8. Containers: where they help, where they don't (Aug 30, 2026)

Raised directly: does containerization make sense anywhere in this project? Two genuinely different questions, answered separately rather than conflated:

**For contributors developing klaridian itself:** a devcontainer (`.devcontainer/devcontainer.json`, the VS Code/Codespaces-standard reference implementation) is a real, low-cost win — pins the Node version, gives every contributor an environment identical to CI, and directly supports the "always re-check from a clean install" discipline already established for dependency-vulnerability auditing (section 7 above / ARCHITECTURE.md section 18). Not yet built; worth doing before accepting outside contributions.

**For the CLI's own runtime:** no case found. `klaridian` is a plain Node/TypeScript CLI with no exotic system dependencies — containerizing the dev loop (`npm run build && npm test`) would add friction with no corresponding benefit.

**For the *generated server* (the more interesting question):** real signal found, but with an important caveat discovered while validating it. Docker itself is pushing containers as the standard MCP server distribution mechanism (Docker MCP Catalog, publicly positioned as "every MCP server that moves from npx execution to containerized deployment is a win") — directly for the same trust reason as PLAN.md section 7: `npx`-executed servers run arbitrary code with full host access (filesystem, network, env vars/secrets), which is exactly the credentials-next-to-an-autonomous-agent trust gap this project already reasons about. So a `--docker` flag on `klaridian generate` (writing a minimal, least-privilege Dockerfile alongside the generated server) is a real, validated idea — but genuinely useful containerization only works for network-based transports, not stdio: MCP tooling (Claude Code, etc.) spawns `docker run -i` as if it were a normal child process, but the container is actually managed by the Docker daemon independently — when the client's session ends, the `docker run` CLI process exits but the container itself doesn't, leaking orphaned containers holding open connections indefinitely (a documented, real problem in the wider MCP ecosystem, not speculative). This is exactly why `--docker` is gated on non-stdio transport support existing first (see ARCHITECTURE.md section 29, where stdio-only was lifted) — and, per that section's own finding, further gated on the `streamable-http` transport's real upstream bug being fixed, since containerizing a transport that crashes on its second request wouldn't be a meaningful deliverable yet.

**Not built in this session:** neither the devcontainer nor `--docker`. The devcontainer was since built (section 11). `--docker` is tracked in Plane: **MCPFO-12** (gated on the prerequisites above, including the upstream streamable-http fix, MCPFO-10).

## 9. Upstream contributions to `openapi-mcp-generator`: tracked, not yet filed (Aug 30, 2026)

Two real bugs/gaps have been found in `openapi-mcp-generator` (klaridian's generation-engine dependency, section 16) during klaridian's own audits — both currently worked around on klaridian's own side, but the durable fix belongs upstream. Explicitly parked here per direct instruction ("let's discuss a PR to their project later") rather than actioned immediately — recorded now so the intent and the specific asks aren't lost between sessions.

**Item 1 — `streamable-http` transport crash (ARCHITECTURE.md section 29).** Its generated `src/streamable-http.ts` throws `TypeError [ERR_INVALID_STATE]: Invalid state: ReadableStream is locked` (inside the `fetch-to-node` dependency's `http-incoming.js`) on the second HTTP request to an established session — reproduced against a vanilla, unpatched `openapi-mcp-generator` project with zero klaridian involvement, confirmed on both Node v22.19.0 and v26.7.0/v26.8.1. klaridian's own workaround: none yet — this transport is generated but documented as not currently usable past the first request (README, ARCHITECTURE.md section 29).

**Item 2 — no verbosity/silent option on `generateMcpServer()` (ARCHITECTURE.md section 33).** `generateMcpServer()` writes ~56 hardcoded `console.error`/`console.warn`/`console.log` progress lines with no way to suppress them via its public `CliOptions` API — meaning every consumer of the library, not just klaridian, has no supported way to build a quiet/scriptable/JSON-output mode around it. klaridian's own workaround: `withConsoleSuppressed()`, a scoped `console.*` monkey-patch around the single call site, engaged only under `--quiet`/`--json` (section 33) — functional, but explicitly documented there as a workaround, not the right long-term fix.

**Why parked rather than filed now:** both are real, reproducible, and already have a clear, minimal proposed fix (item 1: root-cause and patch the `fetch-to-node` interaction, or document/skip it; item 2: accept an optional `logger`/`silent` field on `CliOptions`, defaulting to today's behavior for backward compatibility) — but filing a well-formed upstream PR (tests, matching the maintainer's existing code style, a clear repro) is real work worth doing deliberately in a dedicated session, not squeezed in as a side effect of an unrelated task. Both items are good candidates for a **single combined PR session** later: same upstream repo, same general shape ("klaridian's own audits found these while using your library for real, here's a fix for each"). **Tracked in Plane: MCPFO-10** (streamable-http crash) and **MCPFO-11** (logger/silent option).

## 10. Should klaridian also ship an MCP server (not just the CLI)? Decided: no, not for `generate` (Aug 30, 2026)

Raised directly, since klaridian's whole domain is MCP servers — worth checking rather than assuming the answer is "obviously yes." Researched the actual decision framework the harness ecosystem itself uses in 2026 (not first-principles guessing): a widely-cited comparison (parallel.ai, Aug 2026) distills how Hermes, Pi, and OpenClaw actually choose between MCP server / agent skill / bare CLI for a given capability, backed by concrete case studies from each. Applied that framework directly to `klaridian generate`, rather than treating "should we have an MCP server" as a branding question.

**The decision rule from that research, stated precisely:** pick MCP when the tool is a *hosted service* — needs OAuth, holds state on someone else's server, benefits from typed schemas and per-tool approval gating, or must work in a harness with no shell access. Pick a CLI (optionally wrapped in a skill) when the tool is local, composable, stateless, and its `--help` is self-explanatory. The article's own worked example (Parallel's web search, shipped as both a hosted MCP server *and* a CLI-as-skill) makes the point concrete: same capability, different mechanism depending on which side of that line it's on.

**Applied to `klaridian generate`:**
- **No hosted state, no OAuth, no multi-tenant concern.** `generate` reads a local/URL-referenced OpenAPI spec and writes local files. Nothing about it is a "service" in the sense that makes MCP's actual value proposition (auth flows, per-tool approval gating, server-side state) apply. This is the single biggest disqualifier per the framework above.
- **Context cost with no offsetting benefit.** An MCP server would inject `generate`'s ~20 flags into every connected agent's context on every turn, whether used or not — the exact "GitHub's server is the notorious example" cost the research explicitly flags. A CLI invoked via `Bash` costs near-zero context until actually called.
- **The typed-I/O and approval-gating value MCP would add is already delivered more cheaply.** This is the direct payoff of the CLI-UX work from sections 32-33: `--json` already gives structured, parseable output (success and failure, with a stable `stage` tag); exit codes already signal outcome; `--force`/non-TTY detection already handle the safety-rail concerns a schema-typed MCP tool would otherwise need to encode. Building an MCP server around the same `generate` command now would be re-wrapping the same capability in a strictly more expensive channel for no new capability — not a complementary interface, a redundant one.
- **No persistent process/session to justify it either.** Contrasted directly against a real precedent found during research (`xprof-cli`, which *does* ship both a CLI and an MCP server) — that tool's dual-interface makes sense because it keeps a long-lived process with loaded profiling data, where an MCP session avoids re-parsing large files per call. `klaridian generate` is the opposite: one invocation, one complete result, nothing to keep warm between calls. The precedent that justifies dual-interface elsewhere doesn't transfer here.

**Decision: no MCP server for `klaridian generate`, or the CLI generally, at this time.** Documented explicitly so this doesn't get re-litigated without a new reason to reconsider it — the reasoning above is specific to the current shape of the CLI (stateless, local-only, no auth), not a general "CLIs never need MCP servers" stance.

**Where the answer would flip — recorded, not built:** the hosted correlation/fleet layer (section 4, Phase 1, still gated on real demand signal) is a genuinely different case. If/when that layer exists, it *is* a hosted, stateful, multi-tenant service — exactly the profile the framework says MCP is the right fit for. At that point, that service exposing its own MCP server (so an agent could ask "what's my fleet's current cost per task" without a human opening a dashboard) would be a natural, well-justified feature — not an extension of `generate`'s interface, but a new interface for a genuinely different, future product. Nothing to build now; recorded so the distinction (CLI-only today, MCP-eligible only for the future hosted layer) isn't lost.

## 11. Devcontainer for contributors: built and validated (Aug 31, 2026)

Follows through on section 8's identified-but-unbuilt item: a devcontainer for anyone contributing to klaridian itself, pinning the exact toolchain versions `.github/workflows/ci.yml` runs against so a contributor's local environment can't silently drift from CI.

**What was built — `.devcontainer/devcontainer.json` + `.devcontainer/post-create.sh`:**
- Base image `mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm` — Node 22, matching `ci.yml`'s `node-version: "22"` for the CLI job exactly (not "whatever recent LTS," a real version pin).
- `ghcr.io/devcontainers/features/python:1` at version 3.11 — matching `ci.yml`'s `python-version: "3.11"` for the `python-posthog-middleware` job. One container now covers both CI jobs' toolchains, since this is a small two-package monorepo, not two separate devcontainers.
- `ghcr.io/devcontainers/features/github-cli:1` — `gh` CLI included, matching how the maintainer already authenticates to GitHub (HTTPS + `gh`, no SSH key, per this profile's own recorded convention).
- `postCreateCommand` runs `.devcontainer/post-create.sh`, which installs both packages' dependencies (`npm install` for `packages/cli`, `pip install -e ".[dev]"` for `packages/python-posthog-middleware`) — deliberately mirroring `ci.yml`'s own "Install" steps line for line, so "what CI does" and "what a fresh devcontainer does on open" don't silently diverge into two different setup procedures.
- `remoteUser: "node"` — runs as the base image's existing non-root user, standard devcontainer practice, not root.

**Validated end to end with the real `@devcontainers/cli`, not assumed to work from the config alone:**
- `npx @devcontainers/cli up --workspace-folder .` — a real container build from the spec above, `postCreateCommand` observed actually running and completing both installs (real `npm install` output, real `pip install` output for `fastmcp`/`posthog`/etc., not a dry run).
- `npx @devcontainers/cli exec ... -- node --version` / `python3 --version` / `gh --version` — confirmed the exact expected versions inside the running container (Node v22.16.0, Python 3.11.16, `gh` 2.98.0), not just that the feature declarations parsed.
- **The real test**: ran both packages' actual test suites *inside* the container via `@devcontainers/cli exec` — `cd packages/cli && npm test` (44/44 passing, identical to running outside the container) and `cd packages/python-posthog-middleware && pytest tests/` (3/3 passing) — proving the devcontainer is a genuinely working development environment for this repo, not just a config file that looks plausible.
- Test container removed after validation (`docker rm -f`), not left running.

**Scope kept deliberately narrow:** no VS Code Codespaces-specific configuration beyond the standard `customizations.vscode.extensions` (ESLint, Prettier, Python) and `editor.formatOnSave` — nothing this project doesn't already conventionally use. No attempt to containerize anything beyond the dev environment itself (the CLI's own runtime, and the generated servers, were both already assessed in section 8 as not benefiting from containerization at this time).

## 12. Dogfooding against a real public spec: tag-based curation doesn't hold up — now the top priority (Sep 1, 2026)

A deliberate step back before continuing down the technical backlog (naming, upstream PR, `--docker`): every prior validation used either the tiny Petstore fixture or an unnameable "production spec" from an earlier session — never a spec independently checkable, and critically, never one big enough to stress-test the project's own headline differentiator (tool curation, section 5's differentiation research + ARCHITECTURE.md sections 24-25). Chose Stripe's public, MIT-licensed OpenAPI spec (`stripe/openapi`) specifically to avoid any ambiguity about whose data was used — not the maintainer's employer, not any private spec, a spec published by a third party expressly for tools like this to validate against (see ARCHITECTURE.md section 34 for the full technical write-up).

**The finding that changes prioritization:** Stripe's spec — the largest, most-referenced real public API spec in the ecosystem — has **zero OpenAPI tags on any of its 594 operations**. klaridian's entire tool-curation mechanism (`--include-tags`, `--exclude-tags`, the interactive checkbox prompt) is tag-based, and against this spec it does **nothing at all** — every one of the 594 operations lands in a single "(untagged)" bucket. The only remaining lever, `--exclude-operation-ids`, requires listing hundreds of individual IDs to get down to a workable tool count, which isn't a realistic workflow.

**Why this matters more than the rest of the current backlog:** the tool-bloat/curation problem is klaridian's most validated differentiator (section 5's 4-pass market research named it the single strongest pain point in the whole MCP ecosystem, stronger than product-analytics demand). Finding that the *mechanism built to solve it* doesn't work against the most realistic large spec available is a bigger problem than anything on the current technical list (npm naming, the upstream PR, `--docker`) — those are all real, but none of them touch whether the core value proposition holds up under realistic conditions. Naming a product well doesn't matter if the thing it names doesn't work against real large APIs.

**Reprioritization, recorded explicitly:** before naming/npm publishing/upstream-PR work, the next concrete technical priority is a **tag-independent curation mechanism** — the shape isn't decided yet (candidates: path-prefix/regex filtering, HTTP-method filtering, a user-supplied operationId allowlist file instead of a CLI-flag list, or resurrecting the LLM-assisted curation idea previously rejected in section 24 but revisiting it now that the rejection's original reasoning — "usage data doesn't exist on day one" — doesn't apply to a *structural* suggestion, not a usage-driven one). **Tracked in Plane: MCPFO-8** (top priority).

## 13. Rebrand decision: `mcpforge` → `klaridian` (Sep 3, 2026)

**Why this was forced:** the name `mcpforge` collides with real, active products — an existing npm package, and existing GitHub/domain activity under the same or confusingly similar name (`mcpforge.dev`/`.org` territory already occupied) — a real trademark/confusion risk once this project goes public, not just an unavailable exact npm slug. Blocks MCPFO-14 (npm publish), MCPFO-15 (launch channel), and any MCP Registry listing (server.json/mcpName, MCPFO-25) until resolved. Per direct instruction, the new name must **not** contain "mcp" — the project intends to expand into adjacent CLI/SDK generation beyond MCP specifically, so a name locked to "mcp" would be a second naming debt later.

**Process:** ~54 candidates evaluated in three batches against the three-axis check from the `product-naming-availability-check` skill (domain DNS via direct `dig ... NS`/`NXDOMAIN`, package registries — npm/PyPI/crates.io, and real-product/company collision via targeted web search) — not just "domain looks free," which is the trap the skill specifically warns about. The overwhelming majority of short abstract candidates (Vercel/Stripe/Linear-style, the user's requested style) failed on `.com` being squatted even with no real product behind it — confirms the skill's warning that this naming space is broadly saturated, not a one-off unlucky batch.

**Follow-up: manual e2e comparison vs. Stripe's own official MCP server (Sep 3, 2026).** Reused the Stripe spec fixture from earlier in this section to actually spawn a klaridian-generated server and drive it live over stdio (`initialize` + `tools/list`) — real build, real process, not string-shape checks. Confirmed: 594 flat tools (`GetAccount`, `PostAccountLinks`, `DeleteAccountsAccount`, ...), one per operation, exactly as predicted.

Compared against Stripe's own published MCP server (`https://mcp.stripe.com`, docs.stripe.com/mcp): it does **not** expose 594 tools. It exposes ~10-15 hand-curated meta-tools: `stripe_api_search` (keyword search over API methods), `stripe_api_details` (schema for one method), `stripe_api_read`/`stripe_api_write` (generic executors for any GET / POST-PATCH-PUT-DELETE method), plus a handful of product tools (`get_stripe_account_info`, `stripe_analytics`, `search_stripe_documentation`, `stripe_report`, etc.).

**What this confirms, with a real side-by-side instead of just benchmark literature:** klaridian's default generation mode (1 tool per operation) is exactly what the API owner who knows this surface best chose *not* to ship to agents. Stripe's own answer to their own tag-less, 594-operation spec is the search+execute/meta-tool pattern (see the `docs/research/2026-09-02-mcp-server-best-practices.md` "third mode" note and the Twilio `search`/`retrieve` precedent already logged above) — not static per-operation tools, and not tag-based curation (which we already found doesn't work on this spec either, since it has zero tags).

**Decision, still deferred:** this is real corroborating evidence, not just vendor benchmark data, that a search+execute generation mode would address a validated real-world case — but it remains a genuine new-architecture undertaking (reverses the section-16 delegation-only design, unproven `execute` path even in Stripe's/Twilio's own servers) and is NOT queued ahead of shipping v1 (domain, npm/PyPI publish, MCPFO-21/22 remainder). Tracked as a candidate post-v1 feature, not started.

**Decision: `klaridian`.** Verified clean on all three axes on Sep 3, 2026:
- **Domain (direct `dig ... NS`, NXDOMAIN):** `.com`, `.dev`, `.io`, `.ai` all unregistered.
- **Packages:** npm `klaridian` and `@klaridian/*` scope — unpublished (404). PyPI `klaridian` — unpublished (404). crates.io — no collision found.
- **GitHub:** `klaridian` user/org handle unclaimed (404). Repository search for "klaridian" — 0 results.
- **Real-product/trademark collision:** no active company, app, or product found under this exact name. The only phonetically-adjacent hits are unrelated and not live tech products: "Klaridan Group Ltd" (obscure UK restaurant-sector company, no digital presence), "Clariden"/"Clariden Leu" (Swiss private bank, merged into Credit Suisse in 2012, defunct), "Claridion"/"Clariti Software" (unrelated government permitting software, different name). None is a live collision under trademark-style scrutiny.

**Honest residual risk (per the skill's own guidance):** this is a point-in-time clearance, not a permanent guarantee — the dev-tool naming space moves fast. Re-verify before the actual public launch if there's a meaningful gap between this decision and going live.

**Not yet done (deliberately, next steps once the repo-side rename lands):** registering the domain, reserving the GitHub org/npm scope, and updating README.md/package.json/CLI binary name — those are execution steps for MCPFO-13, not blocked on further research. This section records the *decision*; the rename execution is tracked as the remaining scope of MCPFO-13 in Plane.

**Execution complete (Sep 3, 2026, commit 2865fe0):** GitHub repo renamed `ricardocvasconcelos/mcpforge` → `ricardocvasconcelos/klaridian` (old URL auto-redirects); `package.json` workspace name, `packages/cli` package (`@klaridian/cli`) and CLI binary (`klaridian`); Python middleware package (`klaridian-posthog-middleware` / module `klaridian_posthog_middleware`); all `MCPFORGE_*` env vars renamed to `KLARIDIAN_*`; every text reference across README/ARCHITECTURE/CLAUDE/CONTRIBUTING/SECURITY/devcontainer/docs/tests/source updated. Validated end to end before push (clean build, full 99-test CLI suite, 3-test Python suite, both green under the pre-push hook). MCPFO-13 closed in Plane. Still open, separately: registering the actual `klaridian.com`/`.dev` domain, and publishing the renamed packages to npm/PyPI.






