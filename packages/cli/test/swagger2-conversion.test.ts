// packages/cli/test/swagger2-conversion.test.ts
//
// MCPFO-27 / ARCHITECTURE.md sections 35/36: real end-to-end validation that
// `klaridian generate` transparently converts a Swagger 2.0 input spec to
// OpenAPI 3.0 before generation, rather than silently producing tools with
// empty inputSchema.properties (the bug reproduced against the real Slack
// spec in section 35). Mirrors this project's existing rigor for
// generate.test.ts: the real binary, a real spec file, a real npm install +
// tsc build, and inspection of the actual generated tool schemas -- not a
// mocked conversion or a unit test of swagger2-conversion.ts in isolation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRYPOINT = path.resolve(__dirname, "../src/index.js");
const SWAGGER2_SPEC_PATH = path.resolve(__dirname, "../../../../examples/swagger2-fixture/swagger.json");

test(
  "generate --spec <swagger2.0>: auto-converts to OpenAPI 3.0 and emits tools with real, non-empty schemas",
  { timeout: 180_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-gen-swagger2-"));
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        SWAGGER2_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-swagger2-widgets",
        "--license",
        "none",
      ]);

      // The conversion step must be surfaced to the user, not silent
      // (AGENTS.md's "fail loudly, don't guess" extended to "don't silently
      // transform" for user-visible input handling).
      assert.match(result.stderr, /Detected Swagger 2\.0 spec.*converting to OpenAPI 3\.0/);
      assert.match(result.stderr, /Generated 3 tool\(s\)/);

      const serverSource = await readFile(path.join(outputDir, "src", "index.ts"), "utf-8");

      // The exact regression this fix targets: before the pre-conversion
      // step, every tool from a Swagger 2.0 spec would get an empty
      // inputSchema.properties (ARCHITECTURE.md section 35). Assert the real
      // parameters survived the OAS2 (flat `in: "query"`) -> OAS3
      // (`parameters[].schema`) reshape with correct types/enums intact.
      assert.match(
        serverSource,
        /"listWidgets"/,
        "listWidgets tool present"
      );
      assert.match(
        serverSource,
        /z\.array\(z\.enum\(\["active","archived"\]\)\)/,
        "array/enum query parameter converted with real schema, not dropped"
      );
      assert.match(
        serverSource,
        /"limit":\s*z\.number\(\)[^,]*\.optional\(\)/,
        "optional integer query parameter converted with real schema"
      );
      assert.match(
        serverSource,
        /"widgetId":\s*z\.string\(\)/,
        "path parameter converted with real schema"
      );
      assert.match(
        serverSource,
        /"name":\s*z\.string\(\)/,
        "required body property converted with real schema (not an opaque empty object)"
      );

      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outputDir, timeout: 120_000 });
      const buildResult = await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 120_000 });
      assert.doesNotMatch(buildResult.stderr, /error TS/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate --spec <openapi 3.x>: no Swagger 2.0 conversion message (regression guard, not a v3 spec)",
  { timeout: 180_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-gen-notswagger2-"));
    const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-petstore-not-swagger2",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
      ]);
      assert.doesNotMatch(result.stderr, /Detected Swagger 2\.0/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);
