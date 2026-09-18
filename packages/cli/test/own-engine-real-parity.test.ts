// packages/cli/test/own-engine-real-parity.test.ts
//
// MCPFO-104 — IR ownership Phase 2.5: CROSS-ENGINE parity on real-world specs.
//
// Phase 2 (MCPFO-73, ARCHITECTURE.md §90) proved klaridian's OWN spec→tool-DATA
// engine deep-equals the UPSTREAM `openapi-mcp-generator` engine on 5 tiny
// hand-authored corpus specs. This test raises the bar to LARGE real-world
// specs — the confidence gate before any future cutover (Phase 3 / MCPFO-74):
//
//   - Stripe        (~594 operations) — the stress test
//   - GitHub REST   (~1239 operations)
//   - DigitalOcean  (~684 operations)
//
// committed offline under test/fixtures/real-specs/*.json (CI reads local files,
// NEVER the network, so the run is deterministic).
//
// For each spec this runs BOTH engines through the IDENTICAL pipeline — the same
// meta recovery, the same `mapMcpToolDefinitionToIR` adapter, the same
// canonicalization (sort tools by operationId, recursively sort object keys) —
// and asserts `own` deep-equals `upstream`. There is NO committed golden here
// (594–1239 tools would be huge/noisy); the assertion is own==upstream computed
// LIVE in the same run, so a diff is a parity bug in getToolsFromOwnEngine, never
// a fixture/serialization artifact.
//
// The pipeline mirrors ir-golden.test.ts / own-engine-parity.test.ts EXACTLY.
// The only variable is which engine produces the raw tools; everything after the
// engine call is shared, so both ToolIR[] are built the same way.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readdir } from "node:fs/promises";
import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPIV3 } from "openapi-types";
import { getToolsFromOpenApi } from "openapi-mcp-generator";
import {
  mapMcpToolDefinitionToIR,
  extractOperationMetaByOperationId,
  prepareSpecForEngine,
  type ToolIR,
  type OperationMeta,
} from "../src/emit/ir.js";
import { extractOutputSchemasByOperationId } from "../src/emit/response-schema.js";
import { isSwagger2Document, convertSwagger2ToOpenApi3 } from "../src/spec/swagger2-conversion.js";
import { writeTempSpec } from "../src/commands/generate-helpers.js";
import { getToolsFromOwnEngine } from "../src/engine/own-engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Real specs live under the SOURCE test dir (not dist) — resolve back out of
// dist/test to packages/cli/test.
const REAL_SPECS_DIR = path.resolve(__dirname, "../../test/fixtures/real-specs");

/** Recursively sort object keys — identical to ir-golden.test.ts. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Canonical, deterministic JSON for a single ToolIR — identical to ir-golden. */
function canonicalizeTool(tool: ToolIR): string {
  return JSON.stringify(sortKeysDeep(tool), null, 2);
}

type Engine = "own" | "upstream";

/**
 * Build ToolIR[] for one spec through the shared pipeline, parameterized ONLY on
 * which engine produces the raw tools. Byte-identical to ir-golden.test.ts's
 * `buildToolIRForSpec` except for the engine call, so any diff between the two
 * engines' ToolIR[] is a real parity difference, not a pipeline artifact.
 */
async function buildToolIRForSpec(specFilePath: string, engine: Engine): Promise<ToolIR[]> {
  let specPath = specFilePath;

  // (1) Swagger 2.0 → OpenAPI 3.0 pre-conversion (same as generate.ts).
  const rawParsed = await SwaggerParser.parse(specPath);
  if (isSwagger2Document(rawParsed)) {
    const converted = await convertSwagger2ToOpenApi3(rawParsed);
    const { specPath: convertedPath } = await writeTempSpec(
      converted,
      "klaridian-real-parity-converted-"
    );
    specPath = convertedPath;
  }

  // (2) Recover per-operation metadata the engine drops (summary + x-klaridian).
  const originalDoc = (await SwaggerParser.parse(specPath)) as OpenAPIV3.Document;
  const metaByOperationId = extractOperationMetaByOperationId(originalDoc);

  // (3) klaridian-owned response-schema extraction → outputSchema.
  const outputSchemas = await extractOutputSchemasByOperationId(specPath);
  for (const [operationId, outputSchema] of outputSchemas) {
    const existing = metaByOperationId.get(operationId);
    if (existing) existing.outputSchema = outputSchema;
    else metaByOperationId.set(operationId, { outputSchema });
  }

  // (4) Prepare the spec for the engine (expose:false → x-mcp:false, object x-mcp → bool).
  const preparedDoc = prepareSpecForEngine(originalDoc);
  if (JSON.stringify(preparedDoc) !== JSON.stringify(originalDoc)) {
    const { specPath: preparedPath } = await writeTempSpec(
      preparedDoc,
      "klaridian-real-parity-prepared-"
    );
    specPath = preparedPath;
  }

  // (5) The engine (the ONLY variable) + (6) the single adapter seam.
  const rawTools =
    engine === "own"
      ? await getToolsFromOwnEngine(specPath, { dereference: true })
      : await getToolsFromOpenApi(specPath, { dereference: true });
  const tools: ToolIR[] = rawTools.map((t) =>
    mapMcpToolDefinitionToIR(t, metaByOperationId.get(t.operationId) as OperationMeta | undefined)
  );

  // Deterministic ordering — the engine's order is not a stable contract.
  tools.sort((a, b) =>
    a.operationId.localeCompare(b.operationId) || a.name.localeCompare(b.name)
  );
  return tools;
}

async function realSpecFiles(): Promise<string[]> {
  const entries = await readdir(REAL_SPECS_DIR);
  return entries.filter((f) => f.endsWith(".json")).sort();
}

/**
 * Build a readable diff of the FIRST differing tool (never the whole 594-tool
 * array): find the first tool whose canonical form differs, then emit its
 * line-level diff. Falls back to a count/name-set diff when the mismatch is a
 * different SET of tools rather than a differing tool.
 */
function firstDifferingToolDiff(own: ToolIR[], upstream: ToolIR[]): string {
  if (own.length !== upstream.length) {
    const ownNames = new Set(own.map((t) => `${t.operationId}::${t.name}`));
    const upNames = new Set(upstream.map((t) => `${t.operationId}::${t.name}`));
    const onlyOwn = [...ownNames].filter((n) => !upNames.has(n)).slice(0, 10);
    const onlyUp = [...upNames].filter((n) => !ownNames.has(n)).slice(0, 10);
    return (
      `Tool COUNT differs: own=${own.length} upstream=${upstream.length}\n` +
      `  only in own (first 10):      ${JSON.stringify(onlyOwn)}\n` +
      `  only in upstream (first 10): ${JSON.stringify(onlyUp)}`
    );
  }
  for (let i = 0; i < own.length; i++) {
    const a = canonicalizeTool(own[i]);
    const e = canonicalizeTool(upstream[i]);
    if (a !== e) {
      const al = a.split("\n");
      const el = e.split("\n");
      const diff: string[] = [];
      const max = Math.max(al.length, el.length);
      for (let j = 0; j < max; j++) {
        if (al[j] !== el[j]) {
          if (el[j] !== undefined) diff.push(`  upstream[${j + 1}]: ${el[j]}`);
          if (al[j] !== undefined) diff.push(`  own[${j + 1}]:      ${al[j]}`);
        }
      }
      return (
        `First differing tool: operationId="${own[i].operationId}" name="${own[i].name}" (index ${i})\n` +
        diff.slice(0, 60).join("\n")
      );
    }
  }
  return "(no per-tool diff found although canonical arrays differ)";
}

// One test per real spec — each runs BOTH engines through the SAME pipeline and
// deep-equals own==upstream. Generous timeout: 594–1239-op deep-equals is heavy
// but fine for node:test. Kept in a separate file so the core suite isn't
// slowed unreasonably.
for (const specFile of await realSpecFiles()) {
  const specPath = path.join(REAL_SPECS_DIR, specFile);

  test(
    `own-engine real-spec parity: ${specFile} — own deep-equals upstream`,
    { timeout: 120_000 },
    async () => {
      const [own, upstream] = await Promise.all([
        buildToolIRForSpec(specPath, "own"),
        buildToolIRForSpec(specPath, "upstream"),
      ]);

      // Compare TOOL-BY-TOOL, not as one canonicalized blob: a 594–1239-tool
      // array with large (recursive-spec) schemas can exceed V8's max string
      // length when JSON.stringify'd whole (Stripe does). Per-tool canonical
      // strings are bounded, cheap to diff, and give a precise first-mismatch.
      if (own.length !== upstream.length) {
        assert.fail(
          `OWN-engine ToolIR for ${specFile} does NOT match the UPSTREAM engine ` +
            `(MCPFO-104 / §90).\n` +
            firstDifferingToolDiff(own, upstream)
        );
      }
      for (let i = 0; i < own.length; i++) {
        if (canonicalizeTool(own[i]) !== canonicalizeTool(upstream[i])) {
          assert.fail(
            `OWN-engine ToolIR for ${specFile} does NOT match the UPSTREAM engine ` +
              `through the identical pipeline. This is a parity bug in ` +
              `getToolsFromOwnEngine (MCPFO-104 / §90).\n` +
              firstDifferingToolDiff(own, upstream)
          );
        }
      }
    }
  );
}
