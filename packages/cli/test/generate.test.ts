// packages/cli/test/generate.test.ts
//
// End-to-end validation of the post-pivot pipeline (ARCHITECTURE.md
// section 16/18): mcpforge's `generate` command delegates OpenAPI parsing
// and server generation to openapi-mcp-generator, then instruments the
// result with mcpforge's own observability plugin layer
// (render/instrument.ts). These tests exercise the full CLI, not just
// individual functions — mirroring the level of rigor used for the
// pre-pivot pipeline (spike/FINDINGS.md, sections 12-13).

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRYPOINT = path.resolve(__dirname, "../src/index.js");
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

function sendJsonRpc(proc: ReturnType<typeof spawn>, msg: unknown) {
  proc.stdin!.write(JSON.stringify(msg) + "\n");
}

test(
  "generate (no plugin): produces a working, uninstrumented server via openapi-mcp-generator",
  { timeout: 120_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "mcpforge-gen-plain-"));
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-petstore-plain",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
      ]);
      assert.match(result.stderr, /Generated 19 tool\(s\)/);
      assert.doesNotMatch(result.stderr, /Instrumented/);

      const serverSource = await readFile(path.join(outputDir, "src", "index.ts"), "utf-8");
      assert.doesNotMatch(serverSource, /wrapTool/, "no plugin requested -> no instrumentation wiring");

      await execFileAsync("npm", ["install"], { cwd: outputDir, timeout: 90_000 });
      const buildResult = await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 60_000 });
      // openapi-mcp-generator's own build may print benign info to stderr
      // (e.g. TS version notices) — assert no actual compiler error markers
      // instead of requiring perfectly empty stderr.
      assert.doesNotMatch(buildResult.stderr, /error TS/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate --plugin otel: instruments the openapi-mcp-generator output, stdout stays clean JSON-RPC",
  { timeout: 120_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "mcpforge-gen-otel-"));
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-petstore-otel",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--plugin",
        "otel",
        "--plugin-config",
        "otel.serviceName=test-petstore-otel",
      ]);
      assert.match(result.stderr, /Generated 19 tool\(s\)/);
      assert.match(result.stderr, /Instrumented with the "otel" observability plugin/);

      const serverSource = await readFile(path.join(outputDir, "src", "index.ts"), "utf-8");
      assert.match(serverSource, /import \{ wrapTool \} from ".\/instrumentation\/otel\.js";/);
      assert.match(
        serverSource,
        /return await wrapTool\(toolName, \(\) => executeApiTool\(toolName, toolDefinition, toolArgs \?\? \{\}, securitySchemes\)\)\(\);/
      );

      const otelFileContent = await readFile(path.join(outputDir, "src", "instrumentation", "otel.ts"), "utf-8");
      assert.match(otelFileContent, /OTLPTraceExporter/);
      assert.doesNotMatch(otelFileContent, /new ConsoleSpanExporter/, "spike/FINDINGS.md finding: never ConsoleSpanExporter");

      const packageJson = JSON.parse(await readFile(path.join(outputDir, "package.json"), "utf-8"));
      assert.ok(packageJson.dependencies["@opentelemetry/sdk-node"]);

      await execFileAsync("npm", ["install"], { cwd: outputDir, timeout: 90_000 });
      const buildResult = await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 60_000 });
      assert.doesNotMatch(buildResult.stderr, /error TS/);

      // Drive the real compiled server over stdio JSON-RPC — the critical
      // invariant carried over from the pre-pivot pipeline (spike/FINDINGS.md):
      // stdout must stay valid JSON-RPC only, even with OTel active and no
      // collector available to receive the exported spans.
      const proc = spawn("node", ["build/index.js"], {
        cwd: outputDir,
        env: { ...process.env, API_BASE_URL: "https://petstore3.swagger.io/api/v3" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdoutBuf = "";
      let stderrBuf = "";
      proc.stdout!.on("data", (d) => (stdoutBuf += d.toString()));
      proc.stderr!.on("data", (d) => (stderrBuf += d.toString()));

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          proc.kill();
          reject(new Error(`Timed out. stderr so far: ${stderrBuf}`));
        }, 20_000);

        setTimeout(
          () =>
            sendJsonRpc(proc, {
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "gen-test", version: "0.0.1" } },
            }),
          300
        );
        setTimeout(() => sendJsonRpc(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), 800);
        setTimeout(
          () =>
            sendJsonRpc(proc, {
              jsonrpc: "2.0",
              id: 3,
              method: "tools/call",
              params: { name: "getPetById", arguments: { petId: 10 } },
            }),
          1300
        );
        setTimeout(() => {
          clearTimeout(timeout);
          proc.kill("SIGTERM"); // exercises the plugin's SIGTERM shutdown handler
          resolve();
        }, 4000);
      });

      await new Promise((r) => setTimeout(r, 500));

      const lines = stdoutBuf.trim().split("\n").filter(Boolean);
      assert.equal(lines.length, 3, `Expected 3 JSON-RPC response lines, got ${lines.length}: ${stdoutBuf}`);
      const parsed = lines.map((line, i) => {
        try {
          return JSON.parse(line);
        } catch {
          assert.fail(`stdout line ${i} is not valid JSON: ${line.slice(0, 200)}`);
        }
      });

      const listResponse = parsed.find((r) => r.id === 2);
      assert.equal(listResponse.result.tools.length, 19);

      const callResponse = parsed.find((r) => r.id === 3);
      assert.ok(callResponse.result, `getPetById call should succeed: ${JSON.stringify(callResponse)}`);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test("instrumentGeneratedServer throws InstrumentationPatchError if the call site isn't found", async () => {
  const { instrumentGeneratedServer, InstrumentationPatchError } = await import("../src/render/instrument.js");
  const { otelPlugin } = await import("../src/plugins/otel/otel.plugin.js");

  assert.throws(
    () => instrumentGeneratedServer("some unrelated source code", otelPlugin),
    InstrumentationPatchError,
    "should fail loudly rather than silently produce an uninstrumented server"
  );
});
