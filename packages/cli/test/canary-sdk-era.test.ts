// packages/cli/test/canary-sdk-era.test.ts
//
// MCPFO-21 Task 3.3 / MCPFO-93 — SDK-era canary. The v2 emit path targets the
// @modelcontextprotocol/server v2 line, which is 2026-07-28-native. As of
// MCPFO-93 the emitter OPTS INTO modern serving by passing
// `supportedProtocolVersions: ["2026-07-28", "2025-11-25"]` to the McpServer
// factory, so the SDK wires `server/discover` (negotiating 2026-07-28) while
// the classic `initialize` handshake still negotiates 2025-11-25 — the two
// eras coexist on ONE server (proven E2E in emit-e2e.test.ts). This canary
// pins the versions the emitter templates into generated projects, so a
// deliberate bump is a reviewed change that also updates the conformance
// claims in README / ARCHITECTURE.md sections 38 + 93 — not a silent drift.

import { test } from "node:test";
import assert from "node:assert/strict";
import { emitServerProject } from "../src/emit/emit-server.js";
import type { ToolIR as McpToolDefinition } from "../src/emit/ir.js";

const FIXTURE: McpToolDefinition = {
  name: "getPetById", description: "x", method: "get", pathTemplate: "/pet/{petId}",
  inputSchema: { type: "object", properties: { petId: { type: "integer" } }, required: ["petId"] },
  executionParameters: [{ name: "petId", in: "path" }], securityRequirements: [],
  operationId: "getPetById", tags: [],
} as unknown as McpToolDefinition;

// The versions the emitter is known-good against (spikes 021/021b/021d).
// If these change, re-verify: (1) the emit-e2e tests still pass, (2) the
// server/discover -> 2026-07-28 negotiation and legacy initialize -> 2025-11-25
// coexistence assertions in emit-e2e.test.ts still hold, and update the
// protocol claims in README + ARCHITECTURE.md sections 38 + 93 in lockstep.
const EXPECTED_SERVER_RANGE = "^2.0.0";
const EXPECTED_ZOD_RANGE = "^4.2.0";

test("canary: emitted project pins the known-good v2 SDK version range", () => {
  const files = emitServerProject({ serverName: "x", tools: [FIXTURE], baseUrl: "https://x/api" });
  const pkg = JSON.parse(files["package.json"]);
  assert.equal(
    pkg.dependencies["@modelcontextprotocol/server"],
    EXPECTED_SERVER_RANGE,
    "If this changed, re-verify emit-e2e AND the server/discover->2026-07-28 + initialize->2025-11-25 coexistence assertions; update ARCHITECTURE.md sections 38 + 93 in lockstep."
  );
  assert.equal(pkg.dependencies["zod"], EXPECTED_ZOD_RANGE, "zod v4 range pinned");
});

test("canary: emitted server opts into modern (2026-07-28) serving while keeping 2025-11-25 legacy (MCPFO-93)", () => {
  const files = emitServerProject({ serverName: "x", tools: [FIXTURE], baseUrl: "https://x/api" });
  const factory = files["src/server-factory.ts"];
  // The factory must advertise BOTH the modern (2026-07-28) revision — which is
  // what wires server/discover — and the legacy (2025-11-25) revision, which
  // classic initialize negotiates. Both present = coexistence.
  assert.match(factory, /supportedProtocolVersions/, "factory passes supportedProtocolVersions to McpServer");
  assert.match(factory, /2026-07-28/, "modern revision advertised (wires server/discover)");
  assert.match(factory, /2025-11-25/, "legacy revision kept (initialize coexistence)");
});
