// packages/cli/test/emit-python-e2e.test.ts
//
// LOAD-BEARING E2E for the Python emit target (MCPFO-60.3), the Python peer of
// emit-e2e.test.ts. Per the repo's standing rule (AGENTS.md): real emit -> real
// `pip install` -> real spawn -> drive over JSON-RPC. String-shape unit tests
// (emit-python.test.ts) are not sufficient; the riskiest failures (a server
// that won't import, or a plugin that corrupts the stdio JSON-RPC stream — the
// spike-001 finding, language-agnostic) only show here.
//
// Requires a Python 3.10+ interpreter on PATH (`python3`). CI's cli job installs
// one via actions/setup-python; locally the test resolves python3/python3.11.
// If none is found the test throws (loudly) rather than silently passing — the
// same discipline the TS E2E holds itself to.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { getToolsFromOpenApi } from "openapi-mcp-generator";
import { pythonTarget } from "../src/emit/target.js";
import { CONFORMANCE_CONTRACT } from "../src/emit/conformance/contract.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");
const PETSTORE_BASE_URL = "https://petstore3.swagger.io/api/v3";

/** Resolve a usable Python 3 interpreter, or throw loudly (no silent skip). */
function resolvePython(): string {
  for (const candidate of ["python3.11", "python3", "python"]) {
    try {
      const v = execFileSync(candidate, ["--version"], { encoding: "utf-8" });
      const m = v.match(/Python (\d+)\.(\d+)/);
      if (m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 10))) return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error("No Python >=3.10 interpreter found on PATH (tried python3.11, python3, python).");
}

async function emitInto(outDir: string, opts: { transport: "stdio" | "streamable-http"; port?: number }) {
  const tools = await getToolsFromOpenApi(PETSTORE_SPEC_PATH, { dereference: true });
  const files = pythonTarget.emitProject({
    serverName: "petstore-py-e2e",
    tools,
    baseUrl: PETSTORE_BASE_URL,
    transport: opts.transport,
    port: opts.port,
  });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(outDir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf-8");
  }
  return tools.length;
}

/** Create a venv and pip-install requirements.txt. Returns the venv python path. */
async function setupVenv(py: string, dir: string): Promise<string> {
  await execFileAsync(py, ["-m", "venv", ".venv"], { cwd: dir, timeout: 120_000 });
  const venvPy = path.join(dir, ".venv", "bin", "python");
  await execFileAsync(venvPy, ["-m", "pip", "install", "-q", "-r", "requirements.txt"], {
    cwd: dir,
    timeout: 180_000,
  });
  return venvPy;
}

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
    setTimeout(() => { proc.stdout!.off("data", onData); reject(new Error("timeout waiting for JSON-RPC line")); }, 20000);
  });
}

test(
  "python emit path: emitted petstore server installs, spawns, and answers tools/list + conformance over stdio",
  { timeout: 300_000 },
  async () => {
    const py = resolvePython();
    const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-py-e2e-"));
    try {
      const toolCount = await emitInto(outDir, { transport: "stdio" });
      const venvPy = await setupVenv(py, outDir);

      const proc = spawn(venvPy, ["server.py"], {
        cwd: outDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, KLARIDIAN_BASE_URL: PETSTORE_BASE_URL },
      });
      try {
        sendJsonRpc(proc, { jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" } } });
        const initResp = await readOneJsonRpcLine(proc);
        assert.equal(initResp.id, 1);
        assert.ok(initResp.result, "initialize returns a result");
        assert.equal(initResp.result.protocolVersion, "2025-11-25");

        sendJsonRpc(proc, { jsonrpc: "2.0", method: "notifications/initialized" });

        sendJsonRpc(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        const listResp = await readOneJsonRpcLine(proc);
        assert.equal(listResp.result.tools.length, toolCount, "all tools listed");
        const getPet = listResp.result.tools.find((t: any) => t.name === "getPetById");
        assert.ok(getPet, "getPetById present");
        assert.equal(getPet.annotations?.readOnlyHint, true, "GET tool annotated read-only (camelCase on the wire)");
        assert.equal(getPet.annotations?.openWorldHint, true);

        // unknown tool -> protocol error -32602 (the spike-059 gap the Python
        // conformance adapter closes: a bare exception would be code:0).
        assert.equal(CONFORMANCE_CONTRACT.unknownTool.kind, "protocol");
        sendJsonRpc(proc, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "noSuchTool", arguments: {} } });
        const unknownResp = await readOneJsonRpcLine(proc);
        assert.ok(unknownResp.error, "unknown tool is a protocol error");
        assert.equal(unknownResp.error.code, (CONFORMANCE_CONTRACT.unknownTool as { code: number }).code);

        // invalid args -> tool-error result (isError:true), NOT a protocol error.
        assert.equal(CONFORMANCE_CONTRACT.invalidArguments.kind, "tool-error");
        sendJsonRpc(proc, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "getPetById", arguments: {} } });
        const invalidResp = await readOneJsonRpcLine(proc);
        assert.ok(!invalidResp.error, "schema-invalid arguments are NOT a protocol error");
        assert.equal(invalidResp.result?.isError, true, "schema-invalid arguments are a tool-error result");
        assert.match(invalidResp.result?.content?.[0]?.text ?? "", /validation/i);
      } finally {
        proc.kill("SIGKILL");
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }
);

test(
  "python emit path: streamable-http server answers SEQUENTIAL requests without crashing",
  { timeout: 300_000 },
  async () => {
    const py = resolvePython();
    const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-py-http-e2e-"));
    const PORT = 3947;
    try {
      await emitInto(outDir, { transport: "streamable-http", port: PORT });
      const venvPy = await setupVenv(py, outDir);

      const proc = spawn(venvPy, ["server.py", "--transport", "streamable-http", "--port", String(PORT)], {
        cwd: outDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, KLARIDIAN_BASE_URL: PETSTORE_BASE_URL },
      });
      let exitedEarly = false;
      proc.on("exit", () => { exitedEarly = true; });
      try {
        await new Promise<void>((resolve, reject) => {
          const to = setTimeout(() => reject(new Error("server did not start")), 20000);
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

        const r1 = await post({ jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" } } });
        assert.ok(r1?.result, "initialize ok");
        const r2 = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        assert.ok(Array.isArray(r2?.result?.tools), "tools/list ok on 2nd request");
        const r3 = await post({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
        assert.ok(Array.isArray(r3?.result?.tools), "3rd request ok");
        const r4 = await post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "noSuchTool", arguments: {} } });
        assert.equal(r4?.error?.code, (CONFORMANCE_CONTRACT.unknownTool as { code: number }).code, "4th request: unknown tool -32602");

        assert.equal(exitedEarly, false, "server survived 4 sequential requests");
      } finally {
        proc.kill("SIGKILL");
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }
);
