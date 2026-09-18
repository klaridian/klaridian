// packages/cli/test/own-engine-real-parity.test.ts
//
// MCPFO-104 / MCPFO-74 — IR ownership: real-world-spec REGRESSION net for
// klaridian's OWN spec→tool-DATA engine.
//
// HISTORY. Through Phase 2.5 (MCPFO-104, ARCHITECTURE.md §90/§91) this file ran
// klaridian's own engine AND the upstream `openapi-mcp-generator` engine through
// the identical pipeline and asserted `own` deep-equals `upstream` on 6 large
// real specs. That cross-engine parity was the confidence gate for the Phase 3
// cutover.
//
// CUTOVER (MCPFO-74, §92). Phase 3 removed the `openapi-mcp-generator`
// dependency outright — klaridian now owns the full pipeline — so this test can
// no longer call the upstream engine. It is converted to an UPSTREAM-FREE
// regression net (approach (b), see §92): for each real spec it asserts the own
// engine produces the EXACT expected operation count and a fully valid ToolIR[],
// and that the pipeline is DETERMINISTIC (two independent builds are byte-equal).
// The frozen operation counts (594/1239/684/1202/346/197) were the numbers the
// own engine matched the upstream engine on when parity was proven, so a drift
// in any count is a real regression, caught without needing the removed dep.
//
// Why counts + validity + determinism rather than committed golden snapshots:
// these specs are 2–13 MB each and yield 197–1239 tools with large recursive
// schemas (Stripe alone exceeds V8's max string length when stringified whole),
// so per-spec golden ToolIR files would be enormous and noisy. The tiny golden
// corpus (test/fixtures/ir-corpus/*.golden.json, asserted byte-for-byte by
// ir-golden.test.ts + own-engine-parity.test.ts) remains the exact-snapshot
// regression net; this file is the LARGE-spec/shape-diversity net on top of it.
//
// Specs (committed offline under test/fixtures/real-specs/*.json; CI reads local
// files, NEVER the network):
//   - Stripe        (594 operations)  — the stress test
//   - GitHub REST   (1239 operations)
//   - DigitalOcean  (684 operations)
//   - Kubernetes    (1202 operations) — a large SWAGGER 2.0 spec (2.0→3.0 path)
//   - OpenAI        (346 operations)  — OpenAPI 3.1.0
//   - Twilio api    (197 operations)  — OpenAPI 3.0.1, twilio_api_v2010
//
// The pipeline mirrors ir-golden.test.ts / own-engine-parity.test.ts EXACTLY.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readdir } from "node:fs/promises";
import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPIV3 } from "openapi-types";
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

/**
 * Frozen expected operation (tool) counts per real spec — the exact numbers the
 * own engine matched the (now-removed) upstream engine on when cross-engine
 * parity was proven (MCPFO-104, §90/§91). A drift here is a real regression.
 */
const EXPECTED_TOOL_COUNTS: Record<string, number> = {
  "stripe.json": 594,
  "github.json": 1239,
  "digitalocean.json": 684,
  "kubernetes.json": 1202,
  "openai.json": 346,
  "twilio_api_v2010.json": 197,
};

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

/**
 * Build ToolIR[] for one spec through the shared pipeline on klaridian's OWN
 * engine. Byte-identical to ir-golden.test.ts's `buildToolIRForSpec` — the same
 * Swagger2 pre-conversion, meta recovery, outputSchema extraction,
 * prepareSpecForEngine, adapter seam, and deterministic sort.
 */
async function buildToolIRForSpec(specFilePath: string): Promise<ToolIR[]> {
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

  // (5) The OWN engine + (6) the single adapter seam.
  const rawTools = await getToolsFromOwnEngine(specPath, { dereference: true });
  const tools: ToolIR[] = rawTools.map((t) =>
    mapMcpToolDefinitionToIR(t, metaByOperationId.get(t.operationId) as OperationMeta | undefined)
  );

  // Deterministic ordering — the engine's order is not a stable contract.
  tools.sort((a, b) =>
    a.operationId.localeCompare(b.operationId) || a.name.localeCompare(b.name)
  );
  return tools;
}

/** Assert one ToolIR is structurally valid (the shape every emitter consumes). */
function assertValidToolIR(t: ToolIR, specFile: string, i: number): void {
  const where = `${specFile}[${i}] name="${t?.name}"`;
  assert.equal(typeof t.name, "string", `${where}: name is a string`);
  assert.ok(t.name.length > 0, `${where}: name is non-empty`);
  assert.ok(t.name.length <= 64, `${where}: name within the 64-char MCP limit`);
  assert.equal(typeof t.operationId, "string", `${where}: operationId is a string`);
  assert.ok(t.operationId.length > 0, `${where}: operationId is non-empty`);
  assert.equal(typeof t.description, "string", `${where}: description is a string`);
  assert.equal(typeof t.method, "string", `${where}: method is a string`);
  assert.equal(typeof t.pathTemplate, "string", `${where}: pathTemplate is a string`);
  assert.ok(t.pathTemplate.startsWith("/"), `${where}: pathTemplate looks like a path`);
  assert.ok(
    t.inputSchema !== undefined && t.inputSchema !== null,
    `${where}: inputSchema present`
  );
  assert.ok(Array.isArray(t.executionParameters), `${where}: executionParameters is an array`);
  for (const p of t.executionParameters) {
    assert.equal(typeof p.name, "string", `${where}: exec param name is a string`);
    assert.equal(typeof p.in, "string", `${where}: exec param 'in' is a string`);
  }
  assert.ok(Array.isArray(t.securityRequirements), `${where}: securityRequirements is an array`);
}

async function realSpecFiles(): Promise<string[]> {
  const entries = await readdir(REAL_SPECS_DIR);
  return entries.filter((f) => f.endsWith(".json")).sort();
}

// One test per real spec: assert the OWN engine yields the exact frozen
// operation count, every tool is a valid ToolIR, tool names are unique, and the
// full pipeline is deterministic (a second independent build is byte-equal).
// Generous timeout: a 1239-op build twice is heavy but fine for node:test.
for (const specFile of await realSpecFiles()) {
  const specPath = path.join(REAL_SPECS_DIR, specFile);
  const expectedCount = EXPECTED_TOOL_COUNTS[specFile];

  test(
    `own-engine real-spec regression: ${specFile} — exact tool count + valid, deterministic ToolIR`,
    { timeout: 120_000 },
    async () => {
      assert.ok(
        expectedCount !== undefined,
        `No frozen expected tool count for real-spec fixture "${specFile}". ` +
          `Add it to EXPECTED_TOOL_COUNTS (MCPFO-74 / §92) so the fixture has a regression assertion.`
      );

      const [first, second] = await Promise.all([
        buildToolIRForSpec(specPath),
        buildToolIRForSpec(specPath),
      ]);

      // (1) Exact operation count — the frozen parity number.
      assert.equal(
        first.length,
        expectedCount,
        `OWN-engine tool count for ${specFile} = ${first.length}, expected ${expectedCount} ` +
          `(frozen at the count the own engine matched the upstream engine on, MCPFO-104/§92). ` +
          `A change is a real regression in getToolsFromOwnEngine or the pipeline.`
      );

      // (2) Every tool is a structurally valid ToolIR + names are unique.
      const names = new Set<string>();
      for (let i = 0; i < first.length; i++) {
        assertValidToolIR(first[i], specFile, i);
        assert.ok(!names.has(first[i].name), `${specFile}: duplicate tool name "${first[i].name}"`);
        names.add(first[i].name);
      }

      // (3) Determinism — a second independent build is byte-for-byte identical.
      assert.equal(second.length, first.length, `${specFile}: build is non-deterministic (count)`);
      for (let i = 0; i < first.length; i++) {
        assert.equal(
          canonicalizeTool(second[i]),
          canonicalizeTool(first[i]),
          `${specFile}: build is non-deterministic at tool index ${i} ("${first[i].name}")`
        );
      }
    }
  );
}
