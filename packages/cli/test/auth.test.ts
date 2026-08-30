// packages/cli/test/auth.test.ts
//
// End-to-end validation of authentication support (ARCHITECTURE.md section
// 16 — roadmap item #2, prioritized directly from the real Wavix case
// study). Generates a server from a spec requiring HTTP Bearer auth, spins
// up a tiny local mock API that asserts the Authorization header it
// receives, builds and runs the generated server, and drives a real tool
// call over stdio JSON-RPC to confirm the token actually reaches the
// upstream request.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mapOpenApiToTools } from "../src/openapi/map-tools.js";
import { renderProject } from "../src/render/render-project.js";
import type { ParsedSpec } from "../src/openapi/parse.js";

const execFileAsync = promisify(execFile);

function sendJsonRpc(proc: ReturnType<typeof spawn>, msg: unknown) {
  proc.stdin!.write(JSON.stringify(msg) + "\n");
}

function bearerAuthSpec(): ParsedSpec {
  return {
    openapi: "3.0.0",
    info: { title: "auth-fixture", version: "1.0.0" },
    servers: [{ url: "https://placeholder.invalid" }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
    paths: {
      "/whoami": {
        get: {
          operationId: "whoami",
          summary: "Get the authenticated caller",
          responses: { "200": { description: "ok" } },
        },
      },
    },
  } as unknown as ParsedSpec;
}

test(
  "generated server with http-bearer auth: sends Authorization header to the real upstream request",
  { timeout: 120_000 },
  async () => {
    const mapping = mapOpenApiToTools(bearerAuthSpec());
    assert.equal(mapping.errors.length, 0);
    assert.deepEqual(mapping.auth, { type: "http-bearer" });

    // --- tiny local mock API asserting the Authorization header ---
    let receivedAuthHeader: string | undefined;
    const mockServer = http.createServer((req, res) => {
      receivedAuthHeader = req.headers["authorization"];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ authenticated: true }));
    });
    await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
    const mockPort = (mockServer.address() as { port: number }).port;
    const mockBaseUrl = `http://127.0.0.1:${mockPort}`;

    const outputDir = await mkdtemp(path.join(tmpdir(), "mcpforge-auth-test-"));

    try {
      await renderProject(mapping, { outputDir, serverName: "test-auth-server" });

      // Verify the README documents MCPFORGE_AUTH_TOKEN, as designed.
      const readme = await import("node:fs/promises").then((fs) =>
        fs.readFile(path.join(outputDir, "README.md"), "utf-8")
      );
      assert.match(readme, /MCPFORGE_AUTH_TOKEN/);

      await execFileAsync("npm", ["install"], { cwd: outputDir, timeout: 90_000 });
      const buildResult = await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 60_000 });
      assert.equal(buildResult.stderr.trim(), "", `Unexpected build stderr: ${buildResult.stderr}`);

      // --- First: confirm the server refuses to start without the token ---
      const procNoToken = spawn("node", ["dist/index.js"], {
        cwd: outputDir,
        env: { ...process.env, MCPFORGE_BASE_URL: mockBaseUrl, MCPFORGE_AUTH_TOKEN: "" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const exitCode = await new Promise<number | null>((resolve) => {
        procNoToken.on("exit", (code) => resolve(code));
      });
      assert.notEqual(exitCode, 0, "server should refuse to start without MCPFORGE_AUTH_TOKEN");

      // --- Second: run with the token set, confirm it reaches the upstream request ---
      const proc = spawn("node", ["dist/index.js"], {
        cwd: outputDir,
        env: { ...process.env, MCPFORGE_BASE_URL: mockBaseUrl, MCPFORGE_AUTH_TOKEN: "test-secret-token-123" },
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
              params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "auth-test", version: "0.0.1" } },
            }),
          300
        );
        setTimeout(
          () => sendJsonRpc(proc, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "whoami", arguments: {} } }),
          1000
        );
        setTimeout(() => {
          clearTimeout(timeout);
          proc.kill();
          resolve();
        }, 3000);
      });

      const lines = stdoutBuf.trim().split("\n").filter(Boolean);
      const parsed = lines.map((l) => JSON.parse(l));
      const callResponse = parsed.find((r) => r.id === 2);
      assert.ok(callResponse?.result, `whoami call should succeed: ${JSON.stringify(callResponse)}`);

      // The critical assertion: the real HTTP request the generated server
      // made to our mock API actually carried the Bearer token.
      assert.equal(receivedAuthHeader, "Bearer test-secret-token-123");
    } finally {
      mockServer.close();
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);
