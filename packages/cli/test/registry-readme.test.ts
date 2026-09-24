// packages/cli/test/registry-readme.test.ts
//
// The npm and PyPI package pages both render a README derived from the root
// README.md by scripts/generate-readme.mjs (MCPFO-120). Registry pages can't
// resolve repo-relative links, and PyPI can't resolve in-page `#anchor` links
// either, so a regression here ships a README full of dead links that only
// shows up after an irreversible publish. Run the real script and check the
// real output.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> packages/cli
const CLI_DIR = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(CLI_DIR, "../..");
const SCRIPT = path.join(CLI_DIR, "scripts", "generate-readme.mjs");

/** Every Markdown link/image target in the document. */
function linkTargets(md: string): string[] {
  return [...md.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
}

const version = JSON.parse(await readFile(path.join(CLI_DIR, "package.json"), "utf8")).version;

test("registry README (npm): no repo-relative links; images pinned to the release tag", async () => {
  await execFileAsync("node", [SCRIPT]);
  const md = await readFile(path.join(CLI_DIR, "README.md"), "utf8");
  const relative = linkTargets(md).filter((t) => !/^(https?:|mailto:|#)/.test(t));
  assert.deepEqual(relative, [], "every non-anchor target must be absolute");
  assert.match(md, new RegExp(`raw\\.githubusercontent\\.com/klaridian/klaridian/v${version.replace(/\./g, "\\.")}/assets/banner\\.png`));
});

test("registry README (pypi): no relative or in-page anchor links; carries the native-binary note", async () => {
  await execFileAsync("node", [SCRIPT, "--target", "pypi"]);
  const md = await readFile(path.join(REPO_ROOT, "packaging", "pypi", "README.md"), "utf8");
  const nonAbsolute = linkTargets(md).filter((t) => !/^(https?:|mailto:)/.test(t));
  assert.deepEqual(nonAbsolute, [], "PyPI has no heading anchors, so every target must be absolute");
  assert.match(md, /This PyPI package is the klaridian CLI as a prebuilt native binary/);
  // Same body as the root README (derived, not hand-written): the install block survives.
  assert.match(md, /pip install klaridian/);
  assert.match(md, /npx klaridian generate/);
});

test("registry README: unknown --target fails loudly", async () => {
  await assert.rejects(execFileAsync("node", [SCRIPT, "--target", "crates"]), /unknown --target/);
});
