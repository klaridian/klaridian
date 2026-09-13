// packages/cli/test/deploy.test.ts
//
// MCPFO-86 step 2 — `klaridian deploy --target docker`. Unit-level tests over
// the Docker artifact emitter (pure, fast). The full E2E (real `docker build`
// of the emitted Dockerfile) is exercised manually and recorded in
// ARCHITECTURE.md §80; here we assert the emitted content is shaped right for
// both languages and the fail-loud contract.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { emitDockerArtifacts } from "../src/emit/deploy/emit-docker.js";
import { emitCloudflareArtifacts } from "../src/emit/deploy/emit-cloudflare.js";
import { execFileAsync, CLI_ENTRYPOINT } from "./test-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PETSTORE_SPEC_PATH = path.resolve(__dirname, "../../../../examples/petstore/openapi.json");

test("docker: TypeScript project gets a multi-stage node Dockerfile over the bundle", () => {
  const files = emitDockerArtifacts({ language: "typescript", port: 3000 });
  const df = files["Dockerfile"];
  assert.match(df, /FROM node:22-slim AS build/, "has a build stage");
  assert.match(df, /FROM node:22-slim AS runtime/, "has a runtime stage");
  assert.match(df, /npm run build/, "builds the bundle");
  assert.match(df, /dist\/server\.bundle\.js/, "runs the self-contained bundle");
  assert.match(df, /KLARIDIAN_BIND_HOST=0\.0\.0\.0/, "binds all interfaces so the container is reachable");
  assert.match(df, /EXPOSE 3000/, "exposes the port");
  assert.ok(files[".dockerignore"].includes("node_modules"), "ignores node_modules in the build context");
});

test("docker: Python project gets a python-slim Dockerfile that installs requirements", () => {
  const files = emitDockerArtifacts({ language: "python", port: 8080 });
  const df = files["Dockerfile"];
  assert.match(df, /FROM python:3\.12-slim/, "python base satisfies requires-python >=3.10");
  assert.match(df, /pip install --no-cache-dir -r requirements\.txt/, "installs deps into the image");
  assert.match(df, /server\.py.*--transport.*streamable-http/s, "runs server.py in http mode");
  assert.match(df, /KLARIDIAN_BIND_HOST=0\.0\.0\.0/, "binds all interfaces");
  assert.match(df, /EXPOSE 8080/, "exposes the generated port");
});

test("docker: port is threaded into ENV/EXPOSE, not hardcoded", () => {
  const files = emitDockerArtifacts({ language: "typescript", port: 4567 });
  assert.match(files["Dockerfile"], /PORT=4567/, "ENV PORT uses the generated port");
  assert.match(files["Dockerfile"], /EXPOSE 4567/, "EXPOSE uses the generated port");
});

test("docker: unknown language fails loudly", () => {
  assert.throws(
    () => emitDockerArtifacts({ language: "ruby" as never, port: 3000 }),
    /unsupported language/,
    "an un-emittable language throws rather than emitting a broken Dockerfile"
  );
});

test(
  "deploy --target docker: writes artifacts for a real generated streamable-http project",
  { timeout: 120_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-deploy-"));
    try {
      await execFileAsync("node", [
        CLI_ENTRYPOINT, "generate",
        "--spec", PETSTORE_SPEC_PATH,
        "--out", outputDir,
        "--name", "deploy-e2e",
        "--base-url", "https://petstore3.swagger.io/api/v3",
        "--transport", "streamable-http",
        "--port", "4321",
        "--license", "none",
      ]);

      const result = await execFileAsync("node", [CLI_ENTRYPOINT, "deploy", outputDir, "--target", "docker", "--json"]);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.success, true);
      assert.equal(payload.language, "typescript");
      assert.equal(payload.port, 4321, "recovered the generated port from the emitted source");
      assert.deepEqual(payload.files.sort(), [".dockerignore", "Dockerfile"]);

      const df = await readFile(path.join(outputDir, "Dockerfile"), "utf-8");
      assert.match(df, /EXPOSE 4321/, "Dockerfile exposes the recovered port");
      assert.match(df, /dist\/server\.bundle\.js/, "runs the TS bundle");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "deploy --target docker: refuses a stdio project (nothing to expose)",
  { timeout: 120_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-deploy-stdio-"));
    try {
      await execFileAsync("node", [
        CLI_ENTRYPOINT, "generate",
        "--spec", PETSTORE_SPEC_PATH,
        "--out", outputDir,
        "--name", "deploy-stdio",
        "--base-url", "https://petstore3.swagger.io/api/v3",
        "--license", "none",
      ]);

      // execFileAsync rejects on non-zero exit (deploy fails loud with exit 1);
      // capture the JSON error off the rejection.
      let payload: { success: boolean; stage: string } | undefined;
      try {
        await execFileAsync("node", [CLI_ENTRYPOINT, "deploy", outputDir, "--target", "docker", "--json"]);
        assert.fail("deploy should have failed on a stdio project");
      } catch (err) {
        payload = JSON.parse((err as { stdout: string }).stdout);
      }
      assert.equal(payload!.success, false);
      assert.equal(payload!.stage, "validate-transport");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

// --- Cloudflare target (MCPFO-86 step 3) ---

test("cloudflare: emits a Worker entry that reuses the shared server factory", () => {
  const files = emitCloudflareArtifacts({ serverName: "my-server", hasAuth: false });
  const worker = files["worker.ts"];
  assert.match(worker, /export default \{/, "Worker default export");
  assert.match(worker, /async fetch\(request: Request/, "web-standard fetch handler");
  assert.match(worker, /from "\.\/src\/server-factory\.js"/, "reuses the split-out buildServer factory");
  assert.match(worker, /createMcpHandler\(buildServer\)/, "wraps the factory in the SDK handler");
  assert.doesNotMatch(worker, /from "node:http"/, "no node:http import — must run on workerd");
});

test("cloudflare: wrangler.toml has nodejs_compat and a normalized name + allowed-hosts", () => {
  const files = emitCloudflareArtifacts({ serverName: "My Server", hasAuth: false });
  const toml = files["wrangler.toml"];
  assert.match(toml, /name = "my-server"/, "server name normalized to a valid wrangler name");
  assert.match(toml, /main = "worker\.ts"/, "points at the worker entry");
  assert.match(toml, /compatibility_flags = \["nodejs_compat"\]/, "nodejs_compat for the SDK");
  assert.match(toml, /KLARIDIAN_ALLOWED_HOSTS = "my-server\.workers\.dev"/, "presets the workers.dev host");
});

test("cloudflare: OAuth project gets a note about the unwired auth path", () => {
  const files = emitCloudflareArtifacts({ serverName: "s", hasAuth: true });
  assert.match(files["worker.ts"], /OAuth/, "worker flags the OAuth caveat");
});

test(
  "deploy --target cloudflare: emits worker + wrangler for a real TS streamable-http project",
  { timeout: 120_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-cf-"));
    try {
      await execFileAsync("node", [
        CLI_ENTRYPOINT, "generate",
        "--spec", PETSTORE_SPEC_PATH,
        "--out", outputDir,
        "--name", "cf-e2e",
        "--base-url", "https://petstore3.swagger.io/api/v3",
        "--transport", "streamable-http",
        "--port", "3000",
        "--license", "none",
      ]);

      const result = await execFileAsync("node", [CLI_ENTRYPOINT, "deploy", outputDir, "--target", "cloudflare", "--json"]);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.success, true);
      assert.equal(payload.target, "cloudflare");
      assert.deepEqual(payload.files.sort(), ["worker.ts", "wrangler.toml"]);

      // The worker must import the split-out factory that generate emitted.
      const worker = await readFile(path.join(outputDir, "worker.ts"), "utf-8");
      assert.match(worker, /from "\.\/src\/server-factory\.js"/);
      assert.ok(await readFile(path.join(outputDir, "src", "server-factory.ts"), "utf-8"), "factory module present");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);

test(
  "deploy --target cloudflare: refuses a Python project (Workers is JS/TS only)",
  { timeout: 120_000 },
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "klaridian-cf-py-"));
    try {
      await execFileAsync("node", [
        CLI_ENTRYPOINT, "generate",
        "--spec", PETSTORE_SPEC_PATH,
        "--out", outputDir,
        "--name", "cf-py",
        "--language", "python",
        "--base-url", "https://petstore3.swagger.io/api/v3",
        "--transport", "streamable-http",
        "--port", "3000",
        "--license", "none",
      ]);

      let payload: { success: boolean; stage: string } | undefined;
      try {
        await execFileAsync("node", [CLI_ENTRYPOINT, "deploy", outputDir, "--target", "cloudflare", "--json"]);
        assert.fail("deploy should have refused a Python project for cloudflare");
      } catch (err) {
        payload = JSON.parse((err as { stdout: string }).stdout);
      }
      assert.equal(payload!.success, false);
      assert.equal(payload!.stage, "validate-language");
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
);
