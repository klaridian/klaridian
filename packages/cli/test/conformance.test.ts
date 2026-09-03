// packages/cli/test/conformance.test.ts
//
// End-to-end validation of the MCP spec conformance fixes (ARCHITECTURE.md
// section 28), found by directly auditing a real generated server against
// the MCP spec (2025-06-18). Mirrors generate.test.ts's discipline: real
// CLI invocation, real npm install + tsc build, real spawn-and-drive over
// stdio JSON-RPC — not unit tests of applyConformanceFixes() in isolation,
// since the whole point is confirming the generated, compiled, running
// server actually behaves per spec.

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

function readOneJsonRpcLine(proc: ReturnType<typeof spawn>): Promise<any> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex !== -1) {
        proc.stdout!.off("data", onData);
        const line = buffer.slice(0, newlineIndex);
        try {
          resolve(JSON.parse(line));
        } catch (err) {
          reject(err);
        }
      }
    };
    proc.stdout!.on("data", onData);
  });
}

test(
  "generate: fixes MCP spec conformance bugs — unknown tool is a protocol error, execution failures set isError: true",
  { timeout: 120_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-conformance-"));
    try {
      const genResult = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--engine",
        "v1",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-conformance",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
      ]);
      assert.match(genResult.stderr, /Applied MCP spec conformance fixes/);

      // Confirm the patch actually landed in source before even building.
      const serverSource = await readFile(path.join(outputDir, "src", "index.ts"), "utf-8");
      assert.match(serverSource, /throw new McpError\(ErrorCode\.InvalidParams, `Unknown tool: \$\{toolName\}`\)/);
      assert.match(serverSource, /isError: true/);
      assert.match(serverSource, /McpError,\s*\n\s*ErrorCode,/);

      await execFileAsync("npm", ["install"], { cwd: outputDir, timeout: 90_000 });
      const buildResult = await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 60_000 });
      assert.doesNotMatch(buildResult.stderr, /error TS/);

      const serverProcess = spawn("node", ["build/index.js"], { cwd: outputDir });
      try {
        sendJsonRpc(serverProcess, {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
        });
        await readOneJsonRpcLine(serverProcess);
        sendJsonRpc(serverProcess, { jsonrpc: "2.0", method: "notifications/initialized" });

        // Fix 1: unknown tool -> a real JSON-RPC protocol error, not a "successful" result.
        sendJsonRpc(serverProcess, {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "totally_unknown_tool", arguments: {} },
        });
        const unknownToolResponse = await readOneJsonRpcLine(serverProcess);
        assert.equal(unknownToolResponse.result, undefined, "unknown tool must NOT be a 'result' response");
        assert.ok(unknownToolResponse.error, "unknown tool must be a JSON-RPC 'error' response");
        assert.equal(unknownToolResponse.error.code, -32602, "must use ErrorCode.InvalidParams (-32602)");
        assert.match(unknownToolResponse.error.message, /Unknown tool/);

        // Fix 2: a validation failure (missing required arg) must set isError: true.
        sendJsonRpc(serverProcess, {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "getPetById", arguments: {} },
        });
        const missingArgResponse = await readOneJsonRpcLine(serverProcess);
        assert.equal(missingArgResponse.result.isError, true, "validation failure must set isError: true");
        assert.match(missingArgResponse.result.content[0].text, /Invalid arguments/);
      } finally {
        serverProcess.kill();
      }
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate --license none: no LICENSE side effects on conformance fix wiring (regression guard, orthogonal flags)",
  { timeout: 60_000 },
  async () => {
    // Not a conformance test per se — confirms the two ALWAYS-ON fixes
    // (conformance) and the OPT-OUT-able one (license) don't interfere
    // with each other's file-writing order in commands/generate.ts.
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-conformance-license-"));
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
        "test-conformance-license",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
      ]);
      assert.match(result.stderr, /Applied MCP spec conformance fixes/);
      assert.match(result.stderr, /Licensed as MIT/);
      const serverSource = await readFile(path.join(outputDir, "src", "index.ts"), "utf-8");
      assert.match(serverSource, /isError: true/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);
