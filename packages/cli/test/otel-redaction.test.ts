// packages/cli/test/otel-redaction.test.ts
//
// MCPFO-24 — argument redaction / field allowlist in observability
// instrumentation. wrapTool() previously did span.setAttribute(
// "mcp.tool.arguments", JSON.stringify(args)) unconditionally, exfiltrating
// raw tool arguments (potential PII) to a third-party OTLP backend. GDPR data
// minimization + marketplace review (reject conversation-data collection)
// require this to be controllable, and safe by DEFAULT.
//
// Config (--plugin-config otel.argumentCapture / otel.redactFields):
//   argumentCapture = "redacted" (default) -> record argument NAMES only, no values
//                   = "none"                -> record nothing about arguments
//                   = "full"                -> record values, but mask redactFields
//   redactFields    = comma-separated field names always masked when capture=full

import { test } from "node:test";
import assert from "node:assert/strict";
import { otelPlugin } from "../src/plugins/otel/otel.plugin.js";

function emit(config: Record<string, string>): string {
  const base = { otlpEndpoint: "http://localhost:4318/v1/traces", serviceName: "svc", ...config };
  const contribs = otelPlugin.getTemplateContributions(base);
  const file = contribs.find((c) => c.path === "src/instrumentation/otel.ts")!;
  return typeof file.content === "function" ? file.content(base) : file.content;
}

test("DEFAULT (no config) is safe: never emits raw JSON.stringify(args) values", () => {
  const src = emit({});
  assert.doesNotMatch(src, /JSON\.stringify\(args\)/, "default must not stringify raw args");
  // default 'redacted' records argument names only
  assert.match(src, /Object\.keys\(args/, "default records argument names");
  assert.match(src, /mcp\.tool\.argument_names/, "uses a names-only attribute by default");
});

test("argumentCapture=none emits no argument attribute at all", () => {
  const src = emit({ argumentCapture: "none" });
  assert.doesNotMatch(src, /mcp\.tool\.arguments/, "no raw-args attribute");
  assert.doesNotMatch(src, /mcp\.tool\.argument_names/, "no names attribute either");
});

test("argumentCapture=full emits values but masks redactFields", () => {
  const src = emit({ argumentCapture: "full", redactFields: "password,ssn" });
  assert.match(src, /mcp\.tool\.arguments/, "captures full args attribute");
  assert.match(src, /password/, "redact list embedded");
  assert.match(src, /ssn/, "redact list embedded");
  assert.match(src, /\[REDACTED\]/, "masks with a redaction marker");
});

test("argumentCapture with an unknown value is rejected loudly at generation time", () => {
  assert.throws(() => emit({ argumentCapture: "bogus" }), /argumentCapture/);
});
