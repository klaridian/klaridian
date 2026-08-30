# mcpforge — v0 Technical Architecture

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
  │  mcpforge CLI      │   `mcpforge generate --spec api.yaml --plugin otel`
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

The CLI is a **generator**, not a runtime — it produces a project, then gets out of the way. The generated server has no runtime dependency on `mcpforge` itself beyond a small shared instrumentation helper package (see section 5).

---

## 3. CLI package structure

```
mcpforge/
├── packages/
│   ├── cli/                      # the `mcpforge` command
│   │   ├── src/
│   │   │   ├── index.ts          # entrypoint, arg parsing (commander or clipanion)
│   │   │   ├── commands/
│   │   │   │   └── generate.ts   # `mcpforge generate` command
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

   > **✅ Done (Aug 30, 2026).** See `spike/FINDINGS.md` for full results. Two findings changed downstream design:
   > - `ConsoleSpanExporter` writes to **stdout**, which corrupts stdio-transport MCP servers (stdout must carry JSON-RPC only). The real OTel plugin must default to `OTLPTraceExporter`; any debug console output must go to stderr, hard-wired, never left to the implementer to get right.
   > - Span flushing needs explicit `SIGINT`/`SIGTERM` handling (`sdk.shutdown()`) — the default batch processor can lose spans on process exit otherwise. `runtime-otel` must wire this by default, not leave it as an exercise for generated-server users.
   >
   > Both findings are now incorporated into section 5 above (the `wrapTool()` design) and should carry into `runtime-otel`'s real implementation and its tests.

2. OpenAPI parsing + tool mapping (no plugins yet, no templating yet — just prove spec → internal tool model works, with tests against the Petstore spec).
3. Basic project templating (no plugins) — generate a working, unInstrumented MCP server.
4. Plugin interface + OTel plugin — wire instrumentation into the templated output.
5. CLI polish (prompts, error messages, `--help`).
6. README + a documented walkthrough using the Petstore example, since that's what launch posts will need anyway.

**Post-v0 roadmap (added Aug 30, 2026 — see section 14 for the full case study):** validating against the real Wavix production API/MCP server surfaced concrete, prioritized next steps beyond the original 6-step list above:

7. ~~`allOf` schema merging in `map-tools.ts` (highest priority — see section 14).~~ **Done (Aug 30, 2026) — see section 15.** Result against the real Wavix spec: 120/122 operations (98.4%) now map successfully.
8. ~~Authentication support (Bearer token at minimum) — currently zero auth story.~~ **Done (Aug 30, 2026) — see section 17.** Also fixed a real blocker found along the way: `generate` used to refuse to produce anything if any operation had a mapping error; now defaults to skip-and-warn (`--strict` restores the old behavior). mcpforge could generate and compile a real, working Wavix MCP server (120 tools, auth wired) from the unmodified real spec.
9. OpenAPI 3.1 support — turns out this already works (the real Wavix spec is 3.1 and parses/maps correctly); still worth adding an explicit 3.1 test fixture so this isn't just incidentally true.
10. Binary/streaming response handling (generate a `{ downloadUrl, contentType, status }`-shaped tool instead of inlining binary data) — same idea frameworks like FastAPI apply with a dedicated response type instead of forcing binary bytes through a JSON body.
11. `multipart/form-data` request body support, or an explicit documented limitation.

**Superseded (Aug 30, 2026) — see section 16.** Items 7-11 above (and their underlying `packages/cli` `openapi/`/`render/` implementation) are superseded by the decision to adopt `openapi-mcp-generator` as mcpforge's generation engine rather than continuing to build and maintain a competing implementation. The *findings* from this work remain valid and directly informed that decision; the code itself is not the path forward. See section 16 for the comparison and rationale, and section 18 for the new build order.

---

## 10. Open technical questions

- [ ] MCP transport for generated servers: stdio only (simplest, matches most local-agent use cases) or also Streamable HTTP? Recommend **stdio-only for v0** — matches the reference MCP servers and keeps the template simpler.
- [ ] Which MCP SDK: official `@modelcontextprotocol/sdk` (assume yes, no reason to deviate).
- [ ] Package manager for generated projects: npm (safest default, zero assumptions about what the user has installed).
- [ ] Do we vendor `runtime-otel` as a copied file into each generated project (zero extra install, more duplication) or publish it as a real npm dependency (cleaner, but means generated servers depend on an mcpforge-maintained package before v1 stability)? **Leaning vendored-file for v0** to avoid a premature published-package commitment; revisit once the API stabilizes.

## 11. Findings from building the OpenAPI parser + mapper (Aug 30, 2026)

Implemented and tested (`packages/cli/src/openapi/{parse,map-tools,types}.ts`, `packages/cli/test/map-tools.test.ts`) against the real Petstore spec (all 19 operations map cleanly, 0 errors) plus 5 targeted edge-case fixtures. One real-world finding that wasn't anticipated in section 7:

**`servers[0].url` can be relative, not absolute.** The real Petstore spec declares `servers: [{ url: "/api/v3" }]` — a path, not a full domain. `mapOpenApiToTools()` passes this through as-is rather than guessing a host. **Consequence for the generator/templates (not yet built):** the generated server's config must require an explicit base host from the user when the spec's server URL is relative — don't silently prepend something. This should become a v0 CLI prompt ("spec declares a relative server URL — what host should tools be called against?") rather than a runtime surprise.

Also validated: `@apidevtools/swagger-parser` fully dereferences `$ref`s before our code sees the document, so `map-tools.ts` never needs its own `$ref` resolution logic — confirms the parser choice in section 1/3 was right.

## 12. Basic project templating — implemented and validated end to end (Aug 30, 2026)

Implemented (`packages/cli/src/render/{generate-server-code,render-project}.ts`) and tested (`packages/cli/test/render-project.test.ts`):

- **`generate-server-code.ts`** generates the actual TypeScript source of `src/index.ts` for a basic, un-instrumented MCP server — hand-rolled code generation (not a templating engine), because tool-handler wiring (path/query/header/body -> fetch call) has real per-parameter-location branching that's clearer as generated code than as template conditionals. This confirms the section 6 hybrid approach was right in spirit, though in practice v0 didn't even need `ts-morph` yet — plain string generation was sufficient because there's no cross-plugin injection point to manage until the OTel plugin lands (next build step).
- **`render-project.ts`** writes the full project to disk: `package.json`, `tsconfig.json`, `README.md` (including a warnings section surfaced from the mapping step), and `src/index.ts`.
- Confirmed the section-11 finding is now handled at generation time: when the spec's server URL isn't absolute, the generated server requires `MCPFORGE_BASE_URL` and fails with a clear message instead of guessing a host, and the generated README documents this explicitly.

**The strongest validation so far:** `render-project.test.ts` doesn't just check generated file contents — it renders a real project to a temp directory, runs a real `npm install`, runs a real `tsc` build, spawns the compiled server, and drives it over stdio JSON-RPC exactly as the spike did by hand. Result: **19/19 tools listed correctly, `getPetById` returns real data from the live Petstore API, all 10 tests pass** (`npm test` in `packages/cli`). This is the generator now doing, automatically, what the spike proved was possible by hand.

**Not yet covered:** no plugins/instrumentation in the generated server yet (that's the next build-order step). No handling yet for OpenAPI response-body schemas beyond "return JSON or text as-is" — response *shape* isn't currently surfaced to the MCP tool definition, only the request-side `inputSchema`. Worth a note for later: MCP tool definitions don't have a standard "output schema" slot the way inputs do, so this may simply not matter much in practice — revisit if real usage says otherwise.

## 13. Plugin interface + OTel plugin — implemented and validated end to end (Aug 30, 2026)

Implemented and tested:

- **`src/plugins/plugin.interface.ts`** — the `ObservabilityPlugin` interface exactly as designed in section 4, plus `resolvePluginConfig()` to validate/apply-defaults for a plugin's config schema against CLI-provided values.
- **`src/plugins/otel/otel.plugin.ts`** — the generic OTel plugin. Its vendored `instrumentation.ts` contribution directly encodes both spike findings: `OTLPTraceExporter` only (never `ConsoleSpanExporter`), OTel diagnostics routed to stderr, and explicit `SIGINT`/`SIGTERM` → `sdk.shutdown()` handlers.
- **`generate-server-code.ts`** now accepts an optional plugin and wraps every generated tool handler in the plugin's `wrapFunctionName` — e.g. `wrapTool("getPetById", handle_getPetById)` — without any per-tool special-casing.
- **`src/commands/generate.ts` + `src/index.ts`** — the real `mcpforge generate` CLI command (via `commander`), supporting `--spec`, `--out`, `--name`, `--plugin`, and repeatable `--plugin-config <pluginId>.<key>=<value>` flags. Surfaces mapping warnings/errors to the user and refuses to generate on hard errors.

**v0 scope decision made here:** exactly 0 or 1 plugins per generated server for now — `generateServerSource` throws if given more than one. Composing multiple plugins around the same tool call site (e.g. OTel + PostHog both wrapping the same handler) needs a real composition strategy that isn't worth building until a second plugin actually exists. Documented directly in code, not just here.

**Validation (`packages/cli/test/otel-plugin.test.ts`):** generates a server with the OTel plugin enabled, runs a real `npm install` (pulling real `@opentelemetry/*` packages), builds, runs it, and — critically — sends it a real `SIGTERM` mid-run to exercise the plugin's shutdown handler. Confirms the invariant from `spike/FINDINGS.md` holds through the full generator, not just the hand-written spike: **stdout stays exactly 2 valid JSON-RPC lines**, even with OTel active and no collector available to receive the exported spans.

Also manually smoke-tested the actual CLI binary (`node dist/src/index.js generate --spec ... --plugin otel --plugin-config otel.serviceName=...`) end to end outside the test suite — correctly surfaced the pre-existing `uploadImage` non-JSON-body warning and generated all 19 tools with OTel wiring. All 11 automated tests pass (`npm test` in `packages/cli`).

## 14. Real-world validation case: could mcpforge replace/generate a Wavix-compatible MCP server? (Aug 30, 2026)

To pressure-test v0 against something harder than the well-formed Petstore spec, we inspected the real, production `Wavix/wavix-mcp-server` (public GitHub repo) and its source spec `Wavix/wavix-openapi`. **Verdict: not today.** The gap is real and instructive, not a minor tweak — documenting it here because it's the clearest signal yet of what "v1" needs to cover to be useful beyond toy specs.

### What the Wavix spec actually looks like, vs. Petstore

| | Petstore (our fixture) | Wavix (real production API) |
|---|---|---|
| OpenAPI version | 3.0.x | **3.1.0** (never tested against our parser/mapper) |
| Paths / operations | 19 | **78 paths, 122 operations** |
| `allOf` usage | 0 | **151 occurrences** |
| `oneOf` / `anyOf` usage | 0 | 5 / 14 occurrences |
| `multipart/form-data` bodies | 0 | 3 endpoints (file uploads: number papers, speech-analytics audio, 10DLC evidence) |
| Non-JSON responses | 0 | 5 endpoints (`audio/wav`, `application/pdf`, `application/x-ndjson`, `application/octet-stream`) |
| `servers[0].url` | relative (`/api/v3`) | absolute (`https://api.wavix.com`) — this one's actually easier than Petstore |
| Auth | none | Bearer token, required on every call |

Our mapper (`map-tools.ts`) **rejects any operation using `allOf`/`oneOf`/`anyOf` as a hard error** by design (section 7/8's "fail loudly" rule). With `allOf` alone appearing 151 times, most of the 122 real Wavix operations would currently be skipped, not mis-mapped — the fail-loudly guardrail did its job, but it also means today's mcpforge covers a small fraction of a real-world API like this.

### How the real Wavix server actually solves these same problems (worth learning from)

`wavix-mcp-server` is Python, built on FastMCP (`FastMCP.from_openapi()`), not custom-generated code like ours. It gets a working server out of a hard spec via targeted spec *preprocessing* before handing it to FastMCP, plus a handful of hand-written escape-hatch tools:

- **`_ensure_request_body_type_object()`** — FastMCP merges `allOf` children into the body schema but doesn't set `type: object` on the result, which then causes single-property body wrappers to get silently stripped. Wavix patches the spec in-memory to add the missing `type` before FastMCP sees it. This is a targeted, well-tested fix (5 unit tests), not a general allOf-merging engine — worth noting because it suggests full oneOf/allOf/anyOf support isn't necessarily "resolve the general case," it can be "handle the specific shapes real specs actually produce."
- **`_strip_non_json_response_content()`** — drops non-JSON response content types from the spec before FastMCP tries to validate real responses against a schema that doesn't fit streaming/binary payloads.
- **4 hand-written "escape hatch" tools** (`call_recording_get`, `billing_invoices_download`, `speech_analytics_file_get`, `ten_dlc_brand_evidence_get`) for the binary/streaming endpoints — these are *excluded* from the automatic OpenAPI-driven mapping (via FastMCP route-map excludes) and reimplemented by hand to return a `{download_url, content_type, status_code}` pointing at a pre-signed redirect or an authenticated re-fetchable URL, rather than trying to stream binary data through the MCP tool-call contract at all.
- **Auth via a custom `httpx.Auth` subclass** that forwards the MCP client's incoming `Authorization` header to the upstream API — with an explicit host allowlist check so the bearer token never leaks to redirect targets (e.g. pre-signed S3 URLs).
- **Documentation exposed as MCP Resources** (not tools) — the whole Wavix docs site is crawled via `llms.txt` and registered as individually fetchable `wavix://docs/*` resource URIs, cached with ETag revalidation. Out of scope for a "generate tools from an API" tool like mcpforge, but notable as a UX pattern.
- **Transport: Streamable HTTP**, hosted at `mcp.wavix.com`, not stdio — a deliberate choice for a multi-tenant hosted server, different from our stdio-only v0 default.

### What mcpforge would need, roughly in priority order

**Blocking (without these, most operations stay unmapped):**
1. **`allOf` merging** — the single highest-value fix; 151 occurrences vs. 5 (`oneOf`) and 14 (`anyOf`). Unlike `oneOf`/`anyOf` (genuinely ambiguous — which branch does a single flat `inputSchema` represent?), `allOf` is a deterministic merge of sibling schemas and is tractable to implement generally, not just spec-specific patching.
2. **Authentication support** — at minimum, a Bearer-token plugin/config that reads from an env var and attaches it to every generated `fetch` call. Currently mcpforge has zero auth story; every generated server today only works against fully open APIs.
3. **OpenAPI 3.1 support** — never validated against our parser (`@apidevtools/swagger-parser` claims 3.1 support, but `map-tools.ts` and its tests have only run against a 3.0.x fixture). Needs its own test fixture before trusting it.

**Important, but workaroundable with real but bounded effort:**
4. **`multipart/form-data` request bodies** — either support file uploads properly, or explicitly document the limitation the way section 8 already frames non-JSON bodies (we already warn and skip the body; the gap is capability, not error handling).
5. **Binary/streaming responses** — follow Wavix's own pattern directly: for OpenAPI operations whose only response content-type is non-JSON (audio, PDF, octet-stream, ndjson), generate a tool that performs the request and returns a `{ downloadUrl, contentType, status }` shape instead of trying to inline binary data into a tool-call `content` block. This is a generation-time decision, not a runtime hack — should live in `map-tools.ts`/`generate-server-code.ts` as a first-class case, not bolted on.

**Lower priority / possibly intentionally out of scope:**
6. **`oneOf`/`anyOf`** — likely correct to keep rejecting these (or, longer-term, offer a manual override the way Wavix hand-writes 4 escape-hatch tools) rather than trying to auto-resolve genuinely ambiguous unions into one flat MCP `inputSchema`. Only ~19 of 122 Wavix operations are affected.
7. **Docs-as-Resources** — a real, validated UX pattern from a production MCP server, but out of scope for "generate tools from an OpenAPI spec." Worth a note for a possible future plugin, not a v1 blocker.
8. **Streamable HTTP transport** — only matters if/when mcpforge wants to generate hosted, multi-tenant servers rather than local stdio ones (ARCHITECTURE.md section 10's open question, still undecided).

### Bottom line

With items 1-3 solved, a rough estimate is mcpforge could automatically cover something like 85-90 of Wavix's 122 real operations (excluding the ~19 oneOf/anyOf and ~8 binary/multipart ones, which would need the same kind of hand-written escape hatches Wavix itself uses). That's a meaningful chunk of real production-API work, not a rewrite of the generator — but it's also not a "small tweak"; `allOf` merging and an auth story are both non-trivial, multi-session features. This is now the top of the post-v0 roadmap (see section 9's build order, which this case study extends rather than replaces).

> **Update (Aug 30, 2026, same day): item 1 (allOf merging) is now implemented — see section 15.** The actual result against the real Wavix spec beat the estimate above by a wide margin: **120 of 122 operations (98.4%) now map successfully**, not the ~85-90 originally estimated. The `anyOf` count (14 occurrences) turned out to mostly coexist with `allOf` in ways that resolve cleanly rather than blocking mapping — only 2 operations hit a genuine, irreducible `oneOf` ambiguity. Auth (item 2) and OpenAPI 3.1 validation (item 3, though the real Wavix spec — which *is* 3.1 — already parses and maps correctly, so this is now more "add an explicit test fixture" than "add support") remain open.

## 15. `allOf` schema merging — implemented and validated against the real Wavix spec (Aug 30, 2026)

Implemented in `packages/cli/src/openapi/map-tools.ts`: a new `mergeAllOf()` function that recursively flattens an `allOf` schema's sibling subschemas into one merged schema — deep-merging `properties`, unioning `required` arrays across all branches, and preserving any `oneOf`/`anyOf` found in a branch (rather than dropping it) so `detectUnsupportedSchemaFeatures` still catches genuine ambiguity in the *merged* result. `detectUnsupportedSchemaFeatures` no longer flags `allOf` itself as unsupported — only `oneOf`/`anyOf` remain hard errors, per the reasoning in section 14 (allOf is a deterministic intersection; oneOf/anyOf are genuinely ambiguous unions with no single flat `inputSchema` representation).

**Real, load-bearing bug caught by testing, not just unit tests on synthetic fixtures:** the first implementation silently discarded a nested `oneOf`/`anyOf` when it appeared inside an `allOf` branch — merging only copied `properties`/`required`/`type`/`description` and dropped everything else. A dedicated test (`allOf containing a oneOf branch still produces a hard error`) caught this immediately: an operation that should have been rejected as ambiguous was instead silently mapped. Fixed by explicitly propagating `oneOf`/`anyOf` into the merged schema so downstream detection still sees them. This is exactly the kind of subtle-wrong-mapping bug the project's "fail loudly, don't guess" rule (section 7/8) exists to prevent — and it shipped with a passing test suite until the oneOf-inside-allOf case was specifically exercised. Lesson: allOf-merging tests need to include "and it still contains an unsupported feature" cases, not just the happy path.

**Validation against real fixtures:**
- 4 new unit tests added to `map-tools.test.ts` (`allOf` in a request body, `allOf` in a parameter schema, nested `allOf`-inside-`allOf`, and `oneOf`-inside-`allOf` still rejected) — all pass, plus the full existing suite (15/15 tests) still passes.
- **Ran the mapper directly against the real Wavix OpenAPI spec** (not just Petstore) as a one-off validation script — this is the same spec analyzed in section 14. Result: **120 of 122 operations (98.4%) now map successfully**, up from an estimated small fraction before this change. Remaining gaps: 2 hard errors (genuine `oneOf` ambiguity) and 3 warnings (non-JSON request bodies — expected, unaddressed until item 4/5 of the roadmap). This substantially beats the original 85-90 estimate in section 14, suggesting `anyOf` usage in the real spec mostly coexists with mergeable `allOf` structure rather than blocking mapping on its own.

**Not yet re-validated end-to-end:** this fix was validated at the mapping layer (does `mapOpenApiToTools` produce a correct `ToolDefinition`?) against both synthetic fixtures and the real Wavix spec's *mapping* output, but **not** by actually rendering and running a generated server against the live Wavix API (unlike the Petstore validations in sections 12-13) — that would require a real Wavix API key, which we don't have. The rendering/running mechanic itself was already proven generic in sections 12-13, so the residual risk here is specifically "does the merged schema's shape make sense to an MCP client," not "does the generator pipeline work," but this is worth flagging explicitly rather than assuming section 12/13's validation automatically covers this new code path too.

## 16. Strategic pivot: adopt `openapi-mcp-generator` as the generation engine instead of maintaining our own (Aug 30, 2026)

While implementing roadmap item #4 (binary/streaming responses), we stopped to check whether mcpforge's hand-rolled OpenAPI→MCP generation was reinventing something that already exists well. It was.

### What we found

[`harsha-iiiv/openapi-mcp-generator`](https://github.com/harsha-iiiv/openapi-mcp-generator) — MIT-licensed, published on npm, 631 GitHub stars, actively maintained (commits within the last 2 months as of this writing). A TypeScript CLI **and** library (exports a clean programmatic API, `getToolsFromOpenApi()`) that converts an OpenAPI spec into a buildable MCP server project. Directly comparable to mcpforge's own generator, and — after hands-on testing against the real Wavix spec — measurably ahead of it on multiple axes we hadn't even covered:

| Capability | `openapi-mcp-generator` | mcpforge (pre-pivot) |
|---|---|---|
| Auth | API key, Bearer, Basic, **OAuth2**, custom | Bearer, API key only |
| Transports | stdio, SSE web server, **StreamableHTTP** | stdio only |
| Schema validation | Zod, auto-generated via `json-schema-to-zod` | hand-written type checks |
| **64-character tool name limit** (a real MCP client constraint, e.g. Claude Desktop) | handled — word-level abbreviation + deterministic hash fallback | **not handled at all** — a latent bug in mcpforge against any spec with long names |
| `allOf`/`oneOf`/`anyOf` | delegated to Zod via `json-schema-to-zod`, handles all three (Zod natively supports unions) | `allOf` hand-merged (section 15); `oneOf`/`anyOf` still hard-rejected |
| Multi-file `$ref` | supported | untested |
| Selective tool inclusion | `x-mcp` OpenAPI extension (per-operation/path/root) | none |
| SSRF protection on spec parsing | explicit (`assertNoExternalRefs`, opt-in `allowExternalRefs`) | none |
| Validated against | Stripe (452 tools, per their own commit history) | Wavix (120/122 tools, section 15/16) |

**Direct validation against the real Wavix spec (same fixture used throughout sections 14-16):** ran `openapi-mcp-generator` against the unmodified `wavix-api.json`. Result: **all 122 operations generated successfully** (vs. mcpforge's 120/122 — the 2 `oneOf` operations that mcpforge still hard-rejects were handled fine here because Zod natively expresses unions), zero warnings printed, and `npm run build` (`tsc`) compiled with zero errors on the first try.

### The other half of the finding: a real critique of OpenAPI→MCP auto-conversion itself

While researching this, we also found [a post by the FastMCP author](https://www.jlowin.dev/blog/stop-converting-rest-apis-to-mcp) (FastMCP's `from_openapi()` is the tool the actual Wavix MCP server uses, per section 14) arguing that auto-converting a REST API to MCP tools 1:1 is actively bad for agents in production: APIs designed for humans are "generous" (hundreds of atomic, composable endpoints), but agents pay a real cost per tool in context/tokens and reasoning overhead — auto-conversion produces "chatty," bloated tool catalogs that make agents slower and more error-prone, not more capable. His recommendation: use auto-conversion for bootstrapping/prototyping only, then curate aggressively (rename, hide, merge, prune) before shipping to production.

This is a genuine, separate insight from "which generator library is best," and it points at a real opportunity: **nobody in this space (Speakeasy, Gram, FastMCP, openapi-mcp-generator) combines auto-generation with automated curation/pruning.** That gap is worth keeping in mind as a possible differentiator distinct from the observability angle — not something to build now, but a validated direction, not a guess.

### Decision

Adopt `openapi-mcp-generator` as mcpforge's generation engine rather than continuing to maintain a parallel, less-capable implementation. Concretely:

- `packages/cli`'s hand-rolled `openapi/` and `render/` modules (sections 12, 15, 16, and the in-progress section on binary responses) are superseded — not because the work was wasted (it directly validated the mechanic, per the spike in sections 9-13, and surfaced real integration risks like the stdout/OTel finding that remain valid regardless of generator choice), but because a better-tested, more complete implementation of the same generation step already exists and is MIT-licensed.
- mcpforge's own value proposition (PLAN.md: generator + observability plugins nobody else combines) is unaffected — if anything, it's cleaner: mcpforge becomes explicitly "`openapi-mcp-generator` (or equivalent) plus an instrumentation layer," not "yet another OpenAPI-to-MCP generator that also happens to have plugins."
- Next concrete step: replace `packages/cli`'s internal OpenAPI parsing/mapping/rendering with a dependency on (or vendored/forked copy of) `openapi-mcp-generator`, then re-attach the `runtime-otel`/plugin instrumentation layer (sections 4-5, 13) on top of *its* generated output instead of our own. The plugin interface design (section 4) doesn't need to change — it was already decoupled from the specific code-generation mechanics.
- Dependency safety confirmed (see section 18 item 1): the 19 vulnerabilities reported by `npm install` in the cloned repo are all in devDependencies (vitest's toolchain) and never reach a real consumer — `npm install openapi-mcp-generator` reports 0 vulnerabilities. Its runtime dependency footprint is small and closely matches mcpforge's own choices already.

---

## 17. Authentication support — implemented and validated end to end against the real Wavix spec (Aug 30, 2026)

> **Note:** this work (and section 15's `allOf` merging) predates the section 16 pivot to `openapi-mcp-generator`. Kept here as an accurate record of what was built and validated, and because the *findings* (real Wavix spec needs auth; skip-and-warn generation is essential for real-world specs) remain true and informed the pivot decision — but the actual code described below (in mcpforge's own `openapi/`/`render/` modules) is superseded per section 16, not the current implementation path going forward.


Implemented (roadmap item #2 from section 14): the second-highest-priority post-v0 fix, chosen because — as section 15's real Wavix validation confirmed — `allOf` merging alone gets 120/122 operations *mapped*, but every one of them still needs a working Bearer token to actually be *callable*, since Wavix requires auth on every request.

**What was built:**
- `AuthScheme` type added to `openapi/types.ts` — a small closed union (`http-bearer` | `api-key` with header/query location), not a general auth framework. Deliberately narrow: these two schemes cover the real-world APIs mcpforge has actually been tested against (Wavix uses `bearerAuth`), and OAuth2/openIdConnect are architecturally different (need an interactive flow a generated stdio server can't run on its own) rather than "just another case to add."
- `detectAuthScheme()` in `map-tools.ts` reads the spec's top-level `security` + `components.securitySchemes`, resolves the first required scheme, and returns an `AuthScheme` for the two supported types. Unsupported scheme types (OAuth2, openIdConnect, mutualTLS, or missing scheme definitions) produce a warning, not a hard error — the server still generates, just without automated auth wiring, letting the user add it manually rather than blocking generation outright.
- `generate-server-code.ts` now takes an optional `auth` and, when present: generates an `MCPFORGE_AUTH_TOKEN` env-var check (fails loudly with a clear message if unset, same pattern as `MCPFORGE_BASE_URL`) and injects the token into every generated tool's `fetch` call — as an `Authorization: Bearer <token>` header for `http-bearer`, or as the named header/query parameter for `api-key`.
- Generated `README.md` documents the requirement and how to set it, mirroring the existing `MCPFORGE_BASE_URL` documentation pattern.

**Real, load-bearing finding from wiring this up against the actual Wavix spec (not just synthetic fixtures):** the CLI's `generate` command previously refused to generate *anything* if `mapping.errors` was non-empty — even though `mapping.tools` already excludes the failing operations and would have produced a perfectly good 120-tool server. Running `mcpforge generate` against the real Wavix spec exposed this directly: 120 valid tools sat unused behind a hard refusal caused by 2 unrelated `oneOf` operations. Fixed by adding a `--strict` flag (default off): non-strict mode now warns about skipped operations and generates the rest; `--strict` restores the old all-or-nothing behavior for anyone who wants it. This is arguably a more important fix than the auth feature itself — without it, real-world specs with *any* unsupported operation (which, per section 14, is normal) couldn't be used at all.

**Validation (`packages/cli/test/auth.test.ts`):** generates a server from a minimal spec requiring `http-bearer` auth, spins up a real local HTTP server (not a mock library — an actual `node:http` server) that asserts the `Authorization` header it receives, builds and runs the generated server twice: once confirming it refuses to start with no token (non-zero exit code), once with a real token set — and confirms the exact string `Bearer test-secret-token-123` arrives at the upstream mock server's request headers, driven through a real MCP `tools/call` over stdio JSON-RPC end to end. Also confirms the README documents `MCPFORGE_AUTH_TOKEN`.

**Full real-world proof:** ran the actual CLI binary against the real Wavix spec end to end — `mcpforge generate --spec wavix-api.json --out ...` now succeeds (previously refused outright), producing **120 tools**, correctly detecting `{ type: "http-bearer" }` auth, and the generated project's `npm run build` (`tsc`) compiles cleanly with zero errors. This is the first time mcpforge has produced a real, compilable, non-Petstore server from an unmodified real-world spec. All 16 automated tests pass (`npm test`).

**Not yet covered:** `api-key` (as opposed to `http-bearer`) auth has unit-level type support and is used identically in the generated fetch wiring, but hasn't been exercised by its own end-to-end test the way `http-bearer` has — worth adding if/when a real API using `apiKey` auth comes up as a validation case. OAuth2/openIdConnect remain explicitly unsupported (warning, not automated) — no changes planned there without a concrete use case, since a generated stdio server can't run an interactive OAuth flow.

## 18. New build order after the section 16 pivot

Replaces the section 9 build order's remaining post-v0 items. Concrete next steps:

1. ~~Audit `openapi-mcp-generator`'s 19 reported dependency vulnerabilities...~~ **Done (Aug 30, 2026).** Resolved as a non-issue: the 19 vulnerabilities (6 moderate, 12 high, 1 critical) only appeared when cloning the full repo and running `npm install` there — that pulls in `devDependencies` (`vitest` and its whole bundler/test-runner tree: `vite`, `esbuild`, `postcss`, etc.), none of which reach an actual consumer. Verified directly: `npm install openapi-mcp-generator` in a clean scratch project reports **0 vulnerabilities**. Its real runtime footprint is tiny and matches mcpforge's own dependency choices closely: `@apidevtools/swagger-parser`, `commander`, `openapi-types` as dependencies, plus `@modelcontextprotocol/sdk`, `json-schema-to-zod`, `zod` as peer dependencies (the consumer supplies these, so no version conflicts with mcpforge's own MCP SDK usage). Safe to depend on directly — no fork-with-patches needed for this reason. (General lesson worth keeping: `npm audit` results from a repo checkout overstate real supply-chain risk for anyone who'll actually consume the package from npm — always re-check from the consumer's install, not the maintainer's dev environment.)
2. ~~Replace `packages/cli`'s internal `openapi/` and `render/`...~~ **Done (Aug 30, 2026) — see this section's own commits.** Both modules deleted; the CLI now calls `openapi-mcp-generator`'s `getToolsFromOpenApi()` (pre-flight tool count) and `generateMcpServer()` (actual project generation) directly.
3. ~~Re-attach the plugin/instrumentation layer...~~ **Done (Aug 30, 2026) — see the section 16/18 pivot's `render/instrument.ts` and `test/generate.test.ts`.** Turned out simpler than expected: `openapi-mcp-generator` dispatches every tool call through a single shared `executeApiTool()` function, so instrumentation only needs one textual patch, not a per-tool codemod.
4. ~~Re-run the full validation suite...~~ **Done (Aug 30, 2026).** Petstore (19 tools) and real Wavix spec (122/122 tools, up from 120/122) both validated end to end through the new pipeline — see `test/generate.test.ts` and this section's manual Wavix run.
5. ~~Decide whether to keep mcpforge's own tests...~~ **Done (Aug 30, 2026).** Retired the old fixture-based unit tests (they tested the now-deleted hand-rolled mapper); replaced with `test/generate.test.ts` (E2E CLI behavior + instrumentation patch) and `test/canary-generator-shape.test.ts` (section 19 — guards against `openapi-mcp-generator` drift).
6. Version-pin `openapi-mcp-generator` and add a canary test for its generated-code shape. **Done (Aug 30, 2026) — see section 19.**



## 19. `openapi-mcp-generator` version pinning + canary test (Aug 30, 2026)

Roadmap item #3 from section 18. `render/instrument.ts`'s patch depends on two exact strings in `openapi-mcp-generator`'s generated output — the `executeApiTool(...)` call site and the `import { z, ZodError } from 'zod';` import marker. That shape is not a contract the library promises to keep stable; a minor/patch version bump could silently change it.

**What was built:**
- `packages/cli/package.json` now pins `openapi-mcp-generator` to an exact version (`4.0.1`, no `^` range) instead of a caret range. This trades automatic patch updates for predictability — an explicit, reviewed `npm install openapi-mcp-generator@x.y.z` is required to move versions, rather than a routine `npm install` silently picking up a new minor/patch release that could break the instrumentation patch.
- `packages/cli/test/canary-generator-shape.test.ts` — two tests:
  1. Asserts the installed `openapi-mcp-generator` version matches the pinned version exactly, with a message explaining exactly what to do if it doesn't (verify `instrument.ts`'s constants by hand, then update both the pin and the test's expected version together).
  2. Generates a real server from the Petstore fixture via `openapi-mcp-generator` directly (not through mcpforge's own CLI) and asserts the two exact strings `instrument.ts` depends on are still present verbatim — failing with the generated source's first 3000 characters inline for fast diagnosis if not.

**Validated the canary actually catches drift:** manually edited the compiled test's expected version to a wrong value and confirmed it fails with a clear `AssertionError` (expected/actual mismatch) rather than silently passing — a canary that can't fail isn't a canary. Reverted immediately; the real pinned version (`4.0.1`) passes.

**Why this approach over an alternative (e.g. vendoring/forking `openapi-mcp-generator`, or generating an AST rather than string-matching):** pinning + a canary test is the minimum-complexity solution that still fails loudly on drift, consistent with the project's "fail loudly, don't guess" rule (section 7/8) — applied here to a dependency's output shape rather than to OpenAPI input, but the same principle. Full AST-based patching would be more robust to formatting-only changes (e.g. whitespace) but adds real complexity for a problem the canary already solves: catching *any* change (including semantic ones) at test time, well before it could reach a generated server silently.

All 5 tests pass (`npm test`): the 2 new canary tests plus the 3 from `generate.test.ts` (section 16/18's pipeline).
