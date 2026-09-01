// packages/cli/test/otel-plugin-deps.test.ts
//
// Regression guard for ARCHITECTURE.md section 34's real-world dogfooding
// finding: the otel plugin's pinned @opentelemetry/* dependency versions
// must not resolve to a version of @opentelemetry/core vulnerable to
// GHSA-8988-4f7v-96qf (unbounded memory allocation in W3C Baggage
// propagation, fixed in @opentelemetry/core 2.8.0+). The bug was found via
// `npm audit` on a real generated project (19 vulnerabilities), not by
// inspecting version numbers in the abstract — this test pins the fix
// version-wise so a future accidental downgrade of the plugin's declared
// dependencies would be caught without needing a live `npm audit` network
// call in CI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { otelPlugin } from "../src/plugins/otel/otel.plugin.js";

test("otel plugin declares @opentelemetry/sdk-node/exporter versions that resolve to a patched @opentelemetry/core (>= 2.8.0, GHSA-8988-4f7v-96qf)", () => {
  const deps = otelPlugin.getDependencies();

  // @opentelemetry/core's fixed version landed alongside the 0.2xx line of
  // sdk-node/exporter-trace-otlp-http (confirmed directly via `npm install`
  // + `npm audit` against real versions during the section 34 dogfooding
  // session — 0.55.x, the previously pinned range, pulls in a vulnerable
  // @opentelemetry/core < 2.8.0; 0.222.x pulls in a patched one).
  const sdkNodeRange = deps["@opentelemetry/sdk-node"];
  const exporterRange = deps["@opentelemetry/exporter-trace-otlp-http"];
  assert.ok(sdkNodeRange, "expected @opentelemetry/sdk-node in otel plugin dependencies");
  assert.ok(exporterRange, "expected @opentelemetry/exporter-trace-otlp-http in otel plugin dependencies");

  const minorVersion = (range: string) => {
    const match = /\^0\.(\d+)\./.exec(range);
    return match ? Number(match[1]) : null;
  };

  const sdkNodeMinor = minorVersion(sdkNodeRange);
  const exporterMinor = minorVersion(exporterRange);
  assert.ok(
    sdkNodeMinor !== null && sdkNodeMinor >= 222,
    `expected @opentelemetry/sdk-node pinned to ^0.222.0 or later (patched @opentelemetry/core), got "${sdkNodeRange}"`
  );
  assert.ok(
    exporterMinor !== null && exporterMinor >= 222,
    `expected @opentelemetry/exporter-trace-otlp-http pinned to ^0.222.0 or later (patched @opentelemetry/core), got "${exporterRange}"`
  );
});
