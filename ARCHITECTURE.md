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

