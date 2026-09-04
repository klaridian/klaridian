// packages/cli/test/emit-sandbox.test.ts
//
// MCPFO-30 — unit tests for the execute_code sandbox's static wiring
// (permission-flag construction, generated tool/runner shape). The load-
// bearing real-Deno-subprocess test lives in emit-sandbox-e2e.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractApiHost,
  buildDenoPermissionFlags,
  emitSandboxRunner,
  emitExecuteCodeToolBlock,
} from "../src/emit/emit-sandbox.js";

test("extractApiHost strips scheme and path from an absolute URL", () => {
  assert.equal(extractApiHost("https://api.example.com/v1"), "api.example.com");
});

test("extractApiHost preserves a non-default port", () => {
  assert.equal(extractApiHost("http://127.0.0.1:38471"), "127.0.0.1:38471");
});

test("extractApiHost throws loudly on a non-absolute/invalid URL rather than guessing", () => {
  assert.throws(() => extractApiHost("/relative/path"), /not a valid absolute URL/);
  assert.throws(() => extractApiHost(""), /not a valid absolute URL/);
});

test("buildDenoPermissionFlags scopes network access to exactly the API host, nothing else", () => {
  const flags = buildDenoPermissionFlags({ apiHost: "api.example.com", distDir: "/tmp/proj/dist" });
  assert.deepEqual(flags, [
    "--allow-net=api.example.com",
    "--allow-read=/tmp/proj/dist",
    "--allow-env=KLARIDIAN_BASE_URL,KLARIDIAN_AUTH_TOKEN",
  ]);
});

test("buildDenoPermissionFlags never includes --allow-write, --allow-run, or --allow-ffi", () => {
  const flags = buildDenoPermissionFlags({ apiHost: "api.example.com", distDir: "/tmp/proj/dist" });
  for (const flag of flags) {
    assert.doesNotMatch(flag, /--allow-write/);
    assert.doesNotMatch(flag, /--allow-run/);
    assert.doesNotMatch(flag, /--allow-ffi/);
    assert.doesNotMatch(flag, /--allow-sys/);
    assert.doesNotMatch(flag, /--allow-all/);
  }
});

test("emitSandboxRunner emits a module that spawns deno with stdio piped and reads the program from stdin", () => {
  const src = emitSandboxRunner();
  assert.match(src, /spawn\("deno", args/);
  assert.match(src, /"-", \/\/ read the program from stdin/);
  assert.match(src, /stdio: \["pipe", "pipe", "pipe"\]/);
});

test("emitSandboxRunner's generated code never bakes in --allow-write", () => {
  const src = emitSandboxRunner();
  assert.doesNotMatch(src, /--allow-write/);
});

test("emitSandboxRunner passes through only the two env vars the client needs", () => {
  const src = emitSandboxRunner();
  assert.match(src, /KLARIDIAN_BASE_URL: process\.env\.KLARIDIAN_BASE_URL/);
  assert.match(src, /KLARIDIAN_AUTH_TOKEN: process\.env\.KLARIDIAN_AUTH_TOKEN/);
});

test("emitExecuteCodeToolBlock registers a single execute_code tool naming the sandboxed API host", () => {
  const block = emitExecuteCodeToolBlock("api.example.com");
  assert.match(block, /"execute_code"/);
  assert.match(block, /api\.example\.com/);
  assert.match(block, /runInSandbox/);
  assert.match(block, /openWorldHint: true/);
});

// MCPFO-32 — plugin wrapping of the execute_code call site.
test("emitExecuteCodeToolBlock without a wrap emits a plain async handler", () => {
  const block = emitExecuteCodeToolBlock("api.example.com");
  assert.match(block, /async \(args\) => \{/);
  assert.doesNotMatch(block, /wrapTool\(/);
});

test("emitExecuteCodeToolBlock with a wrap applies it to the execute_code handler, same shape as emit-tool.ts", () => {
  const block = emitExecuteCodeToolBlock("api.example.com", { fn: "wrapTool" });
  assert.match(block, /wrapTool\("execute_code", async \(args\) => \{/);
  assert.match(block, /\}\)\)?,\s*\n\s*\);/s);
});
