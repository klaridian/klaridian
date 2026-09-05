// packages/cli/test/list.test.ts
//
// End-to-end validation of MCPFO-39: `klaridian plugins list` and
// `klaridian licenses list` (ARCHITECTURE.md section 54). Same
// real-compiled-binary discipline as the other command tests — the point of
// the ticket is that these commands report exactly what the single sources
// of truth (`AVAILABLE_PLUGINS`, `SUPPORTED_LICENSES`) contain, so each test
// asserts the command's output against the imported constant rather than a
// hardcoded expected list. Add a plugin or a license to its source of truth
// and these tests follow automatically.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileAsync, CLI_ENTRYPOINT } from "./test-helpers.js";
import { AVAILABLE_PLUGINS } from "../src/commands/generate.js";
import { SUPPORTED_LICENSES } from "../src/render/license.js";

test("plugins list: human-readable output names every registered plugin", { timeout: 15_000 }, async () => {
  const { stdout } = await execFileAsync("node", [CLI_ENTRYPOINT, "plugins", "list"]);
  for (const id of Object.keys(AVAILABLE_PLUGINS)) {
    assert.match(stdout, new RegExp(`(^|\\s)${id}(\\s|$)`, "m"), `expected "${id}" in:\n${stdout}`);
  }
});

test("plugins list --json: parseable, structured, sourced from AVAILABLE_PLUGINS", { timeout: 15_000 }, async () => {
  const { stdout } = await execFileAsync("node", [CLI_ENTRYPOINT, "plugins", "list", "--json"]);
  const parsed = JSON.parse(stdout);
  assert.deepEqual(
    parsed.plugins.map((p: { id: string }) => p.id).sort(),
    Object.keys(AVAILABLE_PLUGINS).sort()
  );
  for (const p of parsed.plugins) {
    assert.equal(typeof p.name, "string");
    assert.ok(p.name.length > 0);
  }
});

test("licenses list: human-readable output names every supported license", { timeout: 15_000 }, async () => {
  const { stdout } = await execFileAsync("node", [CLI_ENTRYPOINT, "licenses", "list"]);
  for (const id of SUPPORTED_LICENSES) {
    const escaped = id.replace(/[.]/g, "\\$&");
    assert.match(stdout, new RegExp(`(^|\\s)${escaped}(\\s|$)`, "m"), `expected "${id}" in:\n${stdout}`);
  }
});

test("licenses list --json: parseable, structured, sourced from SUPPORTED_LICENSES", { timeout: 15_000 }, async () => {
  const { stdout } = await execFileAsync("node", [CLI_ENTRYPOINT, "licenses", "list", "--json"]);
  const parsed = JSON.parse(stdout);
  assert.deepEqual(
    parsed.licenses.map((l: { id: string }) => l.id),
    [...SUPPORTED_LICENSES]
  );
  for (const l of parsed.licenses) {
    assert.equal(typeof l.label, "string");
    assert.ok(l.label.length > 0);
  }
});
