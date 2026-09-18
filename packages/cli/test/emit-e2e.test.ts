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
import { getToolsFromOwnEngine } from "../src/engine/own-engine.js";
import { emitServerProject } from "../src/emit/emit-server.js";
import { CONFORMANCE_CONTRACT } from "../src/emit/conformance/contract.js";

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
    const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-emit-e2e-"));
    try {
      // 1. Emit the project from real tool data.
      const tools = await getToolsFromOwnEngine(PETSTORE_SPEC_PATH, { dereference: true });
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
        // MCPFO-93 coexistence (leg 1): classic initialize still negotiates the
        // LEGACY 2025-11-25 wire, unchanged, on the modern-serving server.
        assert.equal(initResp.result.protocolVersion, "2025-11-25", "legacy initialize negotiates 2025-11-25");

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

        // tools/call unknown -> native protocol error. The TS SDK v2 gives
        // this at the registerTool() boundary; MCPFO-60.1 names it as the
        // shared conformance contract so the Python target (MCPFO-60.3)
        // implements against the same guarantee.
        assert.equal(CONFORMANCE_CONTRACT.unknownTool.kind, "protocol");
        sendJsonRpc(proc, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "noSuchTool", arguments: {} } });
        const unknownResp = await readOneJsonRpcLine(proc);
        assert.ok(unknownResp.error, "unknown tool is a protocol error");
        assert.equal(
          unknownResp.error.code,
          (CONFORMANCE_CONTRACT.unknownTool as { code: number }).code
        );

        // tools/call with arguments that violate the tool's input schema
        // (getPetById requires petId). Per the MCP two-tier model this is a
        // TOOL error, not a protocol error: the SDK returns a normal result
        // with isError: true and a validation message, so the model can see
        // and react to it. Verified against the real SDK — this corrected the
        // ticket's initial "invalid-arguments -> -32602" assumption. The
        // contract encodes it as { kind: "tool-error" }.
        assert.equal(CONFORMANCE_CONTRACT.invalidArguments.kind, "tool-error");
        sendJsonRpc(proc, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "getPetById", arguments: {} } });
        const invalidResp = await readOneJsonRpcLine(proc);
        assert.ok(!invalidResp.error, "schema-invalid arguments are NOT a protocol error");
        assert.equal(invalidResp.result?.isError, true, "schema-invalid arguments are a tool-error result");
        assert.match(
          invalidResp.result?.content?.[0]?.text ?? "",
          /validation/i,
          "tool-error content explains the validation failure"
        );
      } finally {
        proc.kill("SIGKILL");
      }

      // MCPFO-93 coexistence (leg 2): the MODERN path on the SAME built server.
      // A fresh stdio connection (the SDK pins one era per connection) sends a
      // `server/discover` carrying the 2026-07-28 per-request envelope claim;
      // the server must answer with a result advertising 2026-07-28 (NOT the
      // pre-MCPFO-93 -32601 method-not-found). Same dist/index.js, proving both
      // eras coexist on one emitted server.
      const proc2 = spawn("node", ["dist/index.js"], { cwd: outDir, stdio: ["pipe", "pipe", "pipe"] });
      try {
        const PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";
        const CLIENT_CAPABILITIES_META_KEY = "io.modelcontextprotocol/clientCapabilities";
        sendJsonRpc(proc2, {
          jsonrpc: "2.0", id: 1, method: "server/discover",
          params: { _meta: { [PROTOCOL_VERSION_META_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_META_KEY]: {} } },
        });
        const discoverResp = await readOneJsonRpcLine(proc2);
        assert.equal(discoverResp.id, 1);
        assert.ok(discoverResp.result, "server/discover returns a result (not -32601 method-not-found)");
        assert.ok(
          Array.isArray(discoverResp.result.supportedVersions) &&
            discoverResp.result.supportedVersions.includes("2026-07-28"),
          `server/discover advertises 2026-07-28 (got ${JSON.stringify(discoverResp.result.supportedVersions)})`
        );
      } finally {
        proc2.kill("SIGKILL");
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }
);

test(
  "MCPFO-102: streamable-http server serves the built-in HTML test client at GET / while MCP still works on /mcp",
  { timeout: 300_000 },
  async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-emit-testclient-"));
    const PORT = 3922;
    try {
      const tools = await getToolsFromOwnEngine(PETSTORE_SPEC_PATH, { dereference: true });
      const files = emitServerProject({
        serverName: "petstore-testclient-e2e",
        tools,
        baseUrl: "https://petstore3.swagger.io/api/v3",
        transport: "streamable-http",
        port: PORT,
      });
      // The vendored, readable test-client source must be emitted (PLAN.md §7).
      assert.ok(files["src/test-client.ts"], "src/test-client.ts is emitted for streamable-http");
      assert.match(files["src/test-client.ts"], /TEST_CLIENT_HTML/, "exports TEST_CLIENT_HTML");
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
      proc.stderr!.on("data", () => {});
      try {
        const origin = `http://127.0.0.1:${PORT}`;
        const mcpUrl = `${origin}/mcp`;
        const headers = {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Origin: origin,
        };
        const post = async (body: unknown) => {
          const r = await fetch(mcpUrl, { method: "POST", headers, body: JSON.stringify(body) });
          const text = await r.text();
          const line = text.split("\n").map((l) => l.replace(/^data:\s*/, "").trim()).find((l) => l.startsWith("{"));
          return line ? JSON.parse(line) : null;
        };

        // Connection-based readiness (never log-based): poll /mcp until it answers.
        await (async () => {
          const deadline = Date.now() + 15000;
          let lastErr: unknown;
          while (Date.now() < deadline) {
            if (exitedEarly) throw new Error("server exited before it became ready");
            try {
              await post({ jsonrpc: "2.0", id: 0, method: "initialize",
                params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "probe", version: "1.0.0" } } });
              return;
            } catch (e) {
              lastErr = e;
              await new Promise((r) => setTimeout(r, 150));
            }
          }
          throw new Error(`server did not become ready within 15s: ${String(lastErr)}`);
        })();

        // GET / returns the built-in HTML test client.
        const rootRes = await fetch(`${origin}/`, { method: "GET", headers: { Origin: origin } });
        assert.equal(rootRes.status, 200, "GET / responds 200");
        assert.match(rootRes.headers.get("content-type") ?? "", /text\/html/, "GET / is HTML");
        const html = await rootRes.text();
        assert.match(html, /<title>MCP test client<\/title>/, "served page is the test client");
        assert.match(html, /\/mcp/, "test client posts to /mcp");
        assert.match(html, /application\/json, text\/event-stream/, "test client sends the required Accept header");

        // The test client did NOT break MCP: tools/list over /mcp still works.
        const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" } } });
        assert.ok(init?.result, "initialize still works after adding the GET / route");
        const listResp = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        assert.ok(Array.isArray(listResp?.result?.tools), "tools/list still works over /mcp");
        assert.equal(listResp.result.tools.length, tools.length, "all tools still listed");

        assert.equal(exitedEarly, false, "server stayed alive across GET / and MCP POSTs");
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
    const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-emit-http-"));
    const PORT = 3921;
    try {
      const tools = await getToolsFromOwnEngine(PETSTORE_SPEC_PATH, { dereference: true });
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
      // Drain stderr so the child never blocks on a full pipe.
      proc.stderr!.on("data", () => {});
      try {
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

        // Readiness is connection-based, NOT log-based: the server prints its
        // startup line to stderr BEFORE the socket is bound, so the log is not
        // proof the port accepts requests. Poll the real endpoint until it
        // answers (ECONNREFUSED is expected in the gap between the log and the
        // bind), bailing immediately if the process dies.
        await (async () => {
          const deadline = Date.now() + 15000;
          let lastErr: unknown;
          while (Date.now() < deadline) {
            if (exitedEarly) throw new Error("server exited before it became ready");
            try {
              await post({ jsonrpc: "2.0", id: 0, method: "initialize",
                params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "probe", version: "1.0.0" } } });
              return;
            } catch (e) {
              lastErr = e;
              await new Promise((r) => setTimeout(r, 150));
            }
          }
          throw new Error(`server did not become ready within 15s: ${String(lastErr)}`);
        })();

        // Request 1: initialize
        const r1 = await post({ jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1.0.0" } } });
        assert.ok(r1?.result, "initialize ok");
        // MCPFO-93 coexistence (leg 1, HTTP): legacy initialize negotiates 2025-11-25.
        assert.equal(r1.result.protocolVersion, "2025-11-25", "HTTP legacy initialize negotiates 2025-11-25");

        // Request 2: tools/list — the SECOND request, where the v1 session-based transport crashes
        const r2 = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
        assert.ok(Array.isArray(r2?.result?.tools), "tools/list ok on 2nd request (no ReadableStream crash)");

        // Request 3 + 4: more sequential calls, proving the process stays alive
        const r3 = await post({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
        assert.ok(Array.isArray(r3?.result?.tools), "3rd request ok");
        const r4 = await post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "noSuchTool", arguments: {} } });
        assert.equal(r4?.error?.code, (CONFORMANCE_CONTRACT.unknownTool as { code: number }).code, "4th request: unknown tool is a native protocol error");

        // MCPFO-93 coexistence (leg 2, HTTP): the MODERN path on the SAME server.
        // Over HTTP the modern era is header-driven: the SDK requires the
        // `Mcp-Method` and `MCP-Protocol-Version` headers alongside the
        // per-request envelope (createMcpHandler cross-checks header vs body).
        // A `server/discover` so framed must return a result advertising
        // 2026-07-28, proving both eras coexist over HTTP too.
        const PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";
        const CLIENT_CAPABILITIES_META_KEY = "io.modelcontextprotocol/clientCapabilities";
        const discoverBody = {
          jsonrpc: "2.0", id: 5, method: "server/discover",
          params: { _meta: { [PROTOCOL_VERSION_META_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_META_KEY]: {} } },
        };
        const discoverRes = await fetch(url, {
          method: "POST",
          headers: {
            ...headers,
            "Mcp-Method": "server/discover",
            "MCP-Protocol-Version": "2026-07-28",
          },
          body: JSON.stringify(discoverBody),
        });
        const discoverText = await discoverRes.text();
        const discoverLine = discoverText
          .split("\n")
          .map((l) => l.replace(/^data:\s*/, "").trim())
          .find((l) => l.startsWith("{"));
        const rDiscover = discoverLine ? JSON.parse(discoverLine) : null;
        assert.ok(rDiscover?.result, `server/discover returns a result over HTTP (not method-not-found); got ${discoverText}`);
        assert.ok(
          Array.isArray(rDiscover.result.supportedVersions) &&
            rDiscover.result.supportedVersions.includes("2026-07-28"),
          `HTTP server/discover advertises 2026-07-28 (got ${JSON.stringify(rDiscover.result.supportedVersions)})`
        );

        assert.equal(exitedEarly, false, "server did not crash across 4 sequential requests");
      } finally {
        proc.kill("SIGKILL");
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }
);
