// packages/cli/test/render-project.test.ts
//
// End-to-end test: parse the real Petstore spec, map it to tools, render a
// full project to a temp directory, npm install + build it, then actually
// spawn the generated server and drive it over stdio JSON-RPC — the same
// technique used to validate the hand-written spike server. This is the
// closest thing to "does the generator actually work" without a human
// running it manually.

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

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

function sendJsonRpc(proc: ReturnType<typeof spawn>, msg: unknown) {
  proc.stdin!.write(JSON.stringify(msg) + "\n");
}

test(
  "generated server: install, build, and drive over stdio JSON-RPC",
  { timeout: 120_000 },
  async () => {
    const spec = await parseOpenApiSpec(PETSTORE_SPEC_PATH);
    const mapping = mapOpenApiToTools(spec);
    assert.equal(mapping.errors.length, 0);

    const outputDir = await mkdtemp(path.join(tmpdir(), "mcpforge-render-test-"));

    try {
      await renderProject(mapping, {
        outputDir,
        serverName: "test-generated-petstore-server",
      });

      // --- npm install in the generated project ---
      await execFileAsync("npm", ["install"], { cwd: outputDir, timeout: 90_000 });

      // --- npm run build (tsc) ---
      const buildResult = await execFileAsync("npm", ["run", "build"], {
        cwd: outputDir,
        timeout: 60_000,
      });
      // tsc should produce no stderr output on a clean build.
      assert.equal(buildResult.stderr.trim(), "", `Unexpected build stderr: ${buildResult.stderr}`);

      // --- spawn the generated server and drive it over stdio ---
      const proc = spawn("node", ["dist/index.js"], {
        cwd: outputDir,
        env: { ...process.env, MCPFORGE_BASE_URL: "https://petstore3.swagger.io/api/v3" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdoutBuf = "";
      let stderrBuf = "";
      proc.stdout!.on("data", (d) => (stdoutBuf += d.toString()));
      proc.stderr!.on("data", (d) => (stderrBuf += d.toString()));

      const responses = await new Promise<string[]>((resolve, reject) => {
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
              params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "render-test", version: "0.0.1" },
              },
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
          proc.kill();
          resolve(stdoutBuf.trim().split("\n").filter(Boolean));
        }, 4000);
      });

      assert.equal(responses.length, 3, `Expected 3 JSON-RPC responses, got ${responses.length}: ${stdoutBuf}`);

      // Every stdout line must be valid, parseable JSON — the critical
      // invariant identified in the spike (spike/FINDINGS.md finding 1).
      const parsed = responses.map((line) => JSON.parse(line));

      const initResponse = parsed.find((r) => r.id === 1);
      assert.ok(initResponse?.result?.protocolVersion, "initialize should succeed");

      const listResponse = parsed.find((r) => r.id === 2);
      assert.equal(listResponse.result.tools.length, 19, "should list all 19 generated tools");
      const toolNames = listResponse.result.tools.map((t: any) => t.name);
      assert.ok(toolNames.includes("getPetById"));
      assert.ok(toolNames.includes("findPetsByStatus"));

      const callResponse = parsed.find((r) => r.id === 3);
      assert.ok(callResponse.result, `getPetById call should succeed, got: ${JSON.stringify(callResponse)}`);
      const petData = JSON.parse(callResponse.result.content[0].text);
      assert.equal(petData.id, 10);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);
