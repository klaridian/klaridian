# klaridian — v0 Technical Architecture

> Companion to PLAN.md. This document sketches the technical shape of the CLI
> and generated servers for v0. Not an implementation plan (no task breakdown,
> no code yet) — this is the architecture to align on before writing code.

**Date:** August 30, 2026
**Status:** Draft — validate against a real OpenAPI spec before building

---

## 1. Scope recap (from PLAN.md)

- Stack: TypeScript/Node
- Input: OpenAPI spec only (v0)
- First plugin: generic OpenTelemetry (spans for every tool call, OTLP exporter, backend-agnostic)
- Output: a working, standalone MCP server, instrumented from generation

---

## 2. High-level flow

```
   OpenAPI spec (YAML/JSON)
          │
          ▼
  ┌───────────────────┐
  │  klaridian CLI      │   `klaridian generate --spec api.yaml --plugin otel`
  │  (the "forge")     │
  └────────┬───────────┘
           │
           ▼
  1. Parse & validate OpenAPI spec
  2. Map operations → MCP tool definitions
  3. Select instrumentation plugin(s) (otel for v0)
  4. Render project from template
  5. Write output directory
           │
           ▼
  ┌────────────────────────────┐
  │  Generated MCP server        │
  │  (standalone Node/TS project)│
  │  - MCP tools (from spec)     │
  │  - OTel spans wired in       │
  │  - Ready to `npm install`    │
  │    & run                     │
  └────────────────────────────┘
```

The CLI is a **generator**, not a runtime — it produces a project, then gets out of the way. The generated server has no runtime dependency on `klaridian` itself beyond a small shared instrumentation helper package (see section 5).

---

## 3. CLI package structure

```
klaridian/
├── packages/
│   ├── cli/                      # the `klaridian` command
│   │   ├── src/
│   │   │   ├── index.ts          # entrypoint, arg parsing (commander or clipanion)
│   │   │   ├── commands/
│   │   │   │   └── generate.ts   # `klaridian generate` command
│   │   │   ├── openapi/
│   │   │   │   ├── parse.ts      # load + validate OpenAPI spec (use `@apidevtools/swagger-parser` or `openapi-types`)
│   │   │   │   └── map-tools.ts  # OpenAPI operation → MCP tool definition mapping
│   │   │   ├── plugins/
│   │   │   │   ├── plugin.interface.ts   # shared plugin contract (see section 4)
│   │   │   │   └── otel/
│   │   │   │       └── otel.plugin.ts    # generic OTel plugin implementation
│   │   │   ├── render/
│   │   │   │   └── render-project.ts     # templating engine glue (see section 6)
│   │   │   └── types.ts
│   │   ├── templates/             # the actual server template(s), see section 6
│   │   │   └── node-basic/
│   │   │       ├── package.json.tmpl
│   │   │       ├── src/
│   │   │       │   ├── server.ts.tmpl
│   │   │       │   ├── tools/{{toolName}}.ts.tmpl
│   │   │       │   └── instrumentation/otel.ts.tmpl
│   │   │       └── tsconfig.json
│   │   └── package.json
│   │
│   └── runtime-otel/              # tiny shared runtime helper, imported by generated servers
│       ├── src/
│       │   └── index.ts           # wrapTool(), initTracer() helpers
│       └── package.json
│
├── examples/
│   └── petstore/                  # a known-good OpenAPI spec for testing generation end to end
│       └── openapi.yaml
│
├── PLAN.md
├── ARCHITECTURE.md                # this file
└── README.md
```

**Monorepo tooling:** npm/pnpm workspaces is enough for v0 — no need for Nx/Turborepo yet at this scale (2 packages). Revisit if plugin count grows.

---

## 4. Plugin interface (the extensibility seam)

This is the most important interface in the whole system — it's what lets "OTel today, Datadog/PostHog plugins tomorrow" be additive, not a rewrite.

```typescript
// packages/cli/src/plugins/plugin.interface.ts

export interface ObservabilityPlugin {
  /** Unique plugin id, used on the CLI: --plugin otel */
  id: string;

  /** Human-readable name for CLI output / prompts */
  name: string;

  /** Config questions to ask the user at generation time (e.g. OTLP endpoint) */
  configSchema: PluginConfigField[];

  /**
   * Returns template files/snippets to inject into the generated project.
   * Keeps the plugin decoupled from the base template — it contributes
   * files and wiring, it doesn't own the whole project structure.
   */
  getTemplateContributions(config: ResolvedPluginConfig): TemplateContribution[];

  /** Additional npm dependencies the generated project needs for this plugin */
  getDependencies(): Record<string, string>;
}

export interface PluginConfigField {
  key: string;
  prompt: string;
  default?: string;
  required: boolean;
}

export interface TemplateContribution {
  /** Path in the generated project, e.g. "src/instrumentation/otel.ts" */
  path: string;
  /** Template content or a function producing it from resolved config */
  content: string | ((config: ResolvedPluginConfig) => string);
}

export type ResolvedPluginConfig = Record<string, string>;
```

**Why this shape:**
- A future PostHog plugin implements the same interface — the CLI doesn't need to know anything PostHog-specific, it just calls `getTemplateContributions()` and merges the output.
- Multiple plugins can be selected in one generation run (`--plugin otel --plugin posthog`) because contributions are additive (different files, or clearly-marked injection points in shared files like `server.ts`).
- Config prompts are declarative (`configSchema`), so the CLI can render them consistently across plugins.

---

## 5. What "instrumentation wired in" actually means in generated code

The generated server should NOT reimplement OTel setup by hand per tool. Instead:

1. `runtime-otel` (a tiny published npm package, or vendored file for v0) exports a `wrapTool()` helper that any generated tool handler is wrapped with.
2. The template generates one call site per tool, not custom code per tool.

Sketch of generated output (`src/tools/getPetById.ts`, illustrative):

```typescript
import { wrapTool } from "../instrumentation/otel";
import { callGetPetById } from "../client";

export const getPetByIdTool = wrapTool(
  {
    name: "getPetById",
    description: "Find pet by ID",
    inputSchema: { /* derived from OpenAPI */ },
  },
  async (input) => callGetPetById(input)
);
```

`wrapTool()` (in `runtime-otel`) does the span creation, attribute tagging (tool name, duration, error status), and exports via OTLP — once, centrally. Adding Datadog-specific tagging later means enhancing `wrapTool()` or offering an alternate exporter config, not touching every generated tool file.

**Semantic conventions:** follow the emerging OTel GenAI/tool-call semantic conventions (referenced in the MCP OTel proposal / SEP-414) for span names and attributes, rather than inventing our own — this is what makes the traces meaningful in Datadog/Grafana out of the box, not just "some spans."

---

## 6. Templating approach

Options considered:
- **Plain string templates + `{{placeholder}}` replacement** — simplest, but gets messy fast for conditional logic (e.g. "only include this import if plugin X is selected").
- **A real templating engine (e.g. `eta`, `handlebars`, or `ejs`)** — recommended. Lightweight, supports conditionals/loops cleanly, well understood.
- **AST-based code generation (ts-morph)** — most powerful (can programmatically merge plugin contributions into a shared file safely) but heavier to build for v0.

**v0 recommendation:** template engine (`eta` is a good lightweight choice) for most files, with `ts-morph` reserved specifically for the one place multiple plugins need to inject into the *same* file (e.g. `server.ts` needs imports from every selected plugin). Keep that surface small and well-tested; template-engine everything else.

---

## 7. OpenAPI → MCP tool mapping (the trickiest logic)

This is where real design judgment is needed, not just plumbing:

- Each OpenAPI **operation** (path + method) → one MCP **tool**.
- `operationId` → tool name (fallback: derive from path + method if missing, need a naming convention).
- `parameters` + `requestBody` schema → MCP tool `inputSchema` (JSON Schema — OpenAPI schemas are close but not identical, need a conversion step, e.g. via `openapi-schema-to-json-schema`).
- `summary`/`description` → MCP tool `description`.
- Auth (API keys, OAuth2 in the spec's `securitySchemes`) → generated server needs a config/env-var story for credentials. **Punt to a simple approach in v0:** read all auth values from environment variables named after the security scheme; document this clearly. Don't try to build a full auth UX in v0.

**Known risk:** OpenAPI specs vary wildly in quality (missing operationIds, vague descriptions, complex `oneOf`/`allOf` schemas). v0 should target well-formed specs (like the Petstore example) and fail loudly with a clear error on anything it can't confidently map — not silently generate broken tools.

---

## 8. What v0 explicitly does NOT do (guardrails against scope creep)

- No PostHog / product-observability plugin yet (that's the second plugin, after OTel ships and works).
- No hosted dashboard / control plane (that's Phase 1 business-wise, and architecturally a separate service entirely — not part of this repo's v0).
- No manual tool-definition input format (OpenAPI only).
- No auth UX beyond "read from env vars."
- No support for OpenAPI specs with severe structural issues — fail with a clear message instead of guessing.
- No multi-language output (TypeScript/Node only; Python templates are a future "if there's demand" item).

---

## 9. Suggested build order (once implementation starts)

1. **Spike (throwaway):** manually generate one MCP server from the Petstore OpenAPI spec, wire OTel by hand, confirm the mechanics actually work end to end (spec → tool → span → OTLP collector) before building any generator abstraction. This validates the riskiest assumption first.

   > **✅ Done (Aug 30, 2026).** See `spikes/001-otel-mechanic/FINDINGS.md` for full results. Two findings changed downstream design:
   > - `ConsoleSpanExporter` writes to **stdout**, which corrupts stdio-transport MCP servers (stdout must carry JSON-RPC only). The real OTel plugin must default to `OTLPTraceExporter`; any debug console output must go to stderr, hard-wired, never left to the implementer to get right.
   > - Span flushing needs explicit `SIGINT`/`SIGTERM` handling (`sdk.shutdown()`) — the default batch processor can lose spans on process exit otherwise. `runtime-otel` must wire this by default, not leave it as an exercise for generated-server users.
   >
   > Both findings are now incorporated into section 5 above (the `wrapTool()` design) and should carry into `runtime-otel`'s real implementation and its tests.

2. OpenAPI parsing + tool mapping (no plugins yet, no templating yet — just prove spec → internal tool model works, with tests against the Petstore spec).
3. Basic project templating (no plugins) — generate a working, unInstrumented MCP server.
4. Plugin interface + OTel plugin — wire instrumentation into the templated output.
5. CLI polish (prompts, error messages, `--help`).
6. README + a documented walkthrough using the Petstore example, since that's what launch posts will need anyway.

**Post-v0 roadmap (added Aug 30, 2026 — see section 14 for the full case study):** validating against a real production API/MCP server surfaced concrete, prioritized next steps beyond the original 6-step list above:

7. ~~`allOf` schema merging in `map-tools.ts` (highest priority — see section 14).~~ **Done (Aug 30, 2026) — see section 15.** Result against the real spec: 120/122 operations (98.4%) now map successfully.
8. ~~Authentication support (Bearer token at minimum) — currently zero auth story.~~ **Done (Aug 30, 2026) — see section 17.** Also fixed a real blocker found along the way: `generate` used to refuse to produce anything if any operation had a mapping error; now defaults to skip-and-warn (`--strict` restores the old behavior). klaridian could generate and compile a real, working MCP server (120 tools, auth wired) from the unmodified real spec.
9. OpenAPI 3.1 support — turns out this already works (the real spec from section 14 is 3.1 and parses/maps correctly); still worth adding an explicit 3.1 test fixture so this isn't just incidentally true.
10. Binary/streaming response handling (generate a `{ downloadUrl, contentType, status }`-shaped tool instead of inlining binary data) — same idea frameworks like FastAPI apply with a dedicated response type instead of forcing binary bytes through a JSON body.
11. `multipart/form-data` request body support, or an explicit documented limitation.

**Superseded (Aug 30, 2026) — see section 16.** Items 7-11 above (and their underlying `packages/cli` `openapi/`/`render/` implementation) are superseded by the decision to adopt `openapi-mcp-generator` as klaridian's generation engine rather than continuing to build and maintain a competing implementation. The *findings* from this work remain valid and directly informed that decision; the code itself is not the path forward. See section 16 for the comparison and rationale, and section 18 for the new build order.

---

## 10. Open technical questions

- [ ] MCP transport for generated servers: stdio only (simplest, matches most local-agent use cases) or also Streamable HTTP? Recommend **stdio-only for v0** — matches the reference MCP servers and keeps the template simpler.
- [ ] Which MCP SDK: official `@modelcontextprotocol/sdk` (assume yes, no reason to deviate).
- [ ] Package manager for generated projects: npm (safest default, zero assumptions about what the user has installed).
- [ ] Do we vendor `runtime-otel` as a copied file into each generated project (zero extra install, more duplication) or publish it as a real npm dependency (cleaner, but means generated servers depend on an klaridian-maintained package before v1 stability)? **Leaning vendored-file for v0** to avoid a premature published-package commitment; revisit once the API stabilizes.

## 11. Findings from building the OpenAPI parser + mapper (Aug 30, 2026)

Implemented and tested (`packages/cli/src/openapi/{parse,map-tools,types}.ts`, `packages/cli/test/map-tools.test.ts`) against the real Petstore spec (all 19 operations map cleanly, 0 errors) plus 5 targeted edge-case fixtures. One real-world finding that wasn't anticipated in section 7:

**`servers[0].url` can be relative, not absolute.** The real Petstore spec declares `servers: [{ url: "/api/v3" }]` — a path, not a full domain. `mapOpenApiToTools()` passes this through as-is rather than guessing a host. **Consequence for the generator/templates:** the generated server's config must require an explicit base host from the user when the spec's server URL is relative — don't silently prepend something. **Tracked in Plane: MCPFO-20** (a v0 CLI prompt: "spec declares a relative server URL — what host should tools be called against?") rather than a runtime surprise.

Also validated: `@apidevtools/swagger-parser` fully dereferences `$ref`s before our code sees the document, so `map-tools.ts` never needs its own `$ref` resolution logic — confirms the parser choice in section 1/3 was right.

## 12. Basic project templating — implemented and validated end to end (Aug 30, 2026)

Implemented (`packages/cli/src/render/{generate-server-code,render-project}.ts`) and tested (`packages/cli/test/render-project.test.ts`):

- **`generate-server-code.ts`** generates the actual TypeScript source of `src/index.ts` for a basic, un-instrumented MCP server — hand-rolled code generation (not a templating engine), because tool-handler wiring (path/query/header/body -> fetch call) has real per-parameter-location branching that's clearer as generated code than as template conditionals. This confirms the section 6 hybrid approach was right in spirit, though in practice v0 didn't even need `ts-morph` yet — plain string generation was sufficient because there's no cross-plugin injection point to manage until the OTel plugin lands (next build step).
- **`render-project.ts`** writes the full project to disk: `package.json`, `tsconfig.json`, `README.md` (including a warnings section surfaced from the mapping step), and `src/index.ts`.
- Confirmed the section-11 finding is now handled at generation time: when the spec's server URL isn't absolute, the generated server requires `KLARIDIAN_BASE_URL` and fails with a clear message instead of guessing a host, and the generated README documents this explicitly.

**The strongest validation so far:** `render-project.test.ts` doesn't just check generated file contents — it renders a real project to a temp directory, runs a real `npm install`, runs a real `tsc` build, spawns the compiled server, and drives it over stdio JSON-RPC exactly as the spike did by hand. Result: **19/19 tools listed correctly, `getPetById` returns real data from the live Petstore API, all 10 tests pass** (`npm test` in `packages/cli`). This is the generator now doing, automatically, what the spike proved was possible by hand.

**Not yet covered:** no plugins/instrumentation in the generated server yet (that's the next build-order step). No handling yet for OpenAPI response-body schemas beyond "return JSON or text as-is" — response *shape* isn't currently surfaced to the MCP tool definition, only the request-side `inputSchema`. Worth a note for later: MCP tool definitions don't have a standard "output schema" slot the way inputs do, so this may simply not matter much in practice — revisit if real usage says otherwise.

## 13. Plugin interface + OTel plugin — implemented and validated end to end (Aug 30, 2026)

Implemented and tested:

- **`src/plugins/plugin.interface.ts`** — the `ObservabilityPlugin` interface exactly as designed in section 4, plus `resolvePluginConfig()` to validate/apply-defaults for a plugin's config schema against CLI-provided values.
- **`src/plugins/otel/otel.plugin.ts`** — the generic OTel plugin. Its vendored `instrumentation.ts` contribution directly encodes both spike findings: `OTLPTraceExporter` only (never `ConsoleSpanExporter`), OTel diagnostics routed to stderr, and explicit `SIGINT`/`SIGTERM` → `sdk.shutdown()` handlers.
- **`generate-server-code.ts`** now accepts an optional plugin and wraps every generated tool handler in the plugin's `wrapFunctionName` — e.g. `wrapTool("getPetById", handle_getPetById)` — without any per-tool special-casing.
- **`src/commands/generate.ts` + `src/index.ts`** — the real `klaridian generate` CLI command (via `commander`), supporting `--spec`, `--out`, `--name`, `--plugin`, and repeatable `--plugin-config <pluginId>.<key>=<value>` flags. Surfaces mapping warnings/errors to the user and refuses to generate on hard errors.

**v0 scope decision made here:** exactly 0 or 1 plugins per generated server for now — `generateServerSource` throws if given more than one. Composing multiple plugins around the same tool call site (e.g. OTel + PostHog both wrapping the same handler) needs a real composition strategy that isn't worth building until a second plugin actually exists. Documented directly in code, not just here.

**Validation (`packages/cli/test/otel-plugin.test.ts`):** generates a server with the OTel plugin enabled, runs a real `npm install` (pulling real `@opentelemetry/*` packages), builds, runs it, and — critically — sends it a real `SIGTERM` mid-run to exercise the plugin's shutdown handler. Confirms the invariant from `spikes/001-otel-mechanic/FINDINGS.md` holds through the full generator, not just the hand-written spike: **stdout stays exactly 2 valid JSON-RPC lines**, even with OTel active and no collector available to receive the exported spans.

Also manually smoke-tested the actual CLI binary (`node dist/src/index.js generate --spec ... --plugin otel --plugin-config otel.serviceName=...`) end to end outside the test suite — correctly surfaced the pre-existing `uploadImage` non-JSON-body warning and generated all 19 tools with OTel wiring. All 11 automated tests pass (`npm test` in `packages/cli`).

## 14. Real-world validation case: could klaridian generate a server for a large, complex production API? (Aug 30, 2026)

To pressure-test v0 against something harder than the well-formed Petstore spec, we inspected a large, complex real-world production API's public OpenAPI spec (details anonymized here — not our spec to showcase; the technical findings below are what matter and don't depend on whose API it was). **Verdict: not today.** The gap is real and instructive, not a minor tweak — documenting it here because it's the clearest signal yet of what "v1" needs to cover to be useful beyond toy specs.

### What that spec actually looked like, vs. Petstore

| | Petstore (our fixture) | The production API under test |
|---|---|---|
| OpenAPI version | 3.0.x | **3.1.0** (never tested against our parser/mapper) |
| Paths / operations | 19 | **78 paths, 122 operations** |
| `allOf` usage | 0 | **151 occurrences** |
| `oneOf` / `anyOf` usage | 0 | 5 / 14 occurrences |
| `multipart/form-data` bodies | 0 | 3 endpoints (file uploads) |
| Non-JSON responses | 0 | 5 endpoints (audio, PDF, ndjson, octet-stream) |
| `servers[0].url` | relative (`/api/v3`) | absolute — this one's actually easier than Petstore |
| Auth | none | Bearer token, required on every call |

Our mapper (`map-tools.ts`) **rejects any operation using `allOf`/`oneOf`/`anyOf` as a hard error** by design (section 7/8's "fail loudly" rule). With `allOf` alone appearing 151 times, most of the 122 real operations would currently be skipped, not mis-mapped — the fail-loudly guardrail did its job, but it also means today's klaridian covers a small fraction of a real-world API like this.

### How production MCP servers built with other frameworks solve these same problems (worth learning from)

The reference server we studied was Python, built on FastMCP (`FastMCP.from_openapi()`), not custom-generated code like ours. It gets a working server out of a hard spec via targeted spec *preprocessing* before handing it to FastMCP, plus a handful of hand-written escape-hatch tools:

- **A schema-normalization patch** — FastMCP merges `allOf` children into the body schema but doesn't set `type: object` on the result, which then causes single-property body wrappers to get silently stripped. The spec gets patched in-memory to add the missing `type` before FastMCP sees it — a targeted, well-tested fix, not a general allOf-merging engine. Worth noting because it suggests full oneOf/allOf/anyOf support isn't necessarily "resolve the general case," it can be "handle the specific shapes real specs actually produce."
- **A response-content-type filter** — drops non-JSON response content types from the spec before FastMCP tries to validate real responses against a schema that doesn't fit streaming/binary payloads.
- **A handful of hand-written "escape hatch" tools** for the binary/streaming endpoints — these are *excluded* from the automatic OpenAPI-driven mapping and reimplemented by hand to return a `{download_url, content_type, status_code}` pointing at a pre-signed redirect or an authenticated re-fetchable URL, rather than trying to stream binary data through the MCP tool-call contract at all.
- **Auth via a custom HTTP client subclass** that forwards the MCP client's incoming `Authorization` header to the upstream API — with an explicit host allowlist check so the bearer token never leaks to redirect targets (e.g. pre-signed S3 URLs).
- **Documentation exposed as MCP Resources** (not tools) — the docs site is crawled and registered as individually fetchable resource URIs, cached with ETag revalidation. Out of scope for a "generate tools from an API" tool like klaridian, but notable as a UX pattern.
- **Transport: Streamable HTTP**, hosted, not stdio — a deliberate choice for a multi-tenant hosted server, different from our stdio-only v0 default.

### What klaridian would need, roughly in priority order

**Blocking (without these, most operations stay unmapped):**
1. **`allOf` merging** — the single highest-value fix; 151 occurrences vs. 5 (`oneOf`) and 14 (`anyOf`). Unlike `oneOf`/`anyOf` (genuinely ambiguous — which branch does a single flat `inputSchema` represent?), `allOf` is a deterministic merge of sibling schemas and is tractable to implement generally, not just spec-specific patching.
2. **Authentication support** — at minimum, a Bearer-token plugin/config that reads from an env var and attaches it to every generated `fetch` call. Currently klaridian has zero auth story; every generated server today only works against fully open APIs.
3. **OpenAPI 3.1 support** — never validated against our parser (`@apidevtools/swagger-parser` claims 3.1 support, but `map-tools.ts` and its tests have only run against a 3.0.x fixture). Needs its own test fixture before trusting it.

**Important, but workaroundable with real but bounded effort:**
4. **`multipart/form-data` request bodies** — either support file uploads properly, or explicitly document the limitation the way section 8 already frames non-JSON bodies (we already warn and skip the body; the gap is capability, not error handling).
5. **Binary/streaming responses** — follow the pattern above directly: for OpenAPI operations whose only response content-type is non-JSON (audio, PDF, octet-stream, ndjson), generate a tool that performs the request and returns a `{ downloadUrl, contentType, status }` shape instead of trying to inline binary data into a tool-call `content` block. This is a generation-time decision, not a runtime hack — should live in `map-tools.ts`/`generate-server-code.ts` as a first-class case, not bolted on.

**Lower priority / possibly intentionally out of scope:**
6. **`oneOf`/`anyOf`** — likely correct to keep rejecting these (or, longer-term, offer a manual override the way the reference server hand-writes a few escape-hatch tools) rather than trying to auto-resolve genuinely ambiguous unions into one flat MCP `inputSchema`. Only ~19 of 122 operations in that spec were affected.
7. **Docs-as-Resources** — a real, validated UX pattern from a production MCP server, but out of scope for "generate tools from an OpenAPI spec." Worth a note for a possible future plugin, not a v1 blocker.
8. **Streamable HTTP transport** — only matters if/when klaridian wants to generate hosted, multi-tenant servers rather than local stdio ones (ARCHITECTURE.md section 10's open question, still undecided).

### Bottom line

With items 1-3 solved, a rough estimate is klaridian could automatically cover something like 85-90 of that spec's 122 real operations (excluding the ~19 oneOf/anyOf and ~8 binary/multipart ones, which would need the same kind of hand-written escape hatches the reference server itself uses). That's a meaningful chunk of real production-API work, not a rewrite of the generator — but it's also not a "small tweak"; `allOf` merging and an auth story are both non-trivial, multi-session features. This is now the top of the post-v0 roadmap (see section 9's build order, which this case study extends rather than replaces).

> **Update (Aug 30, 2026, same day): item 1 (allOf merging) is now implemented — see section 15.** The actual result beat the estimate above by a wide margin: **120 of 122 operations (98.4%) now map successfully**, not the ~85-90 originally estimated. The `anyOf` count (14 occurrences) turned out to mostly coexist with `allOf` in ways that resolve cleanly rather than blocking mapping — only 2 operations hit a genuine, irreducible `oneOf` ambiguity. Auth (item 2) and OpenAPI 3.1 validation (item 3, though this spec — which *is* 3.1 — already parses and maps correctly, so this is now more "add an explicit test fixture" than "add support") remain open.

## 15. `allOf` schema merging — implemented and validated against a real production spec (Aug 30, 2026)

Implemented in `packages/cli/src/openapi/map-tools.ts`: a new `mergeAllOf()` function that recursively flattens an `allOf` schema's sibling subschemas into one merged schema — deep-merging `properties`, unioning `required` arrays across all branches, and preserving any `oneOf`/`anyOf` found in a branch (rather than dropping it) so `detectUnsupportedSchemaFeatures` still catches genuine ambiguity in the *merged* result. `detectUnsupportedSchemaFeatures` no longer flags `allOf` itself as unsupported — only `oneOf`/`anyOf` remain hard errors, per the reasoning in section 14 (allOf is a deterministic intersection; oneOf/anyOf are genuinely ambiguous unions with no single flat `inputSchema` representation).

**Real, load-bearing bug caught by testing, not just unit tests on synthetic fixtures:** the first implementation silently discarded a nested `oneOf`/`anyOf` when it appeared inside an `allOf` branch — merging only copied `properties`/`required`/`type`/`description` and dropped everything else. A dedicated test (`allOf containing a oneOf branch still produces a hard error`) caught this immediately: an operation that should have been rejected as ambiguous was instead silently mapped. Fixed by explicitly propagating `oneOf`/`anyOf` into the merged schema so downstream detection still sees them. This is exactly the kind of subtle-wrong-mapping bug the project's "fail loudly, don't guess" rule (section 7/8) exists to prevent — and it shipped with a passing test suite until the oneOf-inside-allOf case was specifically exercised. Lesson: allOf-merging tests need to include "and it still contains an unsupported feature" cases, not just the happy path.

**Validation against real fixtures:**
- 4 new unit tests added to `map-tools.test.ts` (`allOf` in a request body, `allOf` in a parameter schema, nested `allOf`-inside-`allOf`, and `oneOf`-inside-`allOf` still rejected) — all pass, plus the full existing suite (15/15 tests) still passes.
- **Ran the mapper directly against the real spec from section 14** (not just Petstore) as a one-off validation script. Result: **120 of 122 operations (98.4%) now map successfully**, up from an estimated small fraction before this change. Remaining gaps: 2 hard errors (genuine `oneOf` ambiguity) and 3 warnings (non-JSON request bodies — expected, unaddressed until item 4/5 of the roadmap). This substantially beats the original 85-90 estimate in section 14, suggesting `anyOf` usage in the real spec mostly coexists with mergeable `allOf` structure rather than blocking mapping on its own.

**Not yet re-validated end-to-end:** this fix was validated at the mapping layer (does `mapOpenApiToTools` produce a correct `ToolDefinition`?) against both synthetic fixtures and the real spec's *mapping* output, but **not** by actually rendering and running a generated server against the live upstream API (unlike the Petstore validations in sections 12-13) — that would require real API credentials for that service, which we didn't have. The rendering/running mechanic itself was already proven generic in sections 12-13, so the residual risk here is specifically "does the merged schema's shape make sense to an MCP client," not "does the generator pipeline work," but this is worth flagging explicitly rather than assuming section 12/13's validation automatically covers this new code path too.

## 16. Strategic pivot: adopt `openapi-mcp-generator` as the generation engine instead of maintaining our own (Aug 30, 2026)

While implementing roadmap item #4 (binary/streaming responses), we stopped to check whether klaridian's hand-rolled OpenAPI→MCP generation was reinventing something that already exists well. It was.

### What we found

[`harsha-iiiv/openapi-mcp-generator`](https://github.com/harsha-iiiv/openapi-mcp-generator) — MIT-licensed, published on npm, 631 GitHub stars, actively maintained (commits within the last 2 months as of this writing). A TypeScript CLI **and** library (exports a clean programmatic API, `getToolsFromOpenApi()`) that converts an OpenAPI spec into a buildable MCP server project. Directly comparable to klaridian's own generator, and — after hands-on testing against the real production spec from section 14 — measurably ahead of it on multiple axes we hadn't even covered:

| Capability | `openapi-mcp-generator` | klaridian (pre-pivot) |
|---|---|---|
| Auth | API key, Bearer, Basic, **OAuth2**, custom | Bearer, API key only |
| Transports | stdio, SSE web server, **StreamableHTTP** | stdio only |
| Schema validation | Zod, auto-generated via `json-schema-to-zod` | hand-written type checks |
| **64-character tool name limit** (a real MCP client constraint, e.g. Claude Desktop) | handled — word-level abbreviation + deterministic hash fallback | **not handled at all** — a latent bug in klaridian against any spec with long names |
| `allOf`/`oneOf`/`anyOf` | delegated to Zod via `json-schema-to-zod`, handles all three (Zod natively supports unions) | `allOf` hand-merged (section 15); `oneOf`/`anyOf` still hard-rejected |
| Multi-file `$ref` | supported | untested |
| Selective tool inclusion | `x-mcp` OpenAPI extension (per-operation/path/root) | none |
| SSRF protection on spec parsing | explicit (`assertNoExternalRefs`, opt-in `allowExternalRefs`) | none |
| Validated against | Stripe (452 tools, per their own commit history) | one large production spec (120/122 tools, section 15/16) |

**Direct validation against the real spec from section 14 (same fixture used throughout sections 14-17):** ran `openapi-mcp-generator` against the unmodified spec. Result: **all 122 operations generated successfully** (vs. klaridian's 120/122 — the 2 `oneOf` operations that klaridian still hard-rejects were handled fine here because Zod natively expresses unions), zero warnings printed, and `npm run build` (`tsc`) compiled with zero errors on the first try.

### The other half of the finding: a real critique of OpenAPI→MCP auto-conversion itself

While researching this, we also found [a post by the FastMCP author](https://www.jlowin.dev/blog/stop-converting-rest-apis-to-mcp) (FastMCP's `from_openapi()` is the tool the reference server from section 14 uses) arguing that auto-converting a REST API to MCP tools 1:1 is actively bad for agents in production: APIs designed for humans are "generous" (hundreds of atomic, composable endpoints), but agents pay a real cost per tool in context/tokens and reasoning overhead — auto-conversion produces "chatty," bloated tool catalogs that make agents slower and more error-prone, not more capable. His recommendation: use auto-conversion for bootstrapping/prototyping only, then curate aggressively (rename, hide, merge, prune) before shipping to production.

This is a genuine, separate insight from "which generator library is best," and it points at a real opportunity: **nobody in this space (Speakeasy, Gram, FastMCP, openapi-mcp-generator) combines auto-generation with automated curation/pruning.** That gap is worth keeping in mind as a possible differentiator distinct from the observability angle — not something to build now, but a validated direction, not a guess.

### Decision

Adopt `openapi-mcp-generator` as klaridian's generation engine rather than continuing to maintain a parallel, less-capable implementation. Concretely:

- `packages/cli`'s hand-rolled `openapi/` and `render/` modules (sections 12, 15, 16, and the in-progress section on binary responses) are superseded — not because the work was wasted (it directly validated the mechanic, per the spike in sections 9-13, and surfaced real integration risks like the stdout/OTel finding that remain valid regardless of generator choice), but because a better-tested, more complete implementation of the same generation step already exists and is MIT-licensed.
- klaridian's own value proposition (PLAN.md: generator + observability plugins nobody else combines) is unaffected — if anything, it's cleaner: klaridian becomes explicitly "`openapi-mcp-generator` (or equivalent) plus an instrumentation layer," not "yet another OpenAPI-to-MCP generator that also happens to have plugins."
- Next concrete step: replace `packages/cli`'s internal OpenAPI parsing/mapping/rendering with a dependency on (or vendored/forked copy of) `openapi-mcp-generator`, then re-attach the `runtime-otel`/plugin instrumentation layer (sections 4-5, 13) on top of *its* generated output instead of our own. The plugin interface design (section 4) doesn't need to change — it was already decoupled from the specific code-generation mechanics.
- Dependency safety confirmed (see section 18 item 1): the 19 vulnerabilities reported by `npm install` in the cloned repo are all in devDependencies (vitest's toolchain) and never reach a real consumer — `npm install openapi-mcp-generator` reports 0 vulnerabilities. Its runtime dependency footprint is small and closely matches klaridian's own choices already.

---

## 17. Authentication support — implemented and validated end to end against a real production spec (Aug 30, 2026)

> **Note:** this work (and section 15's `allOf` merging) predates the section 16 pivot to `openapi-mcp-generator`. Kept here as an accurate record of what was built and validated, and because the *findings* (real production specs need auth; skip-and-warn generation is essential for real-world specs) remain true and informed the pivot decision — but the actual code described below (in klaridian's own `openapi/`/`render/` modules) is superseded per section 16, not the current implementation path going forward.


Implemented (roadmap item #2 from section 14): the second-highest-priority post-v0 fix, chosen because — as section 15's real-spec validation confirmed — `allOf` merging alone gets 120/122 operations *mapped*, but every one of them still needs a working Bearer token to actually be *callable*, since that spec requires auth on every request.

**What was built:**
- `AuthScheme` type added to `openapi/types.ts` — a small closed union (`http-bearer` | `api-key` with header/query location), not a general auth framework. Deliberately narrow: these two schemes cover the real-world APIs klaridian has actually been tested against, and OAuth2/openIdConnect are architecturally different (need an interactive flow a generated stdio server can't run on its own) rather than "just another case to add."
- `detectAuthScheme()` in `map-tools.ts` reads the spec's top-level `security` + `components.securitySchemes`, resolves the first required scheme, and returns an `AuthScheme` for the two supported types. Unsupported scheme types (OAuth2, openIdConnect, mutualTLS, or missing scheme definitions) produce a warning, not a hard error — the server still generates, just without automated auth wiring, letting the user add it manually rather than blocking generation outright.
- `generate-server-code.ts` now takes an optional `auth` and, when present: generates an `KLARIDIAN_AUTH_TOKEN` env-var check (fails loudly with a clear message if unset, same pattern as `KLARIDIAN_BASE_URL`) and injects the token into every generated tool's `fetch` call — as an `` Authorization: Bearer <token> `` header for `http-bearer`, or as the named header/query parameter for `api-key`.
- Generated `README.md` documents the requirement and how to set it, mirroring the existing `KLARIDIAN_BASE_URL` documentation pattern.

**Real, load-bearing finding from wiring this up against the actual spec (not just synthetic fixtures):** the CLI's `generate` command previously refused to generate *anything* if `mapping.errors` was non-empty — even though `mapping.tools` already excludes the failing operations and would have produced a perfectly good 120-tool server. Running `klaridian generate` against the real spec exposed this directly: 120 valid tools sat unused behind a hard refusal caused by 2 unrelated `oneOf` operations. Fixed by adding a `--strict` flag (default off): non-strict mode now warns about skipped operations and generates the rest; `--strict` restores the old all-or-nothing behavior for anyone who wants it. This is arguably a more important fix than the auth feature itself — without it, real-world specs with *any* unsupported operation (which, per section 14, is normal) couldn't be used at all.

**Validation (`packages/cli/test/auth.test.ts`):** generates a server from a minimal spec requiring `http-bearer` auth, spins up a real local HTTP server (not a mock library — an actual `node:http` server) that asserts the `Authorization` header it receives, builds and runs the generated server twice: once confirming it refuses to start with no token (non-zero exit code), once with a real token set — and confirms the exact string `Bearer test-secret-token-123` arrives at the upstream mock server's request headers, driven through a real MCP `tools/call` over stdio JSON-RPC end to end. Also confirms the README documents `KLARIDIAN_AUTH_TOKEN`.

**Full real-world proof:** ran the actual CLI binary against the real spec from section 14 end to end — `klaridian generate --spec ... --out ...` now succeeds (previously refused outright), producing **120 tools**, correctly detecting `{ type: "http-bearer" }` auth, and the generated project's `npm run build` (`tsc`) compiles cleanly with zero errors. This is the first time klaridian has produced a real, compilable, non-Petstore server from an unmodified real-world spec. All 16 automated tests pass (`npm test`).

**Not yet covered:** `api-key` (as opposed to `http-bearer`) auth has unit-level type support and is used identically in the generated fetch wiring, but hasn't been exercised by its own end-to-end test the way `http-bearer` has — worth adding if/when a real API using `apiKey` auth comes up as a validation case. OAuth2/openIdConnect remain explicitly unsupported (warning, not automated) — no changes planned there without a concrete use case, since a generated stdio server can't run an interactive OAuth flow.

## 18. New build order after the section 16 pivot

Replaces the section 9 build order's remaining post-v0 items. Concrete next steps:

1. ~~Audit `openapi-mcp-generator`'s 19 reported dependency vulnerabilities...~~ **Done (Aug 30, 2026).** Resolved as a non-issue: the 19 vulnerabilities (6 moderate, 12 high, 1 critical) only appeared when cloning the full repo and running `npm install` there — that pulls in `devDependencies` (`vitest` and its whole bundler/test-runner tree: `vite`, `esbuild`, `postcss`, etc.), none of which reach an actual consumer. Verified directly: `npm install openapi-mcp-generator` in a clean scratch project reports **0 vulnerabilities**. Its real runtime footprint is tiny and matches klaridian's own dependency choices closely: `@apidevtools/swagger-parser`, `commander`, `openapi-types` as dependencies, plus `@modelcontextprotocol/sdk`, `json-schema-to-zod`, `zod` as peer dependencies (the consumer supplies these, so no version conflicts with klaridian's own MCP SDK usage). Safe to depend on directly — no fork-with-patches needed for this reason. (General lesson worth keeping: `npm audit` results from a repo checkout overstate real supply-chain risk for anyone who'll actually consume the package from npm — always re-check from the consumer's install, not the maintainer's dev environment.)
2. ~~Replace `packages/cli`'s internal `openapi/` and `render/`...~~ **Done (Aug 30, 2026) — see this section's own commits.** Both modules deleted; the CLI now calls `openapi-mcp-generator`'s `getToolsFromOpenApi()` (pre-flight tool count) and `generateMcpServer()` (actual project generation) directly.
3. ~~Re-attach the plugin/instrumentation layer...~~ **Done (Aug 30, 2026) — see the section 16/18 pivot's `render/instrument.ts` and `test/generate.test.ts`.** Turned out simpler than expected: `openapi-mcp-generator` dispatches every tool call through a single shared `executeApiTool()` function, so instrumentation only needs one textual patch, not a per-tool codemod.
4. ~~Re-run the full validation suite...~~ **Done (Aug 30, 2026).** Petstore (19 tools) and the real production spec from section 14 (122/122 tools, up from 120/122) both validated end to end through the new pipeline — see `test/generate.test.ts` and this section's manual run.
5. ~~Decide whether to keep klaridian's own tests...~~ **Done (Aug 30, 2026).** Retired the old fixture-based unit tests (they tested the now-deleted hand-rolled mapper); replaced with `test/generate.test.ts` (E2E CLI behavior + instrumentation patch) and `test/canary-generator-shape.test.ts` (section 19 — guards against `openapi-mcp-generator` drift).
6. Version-pin `openapi-mcp-generator` and add a canary test for its generated-code shape. **Done (Aug 30, 2026) — see section 19.**



## 19. `openapi-mcp-generator` version pinning + canary test (Aug 30, 2026)

Roadmap item #3 from section 18. `render/instrument.ts`'s patch depends on two exact strings in `openapi-mcp-generator`'s generated output — the `executeApiTool(...)` call site and the `import { z, ZodError } from 'zod';` import marker. That shape is not a contract the library promises to keep stable; a minor/patch version bump could silently change it.

**What was built:**
- `packages/cli/package.json` now pins `openapi-mcp-generator` to an exact version (`4.0.1`, no `^` range) instead of a caret range. This trades automatic patch updates for predictability — an explicit, reviewed `npm install openapi-mcp-generator@x.y.z` is required to move versions, rather than a routine `npm install` silently picking up a new minor/patch release that could break the instrumentation patch.
- `packages/cli/test/canary-generator-shape.test.ts` — two tests:
  1. Asserts the installed `openapi-mcp-generator` version matches the pinned version exactly, with a message explaining exactly what to do if it doesn't (verify `instrument.ts`'s constants by hand, then update both the pin and the test's expected version together).
  2. Generates a real server from the Petstore fixture via `openapi-mcp-generator` directly (not through klaridian's own CLI) and asserts the two exact strings `instrument.ts` depends on are still present verbatim — failing with the generated source's first 3000 characters inline for fast diagnosis if not.

**Validated the canary actually catches drift:** manually edited the compiled test's expected version to a wrong value and confirmed it fails with a clear `AssertionError` (expected/actual mismatch) rather than silently passing — a canary that can't fail isn't a canary. Reverted immediately; the real pinned version (`4.0.1`) passes.

**Why this approach over an alternative (e.g. vendoring/forking `openapi-mcp-generator`, or generating an AST rather than string-matching):** pinning + a canary test is the minimum-complexity solution that still fails loudly on drift, consistent with the project's "fail loudly, don't guess" rule (section 7/8) — applied here to a dependency's output shape rather than to OpenAPI input, but the same principle. Full AST-based patching would be more robust to formatting-only changes (e.g. whitespace) but adds real complexity for a problem the canary already solves: catching *any* change (including semantic ones) at test time, well before it could reach a generated server silently.

All 5 tests pass (`npm test`): the 2 new canary tests plus the 3 from `generate.test.ts` (section 16/18's pipeline).

## 20. Second plugin: PostHog (product observability), and multi-plugin composition (Aug 30, 2026)

Ships the second plugin from PLAN.md's roadmap and — more importantly — proves out something that had only ever been designed on paper: composing more than one `ObservabilityPlugin` on the same generated server. Section 13's v0 guardrail ("exactly 0 or 1 plugins, `generateServerSource` throws otherwise") is lifted now that there's an actual second plugin to validate composition against, instead of guessing at a composition strategy speculatively.

**What was built:**
- `src/plugins/posthog/posthog.plugin.ts` — mirrors the OTel plugin's shape closely (same `ObservabilityPlugin` interface, same vendored-file-in-`src/instrumentation/`-pattern). Captures one `"mcp tool called"` event per tool call via `posthog-node`, with `tool_name`, `duration_ms`, `success`, and (on failure) `error_message` properties. Uses a fixed `distinctId: "mcp-server"` for v0 — deliberately simple, since a generated stdio MCP server has no notion of an end-user identity (the caller is an MCP client, not a logged-in human); revisit only if per-caller identity becomes available and useful. Config schema has one field, `apiHost` (defaults to PostHog's US cloud), read from `POSTHOG_API_HOST`/`POSTHOG_API_KEY` env vars at runtime, following the exact same fail-loudly-if-missing pattern as `KLARIDIAN_AUTH_TOKEN`/`KLARIDIAN_BASE_URL` from the pre-pivot work (sections 12, 17).
- **stdio-safety check done explicitly, not assumed:** inspected `posthog-node`'s published `dist/` directly for any `console.log`/`console.dir` (stdout) calls — found none; its internal logging is exclusively `console.error`/`console.warn`, which Node routes to stderr. So there's no `ConsoleSpanExporter`-style landmine (section 12's finding) waiting inside this dependency. Worth stating explicitly rather than assuming, since it's a hard invariant the whole project depends on and a different SDK could easily have gotten it wrong.
- `render/instrument.ts` rewritten to take `ObservabilityPlugin[]` instead of a single plugin everywhere (`instrumentGeneratedServer`, `getPluginProjectAdditions`). Composition works by nesting: each plugin wraps a thunk around the next (`wrapTool(name, () => wrapPostHogTool(name, () => executeApiTool(...))())()`), so N plugins compose the same way 1 does — no special-cased branch for the single-plugin case anymore. Ordering is **first-listed = outermost**: `--plugin otel --plugin posthog` puts OTel's span around PostHog's capture, which reads naturally in a trace viewer (the broad engineering span containing the narrower product event). This is an arbitrary but now-documented and stable choice, not left to insertion order or plugin registration order.
- File-path collisions between plugins' contributed files are detected and fail loudly (`InstrumentationPatchError`) rather than one plugin silently overwriting another's file — validated by a dedicated unit test using a deliberately-conflicting fake plugin.
- `commands/generate.ts` now accepts repeatable `--plugin <id>` flags (was single-value) and reports `Instrumented with: otel, posthog` listing every active plugin.

**Validation:**
- Manual end-to-end run with both plugins against Petstore: generated 19 tools, both `wrapTool`/`wrapPostHogTool` imports present, nested call site exactly as designed, both plugins' dependencies merged into `package.json`, `npm install` + `tsc build` clean, and — critically — a real compiled server run over stdio JSON-RPC with **both** `OTEL_EXPORTER_OTLP_ENDPOINT`-style and `POSTHOG_API_KEY`/`POSTHOG_API_HOST` env vars set: stdout stayed exactly 3 valid JSON-RPC lines (init, tools/list, tools/call), confirming composing two plugins doesn't compound stdout-corruption risk the way each individually already doesn't.
- `test/generate.test.ts` gained a full E2E test (`generate --plugin otel --plugin posthog: composes both plugins...`) covering everything above as an automated test, not just a manual run — including a real SIGTERM to exercise both plugins' shutdown handlers together.
- `test/generate.test.ts` also gained a unit test for the new file-collision guard in `getPluginProjectAdditions`.

All 7 tests pass (`npm test`): the 2 canary tests (section 19), 2 single-plugin/no-plugin E2E tests (section 16/18), the new multi-plugin E2E test, and 2 unit tests for the instrumentation patch's failure modes.

**Not yet covered:** PostHog's own posthog-node has real capabilities (feature flags, session recording, group analytics) deliberately left out of scope for v0, same restraint as the OTel plugin's OTLP-only choice — no speculative feature-building without a concrete need. The `distinctId: "mcp-server"` simplification means all events currently look identical regardless of which MCP client/end-user triggered them; acceptable for v0's "is this tool used at all" question, not yet sufficient for per-user product analytics.

**Clarification worth recording (Aug 30, 2026):** PostHog ships two genuinely separate data systems, not one — confirmed directly rather than assumed. **Product Analytics** (`posthog.capture()`, funnels/retention/trends) is what this plugin uses, and matches the original product idea (engineering + product observability as two distinct plugins) exactly — no conceptual overlap with the `otel` plugin. Separately, PostHog also ships **Traces/Logs** (beta, OTLP-based) — positioned as an observability/debugging feature (span waterfalls, latency, error rates), i.e. the same category as our `otel` plugin, not product analytics. This does NOT create redundancy between klaridian's two plugins — but it does mean PostHog's own OTLP endpoint is a valid target for the *`otel` plugin*, since it already speaks standard OTLP/HTTP. A user could point `OTEL_EXPORTER_OTLP_ENDPOINT` at PostHog's trace ingestion and get both plugins' data inside one PostHog project, with zero klaridian-side code changes — a synergy worth mentioning in docs/positioning, not a threat to the plugins' distinct purposes.

## 21. Competitive feature matrix: klaridian vs. FastMCP (Aug 30, 2026)

Researched after shipping the PostHog plugin (section 20), to sanity-check klaridian's differentiation before continuing. Important framing correction made during this research: **FastMCP and klaridian are not the same product category.** FastMCP is a Python *framework* for building MCP servers by hand (with `from_openapi()` as one ingestion path among several); klaridian is a TypeScript *generator* that produces a standalone server from an OpenAPI spec, delegating the actual generation to `openapi-mcp-generator` (section 16). The fairer comparison is "klaridian + openapi-mcp-generator" vs. "FastMCP + `from_openapi()`", and even that undersells FastMCP's scope — it's a full application framework, we're a narrower code generator plus an instrumentation layer.

| Feature | klaridian | FastMCP 3.0/4.0 |
|---|---|---|
| Language | TypeScript/Node | Python |
| License | MIT/Apache (planned) | Apache 2.0 |
| Model | Generates standalone code (via `openapi-mcp-generator`) | Runtime framework — no code generation |
| OpenAPI 3.0/3.1 | Yes (via `openapi-mcp-generator`) | Yes |
| Transports | stdio only | stdio, HTTP, SSE |
| **OpenTelemetry** | Opt-in plugin (`--plugin otel`), our own vendored instrumentation | **Native, on by default since v3.0/4.0**, zero-config, no-op without an SDK configured (same "bring your own backend" principle we independently chose for our plugin) |
| **PostHog / product observability** | Plugin (`--plugin posthog`) — appears to be genuinely unique in the space | None found — not in FastMCP itself, not in the most OTel-forward OpenAPI→FastMCP generator (`mcp-generator-3.x`) |
| Auth | Bearer + API key (via `openapi-mcp-generator`) | Bearer, full OAuth2 (proxy + Dynamic Client Registration), JWT/JWKS, `MultiAuth` composition |
| Middleware / request pipeline | None | Full pipeline: logging, rate limiting, retries, caching, structured error handling, built-in + custom hooks (`on_call_tool`, `on_request`, etc.) |
| Server composition | None | `mount()`, `ProxyProvider`, namespacing, multi-server aggregation |
| MCP Resources | None | Yes |
| Component versioning | None | Yes (multiple tool versions coexist) |
| Maturity / adoption | Personal project, days old | ~16M PyPI downloads/week, reported as powering the majority of MCP servers in production |

**A second, more direct competitor surfaced during this research:** [`mcp-generator-3.x`](https://github.com/quotentiroler/mcp-generator-3.x) (Python, Apache 2.0, actively maintained) generates **FastMCP 3.x servers from OpenAPI specs** — i.e. it already combines "OpenAPI→MCP generation" with FastMCP's native OTel, plus JWT/JWKS auth, OAuth2 flows, a real middleware stack, MCP Resources, and modular sub-servers. It has **no PostHog/product-observability equivalent either** (confirmed by its own feature table, which lists OpenTelemetry but nothing product-analytics-shaped).

**What this changes about klaridian's differentiation:**
- The OTel plugin has **no differentiation value in the Python ecosystem** — anyone on FastMCP already gets engineering observability for free, natively. Its value is now specifically "there's no equivalent zero-config OTel story in the Node/TypeScript OpenAPI→MCP generator space" — a narrower, still-real, but smaller claim than originally assumed.
- The PostHog plugin remains the one clearly validated, unique differentiator — nobody else in the space (Python or TypeScript, framework or generator) combines OpenAPI→MCP generation with product observability.
- On every other axis (auth sophistication, middleware, composition, transports, MCP Resources), a mature Python competitor is already ahead of klaridian's current TypeScript stack — these aren't gaps klaridian invented, they're gaps inherited from depending on `openapi-mcp-generator`'s current scope (itself narrower than FastMCP's).

See section 22 for the differentiation paths this points toward.

## 22. Differentiation paths under consideration (Aug 30, 2026)

Raised directly by the section 21 finding: "generate a server with observability" is no longer a clean, uncontested niche — FastMCP-based competitors already do OTel+auth+middleware natively, and klaridian's own OTel plugin is redundant for anyone already on FastMCP. This section lists candidate differentiation paths, not decisions — none of these are committed to; they need discussion and, per PLAN.md's guiding principle, real signal before building.

### a) Multi-language: generate the SAME instrumentation for Python (FastMCP) targets too
Instead of competing with FastMCP's native OTel, **plug into it** — ship a `--target fastmcp` (or similar) generation mode that produces a Python/FastMCP server (or a `fastmcp.json` config) with klaridian's PostHog plugin wired in on top of FastMCP's own native OTel, rather than reinventing OTel wiring FastMCP already does for free. This reframes klaridian from "OpenAPI→MCP generator, TypeScript only" to "the product-observability layer for OpenAPI-generated MCP servers, regardless of which generator/language produced them." Concretely lower-risk than it sounds: the PostHog plugin's actual logic (capture one event per tool call, with duration/success/error) is a thin, portable pattern — the hard part is finding FastMCP's own equivalent single-call-site injection point (its "component" execution path), which needs research before assuming it's as simple as `openapi-mcp-generator`'s single `executeApiTool()` was (section 20).

**Trade-off:** real engineering investment (a second target language/runtime), and it repositions the whole project — no longer "a generator with plugins," more "an instrumentation layer that works across generators." Needs explicit buy-in before starting, not a small addition.

### b) Double down on product observability itself — go deeper than one PostHog event
Rather than spreading thin across languages, make the PostHog plugin itself meaningfully better than any DIY integration a developer would hand-roll in 20 minutes: per-argument/parameter analytics (which fields get used, not just which tool), automatic funnel construction across multi-tool agent sessions (tool A → tool B → tool C sequences), correlation with MCP client identity (once available via protocol extensions), or opinionated dashboards/insights pre-built for "MCP tool usage" as a first-class PostHog data shape (not just raw events the user has to build charts for themselves). This is the lowest-risk path — no new language, no new competitor category — but needs validation that the shallow version (what exists today) isn't already "enough" for real users; more depth is only valuable if someone's asking for it.

### c) Tool curation / pruning (the FastMCP-author critique from section 16)
Already flagged as a validated-but-unbuilt direction: the FastMCP author's own critique of OpenAPI→MCP auto-conversion (too many tools, context bloat, agents perform worse) points at a real, different problem nobody in this space solves — automatic or semi-automatic curation of which of the N generated tools an agent should actually see, based on usage data (which the PostHog plugin is already collecting). This could be a genuinely novel combination: **use our own product-observability data to drive automatic tool pruning/prioritization** — closing the loop between "we measure usage" and "we use that measurement to improve the generated server," which no generator (FastMCP-based or otherwise) currently does. Needs real usage data to be believable, though — a chicken-and-egg problem with adoption.

### d) The hosted correlation/fleet layer (already in PLAN.md section 4)
Restating the existing plan rather than a new idea: cross-server task correlation, fleet inventory, unified cost attribution, smart routing — deliberately positioned to never duplicate Datadog/PostHog/FastMCP's own capabilities. This remains the most defensible long-term moat (a generator/framework is commodity, a hosted aggregation layer isn't), but is explicitly gated on 20-50 real users per the existing Phase 0/Phase 1 plan — not something to pull forward just because the generator-level differentiation narrowed.

### e) Do less generation, more "bring your own generator" — become instrumentation-only, generator-agnostic
A more radical version of (a): stop shipping a generator at all (or make it optional), and instead ship the instrumentation layer as something that attaches to *any* already-generated MCP server (FastMCP output, `openapi-mcp-generator` output, hand-written servers) via a post-processing CLI step (`klaridian instrument ./my-server --plugin posthog`) — closer to a linter/codemod tool than a scaffolder. This sidesteps the "which generator is best" competition entirely and repositions around the one piece nobody else has (PostHog), applied universally. Highest strategic coherence with the section 21 finding, but also the biggest scope change — effectively obsoletes the `generate` command as currently built (sections 16-19) in favor of a new `instrument` command working on arbitrary input.

**No decision made in this session.** Recorded for discussion; PLAN.md section 5 ("open questions") should reference this section once a direction is chosen.

## 23. Multi-language expansion: Python/FastMCP via a native middleware (Aug 30, 2026)

First concrete step on differentiation path (a) from section 22 — validated with real code and real tests, not just a design sketch, following the same "prove it end to end" discipline as every other decision in this document.

**Decision made:** attach to FastMCP (not generate for it). FastMCP already dominates OpenAPI→MCP generation in Python (native `from_openapi()`, native zero-config OpenTelemetry since v3.0/4.0) — building a competing generator would mean re-fighting the same battle section 16 already concluded was a losing one for TypeScript. FastMCP has something the TypeScript `openapi-mcp-generator` output does not: a first-class middleware pipeline (`Middleware` base class, `add_middleware()`, hooks like `on_call_tool`). This means the Python side needs **no code generation and no textual patching at all** — the entire mechanism from `render/instrument.ts` (finding a call site, rewriting it, hoping the generator's output shape doesn't drift) simply doesn't apply. A middleware class is the idiomatic, zero-surprise way to attach cross-cutting behavior to *any* FastMCP server — hand-written, `from_openapi()`-generated, or generated by a third party (`mcp-generator-3.x`).

**What was built:** `packages/python-posthog-middleware/` — a standalone, publishable Python package (`klaridian-posthog-middleware`), independent of the TypeScript CLI (no shared runtime, deliberately — the mechanism is fundamentally different per language, forcing shared code here would be artificial):
- `src/klaridian_posthog_middleware/__init__.py` — `PostHogMiddleware(Middleware)`, overriding `on_call_tool`. Captures the *exact same event shape* as the TypeScript plugin (`"mcp tool called"` event, `tool_name`/`duration_ms`/`success`/`error_message` properties, fixed `distinct_id="mcp-server"` by default) — deliberate parity, so a fleet mixing TypeScript- and Python-generated servers produces consistent, comparable events in one PostHog project.
- Reads `POSTHOG_API_KEY`/`POSTHOG_API_HOST` from env if not passed explicitly, mirroring the TypeScript plugin's fail-loudly-if-missing pattern (raises `ValueError` immediately at construction, not at first tool call).
- `pyproject.toml` — standard `hatchling` build, `fastmcp>=3.0.0` + `posthog>=3.0.0` as real dependencies (not vendored/generated files the way the TypeScript OTel/PostHog plugins are — Python has no equivalent need to vendor, since there's no generated-project-directory concept here at all; this is just a normal installable library).

**stdio-safety check done explicitly (mirroring section 20's discipline):** inspected the installed `posthog` Python package directly for stdout-writing code — found none in shipped runtime code (only its own test suite uses `print()`); its internal logging uses the standard `logging` module, which defaults to stderr. Same conclusion as the Node `posthog-node` package (section 20), independently re-verified for the Python package rather than assumed to be equivalent.

**Validation (`packages/python-posthog-middleware/tests/test_middleware.py`, `pytest` + `pytest-asyncio`):**
- Built a real `FastMCP` server with two real tools (one that succeeds, one that always raises), mounted `PostHogMiddleware` via `add_middleware()`, and drove it through FastMCP's real in-memory `Client` transport (a genuine MCP client/server round-trip — `list_tools()`, `call_tool()` — not a mocked interface).
- Only `posthog.client.Client.capture`'s actual outbound network call is mocked (so the test suite makes no real network requests) — everything else (the middleware's `on_call_tool` hook, FastMCP's own request handling, timing, exception propagation) runs for real.
- Confirmed: exactly 2 events captured (one success, one failure) with the exact expected shape — `distinct_id="mcp-server"`, `event="mcp tool called"`, correct `tool_name`/`success`/`duration_ms` per call, `error_message` present only on the failing call and containing the real exception text.
- 2 additional unit tests for the fail-loudly-on-missing-key behavior (raises immediately at construction) and the env-var fallback path.
- All 3 tests pass.

**Deliberately not done yet:**
- No `otel`-equivalent Python middleware — not needed. FastMCP's own native OTel already covers this; building one would be pure duplication with zero differentiation value (the exact section 21 finding this section responds to).
- No PyPI publish yet — package is validated locally (editable install) but not yet released; publishing is a distribution decision, not a technical blocker.
- No integration test against a `from_openapi()`-generated or `mcp-generator-3.x`-generated server specifically — the middleware attaches identically regardless of how the underlying FastMCP server's tools were created (that's the whole point of using FastMCP's own middleware API rather than patching generated code), so a hand-written test server is a valid stand-in; worth a follow-up real-world check against an actual `from_openapi()` output if/when this ships for real users.
- No decision yet on whether this package lives in the `klaridian` monorepo long-term or gets its own repository — kept in `packages/python-posthog-middleware/` for now since the differentiation-path decision itself (section 22) isn't finalized.

## 24. Tool curation direction: user-chosen filtering at generation time, not LLM- or usage-data-driven (Aug 30, 2026)

Follows the section 21-22 differentiation discussion and deep market research (see PLAN.md section 5) confirming "tool bloat / context overload" as the single strongest, most independently corroborated pain point in the whole MCP ecosystem today — stronger signal than product analytics demand, and specifically called out for OpenAPI→MCP generators as a category (the exact category klaridian is in).

**Explicit user decision on mechanism (Aug 30, 2026):** curation must be **user-chosen, not LLM-suggested**. Rejected the earlier idea of an LLM pass over the spec to suggest "core vs. rarely-used" operations — the user should decide what's included, not an automated guess. This is consistent with the project's existing "fail loudly, don't guess" principle (sections 7/8) applied to a new area: don't let an LLM guess which tools matter any more than the generator should guess an ambiguous schema.

**Investigated whether OAuth consent-screen-style tool selection is available to us — it isn't, and here's why:** researched how MCP clients handle tool visibility today. Two genuinely different mechanisms exist:
1. **OAuth consent screens** (remote/HTTP transport only, e.g. via Keycloak) can list scopes/tools to the end user — but OAuth scopes are coarse by design (read/write/admin-style), with no standard mechanism for per-tool granularity, and this only exists for HTTP+OAuth transport.
2. **Client-side tool toggles** (VS Code's tool picker, LibreChat's per-tool enable/disable, an open Zed feature request for the same) — these exist and work on any transport including stdio, but they're a responsibility of the **MCP client** (VS Code, Claude Desktop, etc.), not the server. klaridian generates servers, not clients, and is stdio-only by design (section 8's guardrails) — so neither mechanism is something klaridian can build or control directly.

**Conclusion:** the only lever klaridian actually has is **generation-time filtering** — deciding which OpenAPI operations become tools in the first place, before the server ever exists. This sidesteps the OAuth/client limitation entirely and works identically regardless of which MCP client eventually connects.

**Mechanism validated with real code (not assumed) against the current `openapi-mcp-generator` dependency:**
- `generateMcpServer()` (the function klaridian's `commands/generate.ts` actually calls to write a full project) **already respects the `x-mcp: false` extension** on individual OpenAPI operations — confirmed by generating a real 2-operation test spec with one operation marked `x-mcp: false` and inspecting the output: only the non-excluded operation appeared as a tool in the generated server.
- `getToolsFromOpenApi()` (the lighter-weight tool-listing function, already used by klaridian for the pre-flight tool count) additionally supports `excludeOperationIds` and a custom `filterFn` — richer, but not currently wired into `generateMcpServer()` itself.
- **Gap identified:** there's no rich filtering API on `generateMcpServer()` directly (only the spec-level `x-mcp` extension) — so klaridian's own curation feature would need to pre-process the input spec (setting `x-mcp: false` on excluded operations based on user choices) before handing it to `generateMcpServer()`, rather than passing a filter option through. This is a small, well-understood integration point, not a blocker.

**Planned design (documented, already implemented — see section 25):**
- Interactive mode: before generating, show the user the spec's operations grouped by OpenAPI tag (tags are already extracted by `openapi-mcp-generator`'s `McpToolDefinition.tags`), let them check/uncheck by tag or individual operation via a terminal checkbox-style prompt — no LLM involved anywhere in the decision.
- Non-interactive equivalents for scripting/CI: `--include-tags <tags>`, `--exclude-tags <tags>`, `--exclude-operation-ids <ids>` flags on `klaridian generate`.
- Internally: apply the user's choices by pre-processing the parsed spec to set `x-mcp: false` on excluded operations, then hand the modified spec to `generateMcpServer()` — reusing the extension point that's already proven to work, rather than forking or patching `openapi-mcp-generator` itself.

**Why this fits the existing plugin/instrumentation strategy rather than competing with it:** this is a generation-time concern (which tools exist at all), completely orthogonal to the `otel`/`posthog` plugins (which instrument tools that already exist). The two are complementary, not alternative differentiation paths — curation controls *what* gets built, instrumentation observes *how it's used* once built. A future iteration could feed PostHog usage data back into curation *suggestions* (still user-approved, never automatic) once real usage data exists — but that's an enhancement to this mechanism, not a prerequisite for it, avoiding the chicken-and-egg problem of needing users before being able to help users.

## 25. Tool curation: implemented and validated end to end (Aug 30, 2026)

Followed through on the section 24 design; built exactly what was documented there, no scope creep.

**New module `packages/cli/src/curation/curation.ts`:**
- `listOperations()` — lists every operation (operationId/tags/method/path) via `openapi-mcp-generator`'s own `getToolsFromOpenApi()`, reused rather than re-parsed independently.
- `summarizeTags()` — counts operations per tag (including an `"(untagged)"` bucket), used to show the user real tag names/counts before they choose.
- `validateCurationChoice()` — fails loudly (`CurationValidationError`) if `--include-tags`/`--exclude-tags`/`--exclude-operation-ids` reference a tag or operationId that doesn't actually exist in the spec, rather than silently no-op'ing a typo. Applies the project's "fail loudly, don't guess" rule (sections 7/8) to user input, not just spec parsing.
- `applyCurationToSpec()` — the actual mechanism: clones the parsed spec (never mutates the caller's document) and sets `x-mcp: false` on every excluded operation, per the section 24 finding that `generateMcpServer()` already respects this extension natively.

**CLI wiring (`commands/generate.ts`):** added `--include-tags`, `--exclude-tags`, `--exclude-operation-ids` (comma-separated) plus an `--interactive` flag that prompts via `@inquirer/prompts` (new dep) before generating. All paths converge on the same `listOperations()` → `validateCurationChoice()` → `applyCurationToSpec()` pipeline, so interactive and scripted/CI usage share one code path rather than diverging. When curation is active, the curated spec is written to a temp file (cleaned up in a `finally`) because `generateMcpServer()` only accepts a spec **path**, not a parsed document in memory — that's the integration seam, not a limitation of the curation logic itself. Success output now reports `"Generated N tool(s) (curated from M total)"` so curation is visible in normal usage, not just inferred.

**New dependencies:** `@apidevtools/swagger-parser` (parses the spec into a mutable `OpenAPIV3.Document` for curation — separate from `openapi-mcp-generator`'s own internal parsing, which only exposes a file-path-in/project-on-disk-out API, not an intermediate document), `@inquirer/prompts` (interactive checkbox-style tag selection), `openapi-types` (typing the document, dev-time only concern).

**Validated end to end, not just unit-tested (per the project's standing rule):** `test/curation.test.ts` covers the pure logic (tag summarization, validation errors on unknown tags/operationIds, `x-mcp` flagging correctness, non-mutation of the input) *and* two real E2E cases against the actual CLI and the Petstore fixture — `--exclude-tags store,user` producing a server whose generated source genuinely excludes those tags' operationIds while keeping others, and an unknown-tag case failing loudly with the expected message on stderr. Full suite: 16/16 passing, including the pre-existing OTel/PostHog plugin composition tests (unaffected by this change, confirming curation and instrumentation remain orthogonal in practice, not just in design).

## 26. Two more product-analytics plugins (Amplitude, Mixpanel) — and why product analytics needed more than one, unlike engineering observability (Aug 30, 2026)

Prompted directly by reviewing the project's own README banner/positioning: it listed one product-analytics option (PostHog) next to engineering observability, which is inherently vendor-neutral (OTel/OTLP fans out to any compatible backend — Datadog, Grafana, Honeycomb, New Relic, etc. — with zero extra klaridian code, since `--plugin otel` already just speaks a standard wire protocol). Listing a single product-analytics provider understated the category and, worse, invited the same "why is this one specific dependency so central" critique the project had just addressed for `openapi-mcp-generator` in the README (see the README's Aug 30, 2026 rewrite) — except here the fix isn't "de-emphasize the dependency," it's "there's a real asymmetry to explain and then close."

**The asymmetry, stated precisely:** OTel/OTLP is a genuine open standard with wire-level interop — one plugin (`otel`) already reaches every OTLP-compatible backend without klaridian writing per-vendor code. Product analytics has no equivalent standard: PostHog, Amplitude, and Mixpanel each have their own proprietary ingestion API and Node SDK, with no shared protocol a single plugin could speak. So "add more product-analytics support" necessarily means "add more plugins," one per provider — this is a structural difference between the two categories, not an oversight in how many plugins got built so far.

**Decision (explicit, not defaulted into):** keep the existing per-plugin-per-provider architecture (`--plugin posthog`, `--plugin amplitude`, `--plugin mixpanel`, each a standalone `ObservabilityPlugin`) rather than building a unified "analytics" plugin with a provider switch. Considered the alternative (one `--plugin analytics --plugin-config analytics.provider=amplitude` plugin wrapping all three SDKs behind a common interface) and rejected it for now: it would be more elegant *if* there were already a shared abstraction worth building, but with only 3 providers and no evidence yet that users want to swap providers at runtime rather than choose one at generation time, the extra indirection has no concrete payoff — consistent with the project's standing "don't build ahead of a validated need" discipline (sections 20, 22).

**What was built — `amplitude.plugin.ts` and `mixpanel.plugin.ts`, mirroring `posthog.plugin.ts`'s exact shape:**
- Both implement the same `ObservabilityPlugin` interface, contribute one vendored `src/instrumentation/<id>.ts` file, and wrap tool handlers with `wrap<Provider>Tool()` the same way OTel/PostHog do — `render/instrument.ts`'s N-plugin composition (section 20) needed zero changes to support two more plugins, confirming that mechanism really does generalize past 2.
- Amplitude (`@amplitude/analytics-node`): reads `AMPLITUDE_API_KEY` (fail-loudly if missing) and `AMPLITUDE_SERVER_ZONE` (US/EU, config-schema field `serverZone`), flushes its internal batch queue on `SIGINT`/`SIGTERM` (same class of bug as OTel's `BatchSpanProcessor` and PostHog's own batching — an unflushed queue is lost on process exit otherwise).
- Mixpanel (`mixpanel`, the actively-maintained `mixpanel-node` successor — confirmed current version and that it ships its own TypeScript types natively, so no separate `@types/mixpanel` dependency is needed): reads `MIXPANEL_TOKEN` (fail-loudly if missing). Deliberately has **no** flush/shutdown handler, unlike the other two — `mixpanel.track()` sends each event over HTTP immediately rather than batching client-side, so there's no in-memory queue that could be lost on exit. This is a real SDK behavior difference, documented explicitly in the generated file's own comment so it doesn't look like a missed pattern later.

**stdio-safety checked directly against the installed packages, not assumed (same discipline as sections 20/23):**
- `@amplitude/analytics-node`'s internal `Logger` class defaults to `logLevel: LogLevel.None` and only calls `console.log`/`console.debug` if a caller explicitly raises the log level — which this plugin's generated file does not do. No stdout writes by default.
- `mixpanel` (mixpanel-node) has **zero** `console.log`/`console.dir`/`console.info` call sites anywhere in its published code (grepped directly) — it only reports errors via callback, never writes to stdout on its own.
- Both confirmed safe alongside stdio MCP transport, same conclusion as OTel/PostHog (section 20) and the Python PostHog middleware (section 23), independently re-verified per package rather than assumed to generalize.

**Validated end to end:** `test/generate.test.ts` gained a full E2E test (`generate --plugin amplitude --plugin mixpanel: two product-analytics plugins compose...`) — real `npm install`/`tsc build`, then the compiled server driven over stdio JSON-RPC with both plugins' env vars set (fake credentials, since the test doesn't need real ingestion to succeed — only stdout purity and successful tool execution are under test): confirmed exactly 3 valid JSON-RPC lines on stdout (init, tools/list, tools/call), 19 tools listed, and a successful `getPetById` call with both plugins actively wrapping it. A manual run against a temp directory (build + real stdio drive) was also done before writing the automated test, per the project's standing practice of validating manually first. Full suite: 17/17 passing.

**README banner updated to reflect this (not just prose):** the SVG diagram (`assets/banner.svg`/`.png`) now shows the engineering-observability branch fanning out to Datadog/Grafana/Honeycomb/New Relic/"any OTLP-compatible backend" (all true today, zero extra code, via the existing `otel` plugin) alongside the product-analytics branch showing PostHog/Amplitude/Mixpanel as three separate concrete plugins, with an explicit label ("via dedicated per-provider plugins — no shared standard") communicating the asymmetry directly in the diagram rather than leaving it implicit. This mirrors the project's own principle from the README rewrite: don't just say more, say the accurate thing — here the accurate thing required *building* the extra plugins first, not just drawing more logos.

## 27. Generated-server LICENSE + package.json license field (Aug 30, 2026)

Follows directly from PLAN.md section 7's finding: MCP servers are conventionally open source because they run with real credentials next to an autonomous agent, and a generated server with no license file at all is a real, visible gap against that norm — not a cosmetic one. Confirmed the gap existed by inspecting real output: a freshly generated project (via `openapi-mcp-generator`) had no `LICENSE` file and no `license` field in its `package.json` at all.

**What was built — `packages/cli/src/render/license.ts`:**
- A small, closed module: `LicenseId = "mit" | "apache-2.0" | "none"`, `getLicenseText(license, author, year)` returning the full, unmodified license text (or `undefined` for `"none"`), and `getPackageJsonLicenseField(license)` returning the SPDX identifier string (`"MIT"`, `"Apache-2.0"`, or `undefined`).
- Deliberately **not** a dependency on an external license-text package — the license bodies are static, standard, SPDX-canonical text embedded directly. One less supply-chain surface for something this small and unlikely to need updating.
- Only two real licenses supported for v0 (MIT, Apache-2.0) plus an explicit opt-out (`none`) — not an open-ended list. Matches the project's standing "narrow v0 scope, don't build ahead of a validated need" discipline (sections 8, 20, 22, 26): these two cover the overwhelming majority of real-world OSS MCP servers seen during this project's own research (Datadog, PostHog, the reference MCP servers, klaridian itself), and a "you may need GPL/BSD/other" gap is easy to add later if someone actually asks.

**CLI wiring (`commands/generate.ts`):**
- New `--license <id>` flag, **default `"mit"`** — deliberately opt-out rather than opt-in. An unset license was the actual bug being fixed; defaulting to "generate with no license unless asked" would have reproduced the same gap for anyone who doesn't know to ask. Validated eagerly, alongside the existing plugin-id validation, before any generation work starts — an unknown `--license` value fails loudly with the supported list, consistent with every other CLI input validation in this command.
- New `--author <name>` flag for the LICENSE's copyright holder; falls back to `git config user.name` (resolved via a new `resolveGitAuthorName()` helper, silently returning `undefined` on any failure — no git installed, not configured, running in CI, etc.) and finally to the literal string `"the project author"` if neither is available. Mirrors the common scaffolding-tool pattern (e.g. `npm init`'s own author-name default) rather than inventing a new convention.
- After a successful generation (and, when applicable, after curation/instrumentation — license writing happens right after the base project exists, before the plugin instrumentation step, so a LICENSE is present even if `--plugin` isn't used at all), the command writes `LICENSE` to the output directory and sets `package.json.license` to the SPDX id — unless `--license none` was passed, in which case **no file is written but an explicit warning is printed** (`⚠️ Generated with --license none — no LICENSE file written...`), applying the project's "fail loudly, don't guess" principle to a silent *omission*, not just to errors: a user who explicitly opts out should still be told what that means for distribution, not left to discover it later.

**Validated end to end (`packages/cli/test/license.test.ts`), not just via unit tests of the pure functions:** four real CLI invocations against the Petstore fixture, each inspecting the actual filesystem output —
1. Default (no `--license` flag): confirms `LICENSE` contains `MIT License` and the given `--author` in the copyright line, and `package.json.license === "MIT"`.
2. `--license apache-2.0`: confirms the real Apache-2.0 header text is present and `package.json.license === "Apache-2.0"`.
3. `--license none`: confirms **no** `LICENSE` file exists, the warning appears on stderr, and `package.json` has no `license` key at all (not `null`, not an empty string — the key is absent).
4. `--license gpl-3.0` (unsupported): confirms the CLI exits non-zero with the exact "Unknown license" message on stderr, and that **nothing** was generated at all (`package.json` doesn't even exist in the output dir) — proving the validation genuinely happens before any generation work, not just before the license-writing step.

Full suite: **21/21 passing** (the 17 pre-existing tests, confirmed unaffected, plus these 4 new ones) — `npm test` run directly, not assumed from the new tests passing in isolation.

**Scope decisions worth flagging:**
- This section only covers the **OpenAPI-path** generated server (the only generation path that currently exists — see section 16). If/when any other generation path is ever built, it must independently ship the same LICENSE/package.json behavior; nothing here is shared infrastructure across generation modes since there's only one mode today.
- Whether `klaridian` (the CLI/generator itself) is published to npm for `npx`-based zero-install usage was raised in the same discussion but is a separate distribution question, not resolved here — see PLAN.md section 7's closing note.

## 28. MCP spec conformance audit + fixes (Aug 30, 2026)

Prompted directly by a request to audit whether the generated server is "fully compliant with the standard." Ran a real audit, not a documentation review: generated a real server (Petstore fixture, 19 tools) via the actual CLI, built it for real, and drove it over real stdio JSON-RPC against the MCP spec's current version (2025-06-18), checking lifecycle/handshake, capability declaration, `tools/list`/`tools/call` shapes, the spec's explicit two-channel error model, and its dedicated Security Considerations section.

**Two real conformance bugs found, both in `openapi-mcp-generator`'s generated output (not klaridian's own code, but shipped by every server klaridian generates):**

1. **Unknown tool name returns a "successful" result instead of a JSON-RPC protocol error.** The spec's Tools/Error Handling section is explicit: "Unknown tools" belongs to the **Protocol Errors** category (a real JSON-RPC `{"error": {"code": -32602, ...}}`), not **Tool Execution Errors** (`{"result": {"content": [...], "isError": true}}`). The generated `CallToolRequestSchema` handler instead returned `{ content: [{ type: "text", text: "Error: Unknown tool requested: ..." }] }` — a `result`, indistinguishable in shape from success to any client that checks `error`/`isError` rather than parsing the text. Confirmed live: calling a nonexistent tool against the unpatched generated server returned a `result`, not an `error`.
2. **Tool execution failures never set `isError: true`.** Same spec section: "Tool Execution Errors: Reported in tool results with `isError: true`." Tested three real failure modes against the unpatched server — a missing required argument (Zod validation failure), an internal error during validation setup, and a genuine upstream API failure (a real HTTP 500 from the Petstore reference API) — and **none** of the three set `isError`. All three came back shaped identically to a successful call; only the text content differed. A client/agent relying on the spec's own error-detection mechanism (`isError`) rather than parsing free-text would never detect any of these three failure types.

**Also found, but explicitly NOT fixed here — recorded as follow-ups, not silently dropped:**
- No tool `title` field, no tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) on any of the 19 generated tools — both optional (not spec `MUST`s) since 2025-06-18, but exactly the mechanism the spec recommends for letting a client/agent distinguish safe reads from destructive writes. `openapi-mcp-generator`'s own `McpToolDefinition` already carries `method` (GET/POST/DELETE/etc.) per tool, which maps fairly directly to `readOnlyHint`/`destructiveHint` — a plausible future enhancement, not attempted in this pass (scope discipline: fix the two real spec violations found, don't scope-creep into a features pass in the same change).
- No `outputSchema`/`structuredContent` — every tool result is free-text (`type: "text"`), never structured output, despite the spec supporting it since 2025-06-18 and the generator already knowing each operation's response schema from the OpenAPI spec.
- No rate limiting of tool invocations anywhere in the generated server or in any plugin — the spec's Security Considerations section says servers "MUST... Rate limit tool invocations." A real gap, but a materially bigger feature than a textual patch (needs a rate-limiting strategy: per-tool? global? configurable?) — not attempted here.
- Tool output (the upstream API's raw response body) is passed back to the client largely unsanitized (`JSON.stringify(response.data)` almost verbatim) — a real "tool poisoning"/injection-via-tool-output surface if the upstream API ever returns attacker-controlled content, per current MCP security research. Same reasoning as rate limiting: real gap, bigger scope than this pass, not attempted here.
- 64-character tool name limit handling wasn't re-tested in this pass (already validated for a large production spec in section 16; the small Petstore fixture used here doesn't exercise it).

**What was built — `packages/cli/src/render/conformance.ts`:**
- `applyConformanceFixes(serverSource: string): string` — a small, always-applied textual patch (same class of mechanism as `render/instrument.ts`, but **unconditional**, not opt-in behind `--plugin`, because this isn't a feature, it's a correctness fix for spec-required behavior). Patches four exact call sites in `openapi-mcp-generator`'s generated `src/index.ts`:
  1. The unknown-tool branch: replaces the `return { content: [...] }` with `throw new McpError(ErrorCode.InvalidParams, \`Unknown tool: ${toolName}\`)` — the SDK's `Server` class (confirmed directly in `@modelcontextprotocol/sdk`'s `shared/protocol.js`) converts a thrown `McpError` into a real JSON-RPC error response automatically, so this is the idiomatic, SDK-native way to produce a protocol error rather than hand-rolling JSON-RPC error envelopes.
  2. The Zod validation-error result, (3) the validation-setup internal-error result, and (4) the tool-execution-error result (API failures, etc.) — all three get `isError: true` appended to their returned `CallToolResult`.
  - Also patches the `@modelcontextprotocol/sdk/types.js` import block to add `McpError, ErrorCode` alongside the existing `CallToolRequestSchema, ListToolsRequestSchema` imports.
- Fails loudly (`ConformancePatchError`) if any of the four call sites or the import marker isn't found verbatim — identical discipline to `render/instrument.ts`'s `InstrumentationPatchError`, because `openapi-mcp-generator`'s generated code shape is not a contract klaridian controls and could drift on a version bump.

**Wired into `commands/generate.ts` as an always-on step**, applied right after `generateMcpServer()` succeeds and *before* the LICENSE step and the opt-in plugin instrumentation step — so `render/instrument.ts`'s textual patch (which itself locates a different call site, `executeApiTool(...)`, unaffected by these fixes) always operates on the already-conformant source, and a LICENSE is written for a conformant server regardless of whether `--plugin` was used. A hard failure here (unlike a plugin failure) has no `--skip` escape hatch — these aren't optional, so there's no legitimate reason to generate a non-conformant server on purpose.

**Validated end to end (`packages/cli/test/conformance.test.ts`), replicating the exact audit scenario, not just re-running the patch function in isolation:**
- Real CLI invocation → real `npm install` + `tsc build` → real spawned server driven over real stdio JSON-RPC.
- Confirms the unknown-tool call now returns a genuine JSON-RPC `error` (not `result`) with `code: -32602` and a message containing "Unknown tool" — the exact bug reproduced and fixed.
- Confirms a missing-required-argument call now returns `result.isError === true` — the exact second bug reproduced and fixed.
- A second test confirms the conformance fixes and the `--license` feature (section 27) don't interfere with each other's file-writing order when both run together (the common case, since conformance fixes are always-on).

Full suite: **23/23 passing** (21 pre-existing, confirmed unaffected — including the plugin-composition tests, which continue to assert clean stdout JSON-RPC and successful tool calls, now additionally implying the conformance patch doesn't corrupt those paths — plus 2 new conformance tests).

**Why this wasn't found by any pre-existing test:** every existing E2E test (`generate.test.ts`) only exercises the **success path** (a valid `getPetById` call with a real id) — none of them called an unknown tool name or deliberately supplied invalid arguments, so the missing `isError`/protocol-error behavior had no test surface to be caught by. Worth remembering as a general lesson for future audits: success-path E2E coverage doesn't imply error-path spec conformance; the two need to be tested separately, which is exactly what this section's audit methodology (deliberately probing failure modes, not just the happy path) surfaced that no prior test did.

## 29. Non-stdio transports (`--transport streamable-http`/`web`) — the stdio-only guardrail lifted (Aug 30, 2026)

Raised directly: does klaridian really need to be stdio-only? Checked rather than assumed — `openapi-mcp-generator` (the dependency klaridian delegates generation to, since section 16) already natively supports `transport: 'stdio' | 'web' | 'streamable-http'` via its `CliOptions`/`generateMcpServer()` API, confirmed by reading its own type definitions and by actually generating real projects with each transport value. The v0 guardrail "stdio-only" (section 8) was written when klaridian had its own hand-rolled generator (pre-section-16 pivot) and stdio was the only thing it knew how to produce — it was never re-examined after the pivot to a dependency that already had more capability. This section lifts it, since the constraint was inherited, not re-justified.

**Why this doesn't touch section 28's conformance fixes or the plugin instrumentation layer at all:** confirmed directly by inspecting `openapi-mcp-generator`'s generated output for both new transports — `streamable-http` and `web` each add exactly one extra file (`src/streamable-http.ts` or `src/web-server.ts`, handling the HTTP-specific transport wiring and session management) plus a transport-specific `start:http`/`start:web` npm script. The actual tool-call handling — `server.setRequestHandler(CallToolRequestSchema, ...)`, the unknown-tool branch, the Zod validation, `executeApiTool()` — lives in the **same shared `src/index.ts`** regardless of transport; only `main()`'s transport-selection wiring differs. This means `render/conformance.ts` (section 28) and `render/instrument.ts` (section 16/20)'s textual patches, which both target call sites inside that shared handler, apply identically and correctly to all three transports with zero code changes to either module — validated directly, not assumed, by generating a `--transport streamable-http` project and confirming both `throw new McpError(...)` and `isError: true` are present in its `src/index.ts` exactly as they are for `--transport stdio`.

**What was built (`commands/generate.ts`):**
- New `--transport <type>` flag (`stdio` default, `streamable-http`, or `web`) and `--port <number>` (default `3000`, only meaningful for the two HTTP transports) — both validated eagerly (unknown transport, or a non-integer/out-of-range port) before any generation work starts, consistent with every other input validation in this command.
- Passed straight through to `generateMcpServer({ transport, port })` — no new mapping/translation layer, since `openapi-mcp-generator`'s own `TransportType` union is used directly as the source of truth for what's valid.
- Success output and the "Next steps" hint adapt to the chosen transport (`npm start` for stdio, `npm run start:http`/`npm run start:web` for the others) rather than always suggesting the stdio-only command that was hardcoded before this change.

**Validated end to end (`packages/cli/test/transport.test.ts`) — with one explicit, honestly-reported limitation:**
- `--transport streamable-http` and `--transport web`: real CLI invocation, confirms the transport-specific file (`streamable-http.ts`/`web-server.ts`) and npm script exist, confirms the section 28 conformance fixes are present in the shared `src/index.ts`, then a real `npm install` + `npm run build` — both compile cleanly.
- `--transport <unknown>` and an invalid `--port`: both fail loudly before touching `openapi-mcp-generator`, mirroring the existing `--license`/`--plugin` validation pattern.
- **Deliberately NOT tested**: a real spawned-server HTTP round-trip (à la the stdio path's spawn-and-drive-over-JSON-RPC tests) for streamable-http/web. Reason, found and confirmed directly rather than guessed at: manually generating, building, and running a `--transport streamable-http` server and driving it with real `curl` requests reproduces a genuine crash — `TypeError [ERR_INVALID_STATE]: Invalid state: ReadableStream is locked`, thrown inside the `fetch-to-node` dependency's `http-incoming.js` — on the **second** HTTP request to an established session (the first `initialize` request always succeeds; any subsequent request, e.g. `tools/call`, crashes the process). Reproduced identically against an **unpatched, vanilla** `openapi-mcp-generator` project generated with zero klaridian involvement, ruling out anything in `conformance.ts`/`instrument.ts`/klaridian's CLI as the cause — this is a real bug in `openapi-mcp-generator`'s own generated `streamable-http.ts` (or its `fetch-to-node` dependency), on the Node versions tested (confirmed on both v22.19.0 and v26.7.0/v26.8.1). Filing this upstream is a reasonable next step but out of scope for this session. Consequence: the generated `streamable-http` output is real and matches upstream's own capability, but is **not currently usable past the first request** — documented here plainly rather than silently shipped as if fully working, and worth flagging to anyone choosing `--transport streamable-http` today. `--transport web` was generated and built successfully in this session but its own runtime behavior wasn't driven with real requests the way stdio and streamable-http were — not yet independently confirmed working or broken.

Full suite: **27/27 passing** (23 pre-existing, confirmed unaffected, plus 4 new transport tests).

**Scope decisions:**
- `--docker` (a Dockerfile for the generated server) was discussed in the same conversation as a possible next step once a non-stdio transport exists — reasoned that stdio + `docker run` has a known, documented container-lifecycle problem in the wider MCP ecosystem (orphaned containers, since `docker run`'s parent-process-exit doesn't stop the daemon-managed container), so a container option makes more sense gated on an HTTP-based transport actually existing and working. Given the streamable-http crash just found, this is now explicitly blocked on that upstream bug being resolved (or worked around) first — not implemented in this session.
- No changes made to `render/conformance.ts` or `render/instrument.ts` themselves — this section is entirely `commands/generate.ts` flag plumbing plus tests, confirming (not modifying) that both existing patch modules already generalize across transports.

## 30. Closing the remaining audit gaps: tool annotations/title, rate limiting, output sanitization (Aug 30, 2026)

Follows through on the three gaps section 28 explicitly found but declined to fix in that pass ("real gaps, bigger scope than a textual patch — not attempted here"). Built for real this time, with the same always-applied, fail-loudly discipline as `render/conformance.ts`.

**What was built — `packages/cli/src/render/security.ts` + a new vendored `src/security-helpers.ts` file written into every generated project:**

1. **Tool annotations + title.** `tools/list`'s handler now emits `title: humanizeToolName(def.name)` (e.g. `getPetById` → `"Get Pet By Id"`) and `annotations: annotationsForMethod(def.method)` for every tool. Annotations are derived mechanically from the OpenAPI operation's HTTP method (already captured per-tool by `openapi-mcp-generator`, no new data needed): `GET`/`HEAD` → `readOnlyHint: true`; `DELETE` → `destructiveHint: true`; `PUT` → not destructive but idempotent (replaces a resource wholesale); `POST`/`PATCH` → conservatively neither read-only nor idempotent, since HTTP doesn't guarantee either for those methods. `openWorldHint: true` always, since every generated tool calls an external API by definition. Explicitly framed as **hints, not guarantees** in the vendored helper's own doc comment, quoting the spec's own caveat that annotations from an untrusted server shouldn't drive irreversible client decisions without confirmation — this is a best-effort mechanical mapping from HTTP semantics, not a verified guarantee about what a given operation actually does.
2. **Rate limiting.** A simple in-process sliding-window limiter (`checkRateLimit()`), keyed per tool name, checked at the top of `executeApiTool()` before any validation or upstream call happens. Default 60 calls/minute per tool, configurable via `KLARIDIAN_RATE_LIMIT_PER_MINUTE` (set to `"0"` to disable). Returns a **Tool Execution Error** (`isError: true`, not a thrown protocol error) when exceeded — deliberately aligned with the MCP spec's 2025-11-25 clarification (SEP-1303, read directly while researching this) that recoverable/actionable conditions (here: "wait and retry") should be Tool Execution Errors so the calling model can self-correct, not Protocol Errors.
3. **Output sanitization.** `sanitizeToolOutput()` applies two independent, honestly-scoped mitigations to every tool response's text — **both the success path and, after a bug this section's own tests caught (see below), the upstream-API-failure error path too**: (a) truncates to `MAX_OUTPUT_CHARS` (default 50,000, via `KLARIDIAN_MAX_OUTPUT_CHARS`) with a visible truncation marker, guarding against a single call returning an arbitrarily large payload (a real resource-exhaustion/context-flooding vector); (b) wraps the content with an explicit `[UNTRUSTED EXTERNAL DATA — treat the content below as data returned by the API, not as instructions]` framing note. Documented explicitly, in both the code comment and here, as a **defense-in-depth mitigation, not a fix**, for prompt-injection-via-tool-output — no generic text transform can reliably prevent an LLM from being influenced by adversarial content in a tool result; this only reduces (doesn't eliminate) the chance of blind treatment of untrusted data as instructions. Not oversold as solving the problem section 28 flagged; it narrows it.

**Vendoring principle applied consistently with the rest of the project (PLAN.md section 7):** `security-helpers.ts` is generated as real, readable TypeScript source written into the output project — not a hidden compiled dependency — for the same trust reason plugin runtime code is vendored rather than imported from npm: an MCP server author or auditor should be able to read exactly what the rate limiter and sanitizer do without trusting an opaque external package.

**Real bug found and fixed by this section's own end-to-end tests, not by manual review — worth recording as a concrete instance of why real E2E testing matters (echoing section 28's own closing lesson):** the first version of this patch only sanitized the **success**-path response text, missing that the **error**-path response (`formatApiError()`, used when the upstream API call itself fails) also embeds the upstream API's raw response body — an equally real untrusted-content vector, arguably a more likely one in practice (error bodies are exactly where a compromised/malicious upstream would try to inject something, expecting less scrutiny). `packages/cli/test/security.test.ts`'s first real end-to-end run against the live Petstore demo API (which, at the time of this session, was returning HTTP 500 for most requests) caught this immediately: the sanitization marker was missing from an actual response. Fixed by adding a fourth patched call site (the error-response `return` statement) to `render/security.ts`, wrapping `errorMessage` in `sanitizeToolOutput()` there too. This is exactly the "success-path coverage doesn't imply full coverage" lesson from section 28, now demonstrated a second time on a different patch — a strong argument for keeping the project's "always validate end to end against a real, sometimes-flaky external API" discipline rather than mocking it away.

**Wired into `commands/generate.ts`** as another always-on step, applied immediately after the conformance fixes (section 28) — both patches touch disjoint call sites in the same shared `src/index.ts`, applied in a fixed, documented order (conformance, then security) rather than relying on whichever happened to be coded first.

**Validated end to end (`packages/cli/test/security.test.ts`):**
- Real CLI invocation → confirms `title`/`annotations` wiring and the vendored `security-helpers.ts`'s three exported functions are present in source → real `npm install` + `tsc build` → real spawned server driven over real stdio JSON-RPC.
- `tools/list` confirms `getPetById` (a GET) has `readOnlyHint: true`/`destructiveHint: false` and the correct humanized `title`; `deletePet` (a DELETE) has `destructiveHint: true`/`readOnlyHint: false` — the annotation derivation validated against two real, semantically-opposite tools, not just one.
- A real `tools/call` confirms the untrusted-data framing marker appears in the actual response text.
- Rate limiting: with `KLARIDIAN_RATE_LIMIT_PER_MINUTE=2`, the first 2 calls to the same tool are not rate-limited (their actual success/failure depends on the live demo API, irrelevant to what's under test) and the 3rd/4th are rejected with `isError: true` and the exact expected message — driven through the real compiled server, not a unit test of `checkRateLimit()` in isolation.
- `KLARIDIAN_RATE_LIMIT_PER_MINUTE=0` confirms the limiter can be fully disabled, with 5 consecutive calls to the same tool all proceeding.

Full suite: **30/30 passing** (27 pre-existing, confirmed unaffected, plus 3 new security-hardening tests).

**Deliberately not attempted, and why:**
- No per-caller/per-session rate limiting — a stdio MCP server has no notion of caller identity distinct from "the one client connected to this process" (same simplification already made for the PostHog plugin's `distinctId`, section 20), so per-tool-name is the only dimension that's meaningful here. A future HTTP-transport-aware version (section 29) could plausibly add per-session limits using the `mcp-session-id` header, but that's a real extension, not implemented here.
- No semantic/content-based output filtering (e.g. detecting actual injection attempts, PII scrubbing) — genuinely out of scope for a generic OpenAPI-to-MCP generator that has no domain knowledge of what a given API returns; the framing-note approach was chosen specifically because it doesn't require understanding the content, only flagging its provenance.
- Annotations are not user-overridable per-operation yet (e.g. via an OpenAPI extension like the existing `x-mcp` for curation) — the mechanical HTTP-method mapping is a reasonable default, but a specific operation might warrant a different hint than its HTTP verb implies (e.g. a `POST /search` that's actually read-only). Worth revisiting if this proves too coarse in practice; not attempted here to avoid scope creep beyond what was asked.

## 31. Cosmetic branding metadata: icons, websiteUrl, description (Aug 30, 2026)

Raised directly: does klaridian generate icons/branding, the way the spec provides for? Checked rather than assumed — this metadata (`icons`, `websiteUrl`, `description` on a server's `Implementation` info) is real, but was added in MCP spec **2025-11-25** (SEP-973), one revision *after* 2025-06-18, the version section 28's audit was run against. Confirmed directly: `@modelcontextprotocol/sdk` v1.30.0 (the version `openapi-mcp-generator` already depends on and generates against) already declares `LATEST_PROTOCOL_VERSION = "2025-11-25"` and its `ImplementationSchema` already accepts `icons`/`websiteUrl`/`description` — the SDK is ready, `openapi-mcp-generator`'s generated code simply never populates these fields (there was nothing to set them until now, and no CLI flag to ask for it).

**Confirmed, not assumed, that no protocol-version patch was needed:** manually inspected `@modelcontextprotocol/sdk`'s `Server` class handshake logic (`shared/protocol.js`'s `_onrequest` / the `initialize` handler) — it already negotiates up to whatever `protocolVersion` the connecting client requests, falling back to `LATEST_PROTOCOL_VERSION` only if the client's requested version isn't recognized. The generated code never hardcodes an older version anywhere. Verified live: sent a real `initialize` request with `protocolVersion: "2025-11-25"` against an unpatched generated server and got back `2025-11-25` cleanly, before writing any code — so this section is purely about *populating* the new optional fields, not about protocol version negotiation at all.

**What was built — `packages/cli/src/render/branding.ts`:**
- `applyBranding(serverSource, options)` — patches the generated `new Server({ name: SERVER_NAME, version: SERVER_VERSION }, ...)` call site to add whichever of `icons`/`websiteUrl`/`description` were provided. Fails loudly (`BrandingPatchError`) if the expected call site isn't found, same discipline as every other `render/*.ts` patch.
- **Deliberately opt-in, unlike `conformance.ts`/`security.ts`:** this patch is only invoked from `commands/generate.ts` when at least one of `--icon`/`--website`/`--server-description` was actually passed. There's no "wrong until fixed" default the way there was for the conformance bugs (section 28) or a "should always be on" case the way there was for security hardening (section 30) — icons/websiteUrl are pure cosmetics with no sensible default value, so omission is a legitimate default rather than a gap.

**CLI wiring (`commands/generate.ts`):**
- `--icon <src[|theme]>`, repeatable — accepts a URL or data URI, with an optional `|light` or `|dark` suffix to set the icon's `theme` field (for clients that pick a variant matching their current UI theme, per the spec's own light/dark pattern). An unrecognized theme suffix (anything other than `light`/`dark`) is warned about and dropped rather than failing the whole generation — validated directly, not guessed.
- `mimeType` is inferred automatically from the icon's file extension (`.svg`→`image/svg+xml`, `.png`→`image/png`, `.jpg`/`.jpeg`, `.gif`, `.webp`, `.ico`) — a small, closed mapping covering the formats the spec's own guidance (researched while building this) recommends (SVG preferred for resolution independence, PNG/etc. as fallback). Unrecognized extensions simply omit `mimeType` (an optional field per spec), rather than guessing wrong.
- `--website <url>` and `--server-description <text>` map directly to `websiteUrl`/`description`.

**Validated end to end (`packages/cli/test/branding.test.ts`), including a real protocol-version-2025-11-25 handshake — not just source-text assertions:**
- Real CLI invocation with 2 icons (light+dark themes), a website, and a description → real `npm install` + `tsc build` → real spawned server → a real `initialize` request explicitly requesting `protocolVersion: "2025-11-25"`. Confirms the response's `serverInfo` carries all three fields exactly as provided, with correctly inferred `mimeType`s and themes, and that the server still correctly negotiates `2025-11-25` and lists all 19 tools afterward (branding doesn't regress normal operation).
- A second test confirms that generating **without** any branding flags leaves the `new Server(...)` call completely untouched (`{ name: SERVER_NAME, version: SERVER_VERSION }`, no `icons`/`websiteUrl` keys at all) — proving this is genuinely opt-in, not a no-op patch that still touches the file.
- A third test confirms an unrecognized icon theme suffix is warned about and dropped, not a hard failure.

Full suite: **33/33 passing** (30 pre-existing, confirmed unaffected, plus 3 new branding tests).

**Deliberately not attempted:**
- No client-side icon rendering/hosting — klaridian only wires the metadata through; whether a given MCP client (Claude Desktop, MCP Inspector, etc.) actually displays it is entirely up to that client's own UI, outside klaridian's control or scope.
- No icons/branding for individual tools/resources/prompts (the spec also allows this per SEP-973) — only server-level `Implementation` branding was requested and built. Per-tool icons would be a natural follow-up (mirroring the per-tool `title`/`annotations` work in section 30) if there's a real use case, not built speculatively here.
- No validation that a given `--icon` URL is actually reachable/a valid image — klaridian has no way to fetch and inspect it without adding a real network dependency to `generate` for a purely cosmetic field; left as the user's responsibility, consistent with the spec's own framing of icons as client-fetched-at-runtime metadata, not server-validated content.

## 32. CLI-UX audit: --force, --json, --quiet, non-TTY detection for --interactive (Aug 30, 2026)

Prompted directly by a request to audit `klaridian`'s own CLI UX for developers (i.e. `klaridian` itself, not the servers it generates) against established CLI-design references (clig.dev, the most commonly cited industry guideline; plus "designing CLIs for agent/script consumption" guidance, relevant given the CLI's own README already states agents are part of the target audience). Six findings were rated 🔴/🟡; per direct instruction, this section closes findings #2, #3, #4, #6, and adds `--quiet` (#5 in the audit) — findings #1 (npm name collision with an unrelated proprietary `klaridian` package) is a distribution/naming concern already tracked separately (PLAN.md), not a UX-in-the-CLI-itself issue, and #5 in the original numbering (no colors) was assessed as an acceptable, deliberate simplification, not a gap.

**What was audited, live, before writing any code:** ran the real compiled CLI through a battery of scenarios — `--help` output shape, stdout/stderr discipline, exit codes across multiple failure modes, overwrite behavior into a non-empty `--out`, `--interactive` piped through empty stdin (simulating a script/CI/agent with no real terminal), typo-command suggestions, and `--json`/`--quiet`/`--force` presence (absent, confirming the gap before building the fix).

**Findings closed:**

1. **(#2) `--interactive` didn't detect a non-TTY stdin.** Reproduced directly: `echo "" | klaridian generate --interactive` silently proceeded with the `@inquirer/prompts` checkbox's default (everything pre-checked) rather than failing — the actual chosen curation was never a real user decision, but nothing signaled that. Fixed with an explicit `process.stdin.isTTY` check *before* any prompt is shown, failing loudly with a message explaining why and pointing at the non-interactive equivalent (`--include-tags`/`--exclude-tags`/`--exclude-operation-ids`). This directly follows the "agents-no-prompts-default" principle from CLI-agent-design guidance researched for this section — a tool whose stated audience includes autonomous agents must never silently accept an empty/absent interactive answer as if it were a real choice.
2. **(#3) No `--force`/overwrite protection.** Reproduced directly: generating into a directory containing an unrelated file (`keep.txt`) silently succeeded, writing the new project's files alongside it with zero warning — `generateMcpServer()`'s own `force: true` was hardcoded, with no equivalent guard at the klaridian CLI layer above it. Fixed with a pre-generation check (`directoryExistsAndIsNonEmpty()`) that refuses to proceed into a non-empty `--out` unless `--force` is passed — checked *before* spec parsing or any generation work, so a mistaken `--out` can never partially destroy something before the user finds out. Also handles the edge case of `--out` pointing at an existing *file* (not a directory) — a hard failure regardless of `--force`, since overwriting a file with a directory isn't a sensible "force" semantics to support.
3. **(#4) No `--json` output.** The CLI's only machine-readable-adjacent option before this was string-matching emoji-prefixed stderr prose — fragile to any wording change, and exactly the kind of thing `agents-json-required`/`agents-structured-errors` guidance (researched for this audit) calls out as a real gap for tools meant to be driven by agents. Fixed with `--json`: on success, prints exactly one JSON object to **stdout** (`success`, `outputDir`, `toolCount`, `curatedFromTotal`, `transport`, `port`, `license`, `plugins`, `branding`, `nextSteps`, `warnings`); on failure, exactly one JSON object (`success: false`, `error`, `stage` — a stable machine-readable tag for *which* step failed, e.g. `"validate-license"`, `"interactive-requires-tty"`, `"apply-conformance"` — deliberately not just a free-text message, so a caller can branch on `stage` without string-matching prose either). Exit code (0/1) is set independently of this payload, so callers that only check the exit code still work unmodified.
4. **(#6) No `--quiet`.** Added to reduce klaridian's own step-by-step progress noise (the 5 possible "✅ Applied..." lines from conformance/security/branding/license/instrumentation) for scripted use, while deliberately keeping warnings (e.g. the `--license none` notice) and the final `Next:` summary line — quiet reduces chatter, it doesn't hide something the user needs to act on or be warned about. `--json` implies `--quiet` internally (no point emitting both prose progress and a JSON summary).

**Honest limitation found and documented while validating #3/#4, closed the same session (see section 33) — do not treat as still-open:** `openapi-mcp-generator`'s own `generateMcpServer()` call was found to print a substantial amount of its own progress text directly to stderr, uncontrollable via any option in its public API. Initially left as a documented limitation; superseded by section 33, which builds a real (if unideal) workaround rather than leaving it as accepted noise, per explicit instruction that the noise was "not acceptable."

**Deliberately not changed:** the npm name collision (audit finding #1) and the "no colors" observation (audit finding #5) — the former is a distribution decision already tracked in PLAN.md, unrelated to the CLI's own interaction design; the latter was assessed during the audit as an acceptable, low-dependency-footprint choice (plain text + emoji markers) rather than a real gap, so no `chalk`/`NO_COLOR` handling was added.

**Validated end to end (`packages/cli/test/ux.test.ts`):**
- `--force`: three real scenarios — refusal into a non-empty dir (with the pre-existing file confirmed untouched), successful overwrite with `--force` (pre-existing unrelated file confirmed to survive alongside the new output), and refusal when `--out` points at a file rather than a directory.
- Non-TTY `--interactive`: spawned (not `execFile`, so stdin can be explicitly piped/closed to guarantee non-TTY) with empty stdin, confirming exit code 1, the exact expected stderr message, and — critically — that `--out` remains completely empty (nothing generated before the failure).
- `--json`: real success case (parses the exact expected field shape, including `warnings` capturing the license-none notice), real failure case (`stage: "validate-license"`), and a case confirming a mid-generation warning (unrecognized icon theme) surfaces in the JSON `warnings` array, not just stderr.
- `--quiet`: confirms klaridian's own "✅ Applied..." lines are suppressed while the license warning and final `Next:` line still appear.

Full suite: **41/41 passing** (33 pre-existing, confirmed unaffected — a deliberate refactor goal, verified: every existing test asserting exact stderr text for `step()`-class messages still passes unmodified, confirming the human-readable-mode output text itself was not altered, only gated behind the new `quietMode`/`jsonMode` conditionals — plus 8 new UX tests).

**Implementation note on how output routing was unified:** rather than scattering `if (opts.json) {...} else if (!opts.quiet) {...}` at every one of the ~10 existing `console.error(...)` call sites, `commands/generate.ts` now defines three small local closures once (`step()` for progress lines gated by quiet/json, `warn()` for warnings that are both recorded into a `warnings` array *and* conditionally printed, and `fail()` — a single unified failure path that either prints the human `❌ message` or writes the JSON error object, always setting `process.exitCode`). Every existing error branch was converted to call `fail(message, stage)` with a stable `stage` tag rather than inlining `console.error` + `process.exitCode = 1` at each site — this was necessary groundwork for `--json`'s `stage` field to exist at all, not an unrelated refactor.

## 33. Closing the "unquietable third-party noise" gap: suppressing openapi-mcp-generator's own console output under --quiet/--json (Aug 30, 2026)

Direct follow-up to section 32's documented limitation, after explicit feedback that leaving `openapi-mcp-generator`'s own progress noise unsilenced under `--quiet`/`--json` was **not acceptable** — this section closes it with a real, validated fix rather than leaving it as an accepted gap, and separately records the proper long-term fix (a real logger/verbosity option in `openapi-mcp-generator` itself) as a tracked roadmap item, since klaridian's own workaround is real but not ideal.

**Confirmed the scope precisely before writing any code — not guessed:** grepped `openapi-mcp-generator`'s installed `dist/` directly. Its own CLI entrypoint module (`dist/index.js`, the file `generateMcpServer()` — the exact function `commands/generate.ts` calls — lives in) contains **56 `console.error`/`console.warn`/`console.log` call sites** with zero conditional gating, no injectable logger, and no verbosity flag exposed anywhere in its public `CliOptions`/`GetToolsOptions` API (confirmed by reading its `.d.ts` type definitions directly). Separately confirmed `getToolsFromOpenApi()` (the other `openapi-mcp-generator` function klaridian calls, for the pre-flight tool count) produces **zero** stderr output in the normal path — the noise is entirely scoped to the single `generateMcpServer()` call, not spread across klaridian's other uses of the dependency.

**What was built — `withConsoleSuppressed()` in `commands/generate.ts`:** a small helper that temporarily replaces `console.log`/`console.warn`/`console.error` with no-ops for the duration of an async function, restoring the originals in a `finally` block regardless of how that function exits (success, thrown error, or otherwise) — so a crash mid-generation can never leave the process's `console` permanently silenced for anything downstream (later warnings, later `fail()` calls, etc.). Applied by wrapping *only* the `generateMcpServer()` call site — the single, precisely-scoped place the noise actually originates — and only when `quietMode` is true (`--quiet` or `--json`, which implies quiet per section 32). Every other call in the command (curation, conformance, security, branding, license, instrumentation) is klaridian's own code, already correctly gated behind `step()`/`warn()`, and untouched by this change.

**Explicitly framed as a workaround, not a fix — and why that's the right call for now:** monkey-patching a global (`console.*`) to suppress a specific dependency's output is exactly the kind of pattern that's fragile in general (races if `generateMcpServer()` ever became concurrent with other console-writing code — it isn't, confirmed by reading `commands/generate.ts`'s own control flow — or if `openapi-mcp-generator` started writing via a different mechanism, e.g. `process.stderr.write()` directly, which this wouldn't catch). Considered and rejected two alternatives:
- **Forking `openapi-mcp-generator`** to add a real `silent`/`logger` option — the *correct* long-term fix, but a real maintenance burden (an actual fork to track upstream against, echoing exactly the "don't fork if you can avoid it" reasoning already applied when adopting this dependency in section 16). Not justified for a cosmetic-output problem when a much smaller, contained workaround exists.
- **Redirecting the whole process's `process.stderr`** (e.g. via a stream override) instead of `console.*` — rejected as strictly worse: it would also swallow anything Node's runtime itself writes to stderr (uncaught warnings, deprecation notices), a much bigger blast radius than the `console.*` monkey-patch, which only intercepts the specific API surface `openapi-mcp-generator` is confirmed to use.

**The real, durable fix — filed as a tracked roadmap item, not just a comment:** PLAN.md now records, alongside the existing pending `streamable-http` upstream-bug item (section 29), a second `openapi-mcp-generator` upstream ask — expose a `silent`/`quiet` option (or an injectable logger) on `generateMcpServer()`'s `CliOptions`, so consumers (not just klaridian) can control its output without a monkey-patch. Both items are candidates for the same upstream PR contribution effort already discussed and parked (see PLAN.md section 9) — grouping them together makes sense contribution-wise (same upstream repo, same "audit found it, we fixed our side, they should fix theirs too" shape), even though they were discovered in different sessions.

**Validated end to end (`packages/cli/test/ux.test.ts`), replacing the previous section 32 assertions that only checked klaridian's own lines:**
- `--quiet`: confirms `openapi-mcp-generator`'s specific hardcoded strings (`"Parsing OpenAPI spec"`, `"Generating server code"`, `"-> Created"`) are now absent, **and** asserts the exact non-empty stderr line count is 2 (the license warning + the `Next:` line) — a stronger assertion than substring absence, since it also catches any *other* unexpected noise source, not just the ones explicitly checked.
- `--json`: confirms stderr is the **empty string**, exactly — the strongest possible assertion for "fully silent."
- **Regression guard, deliberately added**: a fourth test confirms that *without* `--quiet`/`--json`, `openapi-mcp-generator`'s progress output is still visible — proving the suppression is genuinely opt-in behind the existing flags, not a silent default-behavior change for every user of the CLI.

Full suite: **44/44 passing** (41 pre-existing, confirmed unaffected, plus 3 new tests directly targeting this fix).

## 34. Real-world dogfooding against a large public spec (Stripe's OpenAPI, 419 paths / 594 operations) (Sep 1, 2026)

Prompted by a step back: every prior validation in this project (sections 16-33) used either the small Petstore fixture (19 tools, 3 tags) or a "large production spec" from an earlier, un-nameable session — never a spec anyone else could independently re-run against, and never one exercising the project's own long-standing concern (section 24) about tool bloat at real scale. Explicitly avoided using any spec tied to the maintainer's employer, even privately — not a legal question, a clean-hands one: a personal open-source project's validation artifacts shouldn't create any ambiguity about whose data was used. Chose Stripe's public OpenAPI spec (`stripe/openapi`, MIT-licensed on GitHub, published by Stripe specifically so third-party tools can validate against it — the same fixture `openapi-mcp-generator`'s own README cites for its "452 tools" validation claim) as a large, real, unambiguously-clean spec with no connection to any specific employer.

**What was run, for real, exactly like a real user would:** `klaridian generate --spec stripe-openapi.json --out ...` end to end — real `npm install`, real `tsc` build, real spawned server driven over real stdio JSON-RPC — plus the same with `--plugin otel` and with `--exclude-operation-ids`, mirroring the discipline used throughout this project, just against a spec two orders of magnitude larger and more realistic than anything used before.

**What worked correctly, confirmed directly, not assumed to generalize from the small fixture:**
- Generated **594 tools** from Stripe's 419 paths, compiled cleanly (`tsc`, zero errors) on the first try.
- Every always-on patch from sections 28/30 held up at this scale: `initialize` handshake correct, unknown-tool calls return a real JSON-RPC protocol error, every listed tool carries correct `annotations` (spot-checked a `GET` → `readOnlyHint: true`/`destructiveHint: false`) and a correctly humanized `title` (`GetAccount` → `"Get Account"`).
- `--plugin otel` generated, built, and ran cleanly against this spec too, with clean stdout (no stdio-transport corruption) even at 594 tools.
- `--interactive` piped through non-TTY stdin correctly refused (section 32's fix), confirmed against this spec too, not just Petstore.

**Two real, previously-invisible problems found, only visible at this scale — the actual point of doing this exercise:**

1. **Tag-based curation (sections 24-25) is completely inert against Stripe's spec.** Confirmed directly: `summarizeTags()` on the parsed spec returns **594/594 operations in a single `"(untagged)"` bucket** — Stripe's OpenAPI spec uses zero `tags` anywhere. This isn't a rare edge case; it's the single largest, most-referenced public API spec in the ecosystem exposing the exact limitation the tool-bloat problem (section 24's own motivating research) is worst for. `--include-tags`/`--exclude-tags`/the interactive checkbox prompt have **no effect whatsoever** on a spec like this — the only remaining lever, `--exclude-operation-ids`, is real but requires listing individual operation IDs one at a time, which is not a workable way to cut 594 tools down to a usable set. **This is now the single most important open gap in the project**, more concretely urgent than anything in sections 8/9/29/30's remaining follow-up lists, because it's not a rough edge — it's the primary differentiator (tool curation, PLAN.md section 5/section 24) failing on the most realistic large spec available. Not fixed in this session — recorded here as the clear next priority, with the concrete shape of a fix already visible: curation needs a tag-independent lever (e.g. filtering by path prefix/regex, by HTTP method, or by a user-supplied allowlist file) for specs that don't use OpenAPI tags at all, which per this finding may be the *common* case for large real APIs, not the exception the current design implicitly assumed.
2. **The `otel` plugin's pinned dependency versions had a real, live vulnerability — found and fixed in this session.** Running `npm audit` on a real generated project with `--plugin otel` reported **19 vulnerabilities (16 moderate, 3 high)**, all tracing to `@opentelemetry/core < 2.8.0` (`GHSA-8988-4f7v-96qf`, unbounded memory allocation in W3C Baggage propagation) — pulled in transitively by the plugin's pinned `@opentelemetry/sdk-node`/`@opentelemetry/exporter-trace-otlp-http` at `^0.55.0`, a version range that predates the fix. This is a materially different situation from section 18's earlier `npm audit` finding (which concluded reported vulnerabilities were dev-only and not a real consumer risk) — this one is a genuine transitive **runtime** dependency vulnerability shipped to every user who generates with `--plugin otel`, not a false alarm. **Fixed in this session**: bumped both to `^0.222.0` in `otel.plugin.ts`, confirmed directly (`npm install` + `npm audit` on a fresh project) that this resolves to **0 vulnerabilities**, and confirmed the full existing test suite (45/45 including the multi-plugin composition tests) still passes with the bumped versions — the OTel wiring itself (span creation, stdout-safety, shutdown handlers) is unaffected by the version bump. New regression test (`test/otel-plugin-deps.test.ts`) pins the minimum acceptable minor version so a future accidental downgrade of the plugin's declared dependencies is caught without needing a live `npm audit` network call in CI.

**Why this dogfooding pass was worth doing now, and the lesson to keep:** every prior validation exercised the *mechanism* (does the patch apply, does it compile, does stdio stay clean) but never the *product decision* (does curation actually help at the scale it was built for) against a spec nobody at klaridian controls the shape of. Both findings above were invisible against Petstore's 19 tools/3 tags — tags existed, and 19 tools never triggered a security-relevant amount of transitive dependency surface to audit meaningfully. The general lesson, consistent with sections 28/30's own closing notes about success-path-only test coverage: **validating a generator's own mechanics is not the same as validating that its actual value proposition holds up against realistic input** — the second needs a real, large, no-strings-attached spec, checked periodically, not assumed to still hold from the last time.

**Test artifacts intentionally not committed:** the generated Stripe-based servers were built and inspected in a scratch directory (`/tmp`), not checked into the repo — `examples/` stays limited to the small Petstore fixture already there, since a full 594-tool generated project isn't a useful example to ship or maintain, only a validation exercise to run periodically. The Stripe OpenAPI spec itself is public and easily re-fetched (`stripe/openapi` on GitHub) if this dogfooding pass needs to be repeated.

## 35. Three-vendor competitive comparison (Stripe, Twilio, Slack): what real vendors ship instead of 1-tool-per-endpoint, and a Swagger-2.0-specific schema bug found by inspecting actual tool output (Sep 1, 2026)

Extending section 34's single-spec dogfooding into a proper comparison: generated real, fully-built-and-run klaridian servers from three more public specs — Stripe (`stripe/openapi`, 594 tools, revalidated), Twilio's core API (`twilio/twilio-oai`, `spec/json/twilio_api_v2010.json`, 121 paths → **197 tools**), and Slack's Web API (`slackapi/slack-api-specs`, `web-api/slack_web_openapi_v2.json`, 174 paths → **174 tools**) — and, per explicit instruction, went beyond tool *counts* to actually inspect the MCP `tools/list` **output** (real JSON-RPC response, not generated source) of all three, comparing it against what each vendor actually ships as their own MCP server/docs.

**Method:** for each spec, ran the full real pipeline (`generate` → `npm install` → `npm run build` → spawn `build/index.js` over real stdio → send real `initialize` + `tools/list` JSON-RPC requests → capture the actual tool array returned). This is the same "validate the artifact, not the generator's intent" discipline as section 34, now applied three times and diffed against each vendor's own public MCP offering.

### Finding 1 (the new one — only visible by reading actual tool JSON, not just counting tools): Swagger 2.0 input causes 100% empty input schemas, silently

Inspecting the real `tools/list` output programmatically:

| Spec | OpenAPI version | Tools | Tools with a usable/structured input schema | Tools with `properties: {}` (completely empty) |
|---|---|---|---|---|
| Stripe | OpenAPI 3.x | 594 | 503 structured + 91 opaque `requestBody` string | 0 |
| Twilio | OpenAPI 3.x | 197 | 196 structured + 1 opaque | 0 |
| Slack | **Swagger 2.0** | 174 | 0 | **174 (100%)** |

Every single Slack tool — including simple, heavily-used ones like `conversations_history` (a `GET` with 6 well-documented `query` parameters: `channel`, `latest`, `oldest`, `limit`, `cursor`, `inclusive` in the source spec) — comes out of `openapi-mcp-generator` with `inputSchema: {"type":"object","properties":{}}`. No error, no warning: the tool is listed, has a name, title, and description, but a client calling `tools/list` has **zero way to discover what arguments it takes or that `channel` is required**. Traced the root cause directly in the spec file: Slack's OpenAPI file declares `"swagger": "2.0"` (Swagger 2.0/OAS2), not `"openapi": "3.x"` — parameters are described the OAS2 way (`in: "query"`, top-level `type`/`description` per parameter, no `schema` wrapper), which `openapi-mcp-generator`'s parameter mapping evidently doesn't handle, silently dropping every parameter instead of failing loudly. Stripe and Twilio's specs are both OpenAPI 3.x and were unaffected. **This is a real, previously-invisible bug in the delegated generator, not an klaridian bug** — but it's klaridian's own "fail loudly, don't guess" principle (CLAUDE.md's working agreement, and section 29's rationale for `conformance.ts`) being violated by a spec shape the current instrumentation/conformance patches don't check for. Not fixed in this session (out of scope for a comparison pass, and it's `openapi-mcp-generator`'s parsing, not `instrument.ts`'s rewrite) — recorded as a candidate for a new, cheap `conformance.ts`-style check: **warn (or refuse with `--strict`) when a generated tool has an empty `inputSchema.properties` but the source operation had declared parameters**, catching exactly this class of silent data loss regardless of which upstream parsing bug causes it next.

### Finding 2: `annotations` semantics genuinely reflect operation risk, and differ meaningfully across the three specs

Cross-checked `destructiveHint`/`readOnlyHint` distribution in the real output, not assumed from section 30's Petstore-scale spot-check:

- Stripe: 594 tools, 265 `readOnlyHint:true`, 32 `destructiveHint:true`.
- Twilio: 197 tools, 103 `readOnlyHint:true`, 32 `destructiveHint:true` — spot-checked `DeleteAddress`: correctly `destructiveHint:true`, `idempotentHint:true`, with a fully structured, well-described input schema (`AccountSid`/`Sid` with regex patterns and human descriptions) — this is `instrument`/`annotationsForMethod`'s HTTP-method-based heuristic (DELETE → destructive) working exactly as designed, on a real spec, with real parameter docs intact.
- Slack: 174 tools, 80 `readOnlyHint:true`, but **`destructiveHint:true` for zero tools** — including `admin_conversations_delete`, `conversations_kick`, `files_delete`, `auth_revoke`, `admin_users_remove`. Root cause: Slack's spec is **94 POST / 80 GET, zero DELETE** — every mutating Slack operation, including outright deletions, is modeled as `POST` (a real, common REST-API-design choice, not a spec defect), and the current `annotationsForMethod` heuristic (section 30) keys `destructiveHint` off HTTP method alone (DELETE→destructive), so it can't distinguish `POST /conversations.history` (read, wrongly not `readOnlyHint`... actually correctly excluded since it's GET) from `POST /admin.conversations.delete` (irreversibly destroys a channel). **This is a second, independent gap the same class of fix should cover**: annotation heuristics that key purely on HTTP method silently under-annotate risk on any API (not just Slack) that models destructive actions as POST — a very common pattern outside strict-REST shops. A better heuristic would pattern-match the operation path/operationId for verbs like `delete`/`archive`/`revoke`/`remove`/`kick` as a fallback when the method is POST, similar to how `humanizeToolName` already does path-based naming.

### Finding 3: what each vendor's *own* MCP offering does instead, confirming the same real fix in three independent ecosystems

Compared the raw generated tool lists above against each vendor's actual shipped MCP server (docs/READMEs, not just marketing):

- **Stripe** (`docs.stripe.com/mcp`, hosted at `mcp.stripe.com`, OAuth): ships ~15 tools total, most of the API surface funneled through exactly two generic dispatch tools, `stripe_api_read`/`stripe_api_write`, plus `stripe_api_search`/`stripe_api_details` for discovery — not 594 individual tools.
- **Twilio**: two separate, sequential answers from the same vendor. `@twilio-alpha/mcp` (github.com/twilio-labs/mcp) is *itself* an OpenAPI→MCP generator (structurally the same category of tool as klaridian) but ships ~40 separate per-product spec files and requires `--services`/`--tags` CLI filtering to avoid loading all of them into one server's context at once. The newer `mcp.twilio.com/docs` (public preview, unauthenticated, no API execution) abandons 1:1 generation entirely for exactly two tools: `twilio__search` + `twilio__retrieve`, covering "over 1,800 endpoints across 30+ products" as an unauthenticated documentation/discovery layer, not an execution layer.
- **Slack**: the most-used *unofficial* server (`korotovsky/slack-mcp-server`, 30k+ monthly visitors) ships roughly a dozen task-oriented tools (`conversations_history`, `conversations_search_messages`, `channels_list`, `reactions_add/remove`, `usergroups_*`...) instead of Slack's 174 raw Web API methods, and — directly relevant to Finding 2 above — **ships every write tool (`conversations_add_message`, `reactions_add/remove`) disabled by default**, requiring an explicit environment variable (optionally scoped to specific channel IDs) to enable, rather than klaridian's current behavior of generating and exposing every write/delete operation active by default.

**The consolidated, now three-times-independently-confirmed pattern:** every vendor examined collapses a large, mechanically-generated, 1-tool-per-endpoint surface into (a) a small number of task- or dispatch-oriented tools, and (b) write/destructive operations disabled by default requiring explicit opt-in — neither of which a pure OpenAPI→MCP generator does today. This is now backed by three independent real specs/vendors (not just an inference from one), and combined with Finding 2's annotation-heuristic gap, sharpens section 34 finding 1's already-recorded top priority: the concrete next feature isn't just "a tag-independent curation lever" but should also consider (i) a `--collapse-to-dispatch` mode emitting generic `api_read`/`api_write`-style tools for oversized specs, mirroring what Stripe/Twilio's newer offerings converged on independently, and (ii) safer default annotation/enablement heuristics (path-based destructive-verb matching, not just HTTP method) so generated servers don't silently expose Slack-shaped POST-based deletes as if they were harmless reads. Not implemented in this session — recorded as roadmap input, deliberately kept separate from PLAN.md's business-priority ordering per this file's own working agreement.

**Test artifacts:** all three generated servers (Stripe, Twilio, Slack) were built and run from scratch directories under `/tmp`, not committed — same rationale as section 34. Raw `tools/list` JSON captured for all three (`stripe-tools.json` 594 entries, `twilio-tools.json` 197, `slack-tools.json` 174) was used for the empty-schema/annotation analysis above and then discarded; all three source specs are public and free to re-fetch (`stripe/openapi`, `twilio/twilio-oai`, `slackapi/slack-api-specs` on GitHub) if this comparison needs to be repeated or extended to a fourth vendor.

## 36. Answering "should we support Swagger 2.0?": yes, confirmed fixable with a pre-conversion step, not a parser rewrite (Sep 1, 2026)

Section 35 finding 1 left the Swagger 2.0 empty-schema bug open as a recorded gap without validating a fix. Tested directly: does converting a Swagger 2.0 spec to OpenAPI 3.0 **before** handing it to `openapi-mcp-generator` fix the empty-schema problem, using the real Slack spec from section 35 as the reproduction case?

**What was run:** installed `swagger2openapi` (Mermade/APIs.guru's converter — mature, BSD-3-Clause, 2M+ weekly npm downloads, 460+ dependents, the de facto standard OAS2→OAS3 converter, not a hand-rolled shim) as a throwaway dependency in the scratch dir, ran `convertObj(slackSwagger, {patch: true, warnOnly: true})` on the exact same `slack_web_openapi_v2.json` from section 35, then ran the **unmodified** klaridian `generate` command against the converted output (no code changes to klaridian itself), then the full real pipeline again (`npm install` → `npm run build` → spawn over stdio → real `tools/list`).

**Result: fully fixed, confirmed on real output, zero klaridian code changes needed:**
- Converted spec: `openapi: "3.0.0"`, same 174 paths preserved.
- Regenerated server: same **174 tools**, compiled cleanly (`tsc`, zero errors) — identical shape to the broken run, just with real schemas now.
- **0/174 tools have an empty `inputSchema.properties`** (down from 174/174 in section 35). 159 tools got fully structured, multi-parameter schemas; 15 got the opaque single-`requestBody`-string fallback (Stripe/Twilio's normal ratio, not a regression).
- Directly re-checked the exact reproduction case from section 35: `conversations_history` now has all 6 real parameters (`token`, `channel`, `latest`, `oldest`, `inclusive`, `limit`, `cursor`) with correct types and full human descriptions carried over from the original Swagger 2.0 spec verbatim — nothing was lost in translation, just correctly reshaped from OAS2's flat `in:"query"` parameter style into OAS3's `parameters[].schema` style.

**Design decision made explicit (asked directly: convert Swagger→OpenAPI first, or generate MCP directly from Swagger?): convert first, always.** Generating MCP directly from Swagger 2.0 would mean building and maintaining a second, parallel code-generation backend — `openapi-mcp-generator` only understands OpenAPI 3.x, so a direct path means either forking/extending it to understand OAS2's different parameter shape internally, or hand-rolling an independent OAS2→MCP generator. Either way, `instrument.ts`/`conformance.ts`/`license.ts` (all coupled to the exact shape `openapi-mcp-generator` emits, per this file's own repo-layout notes) would need duplicate equivalents for a second generated-code shape. This directly contradicts the section 16 architecture pivot's own rationale (delegate to a mature library instead of hand-rolling a generator) — and there is no equally mature "Swagger 2.0 straight to MCP" library to delegate to; `swagger2openapi` (OAS2→OAS3 normalization) is the mature, widely-used piece, not a from-scratch MCP generator. The conversion-first path was the one actually validated above with zero klaridian code changes to the generation pipeline itself — that's the concrete proof this is a cheap pre-processing step, not a second parallel system.

**Conclusion: yes, klaridian should support Swagger 2.0 input, and the fix is cheap.** This isn't a case needing a parser rewrite or a fork of `openapi-mcp-generator` — the architecture pivot's own principle (section 16: delegate parsing to a mature library, don't hand-roll) extends cleanly here by delegating the *version conversion* too, to another mature, widely-used library, same spirit as delegating OpenAPI parsing itself. Concrete shape for a real implementation (not done in this session — this was a fix validation, not the fix): detect `swagger: "2.0"` (vs `openapi: "3.x"`) on the raw input before handing it to `openapi-mcp-generator`, transparently run it through `swagger2openapi` first when detected (with `patch: true` so minor spec non-compliance in the wild — very common in Swagger 2.0 files, per swagger2openapi's own README — gets auto-repaired rather than hard-failing), and only then proceed with the existing pipeline. Should surface this conversion step in `--verbose`/non-`--quiet` output (e.g. `Detected Swagger 2.0 spec — converting to OpenAPI 3.0 before generation`) rather than silently swapping the input file, consistent with this project's "fail loudly, don't guess" principle — a silent conversion is exactly the kind of surprise section 35's finding was about in the first place. Also worth keeping the **empty-schema safety-net check from section 35's Finding 1 as a second, independent line of defense** regardless of this fix: it would still catch any *other* upstream parsing bug (OAS 3.1, malformed refs, future `openapi-mcp-generator` regressions) that silently drops parameters, not just this specific Swagger 2.0 case.

**Test artifacts:** `slack-api-oas3.json` (converted spec) and `generated-oas3/` (rebuilt server) live under the same `/tmp/slack-compare` scratch dir as section 35's originals, not committed — same rationale. `swagger2openapi` was installed with `--no-save` in the scratch dir only; it is **not** a dependency of klaridian today — adding it (or an equivalent) to `packages/cli/package.json` is exactly the follow-up work this finding recommends, not something already wired in.

## 37. Four-report research pass on 2026 MCP best practices, marketplaces, tooling and the generator-vs-framework question — decisions recorded (Sep 2, 2026)

Prompted by a direct architecture question (code generator vs runtime framework like FastMCP, and how that interacts with the generated server being open-sourceable/marketplace-listable). Ran four parallel source-cited research passes, saved verbatim under `docs/research/2026-09-02-*.md` (indexed in `docs/research/README.md`): (1) the MCP spec's server-side transport/auth requirements, (2) marketplace/connector listing requirements, (3) the tooling landscape with pricing/licenses and hard adoption metrics, (4) production best practices. Every claim in those files is tagged verified/inferred/unverified with access dates. The two headline claims below were re-verified directly against `modelcontextprotocol.io/specification/2026-07-28` on 2026-09-02, not taken on the subagents' word. This section records the *decisions* that came out of it; the reports are the evidence.

**Finding that reorganizes the technical backlog — MCP spec `2026-07-28` is a breaking, stateless revision.** Released ~5 weeks before this pass, it removes the `initialize` handshake and `Mcp-Session-Id`/sessions, mandates `server/discover`, moves protocol version + capabilities into per-request `_meta`, requires `ttlMs`/`cacheScope` on list results, replaces server-initiated requests with the MRTR pattern, **deprecates Dynamic Client Registration in favor of Client ID Metadata Documents (CIMD)**, lands SEP-414 (W3C `traceparent`/`tracestate`/`baggage` as reserved `_meta` keys), and **deprecates the protocol's own logging feature with "use OpenTelemetry" as the migration path**. The official TypeScript SDK **v2** (`@modelcontextprotocol/server` 2.0) is the stable line for this revision. The problem for klaridian: `openapi-mcp-generator` (our delegated generation engine, section 16) still targets SDK **v1** and has had no commits since 2026-06-15, and our `instrument.ts`/`conformance.ts` textual patches are coupled to its v1 output shape. This is a real migration cliff, now tracked as **MCPFO-21 (urgent)**.

**Decision 1 — generator vs framework: stay a standalone code generator, but the *protocol* comes from the official SDK, not from us.** The evidence (report 3, hard npm/PyPI download metrics) is that the market by volume and momentum is going *runtime* (every API-gateway vendor, framework and PaaS converts at runtime because that's where they attach billing/auth/analytics), and only 3-4 standalone-codegen players exist (harsha-iiiv, Speakeasy, Stainless, cnoe-io) — two of them SDK companies for whom MCP codegen is an adjacent, hard-to-monetize output. But standalone codegen's value proposition — *no vendor in the request path, auditable code, your CI, your license* — is real, under-served, and exactly aligned with klaridian's already-recorded trust argument (PLAN.md section 7) and its regulated target audience (health/finance/EU). Speakeasy, a serious API-tooling company, made the same choice for the same kind of buyer. So: **standalone code generation remains correct for klaridian**, with the refinement that the *stateless-protocol/transport/auth* layer should come from the official SDK (a versioned dependency that ships spec-migration fixes once), while the *tool surface* (catalog, schemas, annotations, upstream call mapping) is generated as readable code the user owns. This is not the vague "codegen + shared lib" hybrid debated earlier — it splits on rate-of-change and trust-surface: the protocol churns and belongs in a dependency (the same official SDK everyone already uses, not a proprietary `@klaridian/*` runtime); the credential-touching tool surface stays visible in the user's repo.

**Decision 2 — observability/product-analytics instrumentation stays vendored source, confirmed against the actual code.** Re-read `packages/cli/src/plugins/otel/otel.plugin.ts`: the plugin lives in klaridian's own codebase and emits `src/instrumentation/otel.ts` as a literal, comment-annotated, readable file into the generated project (`getTemplateContributions()`), while only the *backend SDKs* (`@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`, and the product-analytics SDKs) are normal `package.json` dependencies. This is already the right split and is now a consolidated decision, not a plugin implementation detail: (a) the instrumentation glue is the **only code in the generated server that exfiltrates data to a third party** (tool arguments → OTLP backend/PostHog), which makes it the single highest privacy/audit-sensitivity surface — precisely the thing a regulated buyer and a marketplace reviewer must read line by line, so it must be vendored, not hidden in an opaque runtime lib; (b) backend-SDK security fixes still propagate via `npm update` because those stay dependencies (this is how the section 34 `@opentelemetry/core` vuln was fixed); (c) publishing a proprietary `@klaridian/otel-runtime` would destroy both the trust argument and one of klaridian's few validated differentiators (report 3 found klaridian is, as far as the research could tell, the only tool patching OTel/product-analytics into *generated* code). Two refinements fell out and are tracked: **SEP-414 trace-context propagation belongs to the transport/SDK layer, not the plugin** (reading/propagating `traceparent` from `_meta` is now protocol, not our concern), and the MCP OTel semantic conventions are still "Development" status and one revision behind the spec (`mcp.session.id` no longer exists) — so **do not chase the unstable semconv inside vendored code**; emit conservative stable attributes now, align when it stabilizes. A related privacy gap — the current `wrapTool` captures all arguments verbatim via `JSON.stringify(args)` — is tracked as **MCPFO-24** (argument redaction/allowlist), and is only solvable *because* the instrumentation is vendored.

**Decision 3 — OAuth is a resource-server-only concern for generated servers, delegated to an external IdP.** The spec makes a protected MCP server an OAuth 2.1 *resource server*: its hard MUSTs are serving RFC 9728 Protected Resource Metadata, validating tokens including audience (RFC 8707), correct 401/403/400 semantics, and **never** passing the inbound token through to the upstream API. PKCE, `iss` validation, redirect-URI rules and CIMD/DCR are the *client* and *authorization-server* obligations, not the resource server's — and the AS is explicitly allowed to be a separate entity. This resolves the earlier "do we support full OAuth2 / OAuth 2.1 like FastMCP?" question precisely: the right target is **resource-server-only with an IdP preset** (WorkOS/Auth0/Clerk, all with large free tiers and CIMD already GA on Auth0/WorkOS), **not** building a full OAuth authorization server (which inherits the confused-deputy consent machinery and is the IdP's job). Also corrects an inconsistency between this file's own sections 16 and 21 on how much auth we "support": generated servers today wire *outbound* auth (Bearer/API key to the upstream API, section 17); *inbound* OAuth 2.1 resource-server behavior is not emitted by any standalone generator (a confirmed gap), and is now tracked as **MCPFO-22 (high)**, gated on the streamable-http transport working (stdio servers must NOT implement authorization per spec — credentials come from the environment). This raised **MCPFO-10 (fix streamable-http) from medium to high**, since ~7 of 12 marketplaces accept remote Streamable HTTP servers only, and OAuth, `--docker` and any remote listing all depend on it.

**Premise correction (belongs in PLAN.md, noted here for traceability): open source is NOT the marketplace gate; API ownership is.** Report 2 found open source is *not* required by claude.ai Connectors, ChatGPT Apps, the official MCP Registry, Docker (remote), Smithery, Glama, or Copilot Studio — it's required only for local/stdio distribution channels (Anthropic MCPB/plugins, Docker-local, Glama OSS track, Cursor plugins, Gemini CLI extensions). The real hard gate across Anthropic, OpenAI and Microsoft is that the publisher must **own or legitimately proxy the upstream API** ("unofficial connectors cannot be approved"). This sharpens klaridian's target user: the *owner* of an API making it agent-callable, not a third party wrapping someone else's OpenAPI spec. And because an MCP server is an OAuth resource server (not a client), an open-source server ships **no client secret** — so "open source" and "OAuth 2.1" are not in tension, contrary to an earlier assumption in this discussion.

**Backlog changes applied from this pass (all in Plane, project MCPFO):** new — MCPFO-21 (spec 2026-07-28 + SDK v2 migration, urgent), MCPFO-22 (resource-server OAuth 2.1, high), MCPFO-23 (marketplace-grade tool annotations, medium), MCPFO-24 (argument redaction, medium), MCPFO-25 (`server.json` for the official Registry, low); reprioritized — MCPFO-10 medium→high; reframed — MCPFO-8 (tag-independent curation now also weighs a search+execute/code-mode output, since the industry calls one-tool-per-operation the wrong default above ~30-40 tools and no tool emits a standalone search+execute server from OpenAPI — a confirmed gap); description updates — MCPFO-12, MCPFO-17. Not changed by this pass: the vendored-instrumentation model (Decision 2, confirmed) and the standalone-generator model (Decision 1, refined not replaced).

## 38. Spike: MCPFO-21/MCPFO-10 feasibility — SDK v2 stateless transport, and generating v2 directly from tool data (option d) — VALIDATED (Sep 3, 2026)

Two throwaway spikes (`spikes/021-sdk-v2-streamable-http/`, README + README-021b) to resolve how MCPFO-10 (streamable-http crash) and MCPFO-21 (spec 2026-07-28 + SDK v2) should actually be built, rather than deciding on the subagent reports alone. Every fact below was verified by direct inspection or by building and driving a real server over HTTP, not taken from the section 37 research reports.

**Root cause of the MCPFO-10 crash, read directly from generated code.** `openapi-mcp-generator`'s generated `src/streamable-http.ts` calls `await c.req.json()` (consuming the Hono request-body `ReadableStream`) and then `toReqRes(c.req.raw)` (via the `fetch-to-node` dependency), which re-reads the now-locked stream → `TypeError: ReadableStream is locked` on the second request. It is a **session-based** transport (`transports[sessionId]`, `mcp-session-id` header) — the exact model the stateless `2026-07-28` spec removed. So patching this file fixes a symptom on an architecturally-obsolete transport.

**Verified facts (npm registry + installed packages, not reports):** `openapi-mcp-generator@4.0.1` is pinned to SDK **v1** (peerDep `@modelcontextprotocol/sdk@^1.10.2`) and frozen (last publish 2026-06-14, no v2, `latest` is its only dist-tag). SDK v1's `latest` is `1.30.0` with `LATEST_PROTOCOL_VERSION = '2025-11-25'` — it does not know `2026-07-28`. **v2 is a separate package set**: `@modelcontextprotocol/server` 2.0.0 + `@modelcontextprotocol/core` 2.0.0 (+ optional `@modelcontextprotocol/node`/`/express`/`/fastify`/`/hono` adapters), on **zod v4** (v1 uses zod v3). Its `createMcpHandler(factory)` builds a fresh `McpServer` per request and holds nothing between requests — stateless by construction.

**Spike 021 result (VALIDATED):** a hand-written v2 stateless server, driven with 5 sequential real HTTP requests (`initialize`, `tools/list`, two `tools/call`, one schema-violating `tools/call`), survived all of them — the MCPFO-10 crash is **structurally impossible** on v2 (no per-session transport, no `fetch-to-node` double-read, no `mcp-session-id`). `initialize` returned no session-id header (stateless confirmed). Schema violation came back as native `isError:true`.

**Spike 021b result (VALIDATED) — the pivotal MCPFO-21 decision:** `getToolsFromOpenApi()` returns **pure, SDK-version-agnostic tool DATA** (`{name, description, inputSchema (JSON Schema), method, pathTemplate, executionParameters, requestBodyContentType, securityRequirements, tags, ...}`), and klaridian already calls it today for its tool-count pre-check. A throwaway generator consumed that data (not `generateMcpServer()`'s v1 *code* output), converted each JSON Schema to a Zod source string via `json-schema-to-zod` (already a peerDep; it emits source text, ideal for a generator — no runtime conversion in the produced server), and emitted a v2 server with one `registerTool(...)` per operation plus HTTP-method-derived annotations. Result: 19 tools from the real petstore spec, built and driven over HTTP — `tools/list` returned all 19 with correct `annotations` (`getPetById`→readOnly, `deletePet`→destructive), sequential `tools/call` worked, invalid enum → native `isError:true`, unknown tool → native `-32602` protocol error.

**Decision recorded — MCPFO-21 path is "option (d)": klaridian emits a v2 server from `getToolsFromOpenApi()` data itself, and stops consuming `generateMcpServer()`'s v1 code output.** This escapes the frozen v1 generator, lands on the current SDK line, and — the important structural payoff — **shrinks klaridian's fragile surface rather than growing it**: (a) `render/conformance.ts` becomes likely-unnecessary because v2 emits `isError:true` on validation failure and `-32602` on unknown tool *natively* (both bugs it was written to patch); (b) `render/instrument.ts` stops being a textual patch against someone else's output — there is no `executeApiTool` call site on this path — and becomes a clean wrap around each `registerTool` handler we emit ourselves; (c) MCPFO-23 (marketplace annotations) is satisfied for free because *we* emit the annotations from the HTTP method. This aligns exactly with section 37 Decision 1 (tool surface generated by us, protocol from the official SDK). It is a real rewrite of the generation core (sections 16/28/29's delegation-to-`generateMcpServer()` model is replaced for the emit step; `getToolsFromOpenApi()` as the data source is kept), so it is the coherent big move, not a version bump.

**MCPFO-10 collapses into MCPFO-21.** The streamable-http crash is a v1-only artifact that never exists on the v2 path; MCPFO-10 is reframed to "resolved by the v2 migration", keeping only the optional upstream `fetch-to-node` fix as good-citizen OSS work for those staying on v1, not klaridian's own path.

**Deliberately still open (honest scope — not claimed as done):** full `2026-07-28` conformance was NOT proven. The v2 package's `LATEST_PROTOCOL_VERSION` constant is still `2025-11-25` and both spikes negotiated that era; `server/discover`, list-result `ttlMs`/`cacheScope`, and `Mcp-Method`/`Mcp-Name` header validation were not asserted, and whether they're automatic or need explicit "era" opt-in is unknown. A follow-up spike (021c) should reach the `2026-07-28` era explicitly and assert those MUSTs before klaridian claims spec-current. Also, the upstream HTTP proxy `fetch` was stubbed in 021b (the data to build it — `executionParameters`/`requestBodyContentType`/`securityRequirements` — is present and is the same mapping the current stdio path already does; re-emitting it for v2 is mechanical, not a new unknown). Spikes are throwaway; the real work is a new emit path in `packages/cli`, not the spike dirs.

**Correction from spike 021c (Sep 3, 2026) — `@modelcontextprotocol/server@2.0.0` stable does NOT yet implement `2026-07-28`, despite its own README and the section 37 research report claiming so.** Verified by driving the real v2 server over HTTP: `server/discover` returns `-32601 Method not found`; `initialize` requesting `protocolVersion: "2026-07-28"` negotiates **down to `2025-11-25`**; `tools/list` results carry neither `ttlMs` nor `cacheScope`. Corroborated statically: v2's `LATEST_PROTOCOL_VERSION = "2025-11-25"`, and `2026-07-28` appears in the v2 dist only inside a `@deprecated … (SEP-2577)` docstring (aware of the revision, not negotiating it); npm dist-tag `latest` is `2.0.0` with no newer stable. **This does not reverse the option-(d) decision** — v2 is still stateless (the MCPFO-10 crash is still structurally gone) and still the right path. It corrects the *claim/timeline*: a v2 migration lands klaridian on a **stateless `2025-11-25`** server today (already ahead of the frozen v1 generator, which is a further revision back and crashes on HTTP), **not** `2026-07-28`-conformant. The three `2026-07-28`-specific MUSTs are the official SDK's responsibility, not klaridian's — because option (d) delegates the protocol layer to the SDK (Decision 1 in §37), klaridian inherits `2026-07-28` for free on a future SDK bump, no generator change needed. Consequences recorded for MCPFO-21: (a) do not market `2026-07-28` conformance — the honest claim post-migration is "stateless, SDK-v2, protocol `2025-11-25`, HTTP-safe"; (b) scope MCPFO-21 as "v2/stateless first, `2026-07-28` second (SDK-gated)", don't block the migration on a conformance level upstream doesn't ship yet; (c) add a lightweight SDK-era canary test (mirroring `canary-generator-shape.test.ts`) asserting the SDK's negotiated latest protocol version, so a future flip to `2026-07-28` is noticed deliberately and the docs/claims update in lockstep. See `spikes/021-sdk-v2-streamable-http/README-021c.md`.

## 39. MCPFO-22 implemented — OAuth 2.1 resource-server support, generic IdP preset (Sep 3, 2026)

Implements the resource-server-only decision from section 37 Decision 3, ahead of the rest of MCPFO-21 per direct instruction (the real blocker — streamable-http's crash — was already resolved by the v2 emit path, section 38). Scoped for `--engine v2 --transport streamable-http` only; `--engine v1` and `--transport stdio` reject the flag combination outright (stdio servers MUST NOT implement authorization per spec — section 3.1's "SHOULD NOT... retrieve credentials from the environment instead").

**New CLI flags:** `--oauth-issuer <url>` (the external IdP's issuer URL — HTTPS required except for `localhost`/`127.0.0.1` during local testing), `--oauth-jwks-uri <url>` (optional — when omitted, resolved automatically from the issuer's OIDC discovery document at `<issuer>/.well-known/openid-configuration`, the standard convention every OAuth 2.1/OIDC-conformant IdP publishes), `--oauth-audience <uri>` (required with `--oauth-issuer` — the canonical resource URI per RFC 8707), `--oauth-required-scopes <scopes>` (optional, comma-separated).

**Design: generic IdP preset, not vendor-specific.** Per the decision in section 5/PLAN.md, this is issuer + JWKS URI + audience — works with any OAuth 2.1/OIDC-conformant IdP (WorkOS, Auth0, Clerk, Okta, Entra, Keycloak, ...) without klaridian maintaining per-vendor config shapes. A vendor-specific preset layer (e.g. `--oauth-preset workos`) can be added later as a thin wrapper if there's demand — not built now.

**Built entirely on the official SDK v2's own bearer-auth primitives** (`packages/cli/src/render/auth.ts`, vendored as literal `src/auth.ts` source into the generated project — same "plugin runtime ships as readable source" rule as section 7/PLAN.md): `verifyBearerToken`/`bearerAuthChallengeResponse` (parses the `Authorization` header, enforces `requiredScopes`, maps failures to spec-shaped 401/403), `oauthMetadataResponse`/`buildOAuthProtectedResourceMetadata`/`getOAuthProtectedResourceMetadataUrl` (serves the RFC 9728 PRM document and an RFC 8414 AS-metadata passthrough at the two `.well-known` routes), and `OAuthTokenVerifier`/`AuthInfo` as the extension point. klaridian supplies only the JWT verification itself, via `jose`'s `createRemoteJWKSet` + `jwtVerify` (zero-dependency, the de facto standard JOSE library for Node) — signature, expiry, issuer, and critically **audience** (RFC 8707) are all checked in one call; an audience mismatch or expiry throws a typed `OAuthError` the SDK's own challenge-response helper turns into the correct 401.

**Real, non-mocked E2E validation (`packages/cli/test/oauth.test.ts`, 4 tests, part of the 92-test suite).** No component is stubbed: a throwaway RSA keypair is generated with `jose`, its public JWK served over a real local HTTP server (the "fake IdP"), the CLI generates a real project pointed at that JWKS URI, `npm install`+`npm run build` run for real, the generated server is spawned as a real child process listening on a real port, and real `fetch()` calls exercise it. Verified: (1) no `Authorization` header → 401 with a `WWW-Authenticate: Bearer` challenge naming the PRM discovery URL; (2) the PRM document itself is correct (`resource` = configured audience, `authorization_servers` = configured issuer); (3) a token signed for the *wrong* audience → 401 (RFC 8707 enforcement); (4) an expired token → 401; (5) a valid token with the correct issuer/audience/scope → 200 with the real 19-tool petstore list. Plus 3 fast validation-only tests: `--oauth-issuer` + stdio rejected, missing `--oauth-audience` rejected, non-HTTPS issuer rejected.

**A real bug caught only by driving the actual HTTP request path (not unit-testing `auth.ts` in isolation):** the first implementation called `toWebRequest(req)` (which reads the Node `IncomingMessage` body stream to build a web-standard `Request`) unconditionally on every request, including normal `tools/call` POSTs — starving the MCP handler's own body parser downstream and producing a spurious `-32700 Parse error: Invalid JSON` on every authenticated request. Fixed by checking the request path against the two `.well-known` routes *before* touching the stream at all; `toWebRequest()` is now only called for those two routes, which never carry a body. This is exactly the kind of transport-corruption failure mode the project's existing "always validate end to end, real npm install + spawn + drive" testing discipline (CLAUDE.md) exists to catch — a mocked-fetch unit test would not have found it.

**Deliberately not built:** vendor-specific IdP presets (decided against for v1, see above); DCR/CIMD (client-registration concerns, not the resource server's — section 3.7/research doc); per-user upstream OAuth delegation / the "MCP proxy server" pattern with its confused-deputy consent machinery (section 5 of the research doc — a substantial, security-sensitive scope the decision explicitly deferred); scope-filtered `tools/list` (spec allows varying the tool list by granted scopes — not implemented, `tools/list` is unconditional once a token passes authentication).

## 40. MCPFO-8 phase 1 implemented — tag-independent structural curation (Sep 3, 2026)

Closes the specific gap identified in section 12: tag-based curation (`--include-tags`/`--exclude-tags`/`--exclude-operation-ids`, MCPFO-9) does nothing against a spec with zero OpenAPI tags — confirmed again in this session by re-fetching Stripe's real public spec (594 operations, 0 tagged, verified by direct inspection, not from memory of the earlier finding).

**Decided scope (direct instruction): structural filtering first, code-mode/search+execute deferred as a separate, bigger decision.** The section 12 finding also raised a second, larger question — whether OpenAPI→MCP generators should stop emitting one tool per operation altogether above ~30-40 tools, in favor of a code-mode/search+execute server (see docs/research/2026-09-02-mcp-server-best-practices.md §1.7 and §7). That question is real and unresolved, but deliberately NOT decided or built here — it needs its own dedicated design discussion (a new server *architecture*, not a filter), not a rider on the tag-independence fix. This section covers only the structural-filtering half.

**New flags, composing with the existing tag-based ones (AND semantics — include narrows, exclude always wins, same rule as before):** `--include-paths <regex,...>` / `--exclude-paths <regex,...>` (regex against the OpenAPI path template, e.g. `^/v1/customers`), `--include-methods <verbs,...>` / `--exclude-methods <verbs,...>` (HTTP method, e.g. `delete` to drop every destructive operation regardless of path or tag). Implementation is a direct extension of `applyCurationToSpec()`'s existing `x-mcp: false` mechanism (`packages/cli/src/curation/curation.ts`) — no new spec-mutation path, same validated mechanism from section 24/MCPFO-9, just two more filter dimensions evaluated the same way tags already are. `validateCurationChoice()` fails loudly on an invalid regex or unknown HTTP method, consistent with the project's existing "fail loudly on bad curation input" behavior for unknown tags/operationIds.

**Validated against the real problem, not just the Petstore fixture.** Re-fetched Stripe's live public OpenAPI spec (`stripe/openapi`, MIT-licensed) and ran `klaridian generate --include-paths "^/v1/customers" --exclude-methods delete` against all 594 real, untagged operations: **39 tools generated** — scoped to exactly the customers surface, destructive operations excluded, zero use of tags anywhere in the flow. This is the concrete, working answer to section 12's finding, not just a unit-tested mechanism.

**Test coverage (`packages/cli/test/curation.test.ts`, 7 new tests, 99 total):** unit tests for each new filter individually and composed with tag filters (including an explicit "ZERO tags" test modeling the Stripe shape), regex/method validation-error tests, and one real CLI E2E test (`--include-paths` against a real untagged spec, generated project inspected for the exact expected tool set).

**Deliberately not built (tracked separately):** an operationId-allowlist *file* input (mentioned as a candidate in section 12 alongside path/method filtering) — not needed once path/method filtering closes the Stripe-shaped gap; revisit only if a real spec surfaces where neither dimension is enough. The code-mode/search+execute architecture question from section 12 remains fully open and unbuilt, tracked as its own follow-up decision, not folded into MCPFO-8's "done" scope.

## 41. Repo audit findings: dead scaffold removed, `commands/generate.ts` split, spike naming fixed, E2E flakiness root-caused (Sep 4, 2026)

A general repo-hygiene audit (git state, monorepo structure, unused files, dev conventions) surfaced four independent, real findings, all fixed in this session:

1. **`packages/runtime-otel/`** was an untracked, empty `src/` directory with no `package.json` — a scaffold left over from the section 10 decision ("vendored-file for v0, not a published package") that should have been deleted when that call was made. Removed.
2. **`commands/generate.ts` had grown to 930 lines**, the clear outlier among `packages/cli/src` modules (next largest was 337). The general-purpose, non-state-closing helpers (plugin-config flag parsing, git author resolution, icon MIME inference, console suppression, directory-emptiness check, the `GenerateJsonResult` shape) moved to `commands/generate-helpers.ts`, no behavior change.
3. **`spike/` and `spikes/021-sdk-v2-streamable-http/` were two separately tracked top-level dirs** with confusingly similar singular/plural names — a real trap for anyone reading the tree. Consolidated: `spike/` → `spikes/001-otel-mechanic/`, with a new `spikes/README.md` indexing both, and every `spike/...` reference across ARCHITECTURE.md/CLAUDE.md/README.md/source comments updated.
4. **The 99-test E2E suite had 6 tests intermittently failing** with `Error: Command failed: npm install` after ~90s. First fix attempt (raising the hardcoded 90s timeout, serializing `node --test`) treated it as a timeout/concurrency problem and didn't fully hold — some installs still hung past 150s even serialized. Root cause, found by reproducing a bare `npm install` manually outside the test harness: on this machine, plain `npm install` (no flags) hangs indefinitely on the network round-trip for npm's audit/funding metadata lookup; `npm install --no-audit --no-fund` against the identical registry/cache completes in under a second. Every E2E test's `npm install` call, CI's workspace install step, and the devcontainer's `post-create.sh` now pass `--no-audit --no-fund` explicitly — the pre-push hook already did this and was therefore never affected. With the real cause fixed, timeouts and concurrency went back down/up to sane values (installs: 60s budget, outer test wrapper: 120s, `node --test --test-concurrency=4`): full local run went from ~4-5 minutes with intermittent failures to **99/99 passing in ~34s**.

**Lesson for future timeout-shaped flakiness in this repo:** don't assume a timeout failure means "raise the timeout" or "reduce concurrency" — reproduce the exact failing command standalone first (as done here) before treating the symptom. A silently-hanging network call disguised as a timeout wastes far more debugging time than it should.

## 42. `CLAUDE.md` → `AGENTS.md` + symlink, and a "Common pitfalls" section added (Sep 4, 2026)

Following a repo audit, checked whether ARCHITECTURE.md's append-only narrative log (this file) was still the right home for operational lessons-learned, or whether 2026 agentic-development practice had moved to something better for a solo, AI-driven open-source project. Findings from research (multiple independent 2026 sources on AGENTS.md/CLAUDE.md conventions):

- **AGENTS.md has become the emerging cross-tool standard** (Linux Foundation-maintained, natively read by Cursor/Copilot/Gemini CLI and others); Claude Code is the notable holdout, still reading `CLAUDE.md` specifically, with a symlink as the documented workaround. Since this repo may eventually see contributors on other tools (see CONTRIBUTING.md), moved the real file to `AGENTS.md` and made `CLAUDE.md` a symlink to it — one file, no drift between two near-identical copies.
- **A short, curated "Common pitfalls" / "Lessons learned" section in the always-loaded agent file is validated practice** (seen directly in `vercel/vercel`'s AGENTS.md "Common Pitfalls" and `vercel-labs/open-agents`'s "Lessons Learned") — distinct from, and complementary to, this file's role as the full narrative log. The narrative log (this file) stays exactly as it is: append-only, one section per real decision/finding, never rewritten. But an agent doesn't reliably rediscover a pitfall buried in section 18 or 41 unless it goes looking — a short imperative-voice list in the file that's *always* loaded (`AGENTS.md`/`CLAUDE.md`) is what actually prevents repeat mistakes. Each pitfall in that list links back here for the full story.
- **Kept this file's role unchanged** — it remains the source of truth for *why*, including dead ends. The new pitfalls section in `AGENTS.md` is a distilled index into it, not a replacement.

**Decision:** no further structural change needed beyond this. Considered and rejected: migrating away from the append-only ARCHITECTURE.md log entirely in favor of pitfalls-only — rejected because the *reasoning* behind a decision (what was tried, why it was wrong, what the alternatives were) is exactly what a numbered append-only log preserves and a bullet list can't; the two serve different purposes and both are needed.

## 43. Code-mode / search+execute design decision: SDK code mode with a Deno subprocess sandbox (Sep 4, 2026)

MCPFO-26 explicitly required a dedicated design session before any build — this section is that session's output. Question: what should klaridian's code-mode/search+execute output actually look like, given that no tool today generates a standalone one from an OpenAPI spec (PLAN.md section 14, market signal 1)?

**Evidence reviewed:** Stainless published head-to-head evals (Mar 2026, Claude Opus 4.6, 31 real test cases against the Increase banking API — github.com/stainless-api/mcp-evals-harness) comparing four architectures:

| Architecture | Completeness | Efficiency | Factuality | Avg duration |
|---|---|---|---|---|
| **SDK code mode (Stainless)** | 98% | 95% | 53% | 48.5s |
| Anthropic Code Mode (`tool_search` + programmatic tool calling betas) | 94% | 82% | 46% | 68.7s |
| Cloudflare Code Mode (V8 isolates / Worker Loader) | 90% | 95% | 43% | 55.9s |
| "Dynamic" meta-tools (`list_api_endpoints`/`get_api_endpoint_schema`/`invoke_api_endpoint`) | 70% | 86% | 33% | 65.1s |

SDK code mode won on every axis, and the gap wasn't cosmetic: on transaction-aggregation tasks, Cloudflare and Dynamic returned **confidently wrong totals** (e.g. reporting $98,306.02 when the correct answer was $140,580.12, with no signal the result was incomplete) while SDK code mode got 100% completeness across all 19 transaction-heavy cases. A typed SDK with API-specific error messages, doc strings, and compile-time type checking gives the model much higher-fidelity feedback to converge on correct code than an untyped `execute(code)` string.

**Why the other two architectures don't fit klaridian's model even ignoring the eval gap:**
- **Cloudflare Code Mode** requires Cloudflare's own infrastructure (Dynamic Workers / V8 isolates via `workerd`) — not something a standalone local generator can emit; it's a hosted-platform feature, not a code-generation pattern.
- **Anthropic Code Mode** depends on client-side Claude API betas (`tool_search`, programmatic tool calling) that the *client*, not the *server*, must opt into — outside a generated MCP server's control entirely.
- **SDK code mode is the only one of the three that is purely a code-generation artifact** — a typed client + a sandboxed subprocess, both fully owned and vendored by the generated output. This is the only shape compatible with Decision 1 (standalone generator, no hosted dependency) and Decision 2 (vendored-source-in-output, section 7).

**Decision: klaridian will generate SDK code mode servers, following Stainless's proven shape, with Deno as the sandbox runtime.**

Concrete architecture:
1. **Typed client generation** — reuse `openapi-mcp-generator`'s existing type-generation path (it already produces per-operation typed functions today for the 1:1 tool mode) rather than hand-rolling a second OpenAPI→TS mapper; the code-mode output's typed client is the same generated types, restructured as an importable module instead of one MCP tool per function.
2. **Two MCP tools exposed**, matching the Stainless/industry-converged shape: `execute_code` (runs model-written TypeScript against the generated client) and `search_docs` (returns per-operation documentation generated from the OpenAPI spec's descriptions/examples, so the model can look up how to call something before writing code — this is what let Stainless's model self-correct in 4 turns instead of guessing).
3. **Sandbox: a Deno subprocess, not `isolated-vm`.** Chosen over embedding V8 directly in Node (`isolated-vm`) because: (a) it's the exact mechanism the eval-winning Stainless architecture uses (their own docs: `npm install deno`, run generated code as a subprocess with explicit `--allow-*` flags); (b) Deno's permission model (`--allow-net=<api-host-only>`, no `--allow-read`/`--allow-write`/`--allow-env` by default) gives real OS-process-level isolation out of the box, not something klaridian has to build and audit itself; (c) `isolated-vm` sandboxes JS execution but not network/fs access the same way — the model-written code still runs in the same Node process address space, and would need klaridian to hand-build the equivalent of Deno's permission boundary. Trade-off accepted: Deno becomes a new external runtime dependency of every code-mode-generated server (not vendored source, can't be — it's a separate binary), which is a real deviation from the vendored-source rule (section 7) for the sandbox *runtime* itself, though the code that runs inside it (the generated client + the instrumentation/curation logic) stays vendored as usual. This is the same trade-off Stainless already made and shipped; documented here so it isn't relitigated as an oversight later.
4. **Orthogonal to existing curation (MCPFO-8/9), not superseding it** — curation (tag/path/method filtering) still decides which operations exist in the generated typed client; code-mode changes how the model *calls* whatever operations survive curation, not which ones survive. Both flags remain independently useful: curation for API owners who want a smaller trusted surface at all, code-mode for whoever's left needing an efficient way to call a large surface.

**Explicitly not decided here (follow-up scope, tracked as sub-tasks under MCPFO-26 in Plane):** the CLI flag shape (`--architecture code-mode` vs. a separate `klaridian generate-sdk` subcommand?), whether code-mode and 1:1-tool-per-operation are mutually exclusive per generation or can coexist in one output, how `search_docs` content gets built from OpenAPI descriptions that are often sparse/missing (a real, unsolved data-quality problem visible in the Increase eval writeup), and how the observability plugins (`otel`/`posthog`) wire into a single `execute_code` call site instead of one call site per tool. Each needs its own scoped implementation task before code is written.

## 44. MCPFO-29 implemented — typed client generation for SDK code mode (Sep 4, 2026)

First concrete build against the section 43 design: a new `emit-client.ts` module (`packages/cli/src/emit/`) that generates one exported, async, Zod-validated TypeScript function per OpenAPI operation from `openapi-mcp-generator's `McpToolDefinition[]` tool DATA — the same data source `emit-tool.ts`'s 1:1 MCP-tool emission already consumes (`getToolsFromOpenApi()`), just wrapped differently: a plain importable module instead of `server.registerTool()` calls. This is the typed client that MCPFO-30's `execute_code` Deno sandbox will run model-written code against.

**What it does:** function names are derived from `operationId` (sanitized to valid JS identifiers, deterministically deduped on collision — mirrors the identifier-level version of `extractToolsFromApi's own `shortenToolName`/`truncateToolName` collision handling, but at the JS-identifier level rather than the MCP-tool-name level). Each function: validates its input against a generated Zod schema (`z.infer` gives the compile-time type), builds the HTTP request using the exact same path/query/header-param and Bearer-auth logic as `emit-tool.ts` (kept deliberately parallel, not reunified into a shared helper yet — revisit if a third emitter needs the same logic), and either returns `{ status, data }` or throws a new `ApiError` (status/statusText/body) on a non-2xx response — giving code-mode's sandboxed script the same kind of typed error signal Stainless's eval writeup credited for its higher accuracy (section 43), rather than a generic thrown string.

**Explicitly not solved here (real limitation, not an oversight):** response bodies are typed `unknown`, not mapped to per-operation TS types — `McpToolDefinition` only carries the request-side `inputSchema`, no OpenAPI response schema. A future response-type-mapping pass is separate scope, not blocking this ticket.

**Validated per the project's "every non-trivial change needs real E2E, not just unit tests" rule (CLAUDE.md/AGENTS.md):** `emit-client.test.ts` (13 unit tests: identifier sanitization/dedup, generated-source shape) plus a new `emit-client-e2e.test.ts` — real `npm install` + `tsc` compile + `node` execution of the *generated* client against a real HTTP server, proving both the happy path (Zod-validated call -> real fetch -> 200 -> parsed JSON) and the validation path (missing required field throws a real `ZodError` before any network call is made). The E2E test originally targeted the public Swagger Petstore demo (matching `emit-e2e.test.ts's existing fixture/base URL) but that demo was found returning 500 for every request during this work — a real upstream reliability problem, confirmed with three separate `curl` retries and a second unrelated endpoint, not a bug in the generated client (the thrown `ApiError` carried the exact real response). Switched to a minimal local `node:http` mock server instead: keeps the test exercising the real network/fetch/JSON stack without depending on a third party's uptime — a pattern worth reusing for any future E2E test that would otherwise hit that same demo endpoint.

**Result:** 114/114 tests passing (99 pre-existing + 13 new unit + 2 new E2E), `tsc -p tsconfig.json` clean.

**Remaining MCPFO-26 sub-scope, unblocked by this:** MCPFO-30 (Deno sandbox `execute_code` tool, consumes this client), MCPFO-28 (CLI flag/subcommand to actually wire this emitter into `klaridian generate`), MCPFO-31 (`search_docs`), MCPFO-32 (instrumentation wiring). This section covers only the typed-client half; nothing here is user-invokable yet — `emitClientModule()` is not called from any CLI command.

## 45. MCPFO-30 implemented — Deno subprocess sandbox for execute_code (Sep 4, 2026)

Second concrete build against the section 43 design, following MCPFO-29 (typed client). New `emit-sandbox.ts` (`packages/cli/src/emit/`) emits the `execute_code` MCP tool and its supporting `src/sandbox-runner.ts` -- the piece that actually spawns model-written code in an isolated Deno subprocess against the typed client.

**Design validated with a real local proof-of-concept before writing any generator code** (not just reasoned about): installed Deno 2.9.6 (`brew install deno` -- was not present on this machine, see AGENTS.md pitfalls list), then manually built a throwaway project with the real emitted client (`emitClientModule()` output) and confirmed, with actual `deno run` invocations against a local mock HTTP server:
- `--allow-net=<host>` genuinely blocks fetches to any other host (tried a same-process cross-host `fetch()`, got `NotCapable`).
- No `--allow-write` genuinely blocks all file writes (tried `Deno.writeTextFile`, got `NotCapable`; the canary file was never created).
- `--allow-read=<dist-dir-only>` genuinely blocks reads outside that directory (tried `/etc/hosts`, got `NotCapable`) while still resolving the sandboxed project's own relative imports (`./client.js`) and `node_modules` (Deno resolves npm-installed packages transparently when given read access to the directory).
- Piping model code over stdin (`deno run -`) with `cwd` set to the compiled client's directory resolves relative imports correctly without writing a temp file to disk per invocation -- the shape `sandbox-runner.ts` uses.

**What was built:**
- `extractApiHost(baseUrl)`: derives the bare `host` or `host:port` Deno's `--allow-net` expects from the server's absolute base URL; throws loudly (not silently) on a non-absolute URL, since code mode has no safe way to scope a sandbox's network permission without a concrete host.
- `buildDenoPermissionFlags({ apiHost, distDir })`: the exact three flags granted -- `--allow-net=<apiHost>`, `--allow-read=<distDir>`, `--allow-env=KLARIDIAN_BASE_URL,KLARIDIAN_AUTH_TOKEN` (the only two env vars `emit-client.ts`'s generated functions read) -- and nothing else. No `--allow-write`/`--allow-run`/`--allow-ffi`/`--allow-sys` ever, by omission (Deno denies by default; the sandboxing *is* what's left out).
- `emitSandboxRunner()`: the generated project's own `src/sandbox-runner.ts`, a vendored (not `npm`-installed) wrapper around `child_process.spawn("deno", ...)` that pipes code over stdin and returns captured stdout/stderr rather than throwing, so the MCP tool handler can report a model's broken code back as a normal tool result (`isError: true`), not a protocol error.
- `emitExecuteCodeToolBlock(apiHost)`: the single `server.registerTool("execute_code", ...)` block that SDK code mode substitutes for N per-operation tool blocks, matching `emit-tool.ts`'s existing registration shape.

**Real bug caught by the E2E test, not by review:** the first `sandbox-runner.ts` draft passed a fully-replaced `env: { KLARIDIAN_BASE_URL, KLARIDIAN_AUTH_TOKEN }` to `spawn()` with no `PATH` -- Node's `spawn()` does not fall back to the parent process's `PATH` when a partial `env` object is supplied, so the OS could not locate the `deno` binary at all (`spawn deno ENOENT`), even though `deno` was correctly on `PATH` for the parent process. Fixed by explicitly including `PATH: process.env.PATH` alongside the two allowed vars -- still nothing else from the parent environment (other API keys, secrets) reaches the sandboxed process, but the sandbox *runner itself* can still find and launch Deno. Documented here because the failure mode (works when you `deno run` by hand, breaks specifically when spawned from Node with a curated env object) is non-obvious and would very likely recur in any future subprocess-spawning code in this repo that tries to restrict the child's environment.

**Validated per the project's "every non-trivial change needs real E2E" rule:** `emit-sandbox.test.ts` (9 unit tests: flag construction, generated-source shape, no destructive Deno flags ever emitted) plus `emit-sandbox-e2e.test.ts` -- 4 tests that really emit the client + sandbox runner, `npm install` + `tsc` compile them, and spawn a REAL `deno` subprocess: one happy-path test (model code imports the generated client, calls a real HTTP endpoint via the permitted host, gets real data back) and three adversarial tests, each attempting one of the three exfiltration vectors validated in the manual PoC (cross-host fetch, arbitrary file write, arbitrary file read outside the dist dir) and asserting Deno's permission system actually blocks each one from inside a real subprocess -- not just asserting the flags were passed. Tests skip gracefully (not fail) when `deno` isn't on `PATH`, so CI/other machines without Deno installed don't get spurious failures; CI now installs Deno via `denoland/setup-deno@v2` (`.github/workflows/ci.yml`) so this coverage runs for real there too, not just locally.

**Result:** 127/127 tests passing (114 pre-existing + 13 new: 9 unit + 4 E2E), `tsc -p tsconfig.json` clean.

**Remaining MCPFO-26 sub-scope, unblocked by this:** MCPFO-28 (CLI flag/subcommand to actually wire `emitClientModule()` + `emitSandboxRunner()` + `emitExecuteCodeToolBlock()` into `klaridian generate` -- nothing built across MCPFO-29/30 is user-invokable yet), MCPFO-31 (`search_docs`, the second of the two code-mode MCP tools), MCPFO-32 (otel/posthog instrumentation wiring for the single `execute_code` call site).

## 46. MCPFO-28 implemented — code-mode wired into `klaridian generate` (Sep 4, 2026)

Third and final concrete build closing out the core of MCPFO-26's SDK code mode work: a new `--architecture <tools|code-mode>` flag on `klaridian generate` (v2 engine only) that actually invokes MCPFO-29's typed client and MCPFO-30's Deno sandbox -- until this, both were fully built and tested in isolation but not user-invokable by anything.

**What changed:**
- `emit-server.ts`: new `Architecture` type (`"tools" | "code-mode"`), threaded through `EmitOptions`. `emitIndex()` branches on it -- `"tools"` (default, unchanged) emits one `registerTool()` block per operation via `emit-tool.ts`; `"code-mode"` emits exactly one block via `emitExecuteCodeToolBlock()` (MCPFO-30). `emitServerProject()` additionally writes `src/client.ts` (MCPFO-29's typed client) and `src/sandbox-runner.ts` (MCPFO-30's Deno spawner) only when code-mode is requested, and validates the base URL is absolute at generation time via `extractApiHost()` -- fails loudly rather than emitting a sandbox whose `--allow-net` scope would be undefined.
- `generate.ts`: `--architecture` flag + validation chain: unknown value rejected; `code-mode` requires `--engine v2` (rejected otherwise -- v1's output is `openapi-mcp-generator`'s own template, not klaridian's emitter, so there's no code-mode integration point there); `code-mode` + any `--plugin` rejected with an explicit MCPFO-32 pointer (the collapsed single-tool call site has no per-operation instrumentation hook yet -- silently generating an uninstrumented server despite `--plugin` being passed would be worse than refusing); `code-mode` + a non-absolute base URL rejected (unlike the "tools" architecture, where a missing absolute base URL is only a runtime warning with a `KLARIDIAN_BASE_URL` fallback -- code-mode's sandbox permission is baked in at generation time, so there is no runtime fallback to warn-and-continue with).

**Validated per the project's "every non-trivial change needs real E2E" rule -- and this time genuinely end-to-end, not per-module:** `emit-server.test.ts` gained 4 unit tests (code-mode emits exactly one tool + the two extra files, tools architecture unaffected, non-absolute base URL throws). New `emit-codemode-e2e.test.ts` -- 3 tests that assemble a REAL generated project via `emitServerProject({ architecture: "code-mode" })`, `npm install` + `tsc` build it, spawn the compiled server over stdio, and drive it with real JSON-RPC: (1) `tools/list` returns exactly one tool (`execute_code`), not one per operation; (2) a real `tools/call execute_code` with model-shaped code (`import { getPetById } from "./client.js"`) round-trips through a real Deno subprocess to a real local HTTP server and returns the real data; (3) intentionally broken model code (`"this is not valid typescript {{{"`) comes back as `isError: true` on the tool result, not a JSON-RPC protocol crash -- proving the earlier sandbox-runner.ts error handling (section 45) actually reaches the MCP layer correctly end to end.

Also manually exercised the real CLI binary (`node dist/src/index.js generate --architecture code-mode ...`), not just the test suite -- confirmed `--json` output includes the new `architecture` field, `--engine v1 --architecture code-mode` and `--architecture code-mode --plugin otel` are both rejected with the expected `validate-architecture` stage and message.

**Result:** 134/134 tests passing (127 pre-existing + 7 new: 4 emit-server.test.ts unit tests for code-mode wiring, 3 real E2E in emit-codemode-e2e.test.ts — plus emit-server.test.ts's pre-existing suite already counted in the 127 baseline), `tsc -p tsconfig.json` clean.

**MCPFO-26 status after this:** 3 of 5 sub-tasks done (MCPFO-29 client, MCPFO-30 sandbox, MCPFO-28 CLI wiring) -- code mode is now genuinely usable end to end (`klaridian generate --architecture code-mode --base-url <absolute-url> ...`), just without `search_docs` (MCPFO-31, still open -- the model has no discovery tool yet, only `execute_code` itself) or plugin instrumentation (MCPFO-32, still open).

## 47. MCPFO-31 implemented — search_docs, structural-fallback-only (Sep 4, 2026)

Fourth build closing MCPFO-26's SDK code mode core: the second and last of code-mode's two-tool surface (section 43's design), `search_docs`, letting the model look up a generated function's signature/purpose before writing `execute_code` (MCPFO-30) against it — the mechanism Stainless's eval writeup (section 43) credited for its model self-correcting in ~4 turns instead of guessing blindly.

**The real, explicitly-scoped decision this ticket flagged (see MCPFO-31's own description):** many real-world OpenAPI specs have sparse or missing operation descriptions (unlike this repo's fully-documented Petstore fixture — 0/19 operations missing a description there, not representative). Two candidate strategies for what search_docs shows when a description is missing: (a) a purely structural fallback built from the operation's own shape (method, path, parameter names/types/locations, request body field summary, deprecated flag) — deterministic, free, no LLM; (b) LLM-assisted doc synthesis at generation time.

**Direct instruction: build (a) only for now; park (b) as a distinct future decision, not folded into this ticket.** This is consistent with curation.ts's prior, explicit rejection of LLM involvement at generation time (section 24/PLAN.md section 10 — user-chosen/structural mechanism over LLM-suggested). Recording the parking-lot note explicitly here so it's findable later: **LLM-assisted search_docs synthesis remains a legitimate, unbuilt enhancement** — worth a real cost/quality tradeoff discussion (an OpenAI/Anthropic API key dependency for `klaridian generate` itself would be a first for this project, which has otherwise been carefully free-of-that; batched/cached synthesis to control per-generation cost; how a synthesized doc should be visually distinguished from spec-authored ones so a user can tell what klaridian invented) whenever it's revisited, not a "just add an LLM call" afterthought.

**What was built (`emit-docs.ts`):**
- `buildOperationDocs(tools, functionNames)`: pairs each tool with the exact function name `emit-client.ts` generated for it (same sanitize/dedupe call, same order — search_docs must always point at a real, importable name, never the raw OpenAPI operationId) and either the real `description` (trimmed; whitespace-only counts as missing) or a structural fallback: `METHOD /path`, parameters grouped by location (path/query/header), request-body field summary (name/type/required/enum, one level deep — not a full recursive schema dump, since the model can already see the full shape via the Zod type in `client.ts`), and a deprecated flag when set.
- `emitDocsDataModule(docs)`: emits `src/docs-data.ts`, a static, vendored array of doc entries computed once at generation time (consistent with every other generated artifact — section 7's vendored-source rule), not recomputed per request.
- `emitSearchDocsToolBlock()`: the `search_docs` MCP tool itself — case-insensitive substring match over function name, path, and doc text; empty query lists every operation. Deliberately not fuzzy/semantic search (no embeddings, no extra runtime dependency, fully deterministic) — revisit only if real usage on a large spec shows substring matching insufficient.
- `emit-server.ts` wiring: `emitServerProject()` now also writes `src/docs-data.ts` for code-mode, and `emitIndex()` registers both `execute_code` and `search_docs` (2 tools total, not 1) as code-mode's full surface.

**Validated per the project's "every non-trivial change needs real E2E" rule:** `emit-docs.test.ts` (8 unit tests: real-description passthrough, structural fallback content for params/body/deprecated, function-name pairing, emitted-module/tool-block shape). Extended `emit-codemode-e2e.test.ts` with a 4th real E2E test — assembles a real generated project, `npm install` + `tsc` build, spawns it over stdio, and drives a real `tools/call search_docs` both with a query (finds `getPetById` by name, surfaces its real method/path) and with an empty query (lists every operation). Also updated the earlier `tools/list` E2E test's expectation from 1 to 2 tools now that `search_docs` exists alongside `execute_code`.

**Result:** 143/143 tests passing (134 pre-existing + 9 new: 8 unit + 1 additional real E2E test, plus the pre-existing tools/list E2E test's assertion updated in place for the new 2-tool count), `tsc -p tsconfig.json` clean.

**MCPFO-26 status after this: 4 of 5 sub-tasks done** (MCPFO-29 client, MCPFO-30 sandbox, MCPFO-28 CLI wiring, MCPFO-31 search_docs). Code mode's full two-tool surface (`execute_code` + `search_docs`) is now complete and usable end to end. Only MCPFO-32 (otel/posthog instrumentation for the collapsed single-execute_code-call-site architecture) remains open.
