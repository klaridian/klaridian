// packages/cli/test/upstream-auth-e2e.test.ts
//
// LOAD-BEARING E2E for MCPFO-105 (ARCHITECTURE.md §95): per-scheme upstream
// authentication. Per the repo's standing rule (AGENTS.md): real emit -> npm
// install -> tsc build -> spawn -> drive over the real MCP wire, then assert
// the upstream request the generated server made carried the CORRECT auth.
//
// The clean way to prove "sends the right header/query" end to end is a tiny
// LOCAL echo server: the generated MCP server proxies to it (KLARIDIAN_BASE_URL
// points at it), the echo server records the headers + URL it received, and the
// test reads them back. No external network dependency; a genuine HTTP request
// is exercised. streamable-http transport is used so we can also drive
// --forward-headers (inbound MCP client headers → upstream) over a real fetch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type Server as HttpServer } from "node:http";
import { getToolsFromOwnEngine } from "../src/engine/own-engine.js";
import { emitServerProject } from "../src/emit/emit-server.js";
import { pythonTarget } from "../src/emit/target.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A spec covering every supported scheme in one server: apiKey header/query/
// cookie, http bearer, http basic, and oauth2 (bearer from env). Each operation
// is a GET so the echo upstream sees exactly one request per tool call.
const AUTH_SPEC = {
  openapi: "3.0.3",
  info: { title: "Auth E2E API", version: "1.0.0" },
  servers: [{ url: "https://replaced.by.env" }],
  components: {
    securitySchemes: {
      apiKeyHeader: { type: "apiKey", in: "header", name: "X-API-Key" },
      apiKeyQuery: { type: "apiKey", in: "query", name: "api_key" },
      apiKeyCookie: { type: "apiKey", in: "cookie", name: "session" },
      bearerAuth: { type: "http", scheme: "bearer" },
      basicAuth: { type: "http", scheme: "basic" },
      oauth2Scheme: {
        type: "oauth2",
        flows: { clientCredentials: { tokenUrl: "https://auth.example.com/token", scopes: {} } },
      },
    },
  },
  paths: {
    "/hdr": { get: { operationId: "hdrKey", summary: "header key", security: [{ apiKeyHeader: [] }], responses: { "200": { description: "ok" } } } },
    "/qry": { get: { operationId: "qryKey", summary: "query key", security: [{ apiKeyQuery: [] }], responses: { "200": { description: "ok" } } } },
    "/cke": { get: { operationId: "ckeKey", summary: "cookie key", security: [{ apiKeyCookie: [] }], responses: { "200": { description: "ok" } } } },
    "/brr": { get: { operationId: "brrTok", summary: "bearer", security: [{ bearerAuth: [] }], responses: { "200": { description: "ok" } } } },
    "/bsc": { get: { operationId: "bscTok", summary: "basic", security: [{ basicAuth: [] }], responses: { "200": { description: "ok" } } } },
    "/oau": { get: { operationId: "oauTok", summary: "oauth2", security: [{ oauth2Scheme: [] }], responses: { "200": { description: "ok" } } } },
    "/fwd": { get: { operationId: "fwdHdr", summary: "forwarded header", responses: { "200": { description: "ok" } } } },
  },
} as const;

interface EchoRecord {
  path: string;
  headers: Record<string, string | string[] | undefined>;
}

/** Start a tiny echo upstream that records each request; returns its origin +
 *  a getter for the last received request. */
function startEchoServer(): Promise<{ origin: string; last: () => EchoRecord | undefined; close: () => void }> {
  return new Promise((resolve) => {
    let last: EchoRecord | undefined;
    const server: HttpServer = createServer((req, res) => {
      last = { path: req.url ?? "", headers: req.headers };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        last: () => last,
        close: () => server.close(),
      });
    });
  });
}

/** Drive one tools/call over streamable-http, returning nothing (we assert on
 *  the echo server, not the MCP response). Optionally send extra inbound headers. */
async function callTool(
  mcpUrl: string,
  origin: string,
  name: string,
  extraHeaders: Record<string, string> = {}
): Promise<void> {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Origin: origin,
    ...extraHeaders,
  };
  await fetch(mcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" } } }),
  });
  await fetch(mcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: {} } }),
  });
}

async function waitForReady(mcpUrl: string, origin: string, exited: () => boolean): Promise<void> {
  const deadline = Date.now() + 15000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    if (exited()) throw new Error("server exited before ready");
    try {
      await fetch(mcpUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Origin: origin },
        body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "probe", version: "1.0.0" } } }),
      });
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error(`server not ready within 15s: ${String(lastErr)}`);
}

// Env the generated server reads for its auth (MCPFO-105 convention).
const AUTH_ENV = {
  KLARIDIAN_API_KEY: "secret-api-key",
  KLARIDIAN_AUTH_TOKEN: "bearer-token-123",
  KLARIDIAN_OAUTH_TOKEN: "oauth-token-456",
  KLARIDIAN_BASIC_USER: "alice",
  KLARIDIAN_BASIC_PASS: "s3cr3t",
};
const EXPECTED_BASIC = Buffer.from("alice:s3cr3t").toString("base64");

/** Assert the echo record for each scheme carried the right auth. */
function assertScheme(echo: EchoRecord | undefined, kind: string): void {
  assert.ok(echo, `${kind}: upstream received a request`);
  const h = echo!.headers;
  switch (kind) {
    case "hdrKey":
      assert.equal(h["x-api-key"], AUTH_ENV.KLARIDIAN_API_KEY, "apiKey header sets X-API-Key");
      break;
    case "qryKey":
      assert.match(echo!.path, /[?&]api_key=secret-api-key(&|$)/, "apiKey query sets api_key param");
      break;
    case "ckeKey":
      assert.match(String(h["cookie"] ?? ""), /session=secret-api-key/, "apiKey cookie sets Cookie");
      break;
    case "brrTok":
      assert.equal(h["authorization"], `Bearer ${AUTH_ENV.KLARIDIAN_AUTH_TOKEN}`, "http bearer sets Authorization: Bearer");
      break;
    case "bscTok":
      assert.equal(h["authorization"], `Basic ${EXPECTED_BASIC}`, "http basic sets Authorization: Basic base64(user:pass)");
      break;
    case "oauTok":
      assert.equal(h["authorization"], `Bearer ${AUTH_ENV.KLARIDIAN_OAUTH_TOKEN}`, "oauth2 sends bearer from KLARIDIAN_OAUTH_TOKEN");
      break;
  }
}

test(
  "MCPFO-105 (TypeScript): each securityScheme sends the correct upstream auth end to end",
  { timeout: 300_000 },
  async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-auth-e2e-ts-"));
    const specPath = path.join(outDir, "spec.json");
    const echo = await startEchoServer();
    const PORT = 3931;
    try {
      await writeFile(specPath, JSON.stringify(AUTH_SPEC), "utf-8");
      const tools = await getToolsFromOwnEngine(specPath, { dereference: true });
      const files = emitServerProject({
        serverName: "auth-e2e-ts",
        tools,
        baseUrl: echo.origin,
        transport: "streamable-http",
        port: PORT,
        forwardHeaders: ["X-Tenant-Token"],
      });
      // Feature C is emitted separately below to keep this test's assertions
      // focused; here we prove features A + B.
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(outDir, rel);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, content, "utf-8");
      }
      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outDir, timeout: 180_000 });
      await execFileAsync("npm", ["run", "build"], { cwd: outDir, timeout: 120_000 });

      const proc = spawn("node", ["dist/index.js"], {
        cwd: outDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, KLARIDIAN_BASE_URL: echo.origin, ...AUTH_ENV },
      });
      let exited = false;
      proc.on("exit", () => { exited = true; });
      proc.stderr!.on("data", () => {});
      try {
        const origin = `http://127.0.0.1:${PORT}`;
        const mcpUrl = `${origin}/mcp`;
        await waitForReady(mcpUrl, origin, () => exited);

        // Feature A: each scheme.
        for (const kind of ["hdrKey", "qryKey", "ckeKey", "brrTok", "bscTok", "oauTok"]) {
          await callTool(mcpUrl, origin, kind);
          assertScheme(echo.last(), kind);
        }

        // Feature B: an inbound MCP client header is forwarded upstream.
        await callTool(mcpUrl, origin, "fwdHdr", { "X-Tenant-Token": "tenant-abc" });
        const fwd = echo.last();
        assert.equal(fwd?.headers["x-tenant-token"], "tenant-abc", "forwarded inbound header reaches upstream");
      } finally {
        proc.kill("SIGKILL");
      }
    } finally {
      echo.close();
      await rm(outDir, { recursive: true, force: true });
    }
  }
);

/** Resolve a usable Python 3.10+ interpreter, or throw loudly. */
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

test(
  "MCPFO-105 (Python parity): each securityScheme sends the correct upstream auth end to end",
  { timeout: 300_000 },
  async () => {
    const py = resolvePython();
    const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-auth-e2e-py-"));
    const specPath = path.join(outDir, "spec.json");
    const echo = await startEchoServer();
    const PORT = 3932;
    try {
      await writeFile(specPath, JSON.stringify(AUTH_SPEC), "utf-8");
      const tools = await getToolsFromOwnEngine(specPath, { dereference: true });
      const files = pythonTarget.emitProject({
        serverName: "auth-e2e-py",
        tools,
        baseUrl: echo.origin,
        transport: "streamable-http",
        port: PORT,
        forwardHeaders: ["X-Tenant-Token"],
      });
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(outDir, rel);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, content, "utf-8");
      }
      await execFileAsync(py, ["-m", "venv", ".venv"], { cwd: outDir, timeout: 120_000 });
      const venvPy = path.join(outDir, ".venv", "bin", "python");
      await execFileAsync(venvPy, ["-m", "pip", "install", "-q", "-r", "requirements.txt"], { cwd: outDir, timeout: 180_000 });

      const proc = spawn(venvPy, ["server.py", "--transport", "streamable-http", "--port", String(PORT)], {
        cwd: outDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, KLARIDIAN_BASE_URL: echo.origin, ...AUTH_ENV },
      });
      let exited = false;
      proc.on("exit", () => { exited = true; });
      proc.stderr!.on("data", () => {});
      try {
        const origin = `http://127.0.0.1:${PORT}`;
        const mcpUrl = `${origin}/mcp`;
        await waitForReady(mcpUrl, origin, () => exited);

        for (const kind of ["hdrKey", "qryKey", "ckeKey", "brrTok", "bscTok", "oauTok"]) {
          await callTool(mcpUrl, origin, kind);
          assertScheme(echo.last(), kind);
        }

        await callTool(mcpUrl, origin, "fwdHdr", { "X-Tenant-Token": "tenant-xyz" });
        const fwd = echo.last();
        assert.equal(fwd?.headers["x-tenant-token"], "tenant-xyz", "Python: forwarded inbound header reaches upstream");
      } finally {
        proc.kill("SIGKILL");
      }
    } finally {
      echo.close();
      await rm(outDir, { recursive: true, force: true });
    }
  }
);
