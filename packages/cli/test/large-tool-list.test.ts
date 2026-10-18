// MCPFO-115: generated servers return every tool in one tools/list response
// (no pagination, ARCHITECTURE.md §108). Past the 128-tool cap that VS Code
// (GitHub Copilot) and OpenAI-backed agents enforce, `generate` warns and
// points at curation or code mode. The live "one page, no nextCursor"
// behavior is asserted in engine-v2.test.ts (TS) and emit-python-e2e.test.ts
// (Python); it was also checked by hand on the 1239-operation GitHub spec.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileAsync, CLI_ENTRYPOINT } from "./test-helpers.js";
import { resolveLargeToolListWarning, LARGE_TOOL_LIST_THRESHOLD } from "../src/emit/emit-server.js";

test("resolveLargeToolListWarning: silent up to the threshold, warns above it, never for code-mode", () => {
  assert.equal(LARGE_TOOL_LIST_THRESHOLD, 128);
  assert.equal(resolveLargeToolListWarning(128, "tools"), null);
  const w = resolveLargeToolListWarning(129, "tools");
  assert.ok(w, "warns at 129");
  assert.match(w!, /129 tools/);
  assert.match(w!, /--architecture code-mode/);
  assert.match(w!, /docs\/how-to\/curation/);
  assert.equal(resolveLargeToolListWarning(5000, "code-mode"), null, "code-mode exposes 2 tools whatever the API size");
});

function specWith(n: number) {
  const paths: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) {
    paths[`/r${i}`] = { get: { operationId: `op${i}`, responses: { "200": { description: "ok" } } } };
  }
  return { openapi: "3.0.3", info: { title: "big", version: "1.0.0" }, servers: [{ url: "https://example.test" }], paths };
}

test("generate --json: the large-tool-list warning appears above 128 tools and not at 128", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "klaridian-large-list-"));
  try {
    const run = async (n: number) => {
      const spec = path.join(work, `spec-${n}.json`);
      await writeFile(spec, JSON.stringify(specWith(n)));
      const { stdout } = await execFileAsync("node", [
        CLI_ENTRYPOINT, "generate", "--spec", spec, "--out", path.join(work, `out-${n}`),
        "--name", "big", "--license", "none", "--json",
      ]);
      return JSON.parse(stdout) as { toolCount: number; warnings: string[] };
    };
    const at = await run(128);
    assert.equal(at.toolCount, 128);
    assert.ok(!at.warnings.some((w) => /more than many clients accept/.test(w)), "no warning at exactly 128");
    const above = await run(129);
    assert.equal(above.toolCount, 129);
    assert.ok(above.warnings.some((w) => /129 tools is more than many clients accept/.test(w)), "warning in --json warnings[]");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
