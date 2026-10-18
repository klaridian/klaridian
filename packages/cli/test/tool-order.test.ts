// MCPFO-92: tools/list order is deterministic and documented.
//
// MCP 2026-07-28 says servers SHOULD return tools in a deterministic order so
// clients (and the model's prompt cache) see the same list on every run. The
// order klaridian emits is: paths in the order the spec lists them, then, within
// a path, HTTP methods in the fixed order GET, PUT, POST, DELETE, OPTIONS, HEAD,
// PATCH, TRACE (own-engine.ts iterates OpenAPIV3.HttpMethods). Curation only
// removes tools, never reorders. This file pins that rule for both targets so an
// engine change can't silently reshuffle every generated server; the live
// tools/list order is asserted in engine-v2.test.ts (TS) and
// emit-python-e2e.test.ts (Python). The rule is documented in curation.mdx.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileAsync, CLI_ENTRYPOINT, expectedToolOrder } from "./test-helpers.js";


// Document order deliberately disagrees with both alphabetical order (/zeta
// before /alpha) and the method order (post before get, delete before get), so
// the test pins the actual rule rather than an accidental sort.
const SPEC = {
  openapi: "3.0.3",
  info: { title: "order", version: "1.0.0" },
  servers: [{ url: "https://example.test/api" }],
  paths: {
    "/zeta": {
      post: { operationId: "zetaCreate", responses: { "200": { description: "ok" } } },
      get: { operationId: "zetaList", responses: { "200": { description: "ok" } } },
    },
    "/alpha": {
      delete: { operationId: "alphaDelete", responses: { "200": { description: "ok" } } },
      patch: { operationId: "alphaPatch", responses: { "200": { description: "ok" } } },
      get: { operationId: "alphaGet", responses: { "200": { description: "ok" } } },
    },
  },
};

const ALL = ["zetaList", "zetaCreate", "alphaGet", "alphaDelete", "alphaPatch"];

/** Tool names in the order the emitted project registers them. */
async function emittedOrder(outDir: string, language: "typescript" | "python"): Promise<string[]> {
  if (language === "typescript") {
    const src = await readFile(path.join(outDir, "src", "server-factory.ts"), "utf-8");
    return [...src.matchAll(/registerTool\(\s*"([^"]+)"/g)].map((m) => m[1]);
  }
  const src = await readFile(path.join(outDir, "tools.py"), "utf-8");
  return [...src.matchAll(/^\s*"name": "([^"]+)",$/gm)].map((m) => m[1]);
}

for (const language of ["typescript", "python"] as const) {
  test(`tool order (${language}): spec path order, then fixed HTTP-method order; stable across runs; curation never reorders`, async () => {
    const work = await mkdtemp(path.join(tmpdir(), `klaridian-order-${language}-`));
    try {
      const specPath = path.join(work, "spec.json");
      await writeFile(specPath, JSON.stringify(SPEC));
      assert.deepEqual(expectedToolOrder(SPEC), ALL, "the helper encodes the documented rule");

      const gen = async (dir: string, extra: string[] = []) => {
        await execFileAsync("node", [
          CLI_ENTRYPOINT, "generate", "--spec", specPath, "--out", path.join(work, dir),
          "--name", "order", "--license", "none", "--language", language, ...extra,
        ]);
        return emittedOrder(path.join(work, dir), language);
      };

      const first = await gen("a");
      const second = await gen("b");
      assert.deepEqual(first, ALL, "emitted order follows the documented rule");
      assert.deepEqual(second, first, "two generations from the same spec give the same order");

      const curated = await gen("c", ["--exclude-methods", "delete"]);
      assert.deepEqual(curated, ALL.filter((n) => n !== "alphaDelete"), "curation removes, never reorders");
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
}
