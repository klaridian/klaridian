// packages/cli/src/render/generate-server-code.ts
//
// Generates the actual TypeScript source of a basic (un-instrumented) MCP
// server from a list of ToolDefinitions. This is hand-rolled string
// generation rather than a templating engine, per ARCHITECTURE.md section 6:
// the tool-handler logic (path/query/header/body wiring) has real branching
// that's clearer as generated code than as template conditionals.
//
// Eta (templating engine) is used for the surrounding project files
// (package.json, tsconfig.json, README) in render-project.ts, where there's
// no non-trivial logic — just substitution.

import type { ToolDefinition, ToolParameter, AuthScheme } from "../openapi/types.js";
import type { ObservabilityPlugin } from "../plugins/plugin.interface.js";

function sanitizeIdentifier(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

/** Converts an OpenAPI path template ("/pet/{petId}") into a JS template literal body. */
function pathToTemplateLiteral(pathTemplate: string, pathParams: ToolParameter[]): string {
  let result = pathTemplate;
  for (const param of pathParams) {
    result = result.replace(`{${param.name}}`, `\${encodeURIComponent(String(args.${sanitizeIdentifier(param.name)}))}`);
  }
  return result;
}

/** Generates the fetch-call body for one tool's handler function. */
function generateHandlerBody(tool: ToolDefinition, auth: AuthScheme | undefined): string {
  const pathParams = tool.parameters.filter((p) => p.location === "path");
  const queryParams = tool.parameters.filter((p) => p.location === "query");
  const headerParams = tool.parameters.filter((p) => p.location === "header");
  const bodyParam = tool.parameters.find((p) => p.location === "body");

  const pathExpr = pathToTemplateLiteral(tool.path, pathParams);

  const lines: string[] = [];
  lines.push(`  const url = new URL(\`\${BASE_URL}${pathExpr}\`);`);

  for (const param of queryParams) {
    const id = sanitizeIdentifier(param.name);
    lines.push(
      `  if (args.${id} !== undefined) url.searchParams.set(${JSON.stringify(param.name)}, String(args.${id}));`
    );
  }

  if (auth?.type === "api-key" && auth.in === "query") {
    lines.push(`  url.searchParams.set(${JSON.stringify(auth.paramName)}, AUTH_TOKEN);`);
  }

  const headersLines: string[] = [];
  if (bodyParam) {
    headersLines.push(`"Content-Type": "application/json"`);
  }
  for (const param of headerParams) {
    const id = sanitizeIdentifier(param.name);
    headersLines.push(`${JSON.stringify(param.name)}: String(args.${id})`);
  }
  if (auth?.type === "http-bearer") {
    headersLines.push(`Authorization: \`Bearer \${AUTH_TOKEN}\``);
  } else if (auth?.type === "api-key" && auth.in === "header") {
    headersLines.push(`${JSON.stringify(auth.paramName)}: AUTH_TOKEN`);
  }
  const headersExpr = headersLines.length > 0 ? `{ ${headersLines.join(", ")} }` : "undefined";

  if (tool.isBinaryResponse) {
    // Binary/streaming responses (audio, PDF, ndjson, octet-stream, ...)
    // can't be inlined into an MCP tool-call content block the way JSON
    // can — this is the same category of problem frameworks like FastAPI
    // solve with a dedicated StreamingResponse/FileResponse type instead
    // of trying to serialize bytes into a JSON body. We apply the same
    // idea here: treat binary endpoints as a distinct response shape and
    // return a structured pointer (download URL + content type) the
    // caller can fetch separately, rather than streaming binary data
    // through the tool-call protocol. Redirects are followed manually so
    // a pre-signed 3xx Location can be returned auth-free, falling back to
    // an authenticated re-fetchable URL on a direct 2xx.
    lines.push(`  const response = await fetch(url, {`);
    lines.push(`    method: ${JSON.stringify(tool.method.toUpperCase())},`);
    lines.push(`    headers: ${headersExpr},`);
    if (bodyParam) {
      lines.push(`    body: JSON.stringify(args.body),`);
    }
    lines.push(`    redirect: "manual",`);
    lines.push(`  });`);
    lines.push(`  if (response.status >= 300 && response.status < 400) {`);
    lines.push(`    const location = response.headers.get("location");`);
    lines.push(`    return {`);
    lines.push(`      downloadUrl: location,`);
    lines.push(`      contentType: response.headers.get("content-type"),`);
    lines.push(`      status: response.status,`);
    lines.push(`      note: "Pre-signed URL — fetch directly, no auth needed.",`);
    lines.push(`    };`);
    lines.push(`  }`);
    lines.push(`  if (response.ok) {`);
    lines.push(`    return {`);
    lines.push(`      downloadUrl: url.toString(),`);
    lines.push(`      contentType: response.headers.get("content-type"),`);
    lines.push(`      status: response.status,`);
    lines.push(`      note: "Authenticated URL — re-fetch with the same credentials to download.",`);
    lines.push(`    };`);
    lines.push(`  }`);
    lines.push(
      `  throw new Error(\`${tool.name} failed: \${response.status} \${response.statusText}\`);`
    );
    return lines.join("\n");
  }

  lines.push(`  const response = await fetch(url, {`);
  lines.push(`    method: ${JSON.stringify(tool.method.toUpperCase())},`);
  lines.push(`    headers: ${headersExpr},`);
  if (bodyParam) {
    lines.push(`    body: JSON.stringify(args.body),`);
  }
  lines.push(`  });`);
  lines.push(`  if (!response.ok) {`);
  lines.push(
    `    throw new Error(\`${tool.name} failed: \${response.status} \${response.statusText}\`);`
  );
  lines.push(`  }`);
  lines.push(`  const contentType = response.headers.get("content-type") ?? "";`);
  lines.push(`  if (contentType.includes("application/json")) {`);
  lines.push(`    return response.json();`);
  lines.push(`  }`);
  lines.push(`  return response.text();`);

  return lines.join("\n");
}

/** Generates the MCP tool `inputSchema` object literal as a string, from our internal JsonSchemaObject. */
function schemaToLiteral(schema: unknown): string {
  return JSON.stringify(schema, null, 2)
    .split("\n")
    .join("\n  ");
}

function generateToolBlock(tool: ToolDefinition, wrapFunctionName: string | undefined, auth: AuthScheme | undefined): string {
  const handlerName = `handle_${sanitizeIdentifier(tool.name)}`;
  const rawHandlerRef = wrapFunctionName ? `${wrapFunctionName}(${JSON.stringify(tool.name)}, ${handlerName})` : handlerName;

  return `
async function ${handlerName}(args: Record<string, any>): Promise<unknown> {
${generateHandlerBody(tool, auth)}
}

const tool_${sanitizeIdentifier(tool.name)} = {
  definition: {
    name: ${JSON.stringify(tool.name)},
    description: ${JSON.stringify(tool.description)},
    inputSchema: ${schemaToLiteral(tool.inputSchema)},
  },
  handler: ${rawHandlerRef},
};`;
}

/** Generates the AUTH_TOKEN env-var validation block, or "" if the spec needs no auth. */
function generateAuthBlock(auth: AuthScheme | undefined): string {
  if (!auth) return "";
  return `
const AUTH_TOKEN = process.env.MCPFORGE_AUTH_TOKEN;
if (!AUTH_TOKEN) {
  console.error(
    "Missing required environment variable MCPFORGE_AUTH_TOKEN. " +
      "The OpenAPI spec used to generate this server requires authentication " +
      "(${auth.type === "http-bearer" ? "HTTP Bearer token" : `apiKey \\"${auth.paramName}\\" via ${auth.in}`}) " +
      "— set MCPFORGE_AUTH_TOKEN to a valid credential before starting the server."
  );
  process.exit(1);
}
`;
}

/**
 * Generates the full contents of src/index.ts for an MCP server exposing
 * the given tools, optionally instrumented by one or more observability
 * plugins (ARCHITECTURE.md section 4). Passing no plugins produces the same
 * un-instrumented output as before plugins existed.
 */
export function generateServerSource(
  tools: ToolDefinition[],
  options: { serverName: string; version: string; plugins?: ObservabilityPlugin[]; auth?: AuthScheme }
): string {
  const plugins = options.plugins ?? [];
  // v0 supports exactly zero or one plugin wrapping each tool handler — see
  // ARCHITECTURE.md section 4 on why multiple plugins wrapping the same
  // call site is deferred (would need a real composition strategy, not
  // needed until a second plugin like PostHog actually ships).
  if (plugins.length > 1) {
    throw new Error(
      `generateServerSource: only 0 or 1 plugins are supported in v0, got ${plugins.length}. ` +
        `Composing multiple plugins around the same tool call is deferred until a second plugin ships.`
    );
  }
  const plugin = plugins[0];
  const wrapFunctionName = plugin?.getServerWiring().wrapFunctionName;
  const auth = options.auth;

  const toolBlocks = tools.map((t) => generateToolBlock(t, wrapFunctionName, auth)).join("\n");
  const toolRegistryEntries = tools
    .map((t) => `  [${JSON.stringify(t.name)}]: tool_${sanitizeIdentifier(t.name)},`)
    .join("\n");

  const pluginImport = plugin ? plugin.getServerWiring().importStatement + "\n" : "";
  const authBlock = generateAuthBlock(auth);

  return `#!/usr/bin/env node
// GENERATED by mcpforge — do not edit by hand, regenerate from the OpenAPI spec instead.
${plugin ? `//\n// Instrumented with the "${plugin.id}" observability plugin.` : "//\n// No observability plugin selected — this server is un-instrumented."}

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
${pluginImport}
const BASE_URL = process.env.MCPFORGE_BASE_URL;
if (!BASE_URL) {
  console.error(
    "Missing required environment variable MCPFORGE_BASE_URL. " +
      "The OpenAPI spec used to generate this server declared a server URL " +
      "that mcpforge could not treat as a complete host — set MCPFORGE_BASE_URL " +
      "to the full base URL to call (e.g. https://api.example.com)."
  );
  process.exit(1);
}
${authBlock}${toolBlocks}

const tools: Record<string, { definition: any; handler: (args: any) => Promise<unknown> }> = {
${toolRegistryEntries}
};

const server = new Server(
  { name: ${JSON.stringify(options.serverName)}, version: ${JSON.stringify(options.version)} },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.values(tools).map((t) => t.definition),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools[request.params.name];
  if (!tool) {
    throw new Error(\`Unknown tool: \${request.params.name}\`);
  }
  const result = await tool.handler(request.params.arguments ?? {});
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(${JSON.stringify(options.serverName)} + " MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
`;
}
