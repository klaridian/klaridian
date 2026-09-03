// packages/cli/test/canary-sdk-era.test.ts
//
// MCPFO-21 Task 3.3 — SDK-era canary. The v2 emit path targets the
// @modelcontextprotocol/server v2 line, which (as of 2026-09-03, verified in
// spike 021c) still negotiates protocol 2025-11-25, NOT 2026-07-28 despite its
// README. This canary pins the versions the emitter templates into generated
// projects, so a deliberate bump (e.g. when v2 starts negotiating 2026-07-28)
// is a reviewed change that also updates the conformance claims in README /
// ARCHITECTURE.md section 38 — not a silent drift.

import { test } from "node:test";
import assert from "node:assert/strict";
import { emitServerProject } from "../src/emit/emit-server.js";
import type { McpToolDefinition } from "openapi-mcp-generator";

const FIXTURE: McpToolDefinition = {
  name: "getPetById", description: "x", method: "get", pathTemplate: "/pet/{petId}",
  inputSchema: { type: "object", properties: { petId: { type: "integer" } }, required: ["petId"] },
  executionParameters: [{ name: "petId", in: "path" }], securityRequirements: [],
  operationId: "getPetById", tags: [],
} as unknown as McpToolDefinition;

// The versions the emitter is known-good against (spikes 021/021b/021d).
// If these change, re-verify: (1) the emit-e2e tests still pass, (2) whether the
// new @modelcontextprotocol/server negotiates 2026-07-28 — if so, add
// server/discover + ttlMs/cacheScope handling and update the "protocol
// 2025-11-25" claims in README + ARCHITECTURE.md section 38.
const EXPECTED_SERVER_RANGE = "^2.0.0";
const EXPECTED_ZOD_RANGE = "^4.2.0";

test("canary: emitted project pins the known-good v2 SDK version range", () => {
  const files = emitServerProject({ serverName: "x", tools: [FIXTURE], baseUrl: "https://x/api" });
  const pkg = JSON.parse(files["package.json"]);
  assert.equal(
    pkg.dependencies["@modelcontextprotocol/server"],
    EXPECTED_SERVER_RANGE,
    "If this changed, re-verify emit-e2e AND check whether the new SDK negotiates 2026-07-28 (spike 021c method); update ARCHITECTURE.md section 38's 'protocol 2025-11-25' claim in lockstep."
  );
  assert.equal(pkg.dependencies["zod"], EXPECTED_ZOD_RANGE, "zod v4 range pinned");
});

test("canary: emitted project does NOT claim or target 2026-07-28 (SDK doesn't negotiate it yet)", () => {
  const files = emitServerProject({ serverName: "x", tools: [FIXTURE], baseUrl: "https://x/api" });
  // The emitter must not hardcode a 2026-07-28 protocolVersion anywhere — the
  // SDK negotiates the era; hardcoding a version it can't speak would be a bug.
  assert.doesNotMatch(files["src/index.ts"], /2026-07-28/, "no hardcoded 2026-07-28 protocol version");
});
