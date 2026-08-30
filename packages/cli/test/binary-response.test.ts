// packages/cli/test/binary-response.test.ts
//
// Validates binary/streaming response handling (ARCHITECTURE.md section 17,
// roadmap item #4). Generates a server for an operation whose only 2xx
// response content type is non-JSON (e.g. audio/mpeg), spins up a real
// local HTTP mock that returns both a redirect and a direct binary payload
// scenario, and confirms the generated tool returns a structured
// { downloadUrl, contentType, status } pointer rather than trying to inline
// binary bytes into the MCP tool-call result — the same idea FastAPI
// applies with StreamingResponse/FileResponse instead of forcing binary
// data through a JSON body.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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

function binaryResponseSpec(): ParsedSpec {
  return {
    openapi: "3.0.0",
    info: { title: "binary-fixture", version: "1.0.0" },
    servers: [{ url: "https://placeholder.invalid" }],
    paths: {
      "/recordings/{id}": {
        get: {
          operationId: "getRecording",
          summary: "Download a call recording",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "ok",
              content: { "audio/mpeg": { schema: { type: "string", format: "binary" } } },
            },
          },
        },
      },
      "/reports/{id}": {
        get: {
          operationId: "getReport",
          summary: "Get a report — has both JSON and PDF variants, should NOT be treated as binary-only",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": { schema: { type: "object" } },
                "application/pdf": { schema: { type: "string", format: "binary" } },
              },
            },
          },
        },
      },
    },
  } as unknown as ParsedSpec;
}

test("operation with only a non-JSON 2xx response is flagged isBinaryResponse", async () => {
  const mapping = mapOpenApiToTools(binaryResponseSpec());
  assert.equal(mapping.errors.length, 0);

  const recording = mapping.tools.find((t) => t.name === "getRecording");
  assert.equal(recording?.isBinaryResponse, true);
});

test("operation with a JSON variant alongside a binary one is NOT flagged binary-only", async () => {
  const mapping = mapOpenApiToTools(binaryResponseSpec());
  const report = mapping.tools.find((t) => t.name === "getReport");
  assert.equal(report?.isBinaryResponse, false, "mixed JSON+PDF response should keep the JSON code path");
});

test(
  "generated server returns { downloadUrl, contentType, status } for a binary endpoint, both redirect and direct-2xx cases",
  { timeout: 120_000 },
  async () => {
    const mapping = mapOpenApiToTools(binaryResponseSpec());
    assert.equal(mapping.errors.length, 0);

    // Real local HTTP mock: /recordings/redirect-me issues a 302 to a
    // pre-signed-style URL; /recordings/direct-file returns the audio bytes
    // directly with a 200 — exercising both branches of the generated code.
    const mockServer = http.createServer((req, res) => {
      if (req.url === "/recordings/redirect-me") {
        res.writeHead(302, { Location: "https://cdn.example.invalid/presigned/abc123.mp3" });
        res.end();
        return;
      }
      if (req.url === "/recordings/direct-file") {
        res.writeHead(200, { "Content-Type": "audio/mpeg" });
        res.end(Buffer.from([0xff, 0xfb, 0x90, 0x00])); // minimal fake MP3-ish bytes
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
    const mockPort = (mockServer.address() as { port: number }).port;
    const mockBaseUrl = `http://127.0.0.1:${mockPort}`;

    const outputDir = await mkdtemp(path.join(tmpdir(), "mcpforge-binary-test-"));

    try {
      await renderProject(mapping, { outputDir, serverName: "test-binary-server" });

      // Sanity: generated source should NOT call response.json()/.text() for
      // the binary tool's handler — confirms the distinct code path was hit
      // at generation time, not just at runtime by accident.
      const generatedSrc = await import("node:fs/promises").then((fs) =>
        fs.readFile(path.join(outputDir, "src", "index.ts"), "utf-8")
      );
      assert.match(generatedSrc, /downloadUrl/);
      assert.match(generatedSrc, /redirect:\s*"manual"/);

      await execFileAsync("npm", ["install"], { cwd: outputDir, timeout: 90_000 });
      const buildResult = await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 60_000 });
      assert.equal(buildResult.stderr.trim(), "", `Unexpected build stderr: ${buildResult.stderr}`);

      const proc = spawn("node", ["dist/index.js"], {
        cwd: outputDir,
        env: { ...process.env, MCPFORGE_BASE_URL: mockBaseUrl },
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
              params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "binary-test", version: "0.0.1" } },
            }),
          300
        );
        setTimeout(
          () =>
            sendJsonRpc(proc, {
              jsonrpc: "2.0",
              id: 2,
              method: "tools/call",
              params: { name: "getRecording", arguments: { id: "redirect-me" } },
            }),
          1000
        );
        setTimeout(
          () =>
            sendJsonRpc(proc, {
              jsonrpc: "2.0",
              id: 3,
              method: "tools/call",
              params: { name: "getRecording", arguments: { id: "direct-file" } },
            }),
          1600
        );
        setTimeout(() => {
          clearTimeout(timeout);
          proc.kill();
          resolve();
        }, 3500);
      });

      const lines = stdoutBuf.trim().split("\n").filter(Boolean);
      const parsed = lines.map((l) => JSON.parse(l));

      const redirectResponse = parsed.find((r) => r.id === 2);
      assert.ok(redirectResponse?.result, `redirect case should succeed: ${JSON.stringify(redirectResponse)}`);
      const redirectPayload = JSON.parse(redirectResponse.result.content[0].text);
      assert.equal(redirectPayload.downloadUrl, "https://cdn.example.invalid/presigned/abc123.mp3");
      assert.equal(redirectPayload.status, 302);

      const directResponse = parsed.find((r) => r.id === 3);
      assert.ok(directResponse?.result, `direct-2xx case should succeed: ${JSON.stringify(directResponse)}`);
      const directPayload = JSON.parse(directResponse.result.content[0].text);
      assert.match(directPayload.downloadUrl, /\/recordings\/direct-file$/);
      assert.equal(directPayload.contentType, "audio/mpeg");
      assert.equal(directPayload.status, 200);
    } finally {
      mockServer.close();
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);
