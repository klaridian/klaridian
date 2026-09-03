// packages/cli/test/transport.test.ts
//
// End-to-end validation of `--transport` (ARCHITECTURE.md section 29 — v0's
// stdio-only guardrail lifted, since openapi-mcp-generator natively supports
// streamable-http and web transports and klaridian's own conformance/plugin
// patches operate on the same shared CallToolRequestSchema handler
// regardless of transport). Covers: flag validation, correct pass-through to
// openapi-mcp-generator, and that the conformance fixes (section 28) still
// land correctly in the generated source for non-stdio transports.
//
// Deliberately does NOT attempt a real spawned-server HTTP round-trip test
// for streamable-http/web the way generate.test.ts does for stdio — see
// ARCHITECTURE.md section 29's "Known upstream limitation" for why: a real,
// reproducible crash exists in openapi-mcp-generator's own generated
// src/streamable-http.ts (a `fetch-to-node` incompatibility, unrelated to
// any klaridian code) on the second HTTP request to a session. Confirmed
// directly against an unpatched vanilla-generated project, so it is not a
// regression this project introduced — but it means "spawn and drive over
// real HTTP" isn't a reliable test today for this path. What CAN be, and is,
// validated for real: successful generation, correct build, and correct
// conformance-patch presence in the generated source.

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
  "generate --transport streamable-http: generates a buildable server with conformance fixes applied",
  { timeout: 120_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-transport-http-"));
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
      assert.match(result.stderr, /Applied MCP spec conformance fixes/);
      assert.match(result.stderr, /npm run start:http/);

      // The StreamableHTTP-specific file must exist.
      const streamableHttpSource = await readFile(path.join(outputDir, "src", "streamable-http.ts"), "utf-8");
      assert.match(streamableHttpSource, /StreamableHTTPServerTransport/);

      // The shared tool-call handler (src/index.ts) must still carry the
      // conformance fixes from section 28 — same handler, same patch,
      // regardless of transport.
      const serverSource = await readFile(path.join(outputDir, "src", "index.ts"), "utf-8");
      assert.match(serverSource, /throw new McpError\(ErrorCode\.InvalidParams, `Unknown tool: \$\{toolName\}`\)/);
      assert.match(serverSource, /isError: true/);

      const packageJson = JSON.parse(await readFile(path.join(outputDir, "package.json"), "utf-8"));
      assert.ok(packageJson.scripts["start:http"], "expected a start:http script for the streamable-http transport");

      await execFileAsync("npm", ["install"], { cwd: outputDir, timeout: 90_000 });
      const buildResult = await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 60_000 });
      assert.doesNotMatch(buildResult.stderr, /error TS/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate --transport web: generates a buildable server with conformance fixes applied",
  { timeout: 120_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-transport-web-"));
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
        "test-transport-web",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--transport",
        "web",
        "--port",
        "3988",
        "--license",
        "none",
      ]);
      assert.match(result.stderr, /\[web, port 3988\]/);
      assert.match(result.stderr, /npm run start:web/);

      const webServerSource = await readFile(path.join(outputDir, "src", "web-server.ts"), "utf-8");
      assert.ok(webServerSource.length > 0);

      const serverSource = await readFile(path.join(outputDir, "src", "index.ts"), "utf-8");
      assert.match(serverSource, /isError: true/);

      const packageJson = JSON.parse(await readFile(path.join(outputDir, "package.json"), "utf-8"));
      assert.ok(packageJson.scripts["start:web"], "expected a start:web script for the web transport");

      await execFileAsync("npm", ["install"], { cwd: outputDir, timeout: 90_000 });
      const buildResult = await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 60_000 });
      assert.doesNotMatch(buildResult.stderr, /error TS/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test("generate --transport <unknown>: fails loudly before generating anything", { timeout: 30_000 }, async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-transport-bad-"));
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
        "--engine",
        "v1",
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
