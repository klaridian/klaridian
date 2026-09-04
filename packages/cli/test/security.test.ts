// packages/cli/test/security.test.ts
//
// End-to-end validation of the security-hardening fixes (ARCHITECTURE.md
// section 30): tool annotations/title, rate limiting, and output
// sanitization. These were explicitly left as follow-ups in the section 28
// conformance audit ("real gaps, bigger scope than a textual patch") — this
// closes them for real, with the same discipline as conformance.test.ts:
// real CLI invocation, real npm install + tsc build, real spawned server
// driven over real stdio JSON-RPC.

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
        try {
          resolve(JSON.parse(buffer.slice(0, newlineIndex)));
        } catch (err) {
          reject(err);
        }
      }
    };
    proc.stdout!.on("data", onData);
  });
}

test(
  "generate: tool annotations/title derived from HTTP method, and output is sanitized",
  { timeout: 300_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-security-annotations-"));
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
        "test-security-annotations",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
      ]);
      assert.match(genResult.stderr, /Applied security hardening/);

      const serverSource = await readFile(path.join(outputDir, "src", "index.ts"), "utf-8");
      assert.match(serverSource, /title: humanizeToolName\(def\.name\)/);
      assert.match(serverSource, /annotations: annotationsForMethod\(def\.method\)/);

      const helpersSource = await readFile(path.join(outputDir, "src", "security-helpers.ts"), "utf-8");
      assert.match(helpersSource, /export function annotationsForMethod/);
      assert.match(helpersSource, /export function checkRateLimit/);
      assert.match(helpersSource, /export function sanitizeToolOutput/);

      await execFileAsync("npm", ["install"], { cwd: outputDir, timeout: 240_000 });
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

        sendJsonRpc(serverProcess, { jsonrpc: "2.0", id: 2, method: "tools/list" });
        const toolsResponse = await readOneJsonRpcLine(serverProcess);
        const tools = toolsResponse.result.tools as any[];
        assert.equal(tools.length, 19);

        const getPetById = tools.find((t) => t.name === "getPetById");
        assert.ok(getPetById, "expected getPetById tool to exist");
        assert.equal(getPetById.title, "Get Pet By Id");
        assert.equal(getPetById.annotations.readOnlyHint, true);
        assert.equal(getPetById.annotations.destructiveHint, false);

        const deletePet = tools.find((t) => t.name === "deletePet");
        assert.ok(deletePet, "expected deletePet tool to exist");
        assert.equal(deletePet.annotations.destructiveHint, true);
        assert.equal(deletePet.annotations.readOnlyHint, false);

        // Any real tool call (success or upstream failure) should carry the
        // untrusted-data framing marker in its text content.
        sendJsonRpc(serverProcess, {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "getPetById", arguments: { petId: 1 } },
        });
        const callResponse = await readOneJsonRpcLine(serverProcess);
        assert.match(callResponse.result.content[0].text, /UNTRUSTED EXTERNAL DATA/);
      } finally {
        serverProcess.kill();
      }
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate: rate limiting rejects calls beyond KLARIDIAN_RATE_LIMIT_PER_MINUTE with isError: true",
  { timeout: 300_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-security-ratelimit-"));
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
        "test-security-ratelimit",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
      ]);
      await execFileAsync("npm", ["install"], { cwd: outputDir, timeout: 240_000 });
      await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 60_000 });

      const serverProcess = spawn("node", ["build/index.js"], {
        cwd: outputDir,
        env: { ...process.env, KLARIDIAN_RATE_LIMIT_PER_MINUTE: "2" },
      });
      try {
        sendJsonRpc(serverProcess, {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
        });
        await readOneJsonRpcLine(serverProcess);
        sendJsonRpc(serverProcess, { jsonrpc: "2.0", method: "notifications/initialized" });

        const results: any[] = [];
        for (let i = 2; i <= 5; i++) {
          sendJsonRpc(serverProcess, {
            jsonrpc: "2.0",
            id: i,
            method: "tools/call",
            params: { name: "findPetsByStatus", arguments: { status: "available" } },
          });
          results.push(await readOneJsonRpcLine(serverProcess));
        }

        // First 2 calls consume the quota (their outcome depends on the
        // real upstream demo API, which is out of this test's control —
        // only that they are NOT rate-limited matters here).
        for (const r of results.slice(0, 2)) {
          assert.doesNotMatch(r.result.content[0].text, /Rate limit exceeded/);
        }
        // Calls 3 and 4 (the 3rd/4th call to this tool) must be rejected by
        // the rate limiter specifically, with isError: true.
        for (const r of results.slice(2)) {
          assert.equal(r.result.isError, true);
          assert.match(r.result.content[0].text, /Rate limit exceeded for tool 'findPetsByStatus'/);
        }
      } finally {
        serverProcess.kill();
      }
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate: KLARIDIAN_RATE_LIMIT_PER_MINUTE=0 disables rate limiting entirely",
  { timeout: 300_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-security-ratelimit-disabled-"));
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
        "test-security-ratelimit-disabled",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
      ]);
      await execFileAsync("npm", ["install"], { cwd: outputDir, timeout: 240_000 });
      await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 60_000 });

      const serverProcess = spawn("node", ["build/index.js"], {
        cwd: outputDir,
        env: { ...process.env, KLARIDIAN_RATE_LIMIT_PER_MINUTE: "0" },
      });
      try {
        sendJsonRpc(serverProcess, {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
        });
        await readOneJsonRpcLine(serverProcess);
        sendJsonRpc(serverProcess, { jsonrpc: "2.0", method: "notifications/initialized" });

        for (let i = 2; i <= 6; i++) {
          sendJsonRpc(serverProcess, {
            jsonrpc: "2.0",
            id: i,
            method: "tools/call",
            params: { name: "findPetsByStatus", arguments: { status: "available" } },
          });
          const r = await readOneJsonRpcLine(serverProcess);
          assert.doesNotMatch(r.result.content[0].text, /Rate limit exceeded/);
        }
      } finally {
        serverProcess.kill();
      }
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);
