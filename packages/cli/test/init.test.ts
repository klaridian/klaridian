// packages/cli/test/init.test.ts
//
// End-to-end validation of MCPFO-38: the `klaridian init` onboarding wizard
// (ARCHITECTURE.md section 53). Same real-compiled-binary discipline as
// config-file.test.ts / ux.test.ts — the whole feature is observable I/O
// (prompts, a written file, exit codes, and whether `generate` can then
// consume that file), which asserting on source text wouldn't validate.
//
// The load-bearing test is the last one: `init` writing a file that
// `generate --config` actually accepts, proving the two commands are wired
// together and not just that `init` emits syntactically valid JSON.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { execFileAsync, CLI_ENTRYPOINT } from "./test-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");
const CONFIG_FILE_NAME = "klaridian.config.json";

async function workspace(label: string) {
  const workDir = await mkdtemp(path.join(tmpdir(), `klaridian-init-${label}-`));
  return {
    workDir,
    configPath: path.join(workDir, CONFIG_FILE_NAME),
    cleanup: () => rm(workDir, { recursive: true, force: true }),
  };
}

test(
  "init: with every wizard field passed as a flag, writes the config with no prompts (non-TTY safe)",
  { timeout: 30_000 },
  async () => {
    const { workDir, configPath, cleanup } = await workspace("flags");
    try {
      const result = await execFileAsync(
        "node",
        [
          CLI_ENTRYPOINT,
          "init",
          "--spec",
          PETSTORE_SPEC_PATH,
          "--generate-out",
          "./petstore-server",
          "--plugin",
          "otel",
          "--license",
          "apache-2.0",
          "--transport",
          "streamable-http",
          "--json",
        ],
        { cwd: workDir }
      );

      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.success, true);
      // realpath may prefix /private on macOS; compare the trailing path.
      assert.ok(parsed.configPath.endsWith(`${path.sep}${CONFIG_FILE_NAME}`));

      const written = JSON.parse(await readFile(configPath, "utf-8"));
      // Keys match commander's camelCase attribute names on `generate`.
      assert.deepEqual(written, {
        spec: PETSTORE_SPEC_PATH,
        out: "./petstore-server",
        plugin: ["otel"],
        license: "apache-2.0",
        transport: "streamable-http",
      });
      assert.match(parsed.nextCommand, /^klaridian generate --spec .+ --out \.\/petstore-server$/);
    } finally {
      await cleanup();
    }
  }
);

test(
  "init: drives the interactive wizard over piped stdin and writes what was chosen",
  { timeout: 60_000 },
  async () => {
    const { workDir, configPath, cleanup } = await workspace("interactive");
    try {
      const proc = spawn("node", [CLI_ENTRYPOINT, "init"], {
        cwd: workDir,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      proc.stdout.on("data", (c) => (stdout += c.toString("utf-8")));
      proc.stderr.on("data", () => {});

      const closed: Promise<number> = new Promise((resolve) =>
        proc.on("close", (code) => resolve(code ?? 1))
      );
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      // One answer per prompt, in order: spec, generate-out, plugins
      // (submit none), license (accept default: mit), transport (accept
      // default: stdio). `@inquirer` forces readline terminal mode, so a
      // newline advances each prompt even though stdin is a pipe.
      await sleep(1500);
      proc.stdin.write(`${PETSTORE_SPEC_PATH}\n`);
      await sleep(700);
      proc.stdin.write("./generated\n");
      await sleep(700);
      proc.stdin.write("\n"); // checkbox: confirm with nothing selected
      await sleep(700);
      proc.stdin.write("\n"); // select license: default
      await sleep(700);
      proc.stdin.write("\n"); // select transport: default
      await sleep(700);
      proc.stdin.end();

      const exitCode = await closed;
      assert.equal(exitCode, 0, `expected a clean exit, stdout was: ${stdout}`);

      const written = JSON.parse(await readFile(configPath, "utf-8"));
      assert.deepEqual(written, {
        spec: PETSTORE_SPEC_PATH,
        out: "./generated",
        plugin: [],
        license: "mit",
        transport: "stdio",
      });
    } finally {
      await cleanup();
    }
  }
);

test(
  "init: refuses to overwrite an existing config file without --force",
  { timeout: 30_000 },
  async () => {
    const { workDir, configPath, cleanup } = await workspace("noforce");
    try {
      await writeFile(configPath, JSON.stringify({ license: "none" }), "utf-8");

      let caught: unknown;
      try {
        await execFileAsync(
          "node",
          [CLI_ENTRYPOINT, "init", "--spec", "x", "--generate-out", "y", "--json"],
          { cwd: workDir }
        );
      } catch (err) {
        caught = err;
      }
      assert.ok(caught, "expected a non-zero exit when the config file already exists");
      const parsed = JSON.parse((caught as { stdout?: string }).stdout ?? "");
      assert.equal(parsed.success, false);
      assert.equal(parsed.stage, "check-output");
      assert.match(parsed.error, /already exists/);

      // The existing file is untouched.
      assert.deepEqual(JSON.parse(await readFile(configPath, "utf-8")), { license: "none" });
    } finally {
      await cleanup();
    }
  }
);

test(
  "init: --force overwrites an existing config file",
  { timeout: 30_000 },
  async () => {
    const { workDir, configPath, cleanup } = await workspace("force");
    try {
      await writeFile(configPath, JSON.stringify({ license: "none" }), "utf-8");

      const result = await execFileAsync(
        "node",
        [
          CLI_ENTRYPOINT,
          "init",
          "--force",
          "--spec",
          "new-spec.yaml",
          "--generate-out",
          "./out",
          "--json",
        ],
        { cwd: workDir }
      );
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.success, true);

      const written = JSON.parse(await readFile(configPath, "utf-8"));
      assert.equal(written.spec, "new-spec.yaml");
      assert.equal(written.license, "mit");
    } finally {
      await cleanup();
    }
  }
);

test(
  "init -> generate: the config init writes is consumed by `generate --config` against a real spec",
  { timeout: 120_000 },
  async () => {
    const { workDir, configPath, cleanup } = await workspace("roundtrip");
    try {
      // 1. Scaffold the config non-interactively.
      const initResult = await execFileAsync(
        "node",
        [
          CLI_ENTRYPOINT,
          "init",
          "--spec",
          PETSTORE_SPEC_PATH,
          "--generate-out",
          "./server",
          "--license",
          "apache-2.0",
          "--transport",
          "streamable-http",
          "--json",
        ],
        { cwd: workDir }
      );
      assert.equal(JSON.parse(initResult.stdout).success, true);

      // 2. Feed it straight into `generate`. --spec/--out still go on the
      // command line (commander enforces them before the file loads), but
      // license + transport come from the file init just wrote.
      const outDir = path.join(workDir, "server");
      const genResult = await execFileAsync(
        "node",
        [
          CLI_ENTRYPOINT,
          "generate",
          "--config",
          configPath,
          "--spec",
          PETSTORE_SPEC_PATH,
          "--out",
          outDir,
          "--base-url",
          "https://petstore3.swagger.io/api/v3",
          "--json",
        ],
        { cwd: workDir }
      );
      const gen = JSON.parse(genResult.stdout);
      assert.equal(gen.success, true, `generate failed: ${genResult.stdout}`);
      assert.equal(gen.license, "Apache-2.0", "license came from the init-written config");
      assert.equal(gen.transport, "streamable-http", "transport came from the init-written config");

      // The generated project really exists.
      const pkg = JSON.parse(await readFile(path.join(outDir, "package.json"), "utf-8"));
      assert.equal(pkg.license, "Apache-2.0");
    } finally {
      await cleanup();
    }
  }
);
