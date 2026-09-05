# Spikes

Throwaway explorations kept as historical reference. Each spike validates a
risky mechanic *before* real code depends on it—don't build new features
into them, and don't treat their code quality as representative of the rest
of the repo.

- **`001-otel-mechanic/`**—the original hand-written proof that OpenAPI →
  MCP → OpenTelemetry instrumentation works without corrupting the MCP
  stdio JSON-RPC stream, built before any generator (hand-rolled or
  `openapi-mcp-generator`) existed. See `001-otel-mechanic/FINDINGS.md`.
  Its core finding—never `ConsoleSpanExporter`, always
  `OTLPTraceExporter`—is encoded in `packages/cli/src/plugins/otel/`.
- **`021-sdk-v2-streamable-http/`**—feasibility spike for MCPFO-21/MCPFO-10
  (SDK v2 stateless streamable-http transport, and generating v2 servers
  directly from tool data). See ARCHITECTURE.md section 38 for the decision
  it fed into.
