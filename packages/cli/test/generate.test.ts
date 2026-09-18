// packages/cli/test/generate.test.ts
//
// End-to-end validation of `klaridian generate` at the CLI level. The command
// extracts pure tool DATA from the spec via openapi-mcp-generator's
// getToolsFromOpenApi(), then emits a v2 (@modelcontextprotocol/server)
// project with klaridian's own emitter (MCPFO-21 cutover, ARCHITECTURE.md
// sections 38/49). These tests exercise the real binary — install + tsc build
// + spawn-and-drive over stdio JSON-RPC — mirroring the rigor used for the
// emitter module itself (emit-e2e.test.ts) and the pre-cutover pipeline
// (spikes/001-otel-mechanic/FINDINGS.md).

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import http from "node:http";
import { execFileAsync, CLI_ENTRYPOINT, sendJsonRpc } from "./test-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

test(
  "generate (no plugin): produces a working, uninstrumented v2 server that installs and builds",
  { timeout: 180_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-gen-plain-"));
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-petstore-plain",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
      ]);
      assert.match(result.stderr, /Generated 19 tool\(s\)/);
      assert.doesNotMatch(result.stderr, /\+ otel/);

      const serverSource = await readFile(path.join(outputDir, "src", "server-factory.ts"), "utf-8");
      assert.doesNotMatch(serverSource, /wrapTool/, "no plugin requested -> no instrumentation wiring");
      assert.match(serverSource, /@modelcontextprotocol\/server/, "v2 SDK import");

      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outputDir, timeout: 120_000 });
      const buildResult = await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 120_000 });
      assert.doesNotMatch(buildResult.stderr, /error TS/);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate --plugin otel: instruments the emitted v2 server, stdout stays clean JSON-RPC",
  { timeout: 180_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-gen-otel-"));
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-petstore-otel",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
        "--plugin",
        "otel",
        "--plugin-config",
        "otel.serviceName=test-petstore-otel",
      ]);
      assert.match(result.stderr, /Generated 19 tool\(s\)/);
      assert.match(result.stderr, /\+ otel/);

      const serverSource = await readFile(path.join(outputDir, "src", "server-factory.ts"), "utf-8");
      assert.match(serverSource, /import \{ wrapTool \} from ".\/instrumentation\/otel\.js";/);
      // Every handler is wrapped via the plugin's wrap function at the
      // registerTool boundary (v2 native wiring — no textual patch).
      assert.match(serverSource, /wrapTool\(\s*"getPetById"\s*,\s*async \(args\)/);

      const otelFileContent = await readFile(path.join(outputDir, "src", "instrumentation", "otel.ts"), "utf-8");
      assert.match(otelFileContent, /OTLPTraceExporter/);
      assert.doesNotMatch(otelFileContent, /new ConsoleSpanExporter/, "spikes/001-otel-mechanic/FINDINGS.md finding: never ConsoleSpanExporter");

      const packageJson = JSON.parse(await readFile(path.join(outputDir, "package.json"), "utf-8"));
      assert.ok(packageJson.dependencies["@opentelemetry/sdk-node"]);

      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outputDir, timeout: 120_000 });
      const buildResult = await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 120_000 });
      assert.doesNotMatch(buildResult.stderr, /error TS/);

      // Drive the real compiled server over stdio JSON-RPC — the critical
      // invariant carried over from the pre-cutover pipeline
      // (spikes/001-otel-mechanic/FINDINGS.md): stdout must stay valid
      // JSON-RPC only, even with OTel active and no collector available to
      // receive the exported spans.
      const proc = spawn("node", ["dist/index.js"], {
        cwd: outputDir,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdoutBuf = "";
      let stderrBuf = "";
      proc.stdout!.on("data", (d) => (stdoutBuf += d.toString()));
      proc.stderr!.on("data", (d) => (stderrBuf += d.toString()));

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          proc.kill();
          reject(new Error(`Timed out. stderr so far: ${stderrBuf}`));
        }, 20_000);

        setTimeout(
          () =>
            sendJsonRpc(proc, {
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "gen-test", version: "0.0.1" } },
            }),
          300
        );
        setTimeout(() => sendJsonRpc(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), 800);
        setTimeout(
          () =>
            sendJsonRpc(proc, {
              jsonrpc: "2.0",
              id: 3,
              method: "tools/call",
              params: { name: "getPetById", arguments: { petId: 10 } },
            }),
          1300
        );
        setTimeout(() => {
          clearTimeout(timeout);
          proc.kill("SIGTERM"); // exercises the plugin's SIGTERM shutdown handler
          resolve();
        }, 4000);
      });

      await new Promise((r) => setTimeout(r, 500));

      const lines = stdoutBuf.trim().split("\n").filter(Boolean);
      assert.ok(lines.length >= 2, `Expected JSON-RPC response lines, got ${lines.length}: ${stdoutBuf}`);
      const parsed = lines.map((line, i) => {
        try {
          return JSON.parse(line);
        } catch {
          assert.fail(`stdout line ${i} is not valid JSON: ${line.slice(0, 200)}`);
        }
      });

      const listResponse = parsed.find((r) => r.id === 2);
      assert.equal(listResponse.result.tools.length, 19);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test("generate: rejects more than one --plugin (the emitter supports at most one)", { timeout: 60_000 }, async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-gen-multi-"));
  try {
    await assert.rejects(
      execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-petstore-multi",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
        "--plugin",
        "amplitude",
        "--plugin",
        "mixpanel",
      ]),
      /at most one --plugin/
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("getPluginProjectAdditions throws PluginContributionError on a file-path collision between plugins", async () => {
  const { getPluginProjectAdditions, PluginContributionError } = await import("../src/render/instrument.js");
  const { otelPlugin } = await import("../src/plugins/otel/otel.plugin.js");

  const conflictingPlugin = {
    ...otelPlugin,
    id: "otel-clone",
    // Deliberately reuses otel's exact contributed file path to trigger
    // the collision guard — a real second plugin would never do this
    // (each plugin should namespace under its own id), but the guard
    // needs to actually fire if one ever did by mistake.
    getTemplateContributions: otelPlugin.getTemplateContributions,
  };

  assert.throws(
    () =>
      getPluginProjectAdditions(
        [otelPlugin, conflictingPlugin],
        new Map([
          ["otel", { otlpEndpoint: "http://localhost:4318/v1/traces", serviceName: "a" }],
          ["otel-clone", { otlpEndpoint: "http://localhost:4318/v1/traces", serviceName: "b" }],
        ])
      ),
    PluginContributionError,
    "two plugins contributing the same file path should fail loudly, not silently overwrite"
  );
});

test(
  "generate --install: fuses decide+prepare — installs, builds, and adjusts nextSteps to skip both",
  { timeout: 180_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-gen-install-"));
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-petstore-install",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
        "--install",
        "--json",
      ]);

      const jsonResult = JSON.parse(result.stdout);
      assert.equal(jsonResult.success, true);
      // ARCHITECTURE.md section 58: --install already ran npm install + npm
      // run build, so the printed next step should be just `npm start` —
      // no leftover "npm install && npm run build" for something already done.
      assert.match(jsonResult.nextSteps, /npm start/);
      assert.doesNotMatch(jsonResult.nextSteps, /npm install/);
      assert.doesNotMatch(jsonResult.nextSteps, /npm run build/);

      // The real artifact --install promised must actually exist — not
      // just a next-steps string that claims it does.
      const bundlePath = path.join(outputDir, "dist", "server.bundle.js");
      const bundleStat = await import("node:fs/promises").then((fs) => fs.stat(bundlePath));
      assert.ok(bundleStat.isFile(), "npm run build should have produced dist/server.bundle.js");

      const nodeModulesStat = await import("node:fs/promises").then((fs) =>
        fs.stat(path.join(outputDir, "node_modules"))
      );
      assert.ok(nodeModulesStat.isDirectory(), "npm install should have produced node_modules");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "generate (default, no --install): still requires the manual npm install/build step",
  { timeout: 60_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-gen-noinstall-"));
    try {
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        PETSTORE_SPEC_PATH,
        "--out",
        outputDir,
        "--name",
        "test-petstore-noinstall",
        "--base-url",
        "https://petstore3.swagger.io/api/v3",
        "--license",
        "none",
        "--json",
      ]);

      const jsonResult = JSON.parse(result.stdout);
      assert.equal(jsonResult.success, true);
      assert.match(jsonResult.nextSteps, /npm install && npm run build && npm start/);

      await assert.rejects(import("node:fs/promises").then((fs) => fs.stat(path.join(outputDir, "node_modules"))));
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

// ---------------------------------------------------------------------------
// MCPFO-76 — x-klaridian annotations: per-hint overrides + expose:false
// exclusion, with zero openapi-mcp-generator fallback warnings even when a
// third-party object `x-mcp` is present (ARCHITECTURE.md §72).
// ---------------------------------------------------------------------------

const KLARIDIAN_SPEC = {
  openapi: "3.0.0",
  info: { title: "klaridian-annotations-fixture", version: "1.0.0" },
  servers: [{ url: "https://api.example.com" }],
  paths: {
    "/things": {
      // POST the author marks destructive + closed-world via x-klaridian;
      // method-derivation alone would give destructive:false, openWorld:true.
      post: {
        operationId: "createThing",
        summary: "Create a thing",
        "x-klaridian": { readOnly: false, destructive: true, openWorld: false, expose: true, title: "Add a thing" },
        responses: { "200": { description: "ok" } },
      },
      // GET the author hides from the tool surface via x-klaridian.expose.
      get: {
        operationId: "listThingsInternal",
        summary: "List things (internal)",
        "x-klaridian": { readOnly: true, expose: false },
        responses: { "200": { description: "ok" } },
      },
    },
    "/things/{id}": {
      // GET with a partial x-klaridian: only openWorld set; readOnly must stay
      // the GET default (true), proving per-hint fallback. Also carries a
      // third-party OBJECT `x-mcp` — klaridian must NOT read hints from it, and
      // the engine must NOT warn about it (prepareSpecForEngine collapses it).
      get: {
        operationId: "getThing",
        summary: "Get a thing",
        "x-klaridian": { openWorld: false },
        "x-mcp": { readOnly: false, expose: true },
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "ok" } },
      },
    },
  },
};

test(
  "generate: x-klaridian overrides annotations, honours expose:false, and emits no fallback warnings",
  { timeout: 60_000 },
  async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), "klaridian-annot-"));
    const specPath = path.join(workDir, "spec.json");
    const outputDir = path.join(workDir, "out");
    try {
      await writeFile(specPath, JSON.stringify(KLARIDIAN_SPEC), "utf-8");
      const result = await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        specPath,
        "--out",
        outputDir,
        "--name",
        "klaridian-annot-test",
        "--base-url",
        "https://api.example.com",
        "--license",
        "none",
      ]);

      // No openapi-mcp-generator fallback warnings, even though a third-party
      // object x-mcp is present: prepareSpecForEngine collapses it to a boolean
      // before the engine ever sees it.
      assert.doesNotMatch(result.stderr, /Invalid x-mcp value/);

      // expose:false dropped the internal GET; 2 tools remain, not 3.
      assert.match(result.stderr, /Generated 2 tool\(s\)/);

      const src = await readFile(path.join(outputDir, "src", "server-factory.ts"), "utf-8");
      assert.match(src, /createThing/);
      assert.match(src, /getThing/);
      assert.doesNotMatch(src, /listThingsInternal/, "expose:false tool must not be emitted");

      // createThing block: author's destructive:true + openWorld:false win over
      // the POST-derived destructive:false / openWorld:true.
      const createBlock = src.slice(src.indexOf('"createThing"'), src.indexOf('"getThing"'));
      assert.match(createBlock, /destructiveHint: true/);
      assert.match(createBlock, /openWorldHint: false/);
      assert.match(createBlock, /readOnlyHint: false/);
      // Title precedence (MCPFO-77): x-klaridian.title wins over the summary.
      assert.match(createBlock, /title: "Add a thing"/, "x-klaridian.title beats summary");
      assert.doesNotMatch(createBlock, /title: "Create a thing"/);

      // getThing block: only openWorld was set → readOnly stays the GET default.
      // (The sibling object x-mcp said readOnly:false and is correctly ignored.)
      const getBlock = src.slice(src.indexOf('"getThing"'));
      assert.match(getBlock, /readOnlyHint: true/, "unset x-klaridian.readOnly falls back to GET default");
      assert.match(getBlock, /openWorldHint: false/, "author override applied");
      // Title precedence: no x-klaridian.title → the OpenAPI summary is used,
      // NOT the humanized operationId ("Get Thing").
      assert.match(getBlock, /title: "Get a thing"/, "summary used as title when no x-klaridian.title");
      assert.doesNotMatch(getBlock, /title: "Get Thing"/);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
);

// MCPFO-33 (ARCHITECTURE.md §83): a spec with an object 2xx body, an array 2xx
// body, and a no-body operation — the three cases that decide whether a tool
// gets an outputSchema.
const OUTPUT_SCHEMA_SPEC = {
  openapi: "3.0.3",
  info: { title: "Output Schema E2E", version: "1.0.0" },
  servers: [{ url: "https://api.example.com" }],
  paths: {
    "/widgets/{id}": {
      get: {
        operationId: "getWidget",
        summary: "Get a widget",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "A widget",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Widget" } } },
          },
        },
      },
    },
    "/widgets": {
      get: {
        operationId: "listWidgets",
        summary: "List widgets",
        responses: {
          "200": {
            description: "Array root — gated OUT of outputSchema",
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Widget" } } } },
          },
        },
      },
    },
    "/ping": {
      get: { operationId: "ping", summary: "Health check", responses: { "204": { description: "No content" } } },
    },
  },
  components: {
    schemas: {
      Widget: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" }, size: { type: "integer" } },
        required: ["id", "name"],
      },
    },
  },
};

test(
  "generate: emits outputSchema only for object-body operations; a real server advertises it over stdio (MCPFO-33)",
  { timeout: 180_000 },
  async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), "klaridian-outschema-"));
    const specPath = path.join(workDir, "spec.json");
    const outputDir = path.join(workDir, "out");
    try {
      await writeFile(specPath, JSON.stringify(OUTPUT_SCHEMA_SPEC), "utf-8");
      await execFileAsync("node", [
        CLI_ENTRYPOINT,
        "generate",
        "--spec",
        specPath,
        "--out",
        outputDir,
        "--name",
        "outschema-test",
        "--base-url",
        "https://api.example.com",
        "--license",
        "none",
      ]);

      // Source-level: the object-body tools advertise outputSchema + populate
      // structuredContent; the array/no-body tools do neither.
      const src = await readFile(path.join(outputDir, "src", "server-factory.ts"), "utf-8");
      const getBlock = src.slice(src.indexOf('"getWidget"'), src.indexOf('"listWidgets"'));
      assert.match(getBlock, /outputSchema: z\.object/, "object 2xx → outputSchema advertised");
      assert.match(getBlock, /const structuredContent = JSON\.parse\(text\)/);
      const listBlock = src.slice(src.indexOf('"listWidgets"'), src.indexOf('"ping"'));
      assert.doesNotMatch(listBlock, /outputSchema:/, "array 2xx → no outputSchema (gated)");
      const pingBlock = src.slice(src.indexOf('"ping"'));
      assert.doesNotMatch(pingBlock, /outputSchema:/, "no JSON body → no outputSchema");

      // Real build + spawn + drive: the running server's tools/list must carry
      // outputSchema for getWidget only. This is the end-to-end proof, not a
      // string assertion.
      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outputDir, timeout: 120_000 });
      await execFileAsync("npm", ["run", "build"], { cwd: outputDir, timeout: 120_000 });

      // MCPFO-91: a mock upstream returns a real Widget object so a tools/call
      // yields structuredContent — proving the SDK VALIDATES it against the
      // advertised 2020-12 outputSchema at runtime (a mismatch would come back
      // as isError). Bind to an ephemeral port and point the server at it.
      const upstream = http.createServer((_req: http.IncomingMessage, res: http.ServerResponse) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "w1", name: "Widget One", size: 42 }));
      });
      await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
      const upstreamPort = (upstream.address() as import("node:net").AddressInfo).port;

      const proc = spawn("node", ["dist/index.js"], {
        cwd: outputDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, KLARIDIAN_BASE_URL: `http://127.0.0.1:${upstreamPort}` },
      });
      let stdoutBuf = "";
      let stderrBuf = "";
      proc.stdout!.on("data", (d) => (stdoutBuf += d.toString()));
      proc.stderr!.on("data", (d) => (stderrBuf += d.toString()));

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          proc.kill();
          reject(new Error(`Timed out. stderr: ${stderrBuf}`));
        }, 20_000);
        setTimeout(
          () =>
            sendJsonRpc(proc, {
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "os-test", version: "0.0.1" } },
            }),
          300
        );
        setTimeout(() => sendJsonRpc(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), 800);
        setTimeout(
          () => sendJsonRpc(proc, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "getWidget", arguments: { id: "w1" } } }),
          1300
        );
        setTimeout(() => {
          clearTimeout(timeout);
          proc.kill("SIGTERM");
          resolve();
        }, 3500);
      });
      await new Promise((r) => setTimeout(r, 300));
      await new Promise<void>((resolve) => upstream.close(() => resolve()));

      const parsed = stdoutBuf
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
      const listResponse = parsed.find((r) => r.id === 2);
      assert.ok(listResponse, `no tools/list response. stderr: ${stderrBuf}`);
      const byName = Object.fromEntries(listResponse.result.tools.map((t: { name: string; outputSchema?: unknown }) => [t.name, t.outputSchema]));
      assert.ok(byName.getWidget, "getWidget advertises outputSchema on the wire");
      assert.equal((byName.getWidget as { type?: string }).type, "object");
      assert.equal(byName.listWidgets, undefined, "listWidgets (array body) has no outputSchema");
      assert.equal(byName.ping, undefined, "ping (no body) has no outputSchema");

      // MCPFO-91: the advertised schemas declare the JSON Schema 2020-12 dialect.
      // The SDK converts every advertised schema to 2020-12 on the wire (verified
      // against @modelcontextprotocol/server 2.x: JSON_SCHEMA_CONVERSION_TARGET =
      // "draft-2020-12"), stamping the canonical $schema.
      const DIALECT_2020_12 = "https://json-schema.org/draft/2020-12/schema";
      const getWidgetTool = listResponse.result.tools.find((t: { name: string }) => t.name === "getWidget");
      assert.equal(
        (getWidgetTool.inputSchema as { $schema?: string }).$schema,
        DIALECT_2020_12,
        "inputSchema advertises the 2020-12 dialect on the wire"
      );
      assert.equal(
        (getWidgetTool.outputSchema as { $schema?: string }).$schema,
        DIALECT_2020_12,
        "outputSchema advertises the 2020-12 dialect on the wire"
      );

      // MCPFO-91: the tools/call succeeded — structuredContent was accepted by
      // the SDK's runtime validation against the advertised 2020-12 outputSchema.
      // (The SDK turns a schema mismatch into isError:true, so a clean success
      // with structuredContent present is the runtime-validation proof.)
      const callResponse = parsed.find((r) => r.id === 3);
      assert.ok(callResponse, `no tools/call response. stderr: ${stderrBuf}`);
      assert.ok(!callResponse.error, "tools/call is not a protocol error");
      assert.notEqual(callResponse.result?.isError, true, "structuredContent validated against 2020-12 outputSchema (no soft error)");
      assert.deepEqual(
        callResponse.result?.structuredContent,
        { id: "w1", name: "Widget One", size: 42 },
        "structuredContent is the parsed upstream object"
      );
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
);