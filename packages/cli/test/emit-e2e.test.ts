// packages/cli/test/emit-e2e.test.ts
//
// LOAD-BEARING test for MCPFO-21 (option d) — the one that actually proves the
// v2 emit path works, per the repo's standing rule (CLAUDE.md): real emit ->
// npm install -> tsc build -> spawn -> drive over JSON-RPC. String-shape unit
// tests (emit-server.test.ts) are not sufficient; the riskiest failure mode
// (a server that doesn't compile or corrupts the transport) only shows here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { getToolsFromOpenApi } from "openapi-mcp-generator";
import { emitServerProject } from "../src/emit/emit-server.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

function sendJsonRpc(proc: ReturnType<typeof spawn>, msg: unknown) {
  proc.stdin!.write(JSON.stringify(msg) + "\n");
}

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
    setTimeout(() => { proc.stdout!.off("data", onData); reject(new Error("timeout waiting for JSON-RPC line")); }, 15000);
  });
}

test(
  "v2 emit path: emitted petstore server installs, builds, and answers tools/list + tools/call over stdio",
  { timeout: 300_000 },
  async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "mcpforge-emit-e2e-"));
    try {
      // 1. Emit the project from real tool data.
      const tools = await getToolsFromOpenApi(PETSTORE_SPEC_PATH, { dereference: true });
      assert.ok(tools.length >= 15, `expected many petstore tools, got ${tools.length}`);
      const files = emitServerProject({
        serverName: "petstore-e2e",
        tools,
        baseUrl: "https://petstore3.swagger.io/api/v3",
        transport: "stdio",
      });
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(outDir, rel);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, content, "utf-8");
      }

      // 2. Real npm install + tsc build.
      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outDir, timeout: 180_000 });
      await execFileAsync("npm", ["run", "build"], { cwd: outDir, timeout: 120_000 });

      // 3. Spawn the built server over stdio and drive it.
      const proc = spawn("node", ["dist/index.js"], { cwd: outDir, stdio: ["pipe", "pipe", "pipe"] });
      try {
        // initialize (2025-11-25 — the era the current v2 SDK negotiates; spike 021c)
        sendJsonRpc(proc, { jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" } } });
        const initResp = await readOneJsonRpcLine(proc);
        assert.equal(initResp.id, 1);
        assert.ok(initResp.result, "initialize returns a result");

        // tools/list
        sendJsonRpc(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        const listResp = await readOneJsonRpcLine(proc);
        assert.ok(Array.isArray(listResp.result.tools), "tools/list returns an array");
        assert.equal(listResp.result.tools.length, tools.length, "all tools listed");
        const getPet = listResp.result.tools.find((t: any) => t.name === "getPetById");
        assert.ok(getPet, "getPetById present");
        assert.equal(getPet.annotations?.readOnlyHint, true, "GET tool annotated read-only");
        assert.equal(getPet.annotations?.openWorldHint, true, "tool annotated open-world (calls external API)");
        assert.equal(getPet.annotations?.idempotentHint, true, "GET tool annotated idempotent");
        assert.ok(getPet.annotations?.title || getPet.title, "tool carries a human-readable title (marketplace requirement)");
        const delPet = listResp.result.tools.find((t: any) => t.name === "deletePet");
        if (delPet) assert.equal(delPet.annotations?.destructiveHint, true, "DELETE tool annotated destructive");

        // tools/call unknown -> native protocol error (-32602), no conformance patch needed
        sendJsonRpc(proc, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "noSuchTool", arguments: {} } });
        const unknownResp = await readOneJsonRpcLine(proc);
        assert.ok(unknownResp.error, "unknown tool is a protocol error");
        assert.equal(unknownResp.error.code, -32602);
      } finally {
        proc.kill("SIGKILL");
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }
);

test(
  "v2 emit path: streamable-http server survives SEQUENTIAL requests (the MCPFO-10 crash is gone)",
  { timeout: 300_000 },
  async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "mcpforge-emit-http-"));
    const PORT = 3921;
    try {
      const tools = await getToolsFromOpenApi(PETSTORE_SPEC_PATH, { dereference: true });
      const files = emitServerProject({
        serverName: "petstore-http-e2e",
        tools,
        baseUrl: "https://petstore3.swagger.io/api/v3",
        transport: "streamable-http",
        port: PORT,
      });
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(outDir, rel);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, content, "utf-8");
      }
      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outDir, timeout: 180_000 });
      await execFileAsync("npm", ["run", "build"], { cwd: outDir, timeout: 120_000 });

      const proc = spawn("node", ["dist/index.js"], { cwd: outDir, stdio: ["ignore", "pipe", "pipe"] });
      let exitedEarly = false;
      proc.on("exit", () => { exitedEarly = true; });
      try {
        // wait for the server to announce it's listening on stderr
        await new Promise<void>((resolve, reject) => {
          const to = setTimeout(() => reject(new Error("server did not start")), 15000);
          proc.stderr!.on("data", (c: Buffer) => {
            if (c.toString().includes("streamable-http")) { clearTimeout(to); resolve(); }
          });
        });

        const url = `http://127.0.0.1:${PORT}/mcp`;
        const headers = {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Origin: `http://127.0.0.1:${PORT}`,
        };
        const post = async (body: unknown) => {
          const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
          const text = await r.text();
          const line = text.split("\n").map((l) => l.replace(/^data:\s*/, "").trim()).find((l) => l.startsWith("{"));
          return line ? JSON.parse(line) : null;
        };

        // Request 1: initialize
        const r1 = await post({ jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" } } });
        assert.ok(r1?.result, "initialize ok");

        // Request 2: tools/list — the SECOND request, where the v1 session-based transport crashes
        const r2 = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        assert.ok(Array.isArray(r2?.result?.tools), "tools/list ok on 2nd request (no ReadableStream crash)");

        // Request 3 + 4: more sequential calls, proving the process stays alive
        const r3 = await post({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
        assert.ok(Array.isArray(r3?.result?.tools), "3rd request ok");
        const r4 = await post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "noSuchTool", arguments: {} } });
        assert.equal(r4?.error?.code, -32602, "4th request: unknown tool is a native protocol error");

        assert.equal(exitedEarly, false, "server did not crash across 4 sequential requests");
      } finally {
        proc.kill("SIGKILL");
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }
);
