// packages/cli/test/ux.test.ts
//
// End-to-end validation of the CLI-UX audit fixes (ARCHITECTURE.md section
// 32): --force/overwrite protection, non-TTY detection for --interactive,
// --json machine-readable output, and --quiet. Same discipline as every
// other test file: real CLI invocation, real filesystem/stdout/stderr
// inspection — the whole point of these fixes is observable I/O behavior,
// so asserting on generated source text wouldn't actually validate them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { execFileAsync, CLI_ENTRYPOINT } from "./test-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

test(
  "generate: refuses to overwrite a non-empty --out without --force",
  { timeout: 60_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-ux-force-"));
    try {
      await writeFile(path.join(outputDir, "keep-me.txt"), "important", "utf-8");

      let caught: unknown;
      try {
        await execFileAsync("node", [
          CLI_ENTRYPOINT,
          "generate",
          "--spec",
          PETSTORE_SPEC_PATH,
          "--out",
          outputDir,
          "--license",
          "none",
        ]);
      } catch (err) {
        caught = err;
      }
      assert.ok(caught, "expected the CLI to refuse a non-empty --out without --force");
      const stderr = (caught as { stderr?: string }).stderr ?? "";
      assert.match(stderr, /already exists and is not empty/);
      assert.match(stderr, /Use --force/);

      // The pre-existing file must be untouched, and nothing else written.
      const entries = await import("node:fs/promises").then((fs) => fs.readdir(outputDir));
      assert.deepEqual(entries, ["keep-me.txt"]);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate --force: overwrites a non-empty --out, preserving unrelated files alongside the new output",
  { timeout: 60_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-ux-force-yes-"));
    try {
      await writeFile(path.join(outputDir, "keep-me.txt"), "important", "utf-8");

      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--license",
        "none",
        "--force",
      ]);
      assert.match(result.stderr, /Generated 19 tool\(s\)/);

      const entries = await import("node:fs/promises").then((fs) => fs.readdir(outputDir));
      assert.ok(entries.includes("keep-me.txt"), "pre-existing unrelated file should survive --force");
      assert.ok(entries.includes("package.json"), "generation should have proceeded");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate --out <path that is a file, not a directory>: fails loudly regardless of --force",
  { timeout: 30_000 },
  async () => {
    const parentDir = await mkdtemp(path.join(tmpdir(), "klaridian-ux-force-file-"));
    const filePath = path.join(parentDir, "not-a-directory");
    try {
      await writeFile(filePath, "I am a file", "utf-8");

      let caught: unknown;
      try {
        await execFileAsync("node", [
          CLI_ENTRYPOINT,
          "generate",
          "--spec",
          PETSTORE_SPEC_PATH,
          "--out",
          filePath,
          "--license",
          "none",
        ]);
      } catch (err) {
        caught = err;
      }
      assert.ok(caught);
      const stderr = (caught as { stderr?: string }).stderr ?? "";
      assert.match(stderr, /already exists and is not a directory/);
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate --interactive with a non-TTY stdin: fails loudly instead of silently proceeding",
  { timeout: 30_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-ux-interactive-notty-"));
    try {
      // spawn (not execFile) so we control stdin directly: piped stdin is
      // never a TTY, reproducing the exact scenario the audit found
      // (a script/CI/agent invoking --interactive with no real terminal).
      const proc = spawn("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--license",
        "none",
        "--interactive",
      ]);
      let stderr = "";
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf-8");
      });
      proc.stdin.end(); // empty piped stdin, definitely not a TTY

      const exitCode: number = await new Promise((resolve) => {
        proc.on("close", (code) => resolve(code ?? 1));
      });

      assert.equal(exitCode, 1, "expected a non-zero exit code");
      assert.match(stderr, /--interactive requires an interactive terminal/);
      assert.match(stderr, /stdin is not a TTY/);

      // Nothing should have been generated — this must fail before any
      // generation work starts, not partway through. outputDir itself
      // already exists (created by mkdtemp above), so check it's empty
      // rather than checking for non-existence.
      const entries = await import("node:fs/promises").then((fs) => fs.readdir(outputDir));
      assert.deepEqual(entries, [], "expected --out to remain empty — nothing should have been generated");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate --json: prints exactly one valid JSON object to stdout on success, with the expected fields",
  { timeout: 60_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-ux-json-ok-"));
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
        "--json",
      ]);

      // stdout must be exactly one parseable JSON value — no stray prose
      // mixed in, since a script piping into `jq` needs this guarantee.
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.success, true);
      assert.equal(parsed.toolCount, 19);
      assert.equal(parsed.transport, "stdio");
      assert.equal(parsed.license, null); // --license none
      assert.deepEqual(parsed.plugins, []);
      assert.match(parsed.nextSteps, /npm install/);
      assert.ok(Array.isArray(parsed.warnings));
      assert.match(parsed.warnings[0], /no LICENSE file written/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate --json on failure: prints exactly one valid JSON error object to stdout, tagged with a stage",
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
        "/tmp/does-not-matter",
        "--license",
        "bogus-license-id",
        "--json",
      ]);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "expected a non-zero exit code");
    const stdout = (caught as { stdout?: string }).stdout ?? "";
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.success, false);
    assert.equal(parsed.stage, "validate-license");
    assert.match(parsed.error, /Unknown license "bogus-license-id"/);
  }
);

test(
  "generate --json: a base-url warning surfaces in the JSON warnings array, not just stderr",
  { timeout: 60_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-ux-json-warn-"));
    const specPath = path.join(outputDir, "relspec.json");
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      specPath,
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "rel", version: "1.0.0" },
        servers: [{ url: "/api/v3" }],
        paths: { "/ping": { get: { operationId: "ping", responses: { "200": { description: "ok" } } } } },
      })
    );
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        specPath,
        "--out",
        path.join(outputDir, "gen"),
        "--license",
        "none",
        "--json",
      ]);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.success, true);
      assert.ok(parsed.warnings.some((w: string) => w.includes("Base URL is not absolute")));
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate --quiet: suppresses klaridian's own step-by-step lines but keeps warnings and the final Next: line",
  { timeout: 60_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-ux-quiet-"));
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--license",
        "none",
        "--quiet",
      ]);
      // Suppressed: klaridian's own "✅ ..." progress lines.
      assert.doesNotMatch(result.stderr, /✅ Generated \d+ tool/);
      // Kept: the license warning and the final "Next:" line — quiet
      // reduces noise, it doesn't hide the one line a human needs to act on
      // or a warning about something the user should know.
      assert.match(result.stderr, /no LICENSE file written/);
      assert.match(result.stderr, /Next: cd/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate --quiet: stderr is exactly the license warning + the Next: line, nothing else",
  { timeout: 60_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-ux-quiet-lines-"));
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
        "--quiet",
      ]);
      // Assert the total line count stays exactly at 2, not just that
      // specific substrings are absent (guards against any new noise source,
      // including third-party libraries the emitter calls).
      const nonEmptyLines = result.stderr.split("\n").filter((l) => l.trim().length > 0);
      assert.equal(nonEmptyLines.length, 2, `expected exactly 2 stderr lines under --quiet, got: ${JSON.stringify(nonEmptyLines)}`);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate --json: stderr is completely empty (no prose, no third-party noise)",
  { timeout: 60_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-ux-json-silent-"));
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--license",
        "none",
        "--json",
      ]);
      assert.equal(result.stderr, "", "expected --json to produce completely empty stderr");
      // stdout must still be exactly one parseable JSON value.
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.success, true);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate (no --quiet/--json): klaridian's own step lines ARE visible by default",
  { timeout: 60_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-ux-noquiet-"));
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--license",
        "none",
      ]);
      // Without --quiet/--json, the step-by-step progress lines are shown.
      assert.match(result.stderr, /✅ Generated 19 tool\(s\)/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);
