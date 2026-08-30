// packages/cli/test/otel-plugin.test.ts
//
// End-to-end validation of the OTel plugin: generate a server WITH the otel
// plugin enabled, install/build/run it, and confirm the critical invariant
// from spike/FINDINGS.md still holds — stdout carries ONLY valid JSON-RPC,
// even with OTel instrumentation active and no collector available to
// receive spans (export fails silently in the background, exactly like the
// spike's manual test).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseOpenApiSpec } from "../src/openapi/parse.js";
import { mapOpenApiToTools } from "../src/openapi/map-tools.js";
import { renderProject } from "../src/render/render-project.js";
import { resolvePluginConfig } from "../src/plugins/plugin.interface.js";
import { otelPlugin } from "../src/plugins/otel/otel.plugin.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

function sendJsonRpc(proc: ReturnType<typeof spawn>, msg: unknown) {
  proc.stdin!.write(JSON.stringify(msg) + "\n");
}

test(
  "generated server with otel plugin: stdout stays clean JSON-RPC, spans don't corrupt the stream",
  { timeout: 120_000 },
  async () => {
    const spec = await parseOpenApiSpec(PETSTORE_SPEC_PATH);
    const mapping = mapOpenApiToTools(spec);
    assert.equal(mapping.errors.length, 0);

    const outputDir = await mkdtemp(path.join(tmpdir(), "mcpforge-otel-test-"));

    try {
      const pluginConfig = resolvePluginConfig(otelPlugin, {
        serviceName: "test-otel-petstore-server",
        // Deliberately no collector running at this endpoint — exercises
        // the "export fails silently, stdout stays clean" path validated
        // by hand in the spike.
        otlpEndpoint: "http://localhost:4318/v1/traces",
      });

      await renderProject(mapping, {
        outputDir,
        serverName: "test-otel-petstore-server",
        plugin: otelPlugin,
        pluginConfig,
      });

      await execFileAsync("npm", ["install"], { cwd: outputDir, timeout: 90_000 });

      const buildResult = await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 60_000 });
      assert.equal(buildResult.stderr.trim(), "", `Unexpected build stderr: ${buildResult.stderr}`);

      const proc = spawn("node", ["dist/index.js"], {
        cwd: outputDir,
        env: { ...process.env, MCPFORGE_BASE_URL: "https://petstore3.swagger.io/api/v3" },
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
              params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "otel-test", version: "0.0.1" } },
            }),
          300
        );
        setTimeout(
          () =>
            sendJsonRpc(proc, {
              jsonrpc: "2.0",
              id: 2,
              method: "tools/call",
              params: { name: "getPetById", arguments: { petId: 10 } },
            }),
          1000
        );

        setTimeout(() => {
          clearTimeout(timeout);
          proc.kill("SIGTERM"); // exercises the plugin's SIGTERM shutdown handler
          resolve();
        }, 4000);
      });

      // Give the SIGTERM handler a moment to run sdk.shutdown() and exit.
      await new Promise((r) => setTimeout(r, 500));

      const lines = stdoutBuf.trim().split("\n").filter(Boolean);
      assert.equal(lines.length, 2, `Expected exactly 2 JSON-RPC response lines, got ${lines.length}: ${stdoutBuf}`);

      // The critical invariant: every stdout line must be valid JSON, even
      // with OTel active and its OTLP export failing in the background.
      for (const [i, line] of lines.entries()) {
        assert.doesNotThrow(() => JSON.parse(line), `stdout line ${i} is not valid JSON: ${line.slice(0, 200)}`);
      }

      const parsed = lines.map((l) => JSON.parse(l));
      const callResponse = parsed.find((r) => r.id === 2);
      assert.ok(callResponse.result, `getPetById call should succeed: ${JSON.stringify(callResponse)}`);
      const petData = JSON.parse(callResponse.result.content[0].text);
      assert.equal(petData.id, 10);

      // Sanity: the generated source actually references the otel wiring —
      // confirms the plugin path was exercised, not silently skipped.
      const generatedIndexSrc = await import("node:fs/promises").then((fs) =>
        fs.readFile(path.join(outputDir, "src", "index.ts"), "utf-8")
      );
      assert.match(generatedIndexSrc, /wrapTool/);
      assert.match(generatedIndexSrc, /instrumentation\/otel\.js/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);
