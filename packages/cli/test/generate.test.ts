// packages/cli/test/generate.test.ts
//
// End-to-end validation of `klaridian generate` at the CLI level. The command
// extracts pure tool DATA from the spec via openapi-mcp-generator's
// getToolsFromOpenApi(), then emits a v2 (@modelcontextprotocol/server)
// project with klaridian's own emitter (MCPFO-21 cutover, ARCHITECTURE.md
// sections 38/49). These tests exercise the real binary — install + tsc build
// + spawn-and-drive over stdio JSON-RPC — mirroring the rigor used for the
// emitter module itself (emit-e2e.test.ts) and the pre-cutover pipeline
// (spikes/001-otel-mechanic/FINDINGS.md).

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { execFileAsync, CLI_ENTRYPOINT, sendJsonRpc } from "./test-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

test(
  "generate (no plugin): produces a working, uninstrumented v2 server that installs and builds",
  { timeout: 180_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-gen-plain-"));
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
        "--license",
        "none",
      ]);
      assert.match(result.stderr, /Generated 19 tool\(s\)/);
      assert.doesNotMatch(result.stderr, /\+ otel/);

      const serverSource = await readFile(path.join(outputDir, "src", "index.ts"), "utf-8");
      assert.doesNotMatch(serverSource, /wrapTool/, "no plugin requested -> no instrumentation wiring");
      assert.match(serverSource, /@modelcontextprotocol\/server/, "v2 SDK import");

      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outputDir, timeout: 120_000 });
      const buildResult = await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 120_000 });
      assert.doesNotMatch(buildResult.stderr, /error TS/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate --plugin otel: instruments the emitted v2 server, stdout stays clean JSON-RPC",
  { timeout: 180_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-gen-otel-"));
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
        "--license",
        "none",
        "--plugin",
        "otel",
        "--plugin-config",
        "otel.serviceName=test-petstore-otel",
      ]);
      assert.match(result.stderr, /Generated 19 tool\(s\)/);
      assert.match(result.stderr, /\+ otel/);

      const serverSource = await readFile(path.join(outputDir, "src", "index.ts"), "utf-8");
      assert.match(serverSource, /import \{ wrapTool \} from ".\/instrumentation\/otel\.js";/);
      // Every handler is wrapped via the plugin's wrap function at the
      // registerTool boundary (v2 native wiring — no textual patch).
      assert.match(serverSource, /wrapTool\(\s*"getPetById"\s*,\s*async \(args\)/);

      const otelFileContent = await readFile(path.join(outputDir, "src", "instrumentation", "otel.ts"), "utf-8");
      assert.match(otelFileContent, /OTLPTraceExporter/);
      assert.doesNotMatch(otelFileContent, /new ConsoleSpanExporter/, "spikes/001-otel-mechanic/FINDINGS.md finding: never ConsoleSpanExporter");

      const packageJson = JSON.parse(await readFile(path.join(outputDir, "package.json"), "utf-8"));
      assert.ok(packageJson.dependencies["@opentelemetry/sdk-node"]);

      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outputDir, timeout: 120_000 });
      const buildResult = await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 120_000 });
      assert.doesNotMatch(buildResult.stderr, /error TS/);

      // Drive the real compiled server over stdio JSON-RPC — the critical
      // invariant carried over from the pre-cutover pipeline
      // (spikes/001-otel-mechanic/FINDINGS.md): stdout must stay valid
      // JSON-RPC only, even with OTel active and no collector available to
      // receive the exported spans.
      const proc = spawn("node", ["dist/index.js"], {
        cwd: outputDir,
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
              params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "gen-test", version: "0.0.1" } },
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
      assert.ok(lines.length >= 2, `Expected JSON-RPC response lines, got ${lines.length}: ${stdoutBuf}`);
      const parsed = lines.map((line, i) => {
        try {
          return JSON.parse(line);
        } catch {
          assert.fail(`stdout line ${i} is not valid JSON: ${line.slice(0, 200)}`);
        }
      });

      const listResponse = parsed.find((r) => r.id === 2);
      assert.equal(listResponse.result.tools.length, 19);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test("generate: rejects more than one --plugin (the emitter supports at most one)", { timeout: 60_000 }, async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-gen-multi-"));
  try {
    await assert.rejects(
      execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-petstore-multi",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
        "--plugin",
        "amplitude",
        "--plugin",
        "mixpanel",
      ]),
      /at most one --plugin/
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("getPluginProjectAdditions throws InstrumentationPatchError on a file-path collision between plugins", async () => {
  const { getPluginProjectAdditions, InstrumentationPatchError } = await import("../src/render/instrument.js");
  const { otelPlugin } = await import("../src/plugins/otel/otel.plugin.js");

  const conflictingPlugin = {
    ...otelPlugin,
    id: "otel-clone",
    // Deliberately reuses otel's exact contributed file path to trigger
    // the collision guard — a real second plugin would never do this
    // (each plugin should namespace under its own id), but the guard
    // needs to actually fire if one ever did by mistake.
    getTemplateContributions: otelPlugin.getTemplateContributions,
  };

  assert.throws(
    () =>
      getPluginProjectAdditions(
        [otelPlugin, conflictingPlugin],
        new Map([
          ["otel", { otlpEndpoint: "http://localhost:4318/v1/traces", serviceName: "a" }],
          ["otel-clone", { otlpEndpoint: "http://localhost:4318/v1/traces", serviceName: "b" }],
        ])
      ),
    InstrumentationPatchError,
    "two plugins contributing the same file path should fail loudly, not silently overwrite"
  );
});
