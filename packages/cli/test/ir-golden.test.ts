// packages/cli/test/ir-golden.test.ts
//
// MCPFO-72 — IR ownership Phase 1: freeze klaridian's ToolIR as a
// golden-tested contract.
//
// This is the safety net for the eventual openapi-mcp-generator swap
// (Phase 2/3, MCPFO-73/74): a small corpus of representative OpenAPI/Swagger
// specs (test/fixtures/ir-corpus/*.json), each with a committed golden
// ToolIR[] snapshot (*.golden.json). For every corpus spec this test runs the
// REAL current pipeline — the exact sequence commands/generate.ts uses:
//
//   SwaggerParser.parse
//     → (Swagger 2.0?) convertSwagger2ToOpenApi3
//     → extractOperationMetaByOperationId  (summary + x-klaridian)
//     → extractOutputSchemasByOperationId  (klaridian-owned response schema)
//     → prepareSpecForEngine               (expose:false → x-mcp:false, object x-mcp → bool)
//     → getToolsFromOwnEngine(..., { dereference: true })   (the engine)
//     → mapMcpToolDefinitionToIR(tool, meta)              (the single adapter seam)
//
// and deep-equals the produced ToolIR[] against the committed golden. Any
// drift in the engine's output OR klaridian's mapping/recovery breaks CI here.
//
// Determinism (critical — a flapping golden breaks every unrelated push):
//   - tools are sorted by operationId (then name) before snapshotting, since
//     the engine's ordering is not contractually stable across versions;
//   - snapshots are serialized with recursively sorted object keys and NO
//     absolute paths / timestamps, so the file is byte-stable across machines.
//
// Regenerate goldens after an INTENTIONAL contract change:
//   UPDATE_GOLDENS=1 node --test dist/test/ir-golden.test.js
// (then review the git diff — an unexpected diff here is drift, not a chore).

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile, writeFile, readdir } from "node:fs/promises";
import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPIV3 } from "openapi-types";
import { getToolsFromOwnEngine } from "../src/engine/own-engine.js";
import {
  mapMcpToolDefinitionToIR,
  extractOperationMetaByOperationId,
  prepareSpecForEngine,
  type ToolIR,
} from "../src/emit/ir.js";
import { extractOutputSchemasByOperationId } from "../src/emit/response-schema.js";
import { isSwagger2Document, convertSwagger2ToOpenApi3 } from "../src/spec/swagger2-conversion.js";
import { writeTempSpec } from "../src/commands/generate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Corpus + goldens live under the SOURCE test dir (not dist), so they are the
// committed fixtures — resolve back out of dist/test to packages/cli/test.
const CORPUS_DIR = path.resolve(__dirname, "../../test/fixtures/ir-corpus");

/** Recursively sort object keys so serialization is byte-stable across machines
 *  (arrays keep their order — element order is part of the contract). */
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

/** Canonical, deterministic JSON for a ToolIR[] snapshot. */
function canonicalize(tools: ToolIR[]): string {
  return JSON.stringify(sortKeysDeep(tools), null, 2) + "\n";
}

/**
 * Run the REAL generate.ts pipeline for one spec and return the resulting
 * ToolIR[], sorted deterministically. Mirrors commands/generate.ts exactly —
 * no shortcuts — so the golden captures today's true output.
 */
async function buildToolIRForSpec(specFilePath: string): Promise<ToolIR[]> {
  let specPath = specFilePath;

  // (1) Swagger 2.0 → OpenAPI 3.0 pre-conversion (same as generate.ts).
  const rawParsed = await SwaggerParser.parse(specPath);
  if (isSwagger2Document(rawParsed)) {
    const converted = await convertSwagger2ToOpenApi3(rawParsed);
    const { specPath: convertedPath } = await writeTempSpec(converted, "klaridian-golden-converted-");
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
    const { specPath: preparedPath } = await writeTempSpec(preparedDoc, "klaridian-golden-prepared-");
    specPath = preparedPath;
  }

  // (5) The engine + (6) the single adapter seam.
  const rawTools = await getToolsFromOwnEngine(specPath, { dereference: true });
  const tools: ToolIR[] = rawTools.map((t) =>
    mapMcpToolDefinitionToIR(t, metaByOperationId.get(t.operationId))
  );

  // Deterministic ordering — the engine's order is not a stable contract.
  tools.sort((a, b) =>
    a.operationId.localeCompare(b.operationId) || a.name.localeCompare(b.name)
  );
  return tools;
}

async function corpusSpecFiles(): Promise<string[]> {
  const entries = await readdir(CORPUS_DIR);
  return entries.filter((f) => f.endsWith(".json") && !f.endsWith(".golden.json")).sort();
}

const UPDATE = process.env.UPDATE_GOLDENS === "1";

// One test per corpus spec — each runs the real pipeline and deep-equals the
// committed golden. (Dynamically enumerated so adding a spec + its golden is
// zero test-wiring.)
for (const specFile of await corpusSpecFiles()) {
  const base = specFile.replace(/\.json$/, "");
  const specPath = path.join(CORPUS_DIR, specFile);
  const goldenPath = path.join(CORPUS_DIR, `${base}.golden.json`);

  test(`ir-golden: ${specFile} matches committed ToolIR golden`, async () => {
    const tools = await buildToolIRForSpec(specPath);
    const actual = canonicalize(tools);

    if (UPDATE) {
      await writeFile(goldenPath, actual, "utf-8");
      return;
    }

    let expected: string;
    try {
      expected = await readFile(goldenPath, "utf-8");
    } catch {
      assert.fail(
        `Missing golden ${path.basename(goldenPath)}. Generate it with: UPDATE_GOLDENS=1 node --test dist/test/ir-golden.test.js`
      );
    }

    if (actual !== expected) {
      // Readable line-level diff on failure (the whole point of the net).
      const a = actual.split("\n");
      const e = expected.split("\n");
      const diff: string[] = [];
      const max = Math.max(a.length, e.length);
      for (let i = 0; i < max; i++) {
        if (a[i] !== e[i]) {
          if (e[i] !== undefined) diff.push(`  golden[${i + 1}]: ${e[i]}`);
          if (a[i] !== undefined) diff.push(`  actual[${i + 1}]: ${a[i]}`);
        }
      }
      assert.fail(
        `ToolIR for ${specFile} drifted from its golden (${path.basename(goldenPath)}).\n` +
          `If this change is intentional, regenerate with UPDATE_GOLDENS=1 and review the diff.\n` +
          `First differing lines:\n${diff.slice(0, 40).join("\n")}`
      );
    }
  });
}
