# MCP Server Generator with Built-in Observability Plugins—Strategic Plan

> Product/business planning document. This is not a code implementation plan—it
> exists to guide decisions before writing a single line of code.

**Date:** August 30, 2026
**Author:** Ricardo Vasconcelos (with Hermes)
**Status:** Initial draft—validate hypotheses before building

---

## 1. Problem

Anyone building an MCP server today to expose their own API/product to agents has to:
1. Write the server by hand (or generate it from an OpenAPI spec—this already exists, e.g. FastMCP, Speakeasy)
2. Manually instrument every tool call for engineering observability (OTel spans to Datadog/Grafana/etc.)
3. Manually instrument product events (PostHog, Amplitude) to know which tools get used, by whom, with what success rate

Steps 2 and 3 are repetitive friction that **every** MCP server developer runs into, and today there's no tool that combines "generate the server" with "out-of-the-box instrumentation" in a single flow.

**What already exists and doesn't solve this:**
- Datadog, PostHog, Sentry, and Grafana all have their own MCP servers—but those let an agent *query* those platforms, not automatically instrument a brand-new server you're building.
- MCP generators from OpenAPI specs exist, but without built-in observability plugins.
- SEP-414 (an official MCP spec) already formalizes OpenTelemetry trace-context propagation—it provides the technical plumbing, but nobody has packaged it as a generator plugin.

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
Don't decide the paid layer now—**there isn't enough information yet to know what's worth paying for.**
Building that too early is the most common and most expensive open-core mistake.

### Phase 0—100% Open Source (month 1-2)
**Everything free, MIT/Apache 2.0 license:**
- Generator CLI (from OpenAPI spec + manual definition)
- Core plugins: generic OTel, Datadog, PostHog (the 2-3 most requested)
- Server templates (Node and Python at minimum)

**This phase's only goal: adoption and feedback, not revenue.**

**Validation mechanism (without building anything paid):**
- Anonymous opt-in telemetry in the CLI (how many servers generated, which plugins used most)
- Built-in waitlist in the CLI: "want a hosted dashboard to see all this aggregated? [yes/no]"
- Don't build the dashboard until we have ~20-50 real users explicitly asking for it

**Decision (Aug 30, 2026): NOT building CLI telemetry, even opt-in.** Reversing the original plan above. Rationale: klaridian targets developers who may generate servers for sensitive/regulated APIs (healthcare, finance, EU data) where auditability and trust matter—the same principle already stated below ("infrastructure touching production data... needs to be auditable"). A CLI that phones home at all, even anonymously and opt-in, is exactly the kind of thing a security/compliance-conscious team flags when evaluating whether to use a tool, undermining that positioning before it's even established. The signal we'd get from it (usage counts, popular plugins) is also cheaply approximated without it—GitHub stars, npm/PyPI download counts, issues, direct community feedback—so the trust cost isn't justified by the data value. If real demand for aggregate usage insight emerges later, the correct mechanism is a clearly-documented, default-off, no-PII opt-in with the exact payload published in the README—not something to build speculatively now. Validation for Phase 1 (whether to build a paid layer) should rely on the waitlist prompt and direct community engagement instead, not CLI-collected telemetry.

### Phase 1—Paid layer (only after validation, not before)
See section 4 for what the paid layer should actually be.

Decision trigger to move forward: clear demand signal (critical mass on the waitlist, or users actively asking for something that doesn't exist yet).

### Why open-core makes sense here specifically
- This is infrastructure touching production data (traces, telemetry)—nobody trusts that to a closed binary from an unknown startup. It needs to be auditable.
- The defensible value isn't the generator itself (a commodity, easily replicated)—it's the ongoing maintenance of plugins as third-party APIs change, plus the aggregation layer (see section 4).
- Open source is also the best distribution strategy in such a niche space (MCP developers): GitHub stars, community-contributed plugins.

### Risk to watch
If the product is just "scaffolder + plugins," it's easy to replicate (Anthropic itself could ship this inside `mcp init` tomorrow). The moat has to live in the hosted aggregation layer, never in the generator itself.

---

## 4. What the paid layer (Phase 1) should be—without overlapping Datadog/PostHog

**Key design principle: don't duplicate data.** The dashboard should NOT store traces/analytics itself—Datadog and PostHog already do that well, and duplicating it is expensive and destroys trust ("why do I need to hand my analytics data to yet another third party?").

Instead, be a **correlation and control layer, one level up**, surfacing things no individual tool can see on its own:

### a) Cross-server correlation of agent tasks
A real agent often calls multiple MCP servers within a single task. Server A's Datadog has no idea about server B. Only a layer above can say: "this agent task took 4.2s, cost $0.03 in tokens, called 3 servers, failed on the third."—genuinely new, no possible overlap.

### b) Fleet inventory / control plane
Which servers were generated, which plugin version each one runs, configuration drift, stale scopes/permissions. Fleet management, not data observability—no overlap possible because Datadog has no notion that your servers exist as a category.

### c) Unified cost attribution
LLM token cost (which neither tool sees natively) plus infrastructure cost per tool call, rolled into one metric: end-to-end cost per agent task.

### d) Smart routing, not storage
Instead of duplicating data: deep links to the right place. Click on a suspicious task → jump straight into Datadog already filtered by the right trace ID, or the right funnel in PostHog. Only correlation metadata gets stored (IDs, timestamps, links)—cheaper to run, more legally defensible, and solves the overlap concern at the root.

### Final positioning
Not "yet another observability dashboard." It's the **control and correlation plane for fleets of MCP servers**, sitting *between* the generator and the observability tools, never duplicating what they already do well.

---

## 5. Open questions / to validate

- [x] Generator tech stack: **TypeScript/Node** (decided Aug 30, 2026—stronger OpenAPI-generator ecosystem, most published MCP servers are Node-based)
- [x] First plugin to build: **generic OpenTelemetry** (decided Aug 30, 2026). Rationale: OTel is the underlying standard (aligns with MCP's own SEP-414), and every major backend (Datadog, Grafana, Honeycomb, New Relic) consumes OTLP—building on OTel first means one plugin works with all of them via exporter config, avoiding vendor lock-in for users and duplicate work per backend. A Datadog-specific plugin can follow later as a thin, pre-configured wrapper over the OTel exporter (API key + auto-tagging convenience), not a separate instrumentation path.
- [x] Input format: **OpenAPI spec only** for v0 (decided Aug 30, 2026). Manual tool definitions (YAML/JSON schema) deferred until there's signal it's needed—keeps v0 scope tight.
- [ ] Where to launch for initial validation—**tracked in Plane: MCPFO-15.**
- [x] Project name: **klaridian** (decided Aug 30, 2026)—**superseded, see section 13 below: name collision found (real npm package + real GitHub project both already named `klaridian`), rebrand decided Sep 3, 2026 to `klaridian`, tracked in Plane MCPFO-13.**
- [ ] Concrete metrics for "enough signal" to move to Phase 1—**tracked in Plane: MCPFO-16.**
- [ ] **Differentiation path after the FastMCP feature-matrix finding (Aug 30, 2026)**—see ARCHITECTURE.md sections 21-24. FastMCP (the dominant Python MCP framework, ~16M weekly PyPI downloads) already ships native, zero-config OpenTelemetry by default; a competing generator (`mcp-generator-3.x`) already combines OpenAPI→FastMCP generation with OTel, OAuth2/JWT auth, middleware, and MCP Resources. klaridian's OTel plugin is therefore **not differentiated** for anyone already on FastMCP/Python—only the PostHog (product observability) plugin remains a clearly unique offering across the whole space (Python or TypeScript). Five candidate paths recorded in ARCHITECTURE.md section 22: (a) multi-language—**shipped** (section 23): a native FastMCP middleware (`packages/python-posthog-middleware/`) attaches PostHog product-observability capture to any FastMCP server, layering on top of FastMCP's own native OTel rather than competing with it; (b) go deeper on product observability itself—**tracked in Plane: MCPFO-17**; (c) usage-driven tool curation/pruning—**superseded by a broader, better-validated decision, see below**; (d) hosted correlation/fleet layer (section 4)—**tracked in Plane: MCPFO-19**, gated on the existing 20-50-user signal threshold; (e) generator-agnostic post-processing `instrument` command—**tracked in Plane: MCPFO-18**.

- [x] **Tool curation—mechanism decided and implemented (Aug 30, 2026, ARCHITECTURE.md sections 24-25; superseded in current priority by MCPFO-8, tag-independent curation).** Deep market research (4 parallel research passes: MCP ecosystem trajectory, developer pain points from forums/issue trackers, competitive/funding landscape, enterprise adoption blockers) converged on "tool bloat / context overload" as the single strongest, most independently corroborated pain point in the whole MCP ecosystem—stronger signal than product-analytics demand, and specifically called out for OpenAPI→MCP generators (klaridian's own category) as producing servers that are "technically correct but behaviorally poor." This supersedes the original narrower "usage-driven pruning" framing of path (c) above: **the user explicitly rejected LLM-suggested curation and usage-data-gated curation as the primary mechanism** (chicken-and-egg problem—usage data doesn't exist on day one) in favor of **user-chosen filtering at generation time**. Investigated and ruled out OAuth consent-screen-style or MCP-client-side tool toggles as something klaridian could build (both are client/transport responsibilities outside a stdio-only generator's control—see section 24 for the full investigation). Mechanism validated with real code: `openapi-mcp-generator`'s `x-mcp: false` spec extension is already respected by `generateMcpServer()`—confirmed by generating a real test spec and inspecting output. **Tracked in Plane: MCPFO-9** (interactive checkbox prompt + `--include-tags`/`--exclude-tags`/`--exclude-operation-ids` flags, applied by pre-processing the spec's `x-mcp` values before generation). This is a generation-time concern, complementary to (not competing with) the `otel`/`posthog` plugins—curation controls what tools exist, instrumentation observes how existing tools get used. A later iteration could feed real PostHog usage data back into curation as an optional, still user-approved suggestion—but that's an enhancement once real users exist, not a blocker to shipping the user-chosen mechanism now.

---

## 6. Concrete next steps (once there's time / full connectivity)

**Done—superseded by actual build progress (sections 7+ below, and the current Plane backlog).** This original 4-item bootstrap list (spike → stack decision → README → minimal CLI) was the pre-code starting point; all of it has since happened. Kept here only as historical context for how the project started, not as a live task list.

---

## 7. Distribution norm: why MCP servers are conventionally open source, and what that implies for klaridian (Aug 30, 2026)

Prompted by a direct question: MCP servers in the wild are overwhelmingly open source (Datadog's, PostHog's, Wavix's own published server, the reference servers in the MCP org)—worth understanding *why*, not just following the convention, because the reason determines which parts of klaridian's own distribution it actually constrains.

**The real reason (not just industry habit):** an MCP server runs with real operational credentials (API keys, DB connections, write access) *and* sits directly in the decision loop of an autonomous agent that chooses when to invoke it. That combination—real credentials + non-human, non-deterministic caller—is a materially higher trust bar than a normal backend service a human calls deliberately. A closed-source binary of unknown provenance running with production credentials next to an agent is a much harder sell than the same thing behind a human-reviewed API call. Open source (or at minimum, fully readable generated source) is the cheapest way to earn that trust: anyone can audit exactly what a tool call does before wiring it to their credentials. This is the same principle already recorded in section 3 above (\"infrastructure touching production data... needs to be auditable\")—this section makes explicit that it applies not just to the klaridian CLI itself, but to *the servers it generates*.

**What this confirms (already the right call, now with an explicit reason)—no changes:**
- CLI + all plugins (`otel`, `posthog`, `amplitude`, `mixpanel`) as MIT/Apache: already decided (section 3), now grounded in a concrete mechanism rather than \"open-core is common in dev tooling.\"
- The paid layer (section 4, hosted fleet/correlation dashboard) can stay closed **because it never runs inside the generated server**—it's an external, opt-in SaaS that never touches the agent's credential path. No tension with the norm above; the norm is about what runs *next to the agent*, not about klaridian's own business model.

**What this newly locks down as an explicit architectural rule (previously an accidental pattern, not a stated principle):**
- **Plugin runtime code must always ship as vendored source inside the generated project, never as an opaque compiled npm dependency.** `render/instrument.ts`'s `getTemplateContributions()` already does this today (writes `src/instrumentation/<plugin-id>.ts` as literal, readable, comment-annotated source into the output)—but this was an implementation detail, not a documented constraint. Recording it here as a rule: a tempting future \"simplification\" (publish `@klaridian/otel-runtime` on npm and `import` it instead of vendoring the file) would silently recreate exactly the trust gap this section describes—the generated server's actual tool-call-wrapping logic would become an opaque dependency again, even though the generator itself stayed open source. Any new plugin, and any refactor of existing plugins, must preserve vendored-source-in-output as a hard constraint, not an implementation convenience that can be optimized away.

**Concrete gap identified and closed the same day (see ARCHITECTURE.md section 27 for the technical implementation):** the generated server itself shipped with no `LICENSE` file and no `license` field in its `package.json`—a real, visible inconsistency against the norm described above for anyone inspecting a freshly generated project. Fixed via a new `--license <mit|apache-2.0|none>` flag on `klaridian generate` (default `mit`), writing a real `LICENSE` file and setting `package.json`'s `license` field accordingly; `--license none` is supported but prints an explicit warning rather than silently omitting the file, consistent with the project's \"fail loudly, don't guess\" principle applied to omission, not just errors.

**Not addressed by this section, deliberately left as a follow-up:** whether the `klaridian` CLI itself is published to the npm registry for `npx klaridian generate ...` zero-install usage—a separate, real distribution question that affects discoverability/adoption friction but not the open-source-trust argument this section is about. **Tracked in Plane: MCPFO-14** (also blocked on the rebrand, MCPFO-13).

**Premise correction (Sep 2, 2026—from the four-report research pass, see ARCHITECTURE.md section 37 and `2026-09-02-*.md` in the private `klaridian-strategy` repo):** an earlier working assumption in this project was that "open source is a requirement in many marketplaces," which is why the trust/auditability argument above felt doubly load-bearing. The research corrected this. Open source is **NOT** required by the major remote connector programs—claude.ai Connectors, ChatGPT Apps, the official MCP Registry ("supports both open-source and closed-source"), Docker (remote), Smithery, Glama connectors, or Copilot Studio. It is required only for **local/stdio distribution channels**: Anthropic MCPB extensions and plugins, Docker-local, the Glama OSS track, Cursor plugins, and Gemini CLI extensions. The real hard gate across Anthropic, OpenAI and Microsoft is **API ownership**—the publisher must own or legitimately proxy the upstream API ("unofficial connectors … cannot be approved"), which cannot be satisfied by a third party wrapping someone else's OpenAPI spec. Two consequences for klaridian's positioning: (1) the target user is sharpened to **the owner of an API** making it agent-callable, not an integrator wrapping a foreign spec; (2) the trust/auditability argument (sections 3/7) does not *lose* value—it stops being about clearing a listing checkbox and becomes purely about what it always really was: earning the confidence of the people who run the generated server with production credentials next to an autonomous agent. Separately, because an MCP server is an OAuth **resource server** (not an OAuth client), an open-source server ships **no client secret**—so "open source" and "OAuth 2.1 support" are not in tension, contrary to a mid-discussion assumption. The generator-vs-framework question that prompted this pass was answered in favor of **staying a standalone code generator** (with the protocol/transport layer coming from the official MCP SDK, the tool surface generated), recorded in full in ARCHITECTURE.md section 37 rather than duplicated here—it is a technical/architecture decision, not a business one.

## 8. Containers: where they help, where they don't (Aug 30, 2026)

Raised directly: does containerization make sense anywhere in this project? Two genuinely different questions, answered separately rather than conflated:

**For contributors developing klaridian itself:** a devcontainer (`.devcontainer/devcontainer.json`, the VS Code/Codespaces-standard reference implementation) is a real, low-cost win—pins the Node version, gives every contributor an environment identical to CI, and directly supports the "always re-check from a clean install" discipline already established for dependency-vulnerability auditing (section 7 above / ARCHITECTURE.md section 18). Not yet built; worth doing before accepting outside contributions.

**For the CLI's own runtime:** no case found. `klaridian` is a plain Node/TypeScript CLI with no exotic system dependencies—containerizing the dev loop (`npm run build && npm test`) would add friction with no corresponding benefit.

**For the *generated server* (the more interesting question):** real signal found, but with an important caveat discovered while validating it. Docker itself is pushing containers as the standard MCP server distribution mechanism (Docker MCP Catalog, publicly positioned as "every MCP server that moves from npx execution to containerized deployment is a win")—directly for the same trust reason as PLAN.md section 7: `npx`-executed servers run arbitrary code with full host access (filesystem, network, env vars/secrets), which is exactly the credentials-next-to-an-autonomous-agent trust gap this project already reasons about. So a `--docker` flag on `klaridian generate` (writing a minimal, least-privilege Dockerfile alongside the generated server) is a real, validated idea—but genuinely useful containerization only works for network-based transports, not stdio: MCP tooling (Claude Code, etc.) spawns `docker run -i` as if it were a normal child process, but the container is actually managed by the Docker daemon independently—when the client's session ends, the `docker run` CLI process exits but the container itself doesn't, leaking orphaned containers holding open connections indefinitely (a documented, real problem in the wider MCP ecosystem, not speculative). This is exactly why `--docker` is gated on non-stdio transport support existing first (see ARCHITECTURE.md section 29, where stdio-only was lifted)—and, per that section's own finding, further gated on the `streamable-http` transport's real upstream bug being fixed, since containerizing a transport that crashes on its second request wouldn't be a meaningful deliverable yet.

**Not built in this session:** neither the devcontainer nor `--docker`. The devcontainer was since built (section 11). `--docker` is tracked in Plane: **MCPFO-12** (gated on the prerequisites above, including the upstream streamable-http fix, MCPFO-10).

## 9. Upstream contributions to `openapi-mcp-generator`: tracked, not yet filed (Aug 30, 2026)

Two real bugs/gaps have been found in `openapi-mcp-generator` (klaridian's generation-engine dependency, section 16) during klaridian's own audits—both currently worked around on klaridian's own side, but the durable fix belongs upstream. Explicitly parked here per direct instruction ("let's discuss a PR to their project later") rather than actioned immediately—recorded now so the intent and the specific asks aren't lost between sessions.

**Item 1—`streamable-http` transport crash (ARCHITECTURE.md section 29).** Its generated `src/streamable-http.ts` throws `TypeError [ERR_INVALID_STATE]: Invalid state: ReadableStream is locked` (inside the `fetch-to-node` dependency's `http-incoming.js`) on the second HTTP request to an established session—reproduced against a vanilla, unpatched `openapi-mcp-generator` project with zero klaridian involvement, confirmed on both Node v22.19.0 and v26.7.0/v26.8.1. klaridian's own workaround: none yet—this transport is generated but documented as not currently usable past the first request (README, ARCHITECTURE.md section 29).

**Item 2—no verbosity/silent option on `generateMcpServer()` (ARCHITECTURE.md section 33).** `generateMcpServer()` writes ~56 hardcoded `console.error`/`console.warn`/`console.log` progress lines with no way to suppress them via its public `CliOptions` API—meaning every consumer of the library, not just klaridian, has no supported way to build a quiet/scriptable/JSON-output mode around it. klaridian's own workaround: `withConsoleSuppressed()`, a scoped `console.*` monkey-patch around the single call site, engaged only under `--quiet`/`--json` (section 33)—functional, but explicitly documented there as a workaround, not the right long-term fix.

**Why parked rather than filed now:** both are real, reproducible, and already have a clear, minimal proposed fix (item 1: root-cause and patch the `fetch-to-node` interaction, or document/skip it; item 2: accept an optional `logger`/`silent` field on `CliOptions`, defaulting to today's behavior for backward compatibility)—but filing a well-formed upstream PR (tests, matching the maintainer's existing code style, a clear repro) is real work worth doing deliberately in a dedicated session, not squeezed in as a side effect of an unrelated task. Both items are good candidates for a **single combined PR session** later: same upstream repo, same general shape ("klaridian's own audits found these while using your library for real, here's a fix for each"). **Tracked in Plane: MCPFO-10** (streamable-http crash) and **MCPFO-11** (logger/silent option).

## 10. Should klaridian also ship an MCP server (not just the CLI)? Decided: no, not for `generate` (Aug 30, 2026)

Raised directly, since klaridian's whole domain is MCP servers—worth checking rather than assuming the answer is "obviously yes." Researched the actual decision framework the harness ecosystem itself uses in 2026 (not first-principles guessing): a widely-cited comparison (parallel.ai, Aug 2026) distills how Hermes, Pi, and OpenClaw actually choose between MCP server / agent skill / bare CLI for a given capability, backed by concrete case studies from each. Applied that framework directly to `klaridian generate`, rather than treating "should we have an MCP server" as a branding question.

**The decision rule from that research, stated precisely:** pick MCP when the tool is a *hosted service*—needs OAuth, holds state on someone else's server, benefits from typed schemas and per-tool approval gating, or must work in a harness with no shell access. Pick a CLI (optionally wrapped in a skill) when the tool is local, composable, stateless, and its `--help` is self-explanatory. The article's own worked example (Parallel's web search, shipped as both a hosted MCP server *and* a CLI-as-skill) makes the point concrete: same capability, different mechanism depending on which side of that line it's on.

**Applied to `klaridian generate`:**
- **No hosted state, no OAuth, no multi-tenant concern.** `generate` reads a local/URL-referenced OpenAPI spec and writes local files. Nothing about it is a "service" in the sense that makes MCP's actual value proposition (auth flows, per-tool approval gating, server-side state) apply. This is the single biggest disqualifier per the framework above.
- **Context cost with no offsetting benefit.** An MCP server would inject `generate`'s ~20 flags into every connected agent's context on every turn, whether used or not—the exact "GitHub's server is the notorious example" cost the research explicitly flags. A CLI invoked via `Bash` costs near-zero context until actually called.
- **The typed-I/O and approval-gating value MCP would add is already delivered more cheaply.** This is the direct payoff of the CLI-UX work from sections 32-33: `--json` already gives structured, parseable output (success and failure, with a stable `stage` tag); exit codes already signal outcome; `--force`/non-TTY detection already handle the safety-rail concerns a schema-typed MCP tool would otherwise need to encode. Building an MCP server around the same `generate` command now would be re-wrapping the same capability in a strictly more expensive channel for no new capability—not a complementary interface, a redundant one.
- **No persistent process/session to justify it either.** Contrasted directly against a real precedent found during research (`xprof-cli`, which *does* ship both a CLI and an MCP server)—that tool's dual-interface makes sense because it keeps a long-lived process with loaded profiling data, where an MCP session avoids re-parsing large files per call. `klaridian generate` is the opposite: one invocation, one complete result, nothing to keep warm between calls. The precedent that justifies dual-interface elsewhere doesn't transfer here.

**Decision: no MCP server for `klaridian generate`, or the CLI generally, at this time.** Documented explicitly so this doesn't get re-litigated without a new reason to reconsider it—the reasoning above is specific to the current shape of the CLI (stateless, local-only, no auth), not a general "CLIs never need MCP servers" stance.

**Where the answer would flip—recorded, not built:** the hosted correlation/fleet layer (section 4, Phase 1, still gated on real demand signal) is a genuinely different case. If/when that layer exists, it *is* a hosted, stateful, multi-tenant service—exactly the profile the framework says MCP is the right fit for. At that point, that service exposing its own MCP server (so an agent could ask "what's my fleet's current cost per task" without a human opening a dashboard) would be a natural, well-justified feature—not an extension of `generate`'s interface, but a new interface for a genuinely different, future product. Nothing to build now; recorded so the distinction (CLI-only today, MCP-eligible only for the future hosted layer) isn't lost.

## 11. Devcontainer for contributors: built and validated (Aug 31, 2026)

Follows through on section 8's identified-but-unbuilt item: a devcontainer for anyone contributing to klaridian itself, pinning the exact toolchain versions `.github/workflows/ci.yml` runs against so a contributor's local environment can't silently drift from CI.

**What was built—`.devcontainer/devcontainer.json` + `.devcontainer/post-create.sh`:**
- Base image `mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm`—Node 22, matching `ci.yml`'s `node-version: "22"` for the CLI job exactly (not "whatever recent LTS," a real version pin).
- `ghcr.io/devcontainers/features/python:1` at version 3.11—matching `ci.yml`'s `python-version: "3.11"` for the `python-posthog-middleware` job. One container now covers both CI jobs' toolchains, since this is a small two-package monorepo, not two separate devcontainers.
- `ghcr.io/devcontainers/features/github-cli:1`—`gh` CLI included, matching how the maintainer already authenticates to GitHub (HTTPS + `gh`, no SSH key, per this profile's own recorded convention).
- `postCreateCommand` runs `.devcontainer/post-create.sh`, which installs both packages' dependencies (`npm install` for `packages/cli`, `pip install -e ".[dev]"` for `packages/python-posthog-middleware`)—deliberately mirroring `ci.yml`'s own "Install" steps line for line, so "what CI does" and "what a fresh devcontainer does on open" don't silently diverge into two different setup procedures.
- `remoteUser: "node"`—runs as the base image's existing non-root user, standard devcontainer practice, not root.

**Validated end to end with the real `@devcontainers/cli`, not assumed to work from the config alone:**
- `npx @devcontainers/cli up --workspace-folder .`—a real container build from the spec above, `postCreateCommand` observed actually running and completing both installs (real `npm install` output, real `pip install` output for `fastmcp`/`posthog`/etc., not a dry run).
- `npx @devcontainers/cli exec ... -- node --version` / `python3 --version` / `gh --version`—confirmed the exact expected versions inside the running container (Node v22.16.0, Python 3.11.16, `gh` 2.98.0), not just that the feature declarations parsed.
- **The real test**: ran both packages' actual test suites *inside* the container via `@devcontainers/cli exec`—`cd packages/cli && npm test` (44/44 passing, identical to running outside the container) and `cd packages/python-posthog-middleware && pytest tests/` (3/3 passing)—proving the devcontainer is a genuinely working development environment for this repo, not just a config file that looks plausible.
- Test container removed after validation (`docker rm -f`), not left running.

**Scope kept deliberately narrow:** no VS Code Codespaces-specific configuration beyond the standard `customizations.vscode.extensions` (ESLint, Prettier, Python) and `editor.formatOnSave`—nothing this project doesn't already conventionally use. No attempt to containerize anything beyond the dev environment itself (the CLI's own runtime, and the generated servers, were both already assessed in section 8 as not benefiting from containerization at this time).

## 12. Dogfooding against a real public spec: tag-based curation doesn't hold up—now the top priority (Sep 1, 2026)

A deliberate step back before continuing down the technical backlog (naming, upstream PR, `--docker`): every prior validation used either the tiny Petstore fixture or an unnameable "production spec" from an earlier session—never a spec independently checkable, and critically, never one big enough to stress-test the project's own headline differentiator (tool curation, section 5's differentiation research + ARCHITECTURE.md sections 24-25). Chose Stripe's public, MIT-licensed OpenAPI spec (`stripe/openapi`) specifically to avoid any ambiguity about whose data was used—not the maintainer's employer, not any private spec, a spec published by a third party expressly for tools like this to validate against (see ARCHITECTURE.md section 34 for the full technical write-up).

**The finding that changes prioritization:** Stripe's spec—the largest, most-referenced real public API spec in the ecosystem—has **zero OpenAPI tags on any of its 594 operations**. klaridian's entire tool-curation mechanism (`--include-tags`, `--exclude-tags`, the interactive checkbox prompt) is tag-based, and against this spec it does **nothing at all**—every one of the 594 operations lands in a single "(untagged)" bucket. The only remaining lever, `--exclude-operation-ids`, requires listing hundreds of individual IDs to get down to a workable tool count, which isn't a realistic workflow.

**Why this matters more than the rest of the current backlog:** the tool-bloat/curation problem is klaridian's most validated differentiator (section 5's 4-pass market research named it the single strongest pain point in the whole MCP ecosystem, stronger than product-analytics demand). Finding that the *mechanism built to solve it* doesn't work against the most realistic large spec available is a bigger problem than anything on the current technical list (npm naming, the upstream PR, `--docker`)—those are all real, but none of them touch whether the core value proposition holds up under realistic conditions. Naming a product well doesn't matter if the thing it names doesn't work against real large APIs.

**Reprioritization, recorded explicitly:** before naming/npm publishing/upstream-PR work, the next concrete technical priority is a **tag-independent curation mechanism**—the shape isn't decided yet (candidates: path-prefix/regex filtering, HTTP-method filtering, a user-supplied operationId allowlist file instead of a CLI-flag list, or resurrecting the LLM-assisted curation idea previously rejected in section 24 but revisiting it now that the rejection's original reasoning—"usage data doesn't exist on day one"—doesn't apply to a *structural* suggestion, not a usage-driven one). **Tracked in Plane: MCPFO-8** (top priority).

## 13. Rebrand decision: `mcpforge` → `klaridian` (Sep 3, 2026)

**Why this was forced:** the name `mcpforge` collides with real, active products—an existing npm package, and existing GitHub/domain activity under the same or confusingly similar name (`mcpforge.dev`/`.org` territory already occupied)—a real trademark/confusion risk once this project goes public, not just an unavailable exact npm slug. Blocks MCPFO-14 (npm publish), MCPFO-15 (launch channel), and any MCP Registry listing (server.json/mcpName, MCPFO-25) until resolved. Per direct instruction, the new name must **not** contain "mcp"—the project intends to expand into adjacent CLI/SDK generation beyond MCP specifically, so a name locked to "mcp" would be a second naming debt later.

**Process:** ~54 candidates evaluated in three batches against the three-axis check from the `product-naming-availability-check` skill (domain DNS via direct `dig ... NS`/`NXDOMAIN`, package registries—npm/PyPI/crates.io, and real-product/company collision via targeted web search)—not just "domain looks free," which is the trap the skill specifically warns about. The overwhelming majority of short abstract candidates (Vercel/Stripe/Linear-style, the user's requested style) failed on `.com` being squatted even with no real product behind it—confirms the skill's warning that this naming space is broadly saturated, not a one-off unlucky batch.

**Follow-up dogfooding, same day, on the same Stripe spec fixture (Sep 3, 2026): does klaridian's own tag-independent curation (MCPFO-8 phase 1) hold up on a real large spec?**

Baseline confirmed live (real build + spawn + `tools/list` over stdio, not just CLI-reported counts): uncurated `klaridian generate` against the full Stripe spec produces **594 flat tools**, one per operation (`GetAccount`, `PostAccountLinks`, `DeleteAccountsAccount`, ...)—as expected from a 1:1 generator on an untagged spec.

Curated run: `klaridian generate --include-paths /v1/customers,/v1/payment_intents,/v1/charges,/v1/refunds` (the tag-independent path filter, the only lever that works since this spec has zero tags) against the same spec. Verified live the same way: **78 tools**, scoped to the requested resources (`GetCharges`, `PostChargesChargeCapture`, `GetChargesChargeDispute`, etc.)—a ~7.6x reduction, still within klaridian's own 1-tool-per-operation category. This is the fair, apples-to-apples test of the actual value proposition (curate the 1:1 output vs. leave it uncurated) and it holds up end-to-end on the same real large spec that broke tag-based curation in section 12 above.

**A different, initially-drafted comparison—klaridian's raw output vs. Stripe's own official hosted MCP server (`https://mcp.stripe.com`, ~10-15 hand-curated meta-tools: `stripe_api_search`, `stripe_api_details`, `stripe_api_read`/`write`, plus product tools)—was considered and explicitly rejected as misleading.** Stripe's server is a hand-built, domain-expert product in a different category (search+execute meta-tools), not a generic OpenAPI→MCP generator; comparing klaridian's default uncurated output against it only re-confirms known benchmark literature (meta-tool designs ship fewer tools than 1:1 generators) without saying anything new about whether klaridian's curation actually works. A fairer category-matched comparison, if pursued later, would be against another 1:1-per-operation generator (e.g. `hubspot-mcp-extended`, 106 static tools from HubSpot's spec)—not attempted here. The search+execute pattern itself remains a legitimate, separately-tracked candidate post-v1 feature (not started, not queued ahead of shipping v1: domain, npm/PyPI publish, MCPFO-21/22 remainder).

**Decision: `klaridian`.** Verified clean on all three axes on Sep 3, 2026:
- **Domain (direct `dig ... NS`, NXDOMAIN):** `.com`, `.dev`, `.io`, `.ai` all unregistered.
- **Packages:** npm `klaridian` and `@klaridian/*` scope—unpublished (404). PyPI `klaridian`—unpublished (404). crates.io—no collision found.
- **GitHub:** `klaridian` user/org handle unclaimed (404). Repository search for "klaridian"—0 results.
- **Real-product/trademark collision:** no active company, app, or product found under this exact name. The only phonetically-adjacent hits are unrelated and not live tech products: "Klaridan Group Ltd" (obscure UK restaurant-sector company, no digital presence), "Clariden"/"Clariden Leu" (Swiss private bank, merged into Credit Suisse in 2012, defunct), "Claridion"/"Clariti Software" (unrelated government permitting software, different name). None is a live collision under trademark-style scrutiny.

**Honest residual risk (per the skill's own guidance):** this is a point-in-time clearance, not a permanent guarantee—the dev-tool naming space moves fast. Re-verify before the actual public launch if there's a meaningful gap between this decision and going live.

**Not yet done (deliberately, next steps once the repo-side rename lands):** registering the domain, reserving the GitHub org/npm scope, and updating README.md/package.json/CLI binary name—those are execution steps for MCPFO-13, not blocked on further research. This section records the *decision*; the rename execution is tracked as the remaining scope of MCPFO-13 in Plane.

**Execution complete (Sep 3, 2026, commit 2865fe0):** GitHub repo renamed `ricardocvasconcelos/mcpforge` → `ricardocvasconcelos/klaridian` (old URL auto-redirects); `package.json` workspace name, `packages/cli` package (`@klaridian/cli`) and CLI binary (`klaridian`); Python middleware package (`klaridian-posthog-middleware` / module `klaridian_posthog_middleware`); all `MCPFORGE_*` env vars renamed to `KLARIDIAN_*`; every text reference across README/ARCHITECTURE/CLAUDE/CONTRIBUTING/SECURITY/devcontainer/docs/tests/source updated. Validated end to end before push (clean build, full 99-test CLI suite, 3-test Python suite, both green under the pre-push hook). MCPFO-13 closed in Plane. Still open, separately: registering the actual `klaridian.com`/`.dev` domain, and publishing the renamed packages to npm/PyPI.

## 14. Roadmap review against the market (Sep 4, 2026)

A deliberate strategy step back—read the full current project state (repo + all ARCHITECTURE/PLAN sections) and cross-referenced it against two fresh source-cited market scans commissioned for this review (`2026-09-03-competitive-landscape.md` and `2026-09-03-mcp-ecosystem-direction.md`, in the private `klaridian-strategy` repo). Both were verified against primary sources before acting on them; one material error was caught and is recorded below so it doesn't propagate.

**Factual correction to the research (verified, not taken on the subagent's word):** the ecosystem-direction report claimed `@modelcontextprotocol/server` 2.0.0 ships full `2026-07-28` conformance. This is **false**—confirmed directly against the npm registry (`latest` is still `2.0.0`, published 2026-07-27, no newer stable) and against this repo's own spike 021c (ARCHITECTURE.md section 38), which drove the real v2 server over HTTP and proved it negotiates **down to `2025-11-25`** (`server/discover` → `-32601`). The honest post-migration claim stays "stateless, SDK-v2, protocol `2025-11-25`, HTTP-safe", exactly as section 38 recorded. The `canary-sdk-era.test.ts` pin is the correct defense; a future SDK bump lands `2026-07-28` for free with no generator change (§37 Decision 1).

**The four market signals that drove the reprioritization:**

1. **Code-mode / search+execute has won the design argument for large APIs.** Stainless *deleted* per-endpoint tool schemes entirely (2 tools: docs-search + execute-in-Deno-sandbox); Cloudflare Code Mode collapses its whole API to 2 tools (99.9% token cut); Anthropic ships Tool Search + Programmatic Tool Calling; OpenAI ships `defer_loading`; the spec roadmap names progressive discovery. This corroborates, from the market side, what this project's own three-vendor dogfooding already found independently (ARCHITECTURE.md section 35: Stripe/Twilio/Slack all collapse 1:1 surfaces into meta-tools). Critically, **no tool today emits a standalone search+execute MCP server from an OpenAPI spec**—a real, unclaimed gap that sits exactly in klaridian's category.

2. **Hosted-MCP economics are visibly failing.** Smithery killed free hosting (Mar 2026); Stainless deprecated hosted servers. This *validates* klaridian's standalone-artifact model (Phase 0) and *warns against* a naive Phase 1 hosted dashboard. Separately, **AgentCat (ex-MCPcat, funded)** already occupies the generic "MCP-server analytics" slot Phase 1 was implicitly aiming at.

3. **The PostHog product-observability plugin is no longer a differentiator.** PostHog shipped first-party `@posthog/mcp` (v0.13.0, published 2026-09-03, SDK v1+v2-aware). The "PostHog middleware for MCP" value klaridian shipped now exists first-party—klaridian's plugin must become a *thin generation-time wiring* of the first-party SDK, not a capture layer klaridian maintains.

4. **The distribution window is open but closing (~6–12 months).** The incumbent OSS generator (harsha-iiiv/openapi-mcp-generator, v4.0.1) is still on SDK v1 with no observability, no registry emission, no interactive curation—the exact gaps klaridian fills today. That lead is real but closable by one motivated maintainer, so npm publish + domain + Registry submission stop being "low" and become time-sensitive.

**Backlog changes applied from this review (all in Plane, project MCPFO):**
- **MCPFO-26 (code-mode/search+execute) promoted `medium` → `urgent`, moved to Todo**—repositioned as the primary differentiation bet, not a post-v1 nice-to-have. Still needs a dedicated design session first (new server *architecture* + sandboxing story, not a filter) before any build.
- **MCPFO-27 created (`high`, Todo): Swagger 2.0 input support via `swagger2openapi` pre-conversion**—the fix validated end-to-end in ARCHITECTURE.md section 36 (0/174 empty schemas on the real Slack spec, zero pipeline changes) but never implemented or tracked until now.
- **MCPFO-14 (npm publish) and MCPFO-15 (launch channel) promoted `low` → `high`**—distribution is now time-sensitive against the closing incumbent-gap window.
- **MCPFO-17 (deepen product observability) and MCPFO-18 (generator-agnostic `instrument` command) demoted to `low`**—both undercut by PostHog's first-party instrumentation and gateway-native tracing; the defensible slice is generation-time wiring of an owned artifact, not a capture layer or third-party retrofit.
- **MCPFO-19 (hosted fleet layer) stays gated, angle sharpened**—annotated with AgentCat + the failing hosting economics; the only defensible framing is a correlation/control plane over a *fleet of klaridian-generated servers* (config-as-code, which no generic analytics tool can see), never a generic hosted dashboard.
- **MCPFO-22 (OAuth 2.1 resource-server) confirmed already Done** (implemented commit `f94c7f7`, ARCHITECTURE.md section 39)—no action, recorded here to close the loop since an earlier session note had it as possibly still open.

**Unchanged and reaffirmed by this review:** the standalone-generator model (protocol from the official SDK, tool surface generated—§37 Decision 1), the vendored-instrumentation-source rule (§7, §37 Decision 2), and the trust/auditability positioning for the API-owner target user. Nothing in the market scan contradicts these; the code-mode gap and the distribution timing are the substantive changes.

## 15. Parking lot: LLM-assisted `search_docs` synthesis for sparse OpenAPI specs (Sep 4, 2026)

MCPFO-31 (code-mode's `search_docs` tool, ARCHITECTURE.md section 47) implemented a purely structural fallback (method/path/params/schema, no LLM) for operations whose OpenAPI spec provides no real description—per direct instruction, deliberately not the LLM-synthesis alternative. Recording the parked option here since it's a business/cost decision, not just a technical one (PLAN.md's own remit per AGENTS.md):

- **What it would be:** at generation time, for operations with no/sparse spec description, call an LLM to write a plausible one from the operation's shape (method, path, params, schema, tags) instead of the current terse structural listing.
- **Why it's not built:** consistent with section 10/ARCHITECTURE.md section 24's prior explicit rejection of LLM involvement at generation time for curation—same reasoning likely applies here (adds an API-key dependency to `klaridian generate` itself, which has otherwise been carefully free of that; adds real per-generation cost; adds a class of subtly-wrong-but-plausible-sounding output that's harder to spot than an honest "no description" gap).
- **What would need deciding if revisited:** whether it's opt-in (a flag) or default; how synthesized text is visually distinguished from spec-authored text so a user/model can tell what klaridian invented vs. what the API owner actually wrote; whether cost is amortized via caching (same spec + same operation → same synthesized doc, computed once) or paid every generation; which model/provider, and whether that becomes a second provider dependency alongside whatever `posthog-node`/`@opentelemetry` already pull in.
- **Not currently blocking anything**—the structural fallback is a real, working default; this is an enhancement, not a gap in shipped functionality.

## 16. Competitive analysis re-check (Sep 6, 2026)

A fresh, deep competitive-analysis pass (`2026-09-06-competitive-analysis-review.md`, in the private `klaridian-strategy` repo), commissioned specifically to re-validate the Aug 30 gap thesis (section 2's "nobody combines generate+instrument+curate") after roughly a week of further build-out (the v1→v2 emitter cutover, the public site going live). Source-cited, not taken at face value—cross-check anything load-bearing against primary sources the way section 14 did for the ecosystem-direction report.

**Headline finding: the gap thesis is now only half-true, and the weaker half is "curate," not "instrument."**
- **Curation is no longer a unique angle.** FastMCP's `RouteMap`/`EXCLUDE` (Python) is materially more mature than klaridian's current tag/path filters; Speakeasy/Gram ships documented "toolset design" best practices; even the `openapi-mcp-generator` library klaridian wraps already has a primitive `x-mcp` filtering extension "for free." The planned Overlay-based curation mechanism (MCPFO-34) needs to clear a materially higher bar than "better than nothing"—it needs to beat what FastMCP and Gram already ship, or be positioned on a different axis (declarative, spec-external, bulk-rename/tag) rather than raw filtering power.
- **"Born instrumented" (OTel + product analytics wired at generation time) is still genuinely rare among generators**—no OpenAPI→MCP generator found wires OTel+PostHog at the `registerTool` boundary by default. But this is being standardized at the *protocol* level, not just competed on at the product level: the MCP spec revision `2026-07-28` deprecates custom logging in favor of OpenTelemetry, and an OTel Semantic Conventions GenAI sub-spec for MCP (`mcp.method.name`, `mcp.server.name`, etc.) is already in development. Separately, Datadog shipped a GA "Agent Observability" feature (Mar 2026) auto-instrumenting MCP clients/servers, and PostHog now ships first-party `@posthog/mcp` (already noted in section 14, item 3)—both reduce, but don't eliminate, the "unpackaged" framing of the original pitch.
- **No competitor—commercial or OSS-with-hosted-upsell—makes an explicit, permanent "never phone-home telemetry" promise.** Speakeasy/Gram, Composio, Arcade, Klavis, Smithery are all businesses that need usage data to run their model (hosting, freemium metering, enterprise upsell). This remains klaridian's most durable, hardest-to-copy differentiator precisely because copying it would cost competitors their own revenue mechanism—reinforces the Aug 30 PLAN.md section 3 decision not to build CLI telemetry, even opt-in.
- **Two threats outrank a direct clone in likelihood of doing real damage:** (1) an established observability vendor (Datadog, or a well-funded OSS player like Arize/Langfuse) shipping a trivial "wrap this generated MCP server with OTel" one-liner for Node/TS, making klaridian's OTel plugin redundant for the engineering-observability half; (2) Anthropic/AAIF formalizing audit-trails/observability in the official MCP SDK as part of the 2026 roadmap, turning basic instrumentation into a protocol-level commodity. Both are more dangerous than a feature-parity clone from Speakeasy/Composio/Arcade, because those vendors' business models actively push them toward managed hosting, not self-hosted zero-telemetry CLIs.

**Actions taken from this review (tracked in Plane, project MCPFO):**
- **MCPFO-43 created (`high`, Backlog): make the "zero telemetry, ever" promise independently verifiable**—document/audit that the CLI makes no outbound network calls beyond what the user explicitly configures in OTel/PostHog exporters; this is the report's #1 recommendation and directly reinforces the section 3 no-telemetry decision.
- **MCPFO-44 created (`medium`, Backlog): differentiate Overlay-based curation from `x-mcp`/FastMCP `RouteMap` explicitly in docs**—write up concretely why declarative Overlay curation (bulk rename/tag, versioned outside the source spec, no OpenAPI edits required) is a different and stronger mechanism than what's already free in the base library and in FastMCP, so MCPFO-34 doesn't ship looking like "the same thing, later."
- **MCPFO-45 created (`medium`, Backlog): adopt the OTel Semantic Conventions GenAI sub-spec for MCP in the `otel` plugin once it's usable**—track `open-telemetry/semantic-conventions-genai`'s `mcp.md` (currently "Development" status) and align the plugin's span attribute naming to it instead of a bespoke convention, so klaridian can honestly claim standard alignment rather than needing a breaking migration later.
- **MCPFO-46 created (`low`, Backlog): disclose the `openapi-mcp-generator` dependency explicitly in README/site copy**—one sentence ("klaridian uses openapi-mcp-generator for OpenAPI parsing and adds X/Y/Z") to preempt "thin wrapper" criticism at launch; low effort, meaningfully reduces a credibility risk the report flagged.

**Unchanged and reaffirmed by this review:** the open-core model (section 3), the no-CLI-telemetry decision (section 3), and the standalone-generator/vendored-instrumentation architecture (section 14). Nothing here contradicts prior decisions—it sharpens the "why us" narrative (trust/sovereignty over feature novelty) and adds a documentation/positioning workstream that wasn't previously tracked.







