// packages/cli/test/engine-v2.test.ts
//
// End-to-end test of the CLI's generation path (MCPFO-21): the real
// `klaridian generate` binary, install/build/spawn/drive. Since the MCPFO-21
// cutover (ARCHITECTURE.md section 49) the v2 emitter is the only engine, so
// there is no `--engine` flag anymore. Complements emit-e2e.test.ts (which
// tests the emitter module directly) by proving the CLI wiring, curation
// reuse, and license step all work end to end.

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
  "klaridian generate: real CLI generates a v2 server that installs, builds and runs",
  { timeout: 300_000 },
  async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-engine-v2-"));
    try {
      const gen = await execFileAsync("node", [
        CLI_ENTRYPOINT, "generate",
        "--spec", PETSTORE_SPEC_PATH,
        "--out", outDir,
        "--name", "engine-v2-test",
        "--base-url", "https://petstore3.swagger.io/api/v3",
        "--registry-name", "io.github.acme/engine-v2-test",
        "--license", "none",
      ]);
      assert.match(gen.stderr, /protocol 2025-11-25/, "reports the v2 emitter + negotiated protocol");

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

test("klaridian generate --engine: the flag was removed in the MCPFO-21 cutover and is now rejected", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-engine-gone-"));
  try {
    await assert.rejects(
      execFileAsync("node", [
        CLI_ENTRYPOINT, "generate", "--spec", PETSTORE_SPEC_PATH, "--out", outDir,
        "--name", "x", "--base-url", "https://x/api", "--engine", "v1",
      ]),
      /unknown option '--engine'/i
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("klaridian generate --docker: emits Dockerfile + .dockerignore for streamable-http (MCPFO-12)", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-docker-"));
  try {
    await execFileAsync("node", [
      CLI_ENTRYPOINT, "generate", "--spec", PETSTORE_SPEC_PATH, "--out", outDir,
      "--name", "d", "--base-url", "https://x/api",
      "--transport", "streamable-http", "--port", "3000", "--docker", "--license", "none",
    ]);
    const df = await readFile(path.join(outDir, "Dockerfile"), "utf-8");
    assert.match(df, /FROM node:\d+/, "pins a Node base");
    assert.match(df, /USER node/, "non-root");
    assert.match(df, /KLARIDIAN_BIND_HOST=0\.0\.0\.0/, "reachable in-container");
    assert.match(df, /EXPOSE 3000/, "exposes the port");
    const di = await readFile(path.join(outDir, ".dockerignore"), "utf-8");
    assert.match(di, /node_modules/);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("klaridian generate --docker with stdio transport fails loudly (MCPFO-12)", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-docker-bad-"));
  try {
    await assert.rejects(
      execFileAsync("node", [
        CLI_ENTRYPOINT, "generate", "--spec", PETSTORE_SPEC_PATH, "--out", outDir,
        "--name", "d", "--base-url", "https://x/api",
        "--transport", "stdio", "--docker", "--license", "none",
      ]),
      /--docker requires --transport streamable-http/
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("klaridian generate: relative spec server URL without --base-url warns (MCPFO-20)", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-relbase-"));
  const specPath = path.join(outDir, "relspec.json");
  const spec = {
    openapi: "3.0.0",
    info: { title: "rel", version: "1.0.0" },
    servers: [{ url: "/api/v3" }],
    paths: { "/ping": { get: { operationId: "ping", responses: { "200": { description: "ok" } } } } },
  };
  const { writeFile } = await import("node:fs/promises");
  await writeFile(specPath, JSON.stringify(spec));
  try {
    // No --base-url; spec url is relative → should warn on stderr but still succeed.
    const gen = await execFileAsync("node", [
      CLI_ENTRYPOINT, "generate", "--spec", specPath, "--out", path.join(outDir, "gen"),
      "--name", "rel", "--license", "none",
    ]);
    assert.match(gen.stderr, /--base-url/, "warns and names the flag");
    assert.match(gen.stderr, /\/api\/v3/, "quotes the relative url");

    // With --base-url absolute → no warning.
    const gen2 = await execFileAsync("node", [
      CLI_ENTRYPOINT, "generate", "--spec", specPath, "--out", path.join(outDir, "gen2"),
      "--name", "rel", "--base-url", "https://api.example.com/v3", "--license", "none",
    ]);
    assert.doesNotMatch(gen2.stderr, /Base URL is not absolute/, "no warning with absolute base-url");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

