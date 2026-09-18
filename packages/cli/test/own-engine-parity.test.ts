// packages/cli/test/own-engine-parity.test.ts
//
// MCPFO-73 — IR ownership Phase 2: SHADOW-MODE parity proof.
//
// The whole point of Phase 2. This runs klaridian's OWN spec→tool-DATA engine
// (`getToolsFromOwnEngine`, src/engine/own-engine.ts) over the SAME Phase-1
// corpus fixtures (test/fixtures/ir-corpus/*.json) through the SAME adapter +
// meta-recovery pipeline, and asserts the resulting ToolIR[] deep-equals the
// SAME committed *.golden.json snapshots that the UPSTREAM
// `openapi-mcp-generator` engine produces (frozen by ir-golden.test.ts,
// MCPFO-72).
//
// If this passes for a corpus spec, klaridian's own engine is byte-for-byte at
// parity with the vendor engine for that spec — the prerequisite for the Phase 3
// cutover (MCPFO-74). This test does NOT change the default path: it only
// exercises the shadow engine directly.
//
// The pipeline mirrors ir-golden.test.ts's `buildToolIRForSpec` EXACTLY, with
// ONE substitution: `getToolsFromOwnEngine` replaces `getToolsFromOpenApi`.
// Everything else (Swagger2 pre-conversion, meta recovery, outputSchema
// extraction, prepareSpecForEngine, the adapter, deterministic sort + canonical
// serialization) is identical, so a diff here is a parity bug in the OWN engine,
// never a fixture/serialization artifact.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPIV3 } from "openapi-types";
import {
  mapMcpToolDefinitionToIR,
  extractOperationMetaByOperationId,
  prepareSpecForEngine,
  type ToolIR,
} from "../src/emit/ir.js";
import { extractOutputSchemasByOperationId } from "../src/emit/response-schema.js";
import { isSwagger2Document, convertSwagger2ToOpenApi3 } from "../src/spec/swagger2-conversion.js";
import { writeTempSpec } from "../src/commands/generate-helpers.js";
import { getToolsFromOwnEngine } from "../src/engine/own-engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Same committed corpus + goldens the upstream engine is frozen against.
const CORPUS_DIR = path.resolve(__dirname, "../../test/fixtures/ir-corpus");

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

/** Canonical, deterministic JSON — identical to ir-golden.test.ts. */
function canonicalize(tools: ToolIR[]): string {
  return JSON.stringify(sortKeysDeep(tools), null, 2) + "\n";
}

/**
 * Build ToolIR[] for one spec using klaridian's OWN engine. Byte-identical to
 * ir-golden.test.ts's `buildToolIRForSpec` EXCEPT the engine call — proving the
 * own engine is a drop-in for `getToolsFromOpenApi` at the adapter seam.
 */
async function buildToolIRWithOwnEngine(specFilePath: string): Promise<ToolIR[]> {
  let specPath = specFilePath;

  // (1) Swagger 2.0 → OpenAPI 3.0 pre-conversion (delegated, unchanged).
  const rawParsed = await SwaggerParser.parse(specPath);
  if (isSwagger2Document(rawParsed)) {
    const converted = await convertSwagger2ToOpenApi3(rawParsed);
    const { specPath: convertedPath } = await writeTempSpec(
      converted,
      "klaridian-own-parity-converted-"
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
      "klaridian-own-parity-prepared-"
    );
    specPath = preparedPath;
  }

  // (5) THE OWN ENGINE (substituted for getToolsFromOpenApi) + (6) the adapter.
  const rawTools = await getToolsFromOwnEngine(specPath, { dereference: true });
  const tools: ToolIR[] = rawTools.map((t) =>
    mapMcpToolDefinitionToIR(t, metaByOperationId.get(t.operationId))
  );

  tools.sort((a, b) =>
    a.operationId.localeCompare(b.operationId) || a.name.localeCompare(b.name)
  );
  return tools;
}

async function corpusSpecFiles(): Promise<string[]> {
  const entries = await readdir(CORPUS_DIR);
  return entries.filter((f) => f.endsWith(".json") && !f.endsWith(".golden.json")).sort();
}

// One test per corpus spec — each runs the OWN engine and deep-equals the SAME
// committed golden the upstream engine produced. Full match expected on
// basic/refs/swagger2/annotations/dialect (documented in ARCHITECTURE.md §90).
for (const specFile of await corpusSpecFiles()) {
  const base = specFile.replace(/\.json$/, "");
  const specPath = path.join(CORPUS_DIR, specFile);
  const goldenPath = path.join(CORPUS_DIR, `${base}.golden.json`);

  test(`own-engine parity: ${specFile} deep-equals committed upstream golden`, async () => {
    const tools = await buildToolIRWithOwnEngine(specPath);
    const actual = canonicalize(tools);

    let expected: string;
    try {
      expected = await readFile(goldenPath, "utf-8");
    } catch {
      assert.fail(
        `Missing golden ${path.basename(goldenPath)} — run ir-golden.test.ts's UPDATE_GOLDENS=1 first.`
      );
    }

    if (actual !== expected) {
      const a = actual.split("\n");
      const e = expected.split("\n");
      const diff: string[] = [];
      const max = Math.max(a.length, e.length);
      for (let i = 0; i < max; i++) {
        if (a[i] !== e[i]) {
          if (e[i] !== undefined) diff.push(`  golden[${i + 1}]: ${e[i]}`);
          if (a[i] !== undefined) diff.push(`  ownengine[${i + 1}]: ${a[i]}`);
        }
      }
      assert.fail(
        `OWN-engine ToolIR for ${specFile} does NOT match the committed upstream golden ` +
          `(${path.basename(goldenPath)}). This is a parity bug in getToolsFromOwnEngine — ` +
          `do NOT edit the golden (it is the upstream-produced contract).\n` +
          `First differing lines:\n${diff.slice(0, 40).join("\n")}`
      );
    }
  });
}
