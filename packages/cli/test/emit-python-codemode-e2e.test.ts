// packages/cli/test/emit-python-codemode-e2e.test.ts
//
// MCPFO-55 (ARCHITECTURE.md §104) — LOAD-BEARING end-to-end test for Python
// code mode: emit a real Python code-mode project, create a venv and
// pip-install requirements.txt (which brings Deno via the `deno` PyPI
// package), run `sandbox_runner.py --install`, spawn server.py over stdio with
// NO system Deno on PATH, and drive search_docs + execute_code with real
// JSON-RPC. execute_code runs model-written TypeScript in the pip-installed
// Deno against a local HTTP server standing in for the upstream API, and the
// permission boundary is probed from inside the sandbox.
//
// Requires Python >=3.11 (same resolution as emit-python-e2e) and network for
// the pip + zod install. No silent skip.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getToolsFromOwnEngine } from "../src/engine/own-engine.js";
import { pythonTarget } from "../src/emit/target.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

function resolvePython(): string {
  const pinned = process.env.KLARIDIAN_TEST_PYTHON;
  for (const candidate of pinned ? [pinned] : ["python3.11", "python3", "python"]) {
    try {
      const v = execFileSync(candidate, ["--version"], { encoding: "utf-8" });
      const m = v.match(/Python (\d+)\.(\d+)/);
      if (m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 11))) return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error("No Python >=3.11 interpreter found on PATH (tried python3.11, python3, python).");
}

/** A local stand-in for the upstream API: GET /pet/findByStatus returns one pet. */
function startUpstream(): Promise<{ server: Server; port: number; hits: string[] }> {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url} auth=${req.headers.authorization ?? ""}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([{ id: 7, name: "rex", photoUrls: [], status: "available" }]));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port, hits })));
}

function makeRpc(proc: ReturnType<typeof spawn>) {
  let buffer = "";
  const waiters = new Map<number, (m: any) => void>();
  proc.stdout!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf-8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("{")) continue;
      const msg = JSON.parse(line);
      waiters.get(msg.id)?.(msg);
    }
  });
  let id = 0;
  return (method: string, params: unknown, timeoutMs = 60_000): Promise<any> => {
    const myId = ++id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout on ${method}`)), timeoutMs);
      waiters.set(myId, (m) => { clearTimeout(t); resolve(m); });
      proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
    });
  };
}

test(
  "python code-mode: pip-installed Deno runs model TypeScript against the typed client, sandbox boundary holds",
  { timeout: 600_000 },
  async () => {
    const py = resolvePython();
    const upstream = await startUpstream();
    const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-py-codemode-"));
    let proc: ReturnType<typeof spawn> | undefined;
    try {
      const tools = await getToolsFromOwnEngine(PETSTORE_SPEC_PATH, { dereference: true });
      const baseUrl = `http://127.0.0.1:${upstream.port}`;
      const files = pythonTarget.emitProject({ serverName: "petstore-py-cm-e2e", tools, baseUrl, architecture: "code-mode" });
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(outDir, rel);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, content as string, "utf-8");
      }

      await execFileAsync(py, ["-m", "venv", ".venv"], { cwd: outDir, timeout: 120_000 });
      const venvPy = path.join(outDir, ".venv", "bin", "python");
      await execFileAsync(venvPy, ["-m", "pip", "install", "-q", "-r", "requirements.txt"], { cwd: outDir, timeout: 300_000 });
      await execFileAsync(venvPy, ["sandbox_runner.py", "--install"], { cwd: outDir, timeout: 180_000 });

      // PATH without any system Deno: the server must use the pip-installed binary.
      proc = spawn(venvPy, ["server.py"], {
        cwd: outDir,
        env: { PATH: "/usr/bin:/bin", KLARIDIAN_BASE_URL: baseUrl, KLARIDIAN_AUTH_TOKEN: "tok-e2e", KLARIDIAN_SANDBOX_TIMEOUT: "20" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const rpc = makeRpc(proc);
      await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
      proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

      const list = await rpc("tools/list", {});
      assert.deepEqual(list.result.tools.map((t: any) => t.name).sort(), ["execute_code", "search_docs"]);

      const search = await rpc("tools/call", { name: "search_docs", arguments: { query: "findPetsByStatus" } });
      assert.match(search.result.content[0].text, /GET \/pet\/findByStatus/);

      const exec = async (code: string) => {
        const r = await rpc("tools/call", { name: "execute_code", arguments: { code } });
        return { isError: Boolean(r.result.isError), text: String(r.result.content[0].text) };
      };

      // Happy path: typed client -> upstream, with the bearer token forwarded.
      const ok = await exec(
        'import { findPetsByStatus } from "./client.ts";\nconst r = await findPetsByStatus({ status: "available" });\nconsole.log(JSON.stringify({ s: r.status, n: r.data[0].name }));'
      );
      assert.equal(ok.isError, false, ok.text);
      assert.match(ok.text, /\{"s":200,"n":"rex"\}/);
      assert.ok(upstream.hits.some((h) => h.startsWith("GET /pet/findByStatus?status=available") && h.endsWith("auth=Bearer tok-e2e")), upstream.hits.join("\n"));

      // The permission boundary, probed from inside the sandbox.
      const probes: Record<string, string> = {
        crossHostFetch: 'await fetch("https://example.com");',
        readOutsideSandbox: 'Deno.readTextFileSync("/etc/hosts");',
        writeFile: 'Deno.writeTextFileSync("x.txt", "1");',
        otherEnv: 'console.log(Deno.env.get("PATH"));',
        subprocess: 'new Deno.Command("ls").outputSync();',
        remoteImport: 'await import("https://esm.sh/is-number@7.0.0");',
      };
      for (const [name, body] of Object.entries(probes)) {
        const r = await exec(`try { ${body} console.log("LEAK"); } catch (e) { console.log("BLOCKED", e.name); }`);
        assert.match(r.text, /BLOCKED/, `${name} must be blocked, got: ${r.text}`);
        assert.doesNotMatch(r.text, /LEAK/, name);
      }

      // A failing script is a tool error, not a crash; the server stays up.
      const bad = await exec('throw new Error("boom");');
      assert.equal(bad.isError, true);
      assert.match(bad.text, /boom/);
      const again = await rpc("tools/list", {});
      assert.equal(again.result.tools.length, 2);
    } finally {
      proc?.kill();
      upstream.server.close();
      await rm(outDir, { recursive: true, force: true });
    }
  }
);
