// packages/cli/test/transport.test.ts
//
// End-to-end validation of `--transport` (ARCHITECTURE.md section 29 — v0's
// stdio-only guardrail lifted). Since the MCPFO-21 cutover (section 49) the v2
// emitter is the only engine: `stdio` (default) and `streamable-http` are
// supported, `web` was v1-only and is gone. The v2 streamable-http server is
// stateless by construction, so the v1 2nd-request crash (MCPFO-10) does not
// apply — a real sequential-request HTTP round-trip is covered in
// emit-e2e.test.ts. This file covers CLI-level flag validation and that
// `--transport streamable-http` produces a buildable project.

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
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

test(
  "generate --transport streamable-http: generates a buildable stateless v2 server",
  { timeout: 120_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-transport-http-"));
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-transport-http",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--transport",
        "streamable-http",
        "--port",
        "3987",
        "--license",
        "none",
      ]);
      assert.match(result.stderr, /\[streamable-http, port 3987\]/);

      // The v2 emitter puts everything in src/index.ts — a stateless
      // createMcpHandler over a node http server, no per-session transport.
      const serverSource = await readFile(path.join(outputDir, "src", "index.ts"), "utf-8");
      assert.match(serverSource, /createMcpHandler/);
      assert.match(serverSource, /3987/, "port baked into the emitted server");

      const packageJson = JSON.parse(await readFile(path.join(outputDir, "package.json"), "utf-8"));
      assert.ok(packageJson.scripts["start"], "expected a start script");
      assert.ok(packageJson.dependencies["@modelcontextprotocol/node"], "node adapter dep for the HTTP transport");

      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outputDir, timeout: 60_000 });
      const buildResult = await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 60_000 });
      assert.doesNotMatch(buildResult.stderr, /error TS/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test("generate --transport web: rejected (web was v1-only, removed in the MCPFO-21 cutover)", { timeout: 30_000 }, async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-transport-web-"));
  try {
    let caught: unknown;
    try {
      await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-transport-web",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--transport",
        "web",
      ]);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "expected the CLI to reject --transport web");
    const stderr = (caught as { stderr?: string }).stderr ?? "";
    assert.match(stderr, /Unknown transport "web"/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("generate --transport <unknown>: fails loudly before generating anything", { timeout: 30_000 }, async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-transport-bad-"));
  try {
    let caught: unknown;
    try {
      await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-transport-bad",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--transport",
        "carrier-pigeon",
      ]);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "expected the CLI to exit non-zero for an unknown --transport value");
    const stderr = (caught as { stderr?: string }).stderr ?? "";
    assert.match(stderr, /Unknown transport "carrier-pigeon"/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("generate --transport streamable-http --port 0: rejects an invalid port", { timeout: 30_000 }, async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-transport-badport-"));
  try {
    let caught: unknown;
    try {
      await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-transport-badport",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--transport",
        "streamable-http",
        "--port",
        "0",
      ]);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "expected the CLI to exit non-zero for an invalid port");
    const stderr = (caught as { stderr?: string }).stderr ?? "";
    assert.match(stderr, /Invalid --port/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
