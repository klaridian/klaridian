// packages/cli/test/branding.test.ts
//
// End-to-end validation of --icon/--website/--server-description
// (ARCHITECTURE.md section 31 — MCP spec 2025-11-25 SEP-973 cosmetic
// metadata). Mirrors the discipline of every other test file: real CLI
// invocation, real npm install + tsc build, real spawned server driven
// over real stdio JSON-RPC — confirming the fields actually arrive in a
// real `initialize` response, not just that they're present in generated
// source text.

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
  "generate --icon/--website/--server-description: real initialize response carries the branding metadata",
  { timeout: 120_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-branding-"));
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
        "test-branding",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
        "--icon",
        "https://example.com/icon-light.svg|light",
        "--icon",
        "https://example.com/icon-dark.svg|dark",
        "--website",
        "https://example.com",
        "--server-description",
        "A test petstore MCP server",
      ]);
      assert.match(genResult.stderr, /Applied branding metadata \(2 icon\(s\), website, description\)/);

      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outputDir, timeout: 60_000 });
      const buildResult = await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 60_000 });
      assert.doesNotMatch(buildResult.stderr, /error TS/);

      const serverProcess = spawn("node", ["build/index.js"], { cwd: outputDir });
      try {
        sendJsonRpc(serverProcess, {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
        });
        const initResponse = await readOneJsonRpcLine(serverProcess);
        const serverInfo = initResponse.result.serverInfo;

        assert.equal(serverInfo.description, "A test petstore MCP server");
        assert.equal(serverInfo.websiteUrl, "https://example.com");
        assert.equal(serverInfo.icons.length, 2);
        assert.deepEqual(serverInfo.icons[0], {
          src: "https://example.com/icon-light.svg",
          mimeType: "image/svg+xml",
          theme: "light",
        });
        assert.deepEqual(serverInfo.icons[1], {
          src: "https://example.com/icon-dark.svg",
          mimeType: "image/svg+xml",
          theme: "dark",
        });

        // Confirm the server still negotiates 2025-11-25 correctly and
        // basic operation (tools/list) is unaffected by the branding patch.
        assert.equal(initResponse.result.protocolVersion, "2025-11-25");

        sendJsonRpc(serverProcess, { jsonrpc: "2.0", method: "notifications/initialized" });
        sendJsonRpc(serverProcess, { jsonrpc: "2.0", id: 2, method: "tools/list" });
        const toolsResponse = await readOneJsonRpcLine(serverProcess);
        assert.equal(toolsResponse.result.tools.length, 19);
      } finally {
        serverProcess.kill();
      }
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate (no branding flags): does not modify the Server construction call at all",
  { timeout: 60_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-branding-none-"));
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
        "test-branding-none",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
      ]);
      assert.doesNotMatch(result.stderr, /Applied branding metadata/);

      const serverSource = await readFile(path.join(outputDir, "src", "index.ts"), "utf-8");
      assert.match(serverSource, /\{ name: SERVER_NAME, version: SERVER_VERSION \}/, "expected the untouched, unbranded Server construction call");
      assert.doesNotMatch(serverSource, /websiteUrl:/);
      assert.doesNotMatch(serverSource, /icons: \[/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate --icon <src>|badtheme: warns and ignores the unrecognized theme rather than failing",
  { timeout: 60_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-branding-badtheme-"));
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
        "test-branding-badtheme",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
        "--icon",
        "https://example.com/icon.png|sepia",
      ]);
      assert.match(result.stderr, /Ignoring unrecognized icon theme "sepia"/);
      assert.match(result.stderr, /Applied branding metadata \(1 icon\(s\)\)/);

      const serverSource = await readFile(path.join(outputDir, "src", "index.ts"), "utf-8");
      assert.match(serverSource, /"src":"https:\/\/example\.com\/icon\.png","mimeType":"image\/png"/);
      assert.doesNotMatch(serverSource, /"theme":"sepia"/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);
