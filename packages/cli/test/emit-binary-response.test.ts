// packages/cli/test/emit-binary-response.test.ts
//
// MCPFO-78 (ARCHITECTURE.md §99) — spec-native binary/download response
// handling. A tool whose OpenAPI success body is non-textual
// (image/audio/octet-stream/pdf/…) must NOT decode the bytes into a text block;
// it returns the MCP-native way — a `resource_link` (redirect / large / non-media)
// or an inline `image`/`audio` block (small media) — driven by
// `emit/response-schema.ts` classification threaded onto the ToolIR.
//
// Two layers:
//  1. Pure unit tests of the classifier (isTextualContentType,
//     detectBinaryResponse, extractBinaryResponsesByOperationId incl. $ref +
//     fail-soft).
//  2. Emitter tests: emit-tool (TS) and the Python proxy emit the binary branch
//     ONLY when the IR carries `binaryResponse`, and stay byte-identical to the
//     text proxy when it doesn't.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isTextualContentType,
  detectBinaryResponse,
  extractBinaryResponsesByOperationId,
  type BinaryResponseMeta,
} from "../src/emit/response-schema.js";
import { emitToolBlock } from "../src/emit/emit-tool.js";
import { pythonTarget } from "../src/emit/target.js";
import { emitServerProject } from "../src/emit/emit-server.js";
import http from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import type { ToolIR } from "../src/emit/ir.js";

const execFileAsync = promisify(execFile);

function baseTool(overrides: Partial<ToolIR> = {}): ToolIR {
  return {
    name: "downloadFile",
    description: "Download a file",
    method: "get",
    pathTemplate: "/files/{id}",
    inputSchema: { type: "object", properties: { id: { type: "string" } } },
    executionParameters: [{ name: "id", in: "path" }],
    securityRequirements: [],
    operationId: "downloadFile",
    ...overrides,
  };
}

const binaryMeta: BinaryResponseMeta = { kind: "binary", contentType: "application/octet-stream" };

// ---------------------------------------------------------------------------
// isTextualContentType
// ---------------------------------------------------------------------------

test("isTextualContentType: text/* is textual", () => {
  assert.equal(isTextualContentType("text/plain"), true);
  assert.equal(isTextualContentType("text/csv; charset=utf-8"), true);
});

test("isTextualContentType: JSON + vendor +json are textual", () => {
  assert.equal(isTextualContentType("application/json"), true);
  assert.equal(isTextualContentType("application/vnd.api+json"), true);
});

test("isTextualContentType: XML + vendor +xml are textual", () => {
  assert.equal(isTextualContentType("application/xml"), true);
  assert.equal(isTextualContentType("application/atom+xml"), true);
});

test("isTextualContentType: binary media types are NOT textual", () => {
  for (const ct of [
    "application/octet-stream",
    "application/pdf",
    "image/png",
    "audio/mpeg",
    "video/mp4",
    "application/x-ndjson",
    "font/woff2",
    "application/zip",
  ]) {
    assert.equal(isTextualContentType(ct), false, ct);
  }
});

// ---------------------------------------------------------------------------
// detectBinaryResponse
// ---------------------------------------------------------------------------

test("detectBinaryResponse: octet-stream 200 → binary", () => {
  const meta = detectBinaryResponse({
    "200": { description: "bytes", content: { "application/octet-stream": { schema: {} } } },
  });
  assert.deepEqual(meta, { kind: "binary", contentType: "application/octet-stream" });
});

test("detectBinaryResponse: image 200 → kind image", () => {
  const meta = detectBinaryResponse({
    "200": { description: "img", content: { "image/png": { schema: {} } } },
  });
  assert.equal(meta?.kind, "image");
});

test("detectBinaryResponse: audio 200 → kind audio", () => {
  const meta = detectBinaryResponse({
    "200": { description: "a", content: { "audio/mpeg": { schema: {} } } },
  });
  assert.equal(meta?.kind, "audio");
});

test("detectBinaryResponse: JSON success wins → undefined (no regression)", () => {
  const meta = detectBinaryResponse({
    "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } },
  });
  assert.equal(meta, undefined);
});

test("detectBinaryResponse: mixed JSON + octet-stream → textual wins", () => {
  const meta = detectBinaryResponse({
    "200": {
      description: "ok",
      content: {
        "application/json": { schema: { type: "object" } },
        "application/octet-stream": { schema: {} },
      },
    },
  });
  assert.equal(meta, undefined);
});

test("detectBinaryResponse: 204 no content → undefined", () => {
  assert.equal(detectBinaryResponse({ "204": { description: "no content" } }), undefined);
});

test("detectBinaryResponse: precedence 200 over other 2xx", () => {
  const meta = detectBinaryResponse({
    "206": { description: "partial", content: { "application/octet-stream": { schema: {} } } },
    "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } },
  });
  // 200 is JSON and wins the precedence, so no binary classification.
  assert.equal(meta, undefined);
});

// ---------------------------------------------------------------------------
// extractBinaryResponsesByOperationId — with a $ref'd response + fail-soft
// ---------------------------------------------------------------------------

test("extractBinaryResponsesByOperationId: resolves a $ref response + classifies", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kl-bin-"));
  try {
    const spec = {
      openapi: "3.0.3",
      info: { title: "t", version: "1.0.0" },
      paths: {
        "/f/{id}": {
          get: {
            operationId: "dl",
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { $ref: "#/components/responses/Bin" } },
          },
        },
        "/j": {
          get: {
            operationId: "listJson",
            responses: {
              "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } },
            },
          },
        },
      },
      components: {
        responses: {
          Bin: { description: "bytes", content: { "application/octet-stream": { schema: {} } } },
        },
      },
    };
    const specPath = path.join(dir, "spec.json");
    await writeFile(specPath, JSON.stringify(spec));
    const map = await extractBinaryResponsesByOperationId(specPath);
    assert.equal(map.get("dl")?.kind, "binary");
    assert.equal(map.has("listJson"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("extractBinaryResponsesByOperationId: unparseable spec → empty map (fail-soft)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kl-bin-"));
  try {
    const specPath = path.join(dir, "broken.json");
    await writeFile(specPath, "{ not valid json");
    const map = await extractBinaryResponsesByOperationId(specPath);
    assert.equal(map.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TS emitter — binary branch present only with binaryResponse
// ---------------------------------------------------------------------------

test("emitToolBlock (TS): binaryResponse → resource_link + manual redirect, no resp.text() on success", () => {
  const src = emitToolBlock(baseTool({ binaryResponse: binaryMeta }));
  assert.match(src, /redirect: "manual"/);
  assert.match(src, /type: "resource_link"/);
  assert.match(src, /type: kind, data, mimeType/); // inline image|audio path
  // Must NOT fall through to the plain text proxy that decodes the whole body.
  assert.doesNotMatch(src, /const text = await resp\.text\(\);/);
});

test("emitToolBlock (TS): no binaryResponse → unchanged text proxy", () => {
  const src = emitToolBlock(baseTool());
  assert.doesNotMatch(src, /resource_link/);
  assert.doesNotMatch(src, /redirect: "manual"/);
  assert.match(src, /const text = await resp\.text\(\);/);
});

// ---------------------------------------------------------------------------
// Python emitter — binary branch present only with binaryResponse
// ---------------------------------------------------------------------------

test("emitProject (Python): binaryResponse → ResourceLink + follow_redirects=False", () => {
  const files = pythonTarget.emitProject({
    serverName: "bin-py",
    tools: [baseTool({ binaryResponse: binaryMeta })],
    baseUrl: "https://api.example.com",
    transport: "stdio",
  });
  const toolsPy = files["tools.py"]!;
  assert.match(toolsPy, /follow_redirects=False/);
  assert.match(toolsPy, /types\.ResourceLink\(/);
  assert.match(toolsPy, /types\.ImageContent\(|types\.AudioContent\(/);
});

test("emitProject (Python): no binaryResponse → unchanged request proxy", () => {
  const files = pythonTarget.emitProject({
    serverName: "bin-py",
    tools: [baseTool()],
    baseUrl: "https://api.example.com",
    transport: "stdio",
  });
  const toolsPy = files["tools.py"]!;
  assert.doesNotMatch(toolsPy, /ResourceLink/);
  assert.doesNotMatch(toolsPy, /follow_redirects=False/);
  assert.match(toolsPy, /client\.request\(/);
});

// ---------------------------------------------------------------------------
// LOAD-BEARING E2E (TS): real emit → npm install → tsc build → spawn → drive
// against a MOCK upstream, asserting the binary handler returns the right
// content blocks and never decodes bytes into text. The TS SDK is the higher-
// risk target (it VALIDATES tool output), so this is the one proven end to end.
// ---------------------------------------------------------------------------

function e2eTool(name: string, pathTemplate: string, binary?: BinaryResponseMeta): ToolIR {
  return {
    name,
    description: name,
    method: "get",
    pathTemplate,
    inputSchema: { type: "object", properties: { id: { type: "string" } } },
    executionParameters: [{ name: "id", in: "path" }],
    securityRequirements: [],
    operationId: name,
    binaryResponse: binary,
  };
}

test(
  "E2E (TS): generated binary handlers return resource_link / inline image, JSON stays text",
  { timeout: 300_000 },
  async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "kl-bin-e2e-"));
    // 1x1 PNG.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64"
    );
    const upstream = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://localhost");
      if (u.pathname.startsWith("/avatars/")) {
        res.writeHead(200, { "content-type": "image/png", "content-length": String(png.length) });
        res.end(png);
      } else if (u.pathname.startsWith("/files/")) {
        res.writeHead(302, { location: "https://cdn.example.com/signed/abc.bin?sig=xyz" });
        res.end();
      } else if (u.pathname === "/pets") {
        const body = JSON.stringify({ pets: ["rex"] });
        res.writeHead(200, { "content-type": "application/json", "content-length": String(body.length) });
        res.end(body);
      } else {
        res.writeHead(404);
        res.end("no");
      }
    });
    let proc: ReturnType<typeof spawn> | undefined;
    try {
      await new Promise<void>((r) => upstream.listen(0, r));
      const port = (upstream.address() as { port: number }).port;
      const base = `http://127.0.0.1:${port}`;

      const tools: ToolIR[] = [
        e2eTool("getAvatar", "/avatars/{id}", { kind: "image", contentType: "image/png" }),
        e2eTool("downloadFile", "/files/{id}", { kind: "binary", contentType: "application/octet-stream" }),
        e2eTool("listPets", "/pets"),
      ];
      const files = emitServerProject({ serverName: "bin-e2e", tools, baseUrl: base, transport: "stdio" });
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(outDir, rel);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, content, "utf-8");
      }
      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outDir, timeout: 180_000 });
      await execFileAsync("npm", ["run", "build"], { cwd: outDir, timeout: 120_000 });

      proc = spawn("node", ["dist/index.js"], {
        cwd: outDir,
        env: { ...process.env, KLARIDIAN_BASE_URL: base },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const child = proc;
      let buf = "";
      const pending = new Map<number, (m: any) => void>();
      child.stdout!.on("data", (d: Buffer) => {
        buf += d.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let m: any;
          try { m = JSON.parse(line); } catch { continue; }
          if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
        }
      });
      const rpc = (id: number, method: string, params: unknown) =>
        new Promise<any>((resolve, reject) => {
          pending.set(id, resolve);
          child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
          setTimeout(() => reject(new Error("timeout " + method)), 20_000);
        });

      await rpc(1, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
      child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

      const call = (id: number, name: string, args: unknown) => rpc(id, "tools/call", { name, arguments: args });

      const avatar = (await call(10, "getAvatar", { id: "1" })).result;
      assert.equal(avatar.content[0].type, "image", "small image inlined as image block");
      assert.equal(avatar.content[0].mimeType, "image/png");
      assert.ok(avatar.content[0].data, "inline image carries base64 data");

      const file = (await call(11, "downloadFile", { id: "1" })).result;
      const link = file.content.find((c: any) => c.type === "resource_link");
      assert.ok(link, "redirect download returns a resource_link");
      assert.match(link.uri, /cdn\.example\.com/, "resource_link points at the pre-signed Location");
      assert.ok(!file.content.some((c: any) => c.type === "image" || c.type === "audio"), "no inline media for a redirect");

      const pets = (await call(12, "listPets", {})).result;
      assert.equal(pets.content[0].type, "text", "JSON endpoint stays text");
      assert.match(pets.content[0].text, /rex/);
    } finally {
      proc?.kill("SIGKILL");
      await new Promise<void>((r) => upstream.close(() => r()));
      await rm(outDir, { recursive: true, force: true });
    }
  }
);
