// packages/cli/test/engine-v2.test.ts
//
// End-to-end test of the CLI with --engine v2 (MCPFO-21 Task 3.1): the real
// `mcpforge generate --engine v2` binary path, install/build/spawn/drive.
// Complements emit-e2e.test.ts (which tests the emitter module directly) by
// proving the CLI wiring, curation reuse, and license step all work on v2.

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

function readOneJsonRpcLine(proc: ReturnType<typeof spawn>): Promise<any> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        proc.stdout!.off("data", onData);
        try { resolve(JSON.parse(line)); } catch (err) { reject(err); }
        return;
      }
    };
    proc.stdout!.on("data", onData);
    setTimeout(() => reject(new Error("timeout")), 15000);
  });
}

test(
  "mcpforge generate --engine v2: real CLI generates a v2 server that installs, builds and runs",
  { timeout: 300_000 },
  async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "mcpforge-engine-v2-"));
    try {
      const gen = await execFileAsync("node", [
        CLI_ENTRYPOINT, "generate",
        "--spec", PETSTORE_SPEC_PATH,
        "--out", outDir,
        "--name", "engine-v2-test",
        "--base-url", "https://petstore3.swagger.io/api/v3",
        "--engine", "v2",
        "--registry-name", "io.github.acme/engine-v2-test",
        "--license", "none",
      ]);
      assert.match(gen.stderr, /engine v2/, "reports v2 engine");

      // package.json must be the v2 dep set, not v1
      const pkg = JSON.parse(await readFile(path.join(outDir, "package.json"), "utf-8"));
      assert.ok(pkg.dependencies["@modelcontextprotocol/server"], "v2 server dep present");
      assert.ok(!pkg.dependencies["@modelcontextprotocol/sdk"], "no v1 sdk dep");

      // MCPFO-25: server.json + matching mcpName for the official MCP Registry
      const serverJson = JSON.parse(await readFile(path.join(outDir, "server.json"), "utf-8"));
      assert.equal(serverJson.name, "io.github.acme/engine-v2-test", "server.json name = registry name");
      assert.equal(serverJson["$schema"], "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
      assert.equal(pkg.mcpName, serverJson.name, "package.json mcpName matches server.json name (ownership proof)");

      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outDir, timeout: 180_000 });
      await execFileAsync("npm", ["run", "build"], { cwd: outDir, timeout: 120_000 });

      const proc = spawn("node", ["dist/index.js"], { cwd: outDir, stdio: ["pipe", "pipe", "pipe"] });
      try {
        proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) + "\n");
        const initResp = await readOneJsonRpcLine(proc);
        assert.ok(initResp.result, "initialize ok");

        proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n");
        const listResp = await readOneJsonRpcLine(proc);
        assert.ok(listResp.result.tools.length >= 15, "tools listed");
      } finally {
        proc.kill("SIGKILL");
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }
);

test("mcpforge generate --engine bogus: fails loudly before generating", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "mcpforge-engine-bad-"));
  try {
    await assert.rejects(
      execFileAsync("node", [
        CLI_ENTRYPOINT, "generate", "--spec", PETSTORE_SPEC_PATH, "--out", outDir,
        "--name", "x", "--base-url", "https://x/api", "--engine", "v9",
      ]),
      /Unknown engine/
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
