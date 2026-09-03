// packages/cli/test/base-url-warning.test.ts
//
// MCPFO-20 — when the OpenAPI spec's servers[0].url is relative (e.g. "/api/v3")
// or missing and the user gave no --base-url, the generated server has no usable
// default upstream host. The generator must warn clearly at generation time
// (non-fatal: KLARIDIAN_BASE_URL can still be supplied at runtime), telling the
// author to pass --base-url with an absolute URL.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBaseUrlWarning } from "../src/emit/emit-server.js";

test("absolute --base-url override → no warning", () => {
  assert.equal(resolveBaseUrlWarning("https://api.example.com/v3", undefined), null);
});

test("absolute spec server url, no override → no warning", () => {
  assert.equal(resolveBaseUrlWarning(undefined, "https://api.example.com/v3"), null);
});

test("relative spec server url, no override → warning naming --base-url", () => {
  const w = resolveBaseUrlWarning(undefined, "/api/v3");
  assert.ok(w, "warns");
  assert.match(w!, /--base-url/, "names the flag");
  assert.match(w!, /\/api\/v3/, "quotes the offending relative url");
});

test("missing spec server url and no override → warning", () => {
  const w = resolveBaseUrlWarning(undefined, undefined);
  assert.ok(w, "warns");
  assert.match(w!, /--base-url/);
});

test("override wins even when spec url is relative → no warning", () => {
  assert.equal(resolveBaseUrlWarning("https://api.example.com", "/api/v3"), null);
});

test("a protocol-relative //host url is still treated as needing an explicit base", () => {
  const w = resolveBaseUrlWarning(undefined, "//api.example.com/v3");
  assert.ok(w, "protocol-relative is ambiguous → warn");
});
