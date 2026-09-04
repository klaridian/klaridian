// packages/cli/test/emit-codemode-e2e.test.ts
//
// LOAD-BEARING test for MCPFO-28 — proves the full code-mode integration
// (emitServerProject({ architecture: "code-mode" }), wiring MCPFO-29's
// client + MCPFO-30's sandbox into a real generated project) actually works
// end to end: real npm install + tsc build + spawn the generated MCP server
// over stdio + drive it with real JSON-RPC tools/call requests against
// execute_code, which itself spawns a real Deno subprocess that calls a
// real local HTTP server. This is the first test that exercises code-mode
// as a user would actually experience it (the assembled generated server),
// as opposed to emit-client-e2e.test.ts / emit-sandbox-e2e.test.ts, which
// each test one generator module in isolation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { getToolsFromOpenApi } from "openapi-mcp-generator";
import { emitServerProject } from "../src/emit/emit-server.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

async function isDenoAvailable(): Promise<boolean> {
  try {
    await execFileAsync("deno", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

function sendJsonRpc(proc: ReturnType<typeof spawn>, msg: unknown) {
  proc.stdin!.write(JSON.stringify(msg) + "\n");
}

function readOneJsonRpcLine(proc: ReturnType<typeof spawn>, timeoutMs = 20000): Promise<any> {
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
    setTimeout(() => { proc.stdout!.off("data", onData); reject(new Error("timeout waiting for JSON-RPC line")); }, timeoutMs);
  });
}

async function startMockApi(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const match = req.url?.match(/^\/pet\/(\d+)$/);
    if (req.method === "GET" && match) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: Number(match[1]), name: "doggie", status: "available" }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: 404, message: "Not Found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test(
  "code-mode generated server: registers exactly one execute_code tool over stdio",
  { timeout: 300_000 },
  async () => {
    const mock = await startMockApi();
    const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-codemode-e2e-"));
    try {
      const tools = await getToolsFromOpenApi(PETSTORE_SPEC_PATH, { dereference: true });
      const files = emitServerProject({
        serverName: "petstore-codemode-e2e",
        tools,
        baseUrl: mock.baseUrl,
        architecture: "code-mode",
        transport: "stdio",
      });
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(outDir, rel);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, content, "utf-8");
      }

      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outDir, timeout: 180_000 });
      await execFileAsync("npm", ["run", "build"], { cwd: outDir, timeout: 120_000 });

      const proc = spawn("node", ["dist/index.js"], { cwd: outDir, stdio: ["pipe", "pipe", "pipe"] });
      try {
        sendJsonRpc(proc, { jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" } } });
        const initResp = await readOneJsonRpcLine(proc);
        assert.ok(initResp.result, "initialize returns a result");

        sendJsonRpc(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        const listResp = await readOneJsonRpcLine(proc);
        assert.equal(listResp.result.tools.length, 2, "exactly two tools registered (execute_code + search_docs), not one per operation");
        const toolNames = listResp.result.tools.map((t: { name: string }) => t.name).sort();
        assert.deepEqual(toolNames, ["execute_code", "search_docs"]);
      } finally {
        proc.kill("SIGKILL");
      }
    } finally {
      await mock.close();
      await rm(outDir, { recursive: true, force: true });
    }
  }
);

test(
  "code-mode generated server: execute_code really runs sandboxed model code that calls the real API and returns real data",
  { timeout: 300_000 },
  async () => {
    if (!(await isDenoAvailable())) {
      console.log("SKIP: deno not on PATH (install with `brew install deno`)");
      return;
    }
    const mock = await startMockApi();
    const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-codemode-e2e-"));
    try {
      const tools = await getToolsFromOpenApi(PETSTORE_SPEC_PATH, { dereference: true });
      const files = emitServerProject({
        serverName: "petstore-codemode-e2e",
        tools,
        baseUrl: mock.baseUrl,
        architecture: "code-mode",
        transport: "stdio",
      });
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(outDir, rel);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, content, "utf-8");
      }

      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outDir, timeout: 180_000 });
      await execFileAsync("npm", ["run", "build"], { cwd: outDir, timeout: 120_000 });

      const proc = spawn("node", ["dist/index.js"], {
        cwd: outDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, KLARIDIAN_BASE_URL: mock.baseUrl },
      });
      try {
        sendJsonRpc(proc, { jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" } } });
        await readOneJsonRpcLine(proc);

        const modelCode = `
import { getPetById } from "./client.js";
const result = await getPetById({ petId: 42 });
console.log(JSON.stringify(result));
`;
        sendJsonRpc(proc, {
          jsonrpc: "2.0", id: 2, method: "tools/call",
          params: { name: "execute_code", arguments: { code: modelCode } },
        });
        const callResp = await readOneJsonRpcLine(proc, 30000);
        assert.ok(callResp.result, `tools/call should return a result, got: ${JSON.stringify(callResp)}`);
        assert.equal(callResp.result.isError, false, `execute_code should not report an error: ${JSON.stringify(callResp.result)}`);
        const text = callResp.result.content[0].text;
        const parsed = JSON.parse(text.trim());
        assert.equal(parsed.status, 200);
        assert.equal(parsed.data.id, 42, "the sandboxed code really called the real API and got the real petId back");
      } finally {
        proc.kill("SIGKILL");
      }
    } finally {
      await mock.close();
      await rm(outDir, { recursive: true, force: true });
    }
  }
);

test(
  "code-mode generated server: search_docs really finds the getPetById function and its docs over JSON-RPC",
  { timeout: 300_000 },
  async () => {
    const mock = await startMockApi();
    const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-codemode-e2e-"));
    try {
      const tools = await getToolsFromOpenApi(PETSTORE_SPEC_PATH, { dereference: true });
      const files = emitServerProject({
        serverName: "petstore-codemode-e2e",
        tools,
        baseUrl: mock.baseUrl,
        architecture: "code-mode",
        transport: "stdio",
      });
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(outDir, rel);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, content, "utf-8");
      }
      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outDir, timeout: 180_000 });
      await execFileAsync("npm", ["run", "build"], { cwd: outDir, timeout: 120_000 });

      const proc = spawn("node", ["dist/index.js"], { cwd: outDir, stdio: ["pipe", "pipe", "pipe"] });
      try {
        sendJsonRpc(proc, { jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" } } });
        await readOneJsonRpcLine(proc);

        sendJsonRpc(proc, {
          jsonrpc: "2.0", id: 2, method: "tools/call",
          params: { name: "search_docs", arguments: { query: "getPetById" } },
        });
        const callResp = await readOneJsonRpcLine(proc);
        assert.ok(callResp.result, `search_docs should return a result, got: ${JSON.stringify(callResp)}`);
        assert.equal(callResp.result.isError, false);
        const text = callResp.result.content[0].text;
        assert.match(text, /getPetById/, "search_docs found the matching function by name");
        assert.match(text, /GET \/pet\/\{petId\}/, "search_docs surfaces the real method/path");

        // An empty query should list every operation, not error or return nothing.
        sendJsonRpc(proc, {
          jsonrpc: "2.0", id: 3, method: "tools/call",
          params: { name: "search_docs", arguments: {} },
        });
        const allResp = await readOneJsonRpcLine(proc);
        assert.equal(allResp.result.isError, false);
        const allText = allResp.result.content[0].text;
        for (const opName of ["getPetById", "addPet", "deletePet"]) {
          assert.match(allText, new RegExp(opName), `empty-query search_docs lists ${opName} among all operations`);
        }
      } finally {
        proc.kill("SIGKILL");
      }
    } finally {
      await mock.close();
      await rm(outDir, { recursive: true, force: true });
    }
  }
);

test(
  "code-mode generated server: execute_code reports isError (not a protocol crash) when the model writes broken code",
  { timeout: 300_000 },
  async () => {
    if (!(await isDenoAvailable())) {
      console.log("SKIP: deno not on PATH (install with `brew install deno`)");
      return;
    }
    const mock = await startMockApi();
    const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-codemode-e2e-"));
    try {
      const tools = await getToolsFromOpenApi(PETSTORE_SPEC_PATH, { dereference: true });
      const files = emitServerProject({
        serverName: "petstore-codemode-e2e",
        tools,
        baseUrl: mock.baseUrl,
        architecture: "code-mode",
        transport: "stdio",
      });
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(outDir, rel);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, content, "utf-8");
      }
      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outDir, timeout: 180_000 });
      await execFileAsync("npm", ["run", "build"], { cwd: outDir, timeout: 120_000 });

      const proc = spawn("node", ["dist/index.js"], {
        cwd: outDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, KLARIDIAN_BASE_URL: mock.baseUrl },
      });
      try {
        sendJsonRpc(proc, { jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" } } });
        await readOneJsonRpcLine(proc);

        sendJsonRpc(proc, {
          jsonrpc: "2.0", id: 2, method: "tools/call",
          params: { name: "execute_code", arguments: { code: "this is not valid typescript {{{" } },
        });
        const callResp = await readOneJsonRpcLine(proc, 30000);
        assert.ok(callResp.result, "broken model code is a tool result, not a JSON-RPC protocol error");
        assert.equal(callResp.result.isError, true, "broken code is reported as isError: true");
      } finally {
        proc.kill("SIGKILL");
      }
    } finally {
      await mock.close();
      await rm(outDir, { recursive: true, force: true });
    }
  }
);
