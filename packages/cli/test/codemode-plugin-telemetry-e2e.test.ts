// packages/cli/test/codemode-plugin-telemetry-e2e.test.ts
//
// MCPFO-134 (ARCHITECTURE.md §105) — LOAD-BEARING E2E for observability
// plugins on code-mode servers. Generates real code-mode servers with
// `--plugin otel` via the CLI (TypeScript and Python), runs them the way a
// user does (`node dist/server.bundle.js`, i.e. `npm start`; `python
// server.py`), sends one execute_code whose script calls two API operations
// (one 200, one 404) with a W3C traceparent in the request _meta, and checks
// what reaches a real OTLP/HTTP collector:
//   - one mcp.tool.call execute_code span, child of the caller's span;
//   - one CLIENT child span per upstream call, named "{method} {url.template}",
//     with the operation, status and host as attributes, and the 404 as ERROR.
// The TS leg runs the esbuild BUNDLE on purpose: the older code-mode + otel
// test ran dist/index.js and never saw that the bundle crashed at startup.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CLI_ENTRYPOINT } from "./test-helpers.js";

const execFileAsync = promisify(execFile);
const PETSTORE_SPEC = path.resolve(path.dirname(CLI_ENTRYPOINT), "../../../../examples/petstore/openapi.json");
const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const PARENT_SPAN_ID = "00f067aa0ba902b7";

interface SimpleSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId: string;
  kind: number; // OTLP enum: 1 INTERNAL, 2 SERVER, 3 CLIENT
  status: number; // 0 UNSET, 1 OK, 2 ERROR
  attrs: Record<string, unknown>;
}

function isDenoAvailable(): boolean {
  try {
    execFileSync("deno", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

function resolvePython(): string {
  const pinned = process.env.KLARIDIAN_TEST_PYTHON;
  for (const candidate of pinned ? [pinned] : ["python3.11", "python3", "python"]) {
    try {
      const m = execFileSync(candidate, ["--version"], { encoding: "utf-8" }).match(/Python (\d+)\.(\d+)/);
      if (m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 11))) return candidate;
    } catch {
      /* try next */
    }
  }
  throw new Error("No Python >=3.11 interpreter found on PATH.");
}

/** Upstream stand-in: findByStatus -> 200, pet 404 -> 404. */
function startUpstream(): Promise<Server & { port: number }> {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/pet/findByStatus")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([{ id: 1, name: "rex", photoUrls: [] }]));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Not Found" }));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(Object.assign(server, { port: (server.address() as AddressInfo).port }))));
}

/** OTLP/HTTP collector: keeps raw request bodies (TS sends JSON, Python sends protobuf). */
function startCollector(): Promise<{ server: Server; port: number; bodies: { type: string; body: Buffer }[] }> {
  const bodies: { type: string; body: Buffer }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      bodies.push({ type: String(req.headers["content-type"] ?? ""), body: Buffer.concat(chunks) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port, bodies })));
}

function spansFromJson(bodies: { type: string; body: Buffer }[]): SimpleSpan[] {
  const out: SimpleSpan[] = [];
  for (const b of bodies) {
    if (!b.type.includes("json") || b.body.length === 0) continue;
    const d = JSON.parse(b.body.toString("utf-8"));
    for (const rs of d.resourceSpans ?? []) for (const ss of rs.scopeSpans ?? []) for (const s of ss.spans ?? []) {
      out.push({
        name: s.name, traceId: s.traceId, spanId: s.spanId, parentSpanId: s.parentSpanId ?? "", kind: s.kind, status: s.status?.code ?? 0,
        attrs: Object.fromEntries((s.attributes ?? []).map((a: any) => [a.key, Object.values(a.value)[0]])),
      });
    }
  }
  return out;
}

/** Python exports protobuf; decode it with the generated project's own opentelemetry-proto. */
async function spansFromProtobuf(venvPy: string, bodies: { type: string; body: Buffer }[], dir: string): Promise<SimpleSpan[]> {
  const out: SimpleSpan[] = [];
  const decoder = path.join(dir, "decode_otlp.py");
  await writeFile(
    decoder,
    [
      "import json, sys",
      "from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest",
      "req = ExportTraceServiceRequest(); req.ParseFromString(open(sys.argv[1], 'rb').read())",
      "out = []",
      "for rs in req.resource_spans:",
      "    for ss in rs.scope_spans:",
      "        for s in ss.spans:",
      "            attrs = {a.key: (a.value.string_value or a.value.int_value) for a in s.attributes}",
      "            out.append({'name': s.name, 'traceId': s.trace_id.hex(), 'spanId': s.span_id.hex(), 'parentSpanId': s.parent_span_id.hex(), 'kind': s.kind, 'status': s.status.code, 'attrs': attrs})",
      "print(json.dumps(out))",
    ].join("\n"),
    "utf-8"
  );
  let i = 0;
  for (const b of bodies) {
    if (!b.type.includes("protobuf") || b.body.length === 0) continue;
    const f = path.join(dir, `otlp-${i++}.bin`);
    await writeFile(f, b.body);
    const { stdout } = await execFileAsync(venvPy, [decoder, f]);
    out.push(...JSON.parse(stdout));
  }
  return out;
}

/** Drives one execute_code over stdio with a traceparent, then closes stdin (clean exit, exporters flush). */
async function driveExecuteCode(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, ext: "js" | "ts") {
  const proc = spawn(cmd, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  proc.stderr!.on("data", (c: Buffer) => (stderr += c.toString("utf-8")));
  const lines: any[] = [];
  let buf = "";
  const waiters: Array<() => void> = [];
  proc.stdout!.on("data", (c: Buffer) => {
    buf += c.toString("utf-8");
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith("{")) { lines.push(JSON.parse(line)); waiters.splice(0).forEach((w) => w()); }
    }
  });
  const next = (id: number, ms = 60_000) =>
    new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for id ${id}; stderr:\n${stderr}`)), ms);
      const check = () => {
        const m = lines.find((l) => l.id === id);
        if (m) { clearTimeout(t); resolve(m); } else waiters.push(check);
      };
      check();
    });
  const send = (m: unknown) => proc.stdin!.write(JSON.stringify(m) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } });
  await next(1);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const code =
    `import { findPetsByStatus, getPetById } from "./client.${ext}";\n` +
    `const a = await findPetsByStatus({ status: "available" });\n` +
    `let b = 0; try { await getPetById({ petId: 404 }); } catch (e) { b = e.status; }\n` +
    `console.log(JSON.stringify({ a: a.status, b }));`;
  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "execute_code", arguments: { code }, _meta: { traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01` } } });
  const resp = await next(2);
  proc.stdin!.end();
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, 15_000);
    proc.on("exit", () => { clearTimeout(t); resolve(); });
  });
  return { result: resp.result, stderr };
}

function assertCodeModeTrace(spans: SimpleSpan[], label: string) {
  const tool = spans.find((s) => s.name === "mcp.tool.call execute_code");
  assert.ok(tool, `${label}: tool span exported; got ${spans.map((s) => s.name).join(", ")}`);
  assert.equal(tool.traceId, TRACE_ID, `${label}: tool span joins the caller's trace`);
  assert.equal(tool.parentSpanId, PARENT_SPAN_ID, `${label}: tool span is a child of the caller's span`);
  const children = spans.filter((s) => s.parentSpanId === tool.spanId && s.kind === 3);
  assert.deepEqual(children.map((s) => s.name).sort(), ["GET /pet/findByStatus", "GET /pet/{petId}"], `${label}: one CLIENT child span per upstream call`);
  const ok = children.find((s) => s.name === "GET /pet/findByStatus")!;
  const notFound = children.find((s) => s.name === "GET /pet/{petId}")!;
  assert.equal(ok.attrs["klaridian.api.operation"], "findPetsByStatus");
  assert.equal(Number(ok.attrs["http.response.status_code"]), 200);
  assert.equal(ok.attrs["server.address"], "127.0.0.1", `${label}: host recorded (host only, per OTel semconv)`);
  assert.ok(Number(ok.attrs["server.port"]) > 0, `${label}: port recorded separately`);
  assert.notEqual(ok.status, 2, `${label}: 200 is not an error`);
  assert.equal(Number(notFound.attrs["http.response.status_code"]), 404);
  assert.equal(notFound.status, 2, `${label}: 404 child span is ERROR`);
  for (const c of children) {
    assert.equal(c.traceId, TRACE_ID);
    for (const k of Object.keys(c.attrs)) assert.doesNotMatch(k, /argument|body|header/i, `${label}: no arguments/bodies recorded`);
  }
}

function assertApiCallsMeta(result: any, label: string) {
  assert.equal(result.isError, false, `${label}: ${JSON.stringify(result)}`);
  assert.deepEqual(JSON.parse(result.content[0].text.trim()), { a: 200, b: 404 });
  const calls = result._meta?.["dev.klaridian/api-calls"];
  assert.deepEqual(calls?.map((c: any) => [c.operation, c.status]), [["findPetsByStatus", 200], ["getPetById", 404]], `${label}: _meta lists the calls`);
  assert.doesNotMatch(result.content[0].text, /@@klaridian-api-call@@/, `${label}: marker lines never reach the model`);
}

test("code-mode + otel (TypeScript, bundled npm start): one child span per API call inside execute_code", { timeout: 600_000 }, async (t) => {
  if (!isDenoAvailable()) {
    t.skip("deno not on PATH (install with `brew install deno`)");
    return;
  }
  const upstream = await startUpstream();
  const collector = await startCollector();
  const out = await mkdtemp(path.join(tmpdir(), "klaridian-cm-otel-ts-"));
  try {
    await execFileAsync("node", [CLI_ENTRYPOINT, "generate", "--spec", PETSTORE_SPEC, "--out", out, "--name", "cm-otel-ts", "--force",
      "--architecture", "code-mode", "--base-url", `http://127.0.0.1:${upstream.port}`,
      "--plugin", "otel", "--plugin-config", "otel.serviceName=cm-otel-ts", "--plugin-config", `otel.otlpEndpoint=http://127.0.0.1:${collector.port}/v1/traces`]);
    await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: out, timeout: 240_000 });
    await execFileAsync("npm", ["run", "build"], { cwd: out, timeout: 120_000 });
    const { result, stderr } = await driveExecuteCode("node", ["dist/server.bundle.js"], out,
      { ...process.env, KLARIDIAN_BASE_URL: `http://127.0.0.1:${upstream.port}` }, "js");
    assertApiCallsMeta(result, "ts");
    assert.doesNotMatch(stderr, /Dynamic require|duplicate registration/, "the bundle starts cleanly with otel");
    assertCodeModeTrace(spansFromJson(collector.bodies), "ts");
  } finally {
    upstream.close();
    collector.server.close();
    await rm(out, { recursive: true, force: true });
  }
});

test("code-mode + otel (Python): one child span per API call inside execute_code", { timeout: 600_000 }, async () => {
  const py = resolvePython();
  const upstream = await startUpstream();
  const collector = await startCollector();
  const out = await mkdtemp(path.join(tmpdir(), "klaridian-cm-otel-py-"));
  try {
    await execFileAsync("node", [CLI_ENTRYPOINT, "generate", "--spec", PETSTORE_SPEC, "--out", out, "--name", "cm-otel-py", "--force",
      "--language", "python", "--architecture", "code-mode", "--base-url", `http://127.0.0.1:${upstream.port}`,
      "--plugin", "otel", "--plugin-config", "otel.serviceName=cm-otel-py", "--plugin-config", `otel.otlpEndpoint=http://127.0.0.1:${collector.port}/v1/traces`]);
    await execFileAsync(py, ["-m", "venv", ".venv"], { cwd: out, timeout: 120_000 });
    const venvPy = path.join(out, ".venv", "bin", "python");
    await execFileAsync(venvPy, ["-m", "pip", "install", "-q", "-r", "requirements.txt"], { cwd: out, timeout: 300_000 });
    await execFileAsync(venvPy, ["sandbox_runner.py", "--install"], { cwd: out, timeout: 180_000 });
    const { result } = await driveExecuteCode(venvPy, ["server.py"], out,
      { PATH: "/usr/bin:/bin", KLARIDIAN_BASE_URL: `http://127.0.0.1:${upstream.port}` }, "ts");
    assertApiCallsMeta(result, "py");
    assertCodeModeTrace(await spansFromProtobuf(venvPy, collector.bodies, out), "py");
  } finally {
    upstream.close();
    collector.server.close();
    await rm(out, { recursive: true, force: true });
  }
});
