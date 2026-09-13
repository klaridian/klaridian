import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "node:http";
import { toNodeHandler, localhostHostValidation, localhostOriginValidation } from "@modelcontextprotocol/node";

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "klaridian-deploy-demo", version: "1.0.0" });

  server.registerTool(
    "updatePet",
    {
      title: "Update an existing pet.",
      description: "Update an existing pet by Id.",
      inputSchema: z.object({ "requestBody": z.object({ "id": z.number().int().optional(), "name": z.string(), "category": z.object({ "id": z.number().int().optional(), "name": z.string().optional() }).optional(), "photoUrls": z.array(z.string()), "tags": z.array(z.object({ "id": z.number().int().optional(), "name": z.string().optional() })).optional(), "status": z.enum(["available","pending","sold"]).describe("pet status in the store").optional() }).describe("Update an existent pet in the store") }),
      annotations: { title: "Update an existing pet.", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/pet";
      const url = new URL(base.replace(/\/$/, "") + path);
      const headers: Record<string, string> = {};
      if (process.env.KLARIDIAN_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.KLARIDIAN_AUTH_TOKEN;
      headers["Content-Type"] = "application/json";
      const resp = await fetch(url, {
        method: "PUT",
        headers,
        body: (args as Record<string, unknown>).requestBody !== undefined ? JSON.stringify((args as Record<string, unknown>).requestBody) : undefined,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "addPet",
    {
      title: "Add a new pet to the store.",
      description: "Add a new pet to the store.",
      inputSchema: z.object({ "requestBody": z.object({ "id": z.number().int().optional(), "name": z.string(), "category": z.object({ "id": z.number().int().optional(), "name": z.string().optional() }).optional(), "photoUrls": z.array(z.string()), "tags": z.array(z.object({ "id": z.number().int().optional(), "name": z.string().optional() })).optional(), "status": z.enum(["available","pending","sold"]).describe("pet status in the store").optional() }).describe("Create a new pet in the store") }),
      annotations: { title: "Add a new pet to the store.", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/pet";
      const url = new URL(base.replace(/\/$/, "") + path);
      const headers: Record<string, string> = {};
      if (process.env.KLARIDIAN_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.KLARIDIAN_AUTH_TOKEN;
      headers["Content-Type"] = "application/json";
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: (args as Record<string, unknown>).requestBody !== undefined ? JSON.stringify((args as Record<string, unknown>).requestBody) : undefined,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "findPetsByStatus",
    {
      title: "Finds Pets by status.",
      description: "Multiple status values can be provided with comma separated strings.",
      inputSchema: z.object({ "status": z.enum(["available","pending","sold"]).describe("Status values that need to be considered for filter").default("available") }),
      annotations: { title: "Finds Pets by status.", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/pet/findByStatus";
      const url = new URL(base.replace(/\/$/, "") + path);
      if (args["status"] !== undefined) url.searchParams.set("status", String(args["status"]));
      const headers: Record<string, string> = {};
      if (process.env.KLARIDIAN_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.KLARIDIAN_AUTH_TOKEN;
      const resp = await fetch(url, {
        method: "GET",
        headers,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "findPetsByTags",
    {
      title: "Finds Pets by tags.",
      description: "Multiple tags can be provided with comma separated strings. Use tag1, tag2, tag3 for testing.",
      inputSchema: z.object({ "tags": z.array(z.string()).describe("Tags to filter by") }),
      annotations: { title: "Finds Pets by tags.", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/pet/findByTags";
      const url = new URL(base.replace(/\/$/, "") + path);
      if (args["tags"] !== undefined) url.searchParams.set("tags", String(args["tags"]));
      const headers: Record<string, string> = {};
      if (process.env.KLARIDIAN_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.KLARIDIAN_AUTH_TOKEN;
      const resp = await fetch(url, {
        method: "GET",
        headers,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "getPetById",
    {
      title: "Find pet by ID.",
      description: "Returns a single pet.",
      inputSchema: z.object({ "petId": z.number().int().describe("ID of pet to return") }),
      annotations: { title: "Find pet by ID.", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/pet/{petId}";
      path = path.replace("{petId}", encodeURIComponent(String(args["petId"])));
      const url = new URL(base.replace(/\/$/, "") + path);
      const headers: Record<string, string> = {};
      if (process.env.KLARIDIAN_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.KLARIDIAN_AUTH_TOKEN;
      const resp = await fetch(url, {
        method: "GET",
        headers,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "updatePetWithForm",
    {
      title: "Updates a pet in the store with form data.",
      description: "Updates a pet resource based on the form data.",
      inputSchema: z.object({ "petId": z.number().int().describe("ID of pet that needs to be updated"), "name": z.string().describe("Name of pet that needs to be updated").optional(), "status": z.string().describe("Status of pet that needs to be updated").optional() }),
      annotations: { title: "Updates a pet in the store with form data.", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/pet/{petId}";
      path = path.replace("{petId}", encodeURIComponent(String(args["petId"])));
      const url = new URL(base.replace(/\/$/, "") + path);
      if (args["name"] !== undefined) url.searchParams.set("name", String(args["name"]));
      if (args["status"] !== undefined) url.searchParams.set("status", String(args["status"]));
      const headers: Record<string, string> = {};
      if (process.env.KLARIDIAN_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.KLARIDIAN_AUTH_TOKEN;
      const resp = await fetch(url, {
        method: "POST",
        headers,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "deletePet",
    {
      title: "Deletes a pet.",
      description: "Delete a pet.",
      inputSchema: z.object({ "api_key": z.string().optional(), "petId": z.number().int().describe("Pet id to delete") }),
      annotations: { title: "Deletes a pet.", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/pet/{petId}";
      path = path.replace("{petId}", encodeURIComponent(String(args["petId"])));
      const url = new URL(base.replace(/\/$/, "") + path);
      const headers: Record<string, string> = {};
      if (args["api_key"] !== undefined) headers["api_key"] = String(args["api_key"]);
      if (process.env.KLARIDIAN_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.KLARIDIAN_AUTH_TOKEN;
      const resp = await fetch(url, {
        method: "DELETE",
        headers,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "uploadFile",
    {
      title: "Uploads an image.",
      description: "Upload image of the pet.",
      inputSchema: z.object({ "petId": z.number().int().describe("ID of pet to update"), "additionalMetadata": z.string().describe("Additional Metadata").optional(), "requestBody": z.string().describe("Request body (content type: application/octet-stream)").optional() }),
      annotations: { title: "Uploads an image.", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/pet/{petId}/uploadImage";
      path = path.replace("{petId}", encodeURIComponent(String(args["petId"])));
      const url = new URL(base.replace(/\/$/, "") + path);
      if (args["additionalMetadata"] !== undefined) url.searchParams.set("additionalMetadata", String(args["additionalMetadata"]));
      const headers: Record<string, string> = {};
      if (process.env.KLARIDIAN_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.KLARIDIAN_AUTH_TOKEN;
      headers["Content-Type"] = "application/octet-stream";
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: (args as Record<string, unknown>).requestBody !== undefined ? JSON.stringify((args as Record<string, unknown>).requestBody) : undefined,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "getInventory",
    {
      title: "Returns pet inventories by status.",
      description: "Returns a map of status codes to quantities.",
      inputSchema: z.object({}),
      annotations: { title: "Returns pet inventories by status.", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/store/inventory";
      const url = new URL(base.replace(/\/$/, "") + path);
      const headers: Record<string, string> = {};
      if (process.env.KLARIDIAN_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.KLARIDIAN_AUTH_TOKEN;
      const resp = await fetch(url, {
        method: "GET",
        headers,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "placeOrder",
    {
      title: "Place an order for a pet.",
      description: "Place a new order in the store.",
      inputSchema: z.object({ "requestBody": z.object({ "id": z.number().int().optional(), "petId": z.number().int().optional(), "quantity": z.number().optional(), "shipDate": z.string().datetime({ offset: true }).optional(), "status": z.enum(["placed","approved","delivered"]).describe("Order Status").optional(), "complete": z.boolean().optional() }).describe("The JSON request body.").optional() }),
      annotations: { title: "Place an order for a pet.", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/store/order";
      const url = new URL(base.replace(/\/$/, "") + path);
      const headers: Record<string, string> = {};
      headers["Content-Type"] = "application/json";
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: (args as Record<string, unknown>).requestBody !== undefined ? JSON.stringify((args as Record<string, unknown>).requestBody) : undefined,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "getOrderById",
    {
      title: "Find purchase order by ID.",
      description: "For valid response try integer IDs with value <= 5 or > 10. Other values will generate exceptions.",
      inputSchema: z.object({ "orderId": z.number().int().describe("ID of order that needs to be fetched") }),
      annotations: { title: "Find purchase order by ID.", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/store/order/{orderId}";
      path = path.replace("{orderId}", encodeURIComponent(String(args["orderId"])));
      const url = new URL(base.replace(/\/$/, "") + path);
      const headers: Record<string, string> = {};
      const resp = await fetch(url, {
        method: "GET",
        headers,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "deleteOrder",
    {
      title: "Delete purchase order by identifier.",
      description: "For valid response try integer IDs with value < 1000. Anything above 1000 or non-integers will generate API errors.",
      inputSchema: z.object({ "orderId": z.number().int().describe("ID of the order that needs to be deleted") }),
      annotations: { title: "Delete purchase order by identifier.", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/store/order/{orderId}";
      path = path.replace("{orderId}", encodeURIComponent(String(args["orderId"])));
      const url = new URL(base.replace(/\/$/, "") + path);
      const headers: Record<string, string> = {};
      const resp = await fetch(url, {
        method: "DELETE",
        headers,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "createUser",
    {
      title: "Create user.",
      description: "This can only be done by the logged in user.",
      inputSchema: z.object({ "requestBody": z.object({ "id": z.number().int().optional(), "username": z.string().optional(), "firstName": z.string().optional(), "lastName": z.string().optional(), "email": z.string().optional(), "password": z.string().optional(), "phone": z.string().optional(), "userStatus": z.number().describe("User Status").optional() }).describe("Created user object").optional() }),
      annotations: { title: "Create user.", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/user";
      const url = new URL(base.replace(/\/$/, "") + path);
      const headers: Record<string, string> = {};
      headers["Content-Type"] = "application/json";
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: (args as Record<string, unknown>).requestBody !== undefined ? JSON.stringify((args as Record<string, unknown>).requestBody) : undefined,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "createUsersWithListInput",
    {
      title: "Creates list of users with given input array.",
      description: "Creates list of users with given input array.",
      inputSchema: z.object({ "requestBody": z.array(z.object({ "id": z.number().int().optional(), "username": z.string().optional(), "firstName": z.string().optional(), "lastName": z.string().optional(), "email": z.string().optional(), "password": z.string().optional(), "phone": z.string().optional(), "userStatus": z.number().describe("User Status").optional() })).describe("The JSON request body.").optional() }),
      annotations: { title: "Creates list of users with given input array.", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/user/createWithList";
      const url = new URL(base.replace(/\/$/, "") + path);
      const headers: Record<string, string> = {};
      headers["Content-Type"] = "application/json";
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: (args as Record<string, unknown>).requestBody !== undefined ? JSON.stringify((args as Record<string, unknown>).requestBody) : undefined,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "loginUser",
    {
      title: "Logs user into the system.",
      description: "Log into the system.",
      inputSchema: z.object({ "username": z.string().describe("The user name for login").optional(), "password": z.string().describe("The password for login in clear text").optional() }),
      annotations: { title: "Logs user into the system.", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/user/login";
      const url = new URL(base.replace(/\/$/, "") + path);
      if (args["username"] !== undefined) url.searchParams.set("username", String(args["username"]));
      if (args["password"] !== undefined) url.searchParams.set("password", String(args["password"]));
      const headers: Record<string, string> = {};
      const resp = await fetch(url, {
        method: "GET",
        headers,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "logoutUser",
    {
      title: "Logs out current logged in user session.",
      description: "Log user out of the system.",
      inputSchema: z.object({}),
      annotations: { title: "Logs out current logged in user session.", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/user/logout";
      const url = new URL(base.replace(/\/$/, "") + path);
      const headers: Record<string, string> = {};
      const resp = await fetch(url, {
        method: "GET",
        headers,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "getUserByName",
    {
      title: "Get user by user name.",
      description: "Get user detail based on username.",
      inputSchema: z.object({ "username": z.string().describe("The name that needs to be fetched. Use user1 for testing") }),
      annotations: { title: "Get user by user name.", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/user/{username}";
      path = path.replace("{username}", encodeURIComponent(String(args["username"])));
      const url = new URL(base.replace(/\/$/, "") + path);
      const headers: Record<string, string> = {};
      const resp = await fetch(url, {
        method: "GET",
        headers,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "updateUser",
    {
      title: "Update user resource.",
      description: "This can only be done by the logged in user.",
      inputSchema: z.object({ "username": z.string().describe("name that need to be deleted"), "requestBody": z.object({ "id": z.number().int().optional(), "username": z.string().optional(), "firstName": z.string().optional(), "lastName": z.string().optional(), "email": z.string().optional(), "password": z.string().optional(), "phone": z.string().optional(), "userStatus": z.number().describe("User Status").optional() }).describe("Update an existent user in the store").optional() }),
      annotations: { title: "Update user resource.", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/user/{username}";
      path = path.replace("{username}", encodeURIComponent(String(args["username"])));
      const url = new URL(base.replace(/\/$/, "") + path);
      const headers: Record<string, string> = {};
      headers["Content-Type"] = "application/json";
      const resp = await fetch(url, {
        method: "PUT",
        headers,
        body: (args as Record<string, unknown>).requestBody !== undefined ? JSON.stringify((args as Record<string, unknown>).requestBody) : undefined,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "deleteUser",
    {
      title: "Delete user resource.",
      description: "This can only be done by the logged in user.",
      inputSchema: z.object({ "username": z.string().describe("The name that needs to be deleted") }),
      annotations: { title: "Delete user resource.", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const base = process.env.KLARIDIAN_BASE_URL;
      if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
      let path = "/user/{username}";
      path = path.replace("{username}", encodeURIComponent(String(args["username"])));
      const url = new URL(base.replace(/\/$/, "") + path);
      const headers: Record<string, string> = {};
      const resp = await fetch(url, {
        method: "DELETE",
        headers,
      });
      const text = await resp.text();
      return { content: [{ type: "text" as const, text }], isError: !resp.ok };
    },
  );

  return server;
});

const nodeHandler = toNodeHandler(handler);
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();
// Bind host is configurable so the same server is secure locally (default
// 127.0.0.1, per MCP spec) and reachable when the caller controls the network
// namespace it runs in (set KLARIDIAN_BIND_HOST=0.0.0.0). Host-header
// validation still restricts callers to localhost, so 0.0.0.0 only widens the
// network interface, not the accepted Host set.
const bindHost = process.env.KLARIDIAN_BIND_HOST || "127.0.0.1";
createServer(async (req, res) => {
  if (!validateHost(req, res) || !validateOrigin(req, res)) return;
  void nodeHandler(req, res);
}).listen(3000, bindHost, () => {
  console.error(`MCP server (streamable-http) on http://${bindHost}:3000/mcp`);
});

process.on("SIGINT", async () => { await handler.close(); process.exit(0); });
process.on("SIGTERM", async () => { await handler.close(); process.exit(0); });
