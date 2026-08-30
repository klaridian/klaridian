// packages/cli/test/openapi-3.1.test.ts
//
// Validates mcpforge against OpenAPI 3.1 (roadmap item #3 from
// ARCHITECTURE.md section 9/14). Previously only exercised via the real
// Wavix spec (which happens to be 3.1) as an incidental side effect of the
// section 15/16 work — this adds an explicit, dedicated fixture so 3.1
// support is a deliberately tested property, not a coincidence.
//
// examples/openapi-3.1-fixture/openapi.json is a small hand-written 3.1
// spec exercising: the 3.1-only `type: [T, "null"]` nullable syntax (3.0
// used a separate `nullable: true` keyword instead), a required bearer
// auth scheme, path/body parameters, and array properties.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseOpenApiSpec } from "../src/openapi/parse.js";
import { mapOpenApiToTools } from "../src/openapi/map-tools.js";
import { renderProject } from "../src/render/render-project.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/openapi-3.1-fixture/openapi.json");

test("parses and maps a real OpenAPI 3.1 spec without errors", async () => {
  const spec = await parseOpenApiSpec(FIXTURE_SPEC_PATH);
  assert.equal((spec as { openapi: string }).openapi, "3.1.0");

  const result = mapOpenApiToTools(spec);
  assert.equal(result.errors.length, 0, `Unexpected errors: ${JSON.stringify(result.errors)}`);
  assert.equal(result.tools.length, 2);
  assert.deepEqual(result.auth, { type: "http-bearer" });
});

test("3.1-style `type: [T, \"null\"]` nullable syntax is preserved through mapping, not rejected", async () => {
  const spec = await parseOpenApiSpec(FIXTURE_SPEC_PATH);
  const result = mapOpenApiToTools(spec);

  const createWidget = result.tools.find((t) => t.name === "createWidget");
  assert.ok(createWidget, "createWidget tool should exist");

  const bodyParam = createWidget!.parameters.find((p) => p.name === "body");
  const nicknameSchema = bodyParam!.schema.properties?.nickname;
  assert.ok(nicknameSchema, "nickname property should be present");
  // The 3.1 array-form `type` is passed through as-is (not normalized to a
  // single string) — confirms parsing/mapping doesn't choke on it or
  // silently drop the "null" branch.
  assert.deepEqual(nicknameSchema!.type, ["string", "null"]);
});

test(
  "generates and compiles a real server from the 3.1 fixture end to end",
  { timeout: 90_000 },
  async () => {
    const spec = await parseOpenApiSpec(FIXTURE_SPEC_PATH);
    const mapping = mapOpenApiToTools(spec);
    assert.equal(mapping.errors.length, 0);

    const outputDir = await mkdtemp(path.join(tmpdir(), "mcpforge-31-test-"));
    try {
      await renderProject(mapping, { outputDir, serverName: "test-31-server" });
      await execFileAsync("npm", ["install"], { cwd: outputDir, timeout: 60_000 });
      const buildResult = await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 60_000 });
      assert.equal(buildResult.stderr.trim(), "", `Unexpected build stderr: ${buildResult.stderr}`);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);
