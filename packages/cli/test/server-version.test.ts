// packages/cli/test/server-version.test.ts
//
// MCPFO-107 (§97) — unit tests for the server-version resolver: the precedence
// (flag > spec info.version > default) and the fail-loud SemVer validation that
// keeps a non-semver value out of the generated server (the MCP Registry marks
// any unparseable version "latest", so klaridian refuses to emit one silently).

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveServerVersion, isSemver, DEFAULT_SERVER_VERSION } from "../src/server-version.js";

test("isSemver accepts concrete SemVer and rejects ranges / v-prefix / junk", () => {
  for (const good of ["1.0.0", "2.4.1", "0.0.1", "1.2.3-beta.1", "3.0.0-rc.2", "1.2.3+build.5"]) {
    assert.equal(isSemver(good), true, `should accept ${good}`);
  }
  for (const bad of ["1", "1.2", "v1.2.3", "^1.2.3", "~1.2.3", ">=1.2.3", "1.2.*", "1 - 2", "latest", "", "abc"]) {
    assert.equal(isSemver(bad), false, `should reject ${bad}`);
  }
});

test("precedence: --server-version overrides the spec info.version", () => {
  const r = resolveServerVersion({ override: "9.9.9", specVersion: "1.2.3" });
  assert.deepEqual(r, { ok: true, version: "9.9.9", source: "flag" });
});

test("precedence: spec info.version is used when no override", () => {
  const r = resolveServerVersion({ specVersion: "1.2.3" });
  assert.deepEqual(r, { ok: true, version: "1.2.3", source: "spec" });
});

test("precedence: falls back to the default when neither is given", () => {
  const r = resolveServerVersion({});
  assert.deepEqual(r, { ok: true, version: DEFAULT_SERVER_VERSION, source: "default" });
});

test("fail-loud: a non-semver --server-version is an error, not a fallback", () => {
  const r = resolveServerVersion({ override: "v2", specVersion: "1.2.3" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /--server-version/);
});

test("fail-loud: a non-semver spec info.version is an error (do not silently bury under 1.0.0)", () => {
  const r = resolveServerVersion({ specVersion: "2024-01-01" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /info\.version/);
});

test("a non-semver spec version is rescued by a valid override", () => {
  const r = resolveServerVersion({ override: "1.0.0", specVersion: "not-semver" });
  assert.deepEqual(r, { ok: true, version: "1.0.0", source: "flag" });
});
