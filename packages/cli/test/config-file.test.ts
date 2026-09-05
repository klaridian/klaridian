// packages/cli/test/config-file.test.ts
//
// End-to-end validation of MCPFO-37: the optional klaridian.config.json
// defaults layer for `klaridian generate` (ARCHITECTURE.md section 52).
// Same discipline as ux.test.ts — real compiled-binary invocation, real
// filesystem/stdout/stderr inspection — because the whole feature is about
// observable precedence behavior (explicit flag > config file > built-in
// default), which asserting on generated source text wouldn't validate.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileAsync, CLI_ENTRYPOINT } from "./test-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

/** Fresh working dir + output dir for one test; caller cleans both up. */
async function workspace(label: string) {
  const workDir = await mkdtemp(path.join(tmpdir(), `klaridian-cfg-${label}-`));
  return {
    workDir,
    outDir: path.join(workDir, "out"),
    cleanup: () => rm(workDir, { recursive: true, force: true }),
  };
}

test(
  "generate: an auto-discovered klaridian.config.json supplies defaults when no relevant flag is passed",
  { timeout: 60_000 },
  async () => {
    const { workDir, outDir, cleanup } = await workspace("auto");
    try {
      await writeFile(
        path.join(workDir, "klaridian.config.json"),
        JSON.stringify({ license: "apache-2.0", baseUrl: "https://petstore3.swagger.io/api/v3" })
      );

      const result = await execFileAsync(
        "node",
        [CLI_ENTRYPOINT, "generate", "--spec", PETSTORE_SPEC_PATH, "--out", outDir, "--json"],
        { cwd: workDir }
      );
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.success, true);
      // license came from the config file, not the hardcoded "mit" default.
      assert.equal(parsed.license, "Apache-2.0");
      // baseUrl came from the config file, so no relative-base-url warning.
      assert.ok(
        !parsed.warnings.some((w: string) => w.includes("Base URL is not absolute")),
        `expected no base-url warning, got: ${JSON.stringify(parsed.warnings)}`
      );
    } finally {
      await cleanup();
    }
  }
);

test(
  "generate: an explicit CLI flag always wins over the same key in the config file",
  { timeout: 60_000 },
  async () => {
    const { workDir, outDir, cleanup } = await workspace("precedence");
    try {
      await writeFile(
        path.join(workDir, "klaridian.config.json"),
        JSON.stringify({ license: "apache-2.0" })
      );

      const result = await execFileAsync(
        "node",
        [
          CLI_ENTRYPOINT,
          "generate",
          "--spec",
          PETSTORE_SPEC_PATH,
          "--out",
          outDir,
          "--base-url",
          "https://petstore3.swagger.io/api/v3",
          "--license",
          "mit",
          "--json",
        ],
        { cwd: workDir }
      );
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.success, true);
      // --license mit on the command line beats "apache-2.0" in the file.
      assert.equal(parsed.license, "MIT");
    } finally {
      await cleanup();
    }
  }
);

test(
  "generate --config <path>: an explicitly named file is used regardless of the current directory",
  { timeout: 60_000 },
  async () => {
    const { workDir, outDir, cleanup } = await workspace("explicit");
    try {
      const configPath = path.join(workDir, "custom-name.json");
      await writeFile(
        configPath,
        JSON.stringify({ transport: "streamable-http", port: 8081, docker: true })
      );

      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outDir,
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
        "--config",
        configPath,
        "--json",
      ]);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.success, true);
      assert.equal(parsed.transport, "streamable-http");
      assert.equal(parsed.port, 8081);
    } finally {
      await cleanup();
    }
  }
);

test(
  "generate --config <missing path>: fails loudly with a clear error and a non-zero exit",
  { timeout: 30_000 },
  async () => {
    let caught: unknown;
    try {
      await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        path.join(tmpdir(), "klaridian-cfg-never"),
        "--config",
        "/no/such/klaridian.config.json",
      ]);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "expected a non-zero exit for a missing --config path");
    const stderr = (caught as { stderr?: string }).stderr ?? "";
    assert.match(stderr, /Could not read config file/);
    assert.match(stderr, /\/no\/such\/klaridian\.config\.json/);
  }
);

test(
  "generate --config <malformed JSON>: fails loudly, tagged with the config-file stage in --json mode",
  { timeout: 30_000 },
  async () => {
    const { workDir, cleanup } = await workspace("malformed");
    try {
      const configPath = path.join(workDir, "broken.json");
      await writeFile(configPath, "{ not valid json ");

      let caught: unknown;
      try {
        await execFileAsync("node", [
          CLI_ENTRYPOINT,
          "generate",
          "--spec",
          PETSTORE_SPEC_PATH,
          "--out",
          path.join(workDir, "out"),
          "--config",
          configPath,
          "--json",
        ]);
      } catch (err) {
        caught = err;
      }
      assert.ok(caught, "expected a non-zero exit for malformed --config JSON");
      const parsed = JSON.parse((caught as { stdout?: string }).stdout ?? "");
      assert.equal(parsed.success, false);
      assert.equal(parsed.stage, "config-file");
      assert.match(parsed.error, /not valid JSON/);
    } finally {
      await cleanup();
    }
  }
);

test(
  "generate: an unknown key in the config file is a warning, not a failure",
  { timeout: 60_000 },
  async () => {
    const { workDir, outDir, cleanup } = await workspace("unknownkey");
    try {
      await writeFile(
        path.join(workDir, "klaridian.config.json"),
        JSON.stringify({
          license: "none",
          baseUrl: "https://petstore3.swagger.io/api/v3",
          frce: true,
        })
      );

      const result = await execFileAsync(
        "node",
        [CLI_ENTRYPOINT, "generate", "--spec", PETSTORE_SPEC_PATH, "--out", outDir, "--json"],
        { cwd: workDir }
      );
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.success, true, "generation still succeeds despite the unknown key");
      assert.ok(
        parsed.warnings.some((w: string) => /unknown key "frce"/.test(w)),
        `expected an unknown-key warning, got: ${JSON.stringify(parsed.warnings)}`
      );
    } finally {
      await cleanup();
    }
  }
);

test(
  "generate: no config file present anywhere leaves behavior unchanged (no config notice, defaults apply)",
  { timeout: 60_000 },
  async () => {
    const { workDir, outDir, cleanup } = await workspace("none");
    try {
      const result = await execFileAsync(
        "node",
        [
          CLI_ENTRYPOINT,
          "generate",
          "--spec",
          PETSTORE_SPEC_PATH,
          "--out",
          outDir,
          "--base-url",
          "https://petstore3.swagger.io/api/v3",
        ],
        { cwd: workDir }
      );
      assert.doesNotMatch(result.stderr, /config file/i, "no config file -> no config notice");
      // The hardcoded "mit" default still applies.
      assert.match(result.stderr, /Licensed as MIT/);
    } finally {
      await cleanup();
    }
  }
);
