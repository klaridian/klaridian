// packages/cli/test/external-refs-ssrf.test.ts
//
// MCPFO-106 (SSRF hardening, ARCHITECTURE.md §94): klaridian must NOT fetch
// REMOTE http(s) external $ref pointers at generation time by default — a
// malicious/compromised spec could otherwise make the parser request
// attacker-controlled or internal-network URLs from the operator's machine or
// CI runner. Local-file $refs must keep working (real multi-file specs need
// them), and the operator can opt back into remote resolution with
// --allow-external-refs.
//
// These are real E2E tests: they spawn the compiled `klaridian generate` binary
// and, for the opt-in case, stand up a real local HTTP server so a genuine
// http(s) $ref actually resolves (no external network dependency, but a real
// remote fetch over http). They also drive getToolsFromOwnEngine directly for
// the finer-grained default-deny/opt-in/local-file assertions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CLI_ENTRYPOINT } from "./test-helpers.js";
import { getToolsFromOwnEngine, RemoteRefBlockedError } from "../src/engine/own-engine.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** A minimal OpenAPI spec whose success-response schema is a REMOTE http(s)
 *  $ref. `refUrl` is the full remote pointer (e.g. https://evil/defs.json#/Foo
 *  or http://127.0.0.1:PORT/defs.json#/Foo). */
function specWithRemoteRef(refUrl: string): Record<string, unknown> {
  return {
    openapi: "3.0.0",
    info: { title: "Remote Ref Spec", version: "1.0.0" },
    servers: [{ url: "https://api.example.com" }],
    paths: {
      "/widgets": {
        get: {
          operationId: "listWidgets",
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: { $ref: refUrl } } },
            },
          },
        },
      },
    },
  };
}

/** A two-file spec: the entry doc references a schema in a sibling LOCAL file. */
function localRefSpecFiles(): { entry: Record<string, unknown>; defs: Record<string, unknown> } {
  return {
    entry: {
      openapi: "3.0.0",
      info: { title: "Local Ref Spec", version: "1.0.0" },
      servers: [{ url: "https://api.example.com" }],
      paths: {
        "/widgets": {
          get: {
            operationId: "listWidgets",
            responses: {
              "200": {
                description: "OK",
                content: { "application/json": { schema: { $ref: "./defs.json#/Widget" } } },
              },
            },
          },
        },
      },
    },
    defs: {
      Widget: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id"],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Engine-level (getToolsFromOwnEngine) assertions.
// ---------------------------------------------------------------------------

test("own engine: REMOTE http(s) $ref is refused by default, naming the ref + the flag", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "klaridian-ssrf-engine-"));
  try {
    const refUrl = "https://attacker.example/evil.json#/Pwn";
    const specPath = path.join(dir, "spec.json");
    await writeFile(specPath, JSON.stringify(specWithRemoteRef(refUrl)), "utf-8");

    await assert.rejects(
      () => getToolsFromOwnEngine(specPath, { dereference: true }),
      (err: unknown) => {
        assert.ok(err instanceof RemoteRefBlockedError, "throws RemoteRefBlockedError");
        assert.match((err as Error).message, /attacker\.example\/evil\.json/, "names the offending ref");
        assert.match((err as Error).message, /--allow-external-refs/, "names the opt-in flag");
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("own engine: REMOTE http(s) $ref resolves when allowExternalRefs is set (served over real http)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "klaridian-ssrf-allow-"));
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        Widget: {
          type: "object",
          properties: { id: { type: "string" }, name: { type: "string" } },
          required: ["id"],
        },
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as import("node:net").AddressInfo).port;
  try {
    const refUrl = `http://127.0.0.1:${port}/defs.json#/Widget`;
    const specPath = path.join(dir, "spec.json");
    await writeFile(specPath, JSON.stringify(specWithRemoteRef(refUrl)), "utf-8");

    // Refused without the flag...
    await assert.rejects(() => getToolsFromOwnEngine(specPath, { dereference: true }), RemoteRefBlockedError);

    // ...resolved with it.
    const tools = await getToolsFromOwnEngine(specPath, { dereference: true, allowExternalRefs: true });
    assert.equal(tools.length, 1);
    assert.equal(tools[0].operationId, "listWidgets");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("own engine: LOCAL-FILE $ref still resolves under the default (regression guard)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "klaridian-ssrf-local-"));
  try {
    const { entry, defs } = localRefSpecFiles();
    await writeFile(path.join(dir, "defs.json"), JSON.stringify(defs), "utf-8");
    const entryPath = path.join(dir, "openapi.json");
    await writeFile(entryPath, JSON.stringify(entry), "utf-8");

    // DEFAULT options (no allowExternalRefs) — must NOT throw, must resolve the
    // local ./defs.json#/Widget into a real tool.
    const tools = await getToolsFromOwnEngine(entryPath, { dereference: true });
    assert.equal(tools.length, 1, "the operation surfaces as a tool");
    assert.equal(tools[0].operationId, "listWidgets");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CLI-binary E2E assertions (the real `klaridian generate`).
// ---------------------------------------------------------------------------

test(
  "CLI generate: a spec with a REMOTE http(s) $ref is refused by default, error names --allow-external-refs",
  { timeout: 60_000 },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "klaridian-ssrf-cli-deny-"));
    try {
      const refUrl = "https://attacker.example/evil.json#/Pwn";
      const specPath = path.join(dir, "spec.json");
      await writeFile(specPath, JSON.stringify(specWithRemoteRef(refUrl)), "utf-8");
      const outDir = path.join(dir, "out");

      // --json makes failure a single machine-readable object on stdout with a
      // non-zero exit code; execFile rejects on non-zero exit, so read stdout
      // off the rejection.
      let stdout = "";
      let failed = false;
      try {
        const res = await execFileAsync("node", [
          CLI_ENTRYPOINT, "generate",
          "--spec", specPath,
          "--out", outDir,
          "--base-url", "https://api.example.com",
          "--license", "none",
          "--json",
        ]);
        stdout = res.stdout;
      } catch (err) {
        failed = true;
        stdout = (err as { stdout?: string }).stdout ?? "";
      }
      assert.ok(failed, "generate exits non-zero when a remote $ref is refused");
      const result = JSON.parse(stdout);
      assert.equal(result.success, false);
      assert.match(result.error, /--allow-external-refs/, "error tells the user about the opt-in flag");
      assert.match(result.error, /attacker\.example\/evil\.json/, "error names the offending ref");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
);

test(
  "CLI generate: --allow-external-refs lets a REMOTE http(s) $ref resolve (served over real http)",
  { timeout: 60_000 },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "klaridian-ssrf-cli-allow-"));
    const server = http.createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          Widget: {
            type: "object",
            properties: { id: { type: "string" }, name: { type: "string" } },
            required: ["id"],
          },
        })
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as import("node:net").AddressInfo).port;
    try {
      const refUrl = `http://127.0.0.1:${port}/defs.json#/Widget`;
      const specPath = path.join(dir, "spec.json");
      await writeFile(specPath, JSON.stringify(specWithRemoteRef(refUrl)), "utf-8");
      const outDir = path.join(dir, "out");

      const res = await execFileAsync("node", [
        CLI_ENTRYPOINT, "generate",
        "--spec", specPath,
        "--out", outDir,
        "--base-url", "https://api.example.com",
        "--license", "none",
        "--allow-external-refs",
        "--json",
      ]);
      const result = JSON.parse(res.stdout);
      assert.equal(result.success, true, "generation succeeds with the opt-in flag");
      assert.equal(result.toolCount, 1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  }
);

test(
  "CLI generate: a spec with LOCAL-FILE $refs still generates under the default (regression guard)",
  { timeout: 60_000 },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "klaridian-ssrf-cli-local-"));
    try {
      const { entry, defs } = localRefSpecFiles();
      await writeFile(path.join(dir, "defs.json"), JSON.stringify(defs), "utf-8");
      const specPath = path.join(dir, "openapi.json");
      await writeFile(specPath, JSON.stringify(entry), "utf-8");
      const outDir = path.join(dir, "out");

      const res = await execFileAsync("node", [
        CLI_ENTRYPOINT, "generate",
        "--spec", specPath,
        "--out", outDir,
        "--base-url", "https://api.example.com",
        "--license", "none",
        "--json",
      ]);
      const result = JSON.parse(res.stdout);
      assert.equal(result.success, true, "generation succeeds with local-file refs by default");
      assert.equal(result.toolCount, 1, "the local ./defs.json#/Widget-backed operation becomes a tool");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
);
