#!/usr/bin/env node
// packages/cli/scripts/smoke-packed.mjs
//
// Install the CLI the way a user does (from the npm tarball, into an empty
// directory) and run it. The repo's own tests run the CLI from the working
// tree, where every file exists, so they can't catch a file missing from
// the published package. That gap shipped a broken npm package from v0.2.0
// through v0.5.0: dist/src/index.js imports ../package.json (for --version)
// and dist/package.json wasn't in "files" (MCPFO-136). CI runs this on
// every build and release.yml runs it before `npm publish`.
//
// Usage (after `npm run build`): node scripts/smoke-packed.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf-8"));
const spec = path.resolve(pkgDir, "../../examples/petstore/openapi.json");
const work = mkdtempSync(path.join(tmpdir(), "klaridian-packed-"));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"] });

try {
  const tarball = run("npm", ["pack", "--silent", "--pack-destination", work], pkgDir).trim().split("\n").pop();
  const app = path.join(work, "app");
  run("mkdir", ["-p", app]);
  writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "smoke", private: true }));
  run("npm", ["install", "--no-audit", "--no-fund", "--silent", path.join(work, tarball)], app);
  const bin = path.join(app, "node_modules", ".bin", "klaridian");

  const version = run(bin, ["--version"], app).trim();
  if (version !== pkg.version) throw new Error(`--version printed "${version}", expected "${pkg.version}"`);

  const out = path.join(work, "out");
  run(bin, ["generate", "--spec", spec, "--out", out, "--name", "smoke", "--base-url", "https://example.test", "--license", "none", "--quiet"], app);
  if (!existsSync(path.join(out, "src", "server-factory.ts"))) throw new Error("generate produced no server");

  console.log(`packed klaridian@${version}: installs, --version and generate work`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
