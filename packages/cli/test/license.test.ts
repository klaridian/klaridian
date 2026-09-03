// packages/cli/test/license.test.ts
//
// End-to-end validation of `klaridian generate`'s LICENSE/package.json
// license-field generation (ARCHITECTURE.md section 27 — MCP servers are
// conventionally open source because they run with real credentials next
// to an autonomous agent; a generated server with no license at all is a
// visible, easily-fixed gap against that norm). Mirrors generate.test.ts's
// discipline of exercising the real CLI end to end rather than only unit
// tests of getLicenseText()/getPackageJsonLicenseField() in isolation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRYPOINT = path.resolve(__dirname, "../src/index.js");
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

test(
  "generate (default license): writes a LICENSE file and sets package.json's license to MIT with no --license flag",
  { timeout: 60_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-license-default-"));
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--engine",
        "v1",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-license-default",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--author",
        "Test Author",
      ]);
      assert.match(result.stderr, /Licensed as MIT/);

      const licenseText = await readFile(path.join(outputDir, "LICENSE"), "utf-8");
      assert.match(licenseText, /MIT License/);
      assert.match(licenseText, /Copyright \(c\) \d{4} Test Author/);

      const packageJson = JSON.parse(await readFile(path.join(outputDir, "package.json"), "utf-8"));
      assert.equal(packageJson.license, "MIT");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate --license apache-2.0: writes the Apache-2.0 LICENSE text and sets package.json accordingly",
  { timeout: 60_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-license-apache-"));
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--engine",
        "v1",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-license-apache",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "apache-2.0",
      ]);
      assert.match(result.stderr, /Licensed as Apache-2\.0/);

      const licenseText = await readFile(path.join(outputDir, "LICENSE"), "utf-8");
      assert.match(licenseText, /Apache License/);
      assert.match(licenseText, /Version 2\.0, January 2004/);

      const packageJson = JSON.parse(await readFile(path.join(outputDir, "package.json"), "utf-8"));
      assert.equal(packageJson.license, "Apache-2.0");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate --license none: writes no LICENSE file, warns on stderr, and leaves package.json without a license field",
  { timeout: 60_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-license-none-"));
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--engine",
        "v1",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-license-none",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
      ]);
      assert.match(result.stderr, /no LICENSE file written/);

      assert.equal(await fileExists(path.join(outputDir, "LICENSE")), false);

      const packageJson = JSON.parse(await readFile(path.join(outputDir, "package.json"), "utf-8"));
      assert.equal("license" in packageJson, false);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test("generate --license <unknown>: fails loudly before generating anything", { timeout: 30_000 }, async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-license-bad-"));
  try {
    let caught: unknown;
    try {
      await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--engine",
        "v1",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-license-bad",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "gpl-3.0",
      ]);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "expected the CLI to exit non-zero for an unknown --license value");
    const stderr = (caught as { stderr?: string }).stderr ?? "";
    assert.match(stderr, /Unknown license "gpl-3\.0"/);
    // Nothing should have been generated at all — fail fast, before touching openapi-mcp-generator.
    assert.equal(await fileExists(path.join(outputDir, "package.json")), false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
