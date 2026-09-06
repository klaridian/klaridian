// packages/cli/test/start.test.ts
//
// Real-binary E2E coverage for `klaridian start` (ARCHITECTURE.md section
// 56): a thin launcher over a project `klaridian generate` already
// produced, added after MCPFO-12's --docker removal (section 55) closed
// the "restart shouldn't depend on npm install" gap on the *generated
// project's own* side. `start` is the missing single-surface piece —
// `klaridian ...` for both generating and launching, still zero new
// configuration surface: no --spec/--architecture/--plugin/etc., only a
// target directory.
//
// Every test here spawns the real compiled CLI binary and a real generated
// project (real npm install + npm run build), matching this repo's
// standing E2E discipline (AGENTS.md) — assembling a fake package.json by
// hand would not catch a real drift between `start`'s assumptions
// (package.json shape, server.json presence, dist/server.bundle.js path)
// and what `generate` actually emits.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileAsync, CLI_ENTRYPOINT } from "./test-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

/** Generates a real project into a fresh temp dir; returns its path. Caller owns cleanup. */
async function generateProject(name: string): Promise<string> {
  const outDir = await mkdtemp(path.join(tmpdir(), `klaridian-start-${name}-`));
  await execFileAsync("node", [
    CLI_ENTRYPOINT, "generate", "--spec", PETSTORE_SPEC_PATH, "--out", outDir,
    "--name", name, "--base-url", "https://petstore3.swagger.io/api/v3", "--license", "none",
  ]);
  return outDir;
}

test(
  "klaridian start <dir>: fails loudly (validate-project) on a directory that isn't a klaridian output",
  { timeout: 30_000 },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "klaridian-start-notaproject-"));
    try {
      let caught: unknown;
      try {
        await execFileAsync("node", [CLI_ENTRYPOINT, "start", dir, "--json"]);
      } catch (err) {
        caught = err;
      }
      assert.ok(caught, "expected a non-zero exit");
      const parsed = JSON.parse((caught as { stdout: string }).stdout);
      assert.equal(parsed.success, false);
      assert.equal(parsed.stage, "validate-project");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
);

test(
  "klaridian start <dir>: fails loudly (validate-project) when package.json has no start script",
  { timeout: 30_000 },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "klaridian-start-noscript-"));
    try {
      await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "x", scripts: {} }));
      let caught: unknown;
      try {
        await execFileAsync("node", [CLI_ENTRYPOINT, "start", dir, "--json"]);
      } catch (err) {
        caught = err;
      }
      assert.ok(caught, "expected a non-zero exit");
      const parsed = JSON.parse((caught as { stdout: string }).stdout);
      assert.equal(parsed.success, false);
      assert.equal(parsed.stage, "validate-project");
      assert.match(parsed.error, /no "start" script/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
);

test(
  "klaridian start <dir>: fails loudly (validate-built) on a real generated project that hasn't been built yet",
  { timeout: 60_000 },
  async () => {
    const dir = await generateProject("notbuilt");
    try {
      let caught: unknown;
      try {
        await execFileAsync("node", [CLI_ENTRYPOINT, "start", dir, "--json"]);
      } catch (err) {
        caught = err;
      }
      assert.ok(caught, "expected a non-zero exit");
      const parsed = JSON.parse((caught as { stdout: string }).stdout);
      assert.equal(parsed.success, false);
      assert.equal(parsed.stage, "validate-built");
      assert.match(parsed.error, /dist\/server\.bundle\.js does not exist yet/);
      assert.match(parsed.error, /npm install && npm run build/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
);

test(
  "klaridian start <dir>: launches a real built project and serves real MCP traffic over stdio, with node_modules absent",
  { timeout: 120_000 },
  async () => {
    const dir = await generateProject("realstart");
    try {
      await execFileAsync("npm", ["install", "--no-audit", "--no-fund"], { cwd: dir });
      await execFileAsync("npm", ["run", "build"], { cwd: dir });

      // The whole point of section 55's bundle: prove start doesn't need
      // node_modules at runtime, not just that it exists at build time.
      await rename(path.join(dir, "node_modules"), path.join(dir, "node_modules.bak"));

      const { spawn } = await import("node:child_process");
      const child = spawn("node", [CLI_ENTRYPOINT, "start", dir], {
        env: { ...process.env, KLARIDIAN_BASE_URL: "https://petstore3.swagger.io/api/v3" },
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));

      const parsedIds = (): number[] =>
        stdout
          .split("\n")
          .filter((l) => l.trim().startsWith("{"))
          .map((l) => {
            try {
              return JSON.parse(l).id;
            } catch {
              return undefined;
            }
          })
          .filter((id): id is number => typeof id === "number");

      // Poll instead of fixed sleeps — CI runners are slower/less
      // predictable than a local machine, and a real npm-start-spawns-
      // node-bundle chain has real, variable startup latency.
      const waitFor = async (predicate: () => boolean, timeoutMs: number): Promise<void> => {
        const start = Date.now();
        while (!predicate()) {
          if (Date.now() - start > timeoutMs) return;
          await new Promise((r) => setTimeout(r, 100));
        }
      };

      const send = (msg: unknown) => child.stdin.write(JSON.stringify(msg) + "\n");
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "start-test", version: "0" } } });
      await waitFor(() => parsedIds().includes(1), 15_000);
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      await waitFor(() => parsedIds().includes(2), 15_000);
      child.kill();
      await new Promise((r) => setTimeout(r, 200)); // let stdio flush after kill

      const lines = stdout.split("\n").filter((l) => l.trim().startsWith("{"));
      const messages = lines.map((l) => JSON.parse(l));
      const initResult = messages.find((m) => m.id === 1);
      const listResult = messages.find((m) => m.id === 2);

      assert.ok(initResult?.result?.protocolVersion, `initialize responded correctly (stdout: ${stdout.slice(0, 500)})`);
      assert.ok(Array.isArray(listResult?.result?.tools), `tools/list responded correctly (stdout: ${stdout.slice(0, 500)})`);
      assert.equal(listResult.result.tools.length, 19, "real Petstore tool count");
      assert.equal(stderr.trim(), "", "no stderr noise (no crash, no corrupted-stdio warnings)");
    } finally {
      await rename(path.join(dir, "node_modules.bak"), path.join(dir, "node_modules")).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  }
);

async function rename(from: string, to: string): Promise<void> {
  const { rename: fsRename } = await import("node:fs/promises");
  await fsRename(from, to);
}
