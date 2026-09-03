// packages/cli/test/canary-generator-shape.test.ts
//
// Canary test (ARCHITECTURE.md section 18 item 3): klaridian's instrumentation
// patch (render/instrument.ts) depends on the EXACT textual shape of
// openapi-mcp-generator's generated server code — a call site
// (`executeApiTool(...)`) and an import marker (the zod import line). That
// shape isn't a contract openapi-mcp-generator promises to keep stable
// across versions.
//
// This test exists to catch drift EARLY and LOUDLY: if a future
// openapi-mcp-generator upgrade changes either string, this test fails with
// a clear, actionable message pointing at render/instrument.ts — instead of
// the failure only showing up as a cryptic InstrumentationPatchError deep in
// generate.test.ts's E2E run, or (worse) instrument.ts's own guard somehow
// not tripping and silently producing an uninstrumented server.
//
// Deliberately generates from the pinned version's real output (not a
// hand-written fixture string) so it fails the moment `npm install` picks up
// a version where the shape actually changed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { generateMcpServer } from "openapi-mcp-generator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");
// Resolved at runtime (not via a static import assertion) so this works
// regardless of npm/workspace hoisting layout — walks from the compiled
// test file's real location (dist/test/) up to the repo root's
// node_modules, same distance PETSTORE_SPEC_PATH above already assumes.
const OPENAPI_MCP_GENERATOR_PKG_PATH = path.resolve(__dirname, "../../../../node_modules/openapi-mcp-generator/package.json");

// Keep this in sync with package.json's pinned openapi-mcp-generator
// version. Pinning (not `^4.0.1`) is intentional — see ARCHITECTURE.md
// section 18 item 3: silent minor/patch bumps could change the generated
// shape without anyone noticing until this canary (or worse, production)
// catches it.
const EXPECTED_PINNED_VERSION = "4.0.1";

test("canary: openapi-mcp-generator version is pinned as expected", async () => {
  const pkg = JSON.parse(await readFile(OPENAPI_MCP_GENERATOR_PKG_PATH, "utf-8"));
  assert.equal(
    pkg.version,
    EXPECTED_PINNED_VERSION,
    `openapi-mcp-generator resolved to ${pkg.version}, but klaridian expects it pinned to ${EXPECTED_PINNED_VERSION}. ` +
      `If this is an intentional upgrade: re-run this whole canary test, review its failures (if any), verify ` +
      `render/instrument.ts's CALL_SITE and importInsertionMarker still match the new generated shape by hand, ` +
      `then update EXPECTED_PINNED_VERSION here and the version in package.json together.`
  );
});

test(
  "canary: generated server source still contains the exact strings instrument.ts depends on",
  { timeout: 60_000 },
  async () => {
    const pkg = JSON.parse(await readFile(OPENAPI_MCP_GENERATOR_PKG_PATH, "utf-8"));
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-canary-"));
    try {
      await generateMcpServer({
        input: PETSTORE_SPEC_PATH,
        output: outputDir,
        serverName: "canary-test",
        baseUrl: "https://petstore3.swagger.io/api/v3",
        transport: "stdio",
        force: true,
      });

      const serverSource = await readFile(path.join(outputDir, "src", "index.ts"), "utf-8");

      // Mirrors render/instrument.ts's CALL_SITE constant exactly. If this
      // assertion fails, that constant needs updating to match the new
      // generated code before instrument.ts will work again.
      const CALL_SITE = "return await executeApiTool(toolName, toolDefinition, toolArgs ?? {}, securitySchemes);";
      assert.ok(
        serverSource.includes(CALL_SITE),
        `Expected exact call site not found in openapi-mcp-generator@${pkg.version}'s generated output. ` +
          `render/instrument.ts's CALL_SITE constant needs to be updated to match the new generated shape. ` +
          `Generated source (first 3000 chars) for inspection:\n${serverSource.slice(0, 3000)}`
      );

      // Mirrors render/instrument.ts's importInsertionMarker constant.
      const IMPORT_MARKER = "import { z, ZodError } from 'zod';";
      assert.ok(
        serverSource.includes(IMPORT_MARKER),
        `Expected zod import marker not found in openapi-mcp-generator@${pkg.version}'s generated output. ` +
          `render/instrument.ts's importInsertionMarker constant needs to be updated to match the new import ordering.`
      );
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);
