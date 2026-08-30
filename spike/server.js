#!/usr/bin/env node
// spike/server.js
//
// Manually-built MCP server for 2 operations from the Petstore OpenAPI spec
// (examples/petstore/openapi.json), instrumented with the wrapTool() helper
// from instrumentation.js.
//
// Goal of this spike: prove the full mechanic — OpenAPI operation -> MCP tool
// -> OTel span -> exported trace — works end to end BEFORE building the
// generator abstraction (per ARCHITECTURE.md section 9, step 1).
//
// Run with: node server.js
// Then drive it with the MCP inspector: npx @modelcontextprotocol/inspector node server.js

const { wrapTool } = require("./instrumentation");

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

const PETSTORE_BASE = "https://petstore3.swagger.io/api/v3";

// --- Tool implementations (would be generated from OpenAPI in the real CLI) ---

async function getPetByIdImpl({ petId }) {
  const res = await fetch(`${PETSTORE_BASE}/pet/${petId}`);
  if (!res.ok) {
    throw new Error(`Petstore API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function findPetsByStatusImpl({ status }) {
  const url = new URL(`${PETSTORE_BASE}/pet/findByStatus`);
  if (status) url.searchParams.set("status", status);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Petstore API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// --- Tool definitions (would be derived from OpenAPI schemas in the real CLI) ---

const tools = {
  getPetById: {
    definition: {
      name: "getPetById",
      description: "Find pet by ID. Returns a single pet.",
      inputSchema: {
        type: "object",
        properties: {
          petId: { type: "integer", description: "ID of pet to return" },
        },
        required: ["petId"],
      },
    },
    handler: wrapTool("getPetById", getPetByIdImpl),
  },
  findPetsByStatus: {
    definition: {
      name: "findPetsByStatus",
      description:
        "Finds Pets by status. Multiple status values can be provided.",
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["available", "pending", "sold"],
            description: "Status value to filter by",
          },
        },
        required: [],
      },
    },
    handler: wrapTool("findPetsByStatus", findPetsByStatusImpl),
  },
};

// --- MCP server wiring ---

const server = new Server(
  { name: "mcpforge-spike-petstore", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.values(tools).map((t) => t.definition),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools[request.params.name];
  if (!tool) {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }
  const result = await tool.handler(request.params.arguments ?? {});
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcpforge-spike-petstore MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
