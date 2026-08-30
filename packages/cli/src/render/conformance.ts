// packages/cli/src/render/conformance.ts
//
// Post-processes openapi-mcp-generator's generated server source to fix two
// real MCP spec (2025-06-18) conformance bugs found by auditing a real
// generated server end to end (ARCHITECTURE.md section 28):
//
// 1. An unknown tool name must be a JSON-RPC PROTOCOL error (McpError with
//    ErrorCode.InvalidParams, which the SDK's Server class converts into a
//    real `{"error": {...}}` JSON-RPC response) — not a `{"content": [...]}`
//    "successful" result that merely contains error-shaped text. The spec's
//    Tools/Error Handling section is explicit that "Unknown tools" belongs
//    to the "Protocol Errors" category, not "Tool Execution Errors".
// 2. Every tool EXECUTION error path (validation failure, internal error
//    during validation, upstream API failure) must return `isError: true`
//    in the CallToolResult, per the same spec section's "Tool Execution
//    Errors: Reported in tool results with isError: true" requirement.
//    openapi-mcp-generator's generated `executeApiTool` never sets this —
//    every failure mode looks identical to a successful call to any client
//    that checks the `isError` field rather than parsing result text.
//
// Both bugs are in openapi-mcp-generator's own generated output, not
// mcpforge's code — so this is a small, ALWAYS-applied textual patch
// (independent of --plugin, unlike instrument.ts), following the same
// "fail loudly if the expected call site isn't found verbatim" discipline
// as render/instrument.ts, because openapi-mcp-generator's generated shape
// is not a contract mcpforge controls.

export class ConformancePatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConformancePatchError";
  }
}

// --- Fix 1: unknown-tool must be a protocol error, not a "successful" result ---

const UNKNOWN_TOOL_CALL_SITE = [
  '  if (!toolDefinition) {',
  '    console.error(`Error: Unknown tool requested: ${toolName}`);',
  '    return { content: [{ type: "text", text: `Error: Unknown tool requested: ${toolName}` }] };',
  '  }',
].join("\n");

const UNKNOWN_TOOL_REPLACEMENT = [
  '  if (!toolDefinition) {',
  '    console.error(`Error: Unknown tool requested: ${toolName}`);',
  '    // MCP spec (2025-06-18) Tools/Error Handling: an unknown tool is a',
  '    // PROTOCOL error (JSON-RPC error, ErrorCode.InvalidParams), not a',
  '    // "successful" result — see ARCHITECTURE.md section 28.',
  '    throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${toolName}`);',
  '  }',
].join("\n");

// --- Fix 2: every tool-execution failure path must set isError: true ---

const VALIDATION_ERROR_CALL_SITE =
  "            return { content: [{ type: 'text', text: validationErrorMessage }] };";
const VALIDATION_ERROR_REPLACEMENT =
  "            return { content: [{ type: 'text', text: validationErrorMessage }], isError: true };";

const VALIDATION_SETUP_ERROR_CALL_SITE =
  "             return { content: [{ type: 'text', text: `Internal error during validation setup: ${errorMessage}` }] };";
const VALIDATION_SETUP_ERROR_REPLACEMENT =
  "             return { content: [{ type: 'text', text: `Internal error during validation setup: ${errorMessage}` }], isError: true };";

const EXECUTION_ERROR_CALL_SITE = '    return { content: [{ type: "text", text: errorMessage }] };';
const EXECUTION_ERROR_REPLACEMENT = '    return { content: [{ type: "text", text: errorMessage }], isError: true };';

const MCP_TYPES_IMPORT_MARKER = 'import {\n  CallToolRequestSchema,\n  ListToolsRequestSchema,';
const MCP_TYPES_IMPORT_REPLACEMENT =
  'import {\n  CallToolRequestSchema,\n  ListToolsRequestSchema,\n  McpError,\n  ErrorCode,';

interface RequiredCallSite {
  label: string;
  find: string;
  replace: string;
}

const REQUIRED_CALL_SITES: RequiredCallSite[] = [
  { label: "unknown-tool handler", find: UNKNOWN_TOOL_CALL_SITE, replace: UNKNOWN_TOOL_REPLACEMENT },
  { label: "Zod validation error result", find: VALIDATION_ERROR_CALL_SITE, replace: VALIDATION_ERROR_REPLACEMENT },
  {
    label: "validation-setup internal error result",
    find: VALIDATION_SETUP_ERROR_CALL_SITE,
    replace: VALIDATION_SETUP_ERROR_REPLACEMENT,
  },
  { label: "tool execution error result", find: EXECUTION_ERROR_CALL_SITE, replace: EXECUTION_ERROR_REPLACEMENT },
];

/**
 * Patches openapi-mcp-generator's generated server source to fix the two
 * MCP spec conformance bugs described above. Always applied (unlike plugin
 * instrumentation, which is opt-in via --plugin) — this isn't a feature,
 * it's a correctness fix for behavior the spec calls out as required
 * ("Servers MUST validate all tool inputs" plus the explicit two-channel
 * error model), so every generated server gets it regardless of flags.
 *
 * Fails loudly if any expected call site isn't found verbatim, per the same
 * principle as render/instrument.ts — openapi-mcp-generator's generated
 * code shape is not a contract mcpforge controls, so silently skipping a
 * missing call site would silently leave that specific bug unfixed with no
 * indication to the user.
 */
export function applyConformanceFixes(serverSource: string): string {
  let patched = serverSource;

  const missing: string[] = [];
  for (const site of REQUIRED_CALL_SITES) {
    if (!patched.includes(site.find)) {
      missing.push(site.label);
      continue;
    }
    patched = patched.replace(site.find, site.replace);
  }

  if (missing.length > 0) {
    throw new ConformancePatchError(
      `Could not find the expected call site(s) for conformance fix(es): ${missing.join(", ")}. ` +
        `This likely means openapi-mcp-generator's generated code shape changed — check its version ` +
        `and update applyConformanceFixes() accordingly. The server was NOT patched for these fixes.`
    );
  }

  if (!patched.includes(MCP_TYPES_IMPORT_MARKER)) {
    throw new ConformancePatchError(
      `Could not find the expected @modelcontextprotocol/sdk/types.js import block to add McpError/ErrorCode to. ` +
        `openapi-mcp-generator's import ordering may have changed — update applyConformanceFixes() accordingly.`
    );
  }
  patched = patched.replace(MCP_TYPES_IMPORT_MARKER, MCP_TYPES_IMPORT_REPLACEMENT);

  return patched;
}
