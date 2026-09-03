// spike/instrumentation.js
// Manual OTel wiring — validates the mechanic before building the generator's
// runtime-otel helper.
//
// IMPORTANT FINDING from this spike: ConsoleSpanExporter writes span dumps to
// STDOUT (via console.dir), which would corrupt the MCP stdio JSON-RPC stream
// — stdio-transport MCP servers require stdout to carry ONLY JSON-RPC
// messages. This confirms the real plugin must default to OTLPTraceExporter
// (exports over HTTP to a collector, never touches stdout/stderr for data),
// never ConsoleSpanExporter, for any stdio-transport generated server.
// If a "debug to console" mode is ever offered, it MUST write to stderr only.

const { NodeSDK } = require("@opentelemetry/sdk-node");
const {
  OTLPTraceExporter,
} = require("@opentelemetry/exporter-trace-otlp-http");
const { trace, SpanStatusCode, diag, DiagConsoleLogger, DiagLogLevel } = require("@opentelemetry/api");

// Route OTel's own internal diagnostics to stderr explicitly (never stdout).
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

const OTLP_ENDPOINT =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318/v1/traces";

const sdk = new NodeSDK({
  serviceName: "klaridian-spike-petstore",
  traceExporter: new OTLPTraceExporter({ url: OTLP_ENDPOINT }),
});

sdk.start();

// Ensure spans are flushed on exit, whether the process ends normally or is
// signaled — otherwise batched spans can be lost (observed in first spike run).
process.on("SIGINT", () => sdk.shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => sdk.shutdown().finally(() => process.exit(0)));

const tracer = trace.getTracer("klaridian-spike");

/**
 * wrapTool — the core mechanic klaridian's runtime-otel package will provide.
 * Wraps an MCP tool handler in an OTel span, following the shape of the
 * emerging OTel GenAI/tool semantic conventions (tool name, status, duration
 * come for free from the span; args go in as attributes).
 */
function wrapTool(toolName, handler) {
  return async (args) => {
    return tracer.startActiveSpan(`mcp.tool.call ${toolName}`, async (span) => {
      span.setAttribute("mcp.tool.name", toolName);
      span.setAttribute("mcp.tool.arguments", JSON.stringify(args));
      try {
        const result = await handler(args);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
        span.recordException(err);
        throw err;
      } finally {
        span.end();
      }
    });
  };
}

module.exports = { wrapTool };
