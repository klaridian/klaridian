// packages/cli/test/emit-client-e2e.test.ts
//
// LOAD-BEARING test for MCPFO-29 — per the repo's standing rule (CLAUDE.md),
// string-shape unit tests (emit-client.test.ts) are not sufficient; the
// riskiest failure mode (generated client that doesn't compile, or whose
// Zod validation/HTTP-call wiring is subtly wrong) only shows up by really
// emitting the module, installing real dependencies, compiling it with tsc,
// and calling a generated function over real HTTP.
//
// Uses a local mock HTTP server (not the public Swagger Petstore demo used
// by emit-e2e.test.ts) — the public demo was found to intermittently return
// 500 for every request during development of this test, which is an
// upstream reliability problem unrelated to the generated client's own
// correctness. A local server keeps this test exercising the real network
// stack (fetch, JSON parsing, status handling) without depending on a third
// party's uptime.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { getToolsFromOpenApi } from "openapi-mcp-generator";
import { emitClientModule } from "../src/emit/emit-client.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

/** Minimal local stand-in for the Petstore API's GET /pet/{petId}, so the E2E test doesn't depend on a third party's uptime. */
async function startMockPetstore(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
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
  "emitClientModule: emitted client installs, builds, and successfully calls a real HTTP server",
  { timeout: 300_000 },
  async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-client-e2e-"));
    const mock = await startMockPetstore();
    try {
      const tools = await getToolsFromOpenApi(PETSTORE_SPEC_PATH, { dereference: true });
      assert.ok(tools.length >= 15, `expected many petstore tools, got ${tools.length}`);

      const clientSrc = emitClientModule(tools);
      await mkdir(path.join(outDir, "src"), { recursive: true });
      await writeFile(path.join(outDir, "src", "client.ts"), clientSrc, "utf-8");

      // A tiny driver script that imports the generated client and calls a
      // real read-only operation (getPetById), proving the whole chain:
      // Zod-validated input -> path-param substitution -> fetch -> ApiResult.
      const driverSrc = `
import { getPetById } from "./client.js";
const result = await getPetById({ petId: 1 } as any);
console.log(JSON.stringify({ status: result.status, hasData: result.data !== undefined }));
`;
      await writeFile(path.join(outDir, "src", "driver.ts"), driverSrc, "utf-8");

      const pkg = {
        name: "klaridian-client-e2e",
        version: "1.0.0",
        private: true,
        type: "module",
        dependencies: { zod: "^4.2.0" },
        devDependencies: { typescript: "^5.7.3", "@types/node": "^22.10.5" },
      };
      await writeFile(path.join(outDir, "package.json"), JSON.stringify(pkg, null, 2), "utf-8");

      const tsconfig = {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          outDir: "dist",
          rootDir: "src",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          types: ["node"],
        },
        include: ["src/**/*.ts"],
      };
      await writeFile(path.join(outDir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2), "utf-8");

      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: outDir, timeout: 180_000 });
      await execFileAsync("npx", ["tsc", "-p", "tsconfig.json"], { cwd: outDir, timeout: 60_000 });

      const { stdout } = await execFileAsync(
        "node",
        ["dist/driver.js"],
        { cwd: outDir, timeout: 30_000, env: { ...process.env, KLARIDIAN_BASE_URL: mock.baseUrl } }
      );
      const parsed = JSON.parse(stdout.trim());
      assert.equal(parsed.status, 200, "getPetById(1) against the local mock server returns 200");
      assert.equal(parsed.hasData, true, "response body was parsed");
    } finally {
      await mock.close();
      await rm(outDir, { recursive: true, force: true });
    }
  }
);

test(
  "emitClientModule: Zod validation rejects a missing required field before any network call",
  { timeout: 120_000 },
  async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "klaridian-client-e2e-validation-"));
    try {
      const tools = await getToolsFromOpenApi(PETSTORE_SPEC_PATH, { dereference: true });
      const clientSrc = emitClientModule(tools);
      await mkdir(path.join(outDir, "src"), { recursive: true });
      await writeFile(path.join(outDir, "src", "client.ts"), clientSrc, "utf-8");

      const driverSrc = `
import { getPetById } from "./client.js";
try {
  await getPetById({} as any); // missing required petId
  console.log(JSON.stringify({ threw: false }));
} catch (err) {
  console.log(JSON.stringify({ threw: true, isZodError: (err as Error).name === "ZodError" }));
}
`;
      await writeFile(path.join(outDir, "src", "driver.ts"), driverSrc, "utf-8");

      const pkg = {
        name: "klaridian-client-e2e-validation",
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
      const { stdout } = await execFileAsync("node", ["dist/driver.js"], { cwd: outDir, timeout: 30_000 });
      const parsed = JSON.parse(stdout.trim());
      assert.equal(parsed.threw, true, "missing required field is rejected before any fetch call");
      assert.equal(parsed.isZodError, true, "rejection is a ZodError from schema validation");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }
);
