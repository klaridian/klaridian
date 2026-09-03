import { createServer } from 'node:http';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler, localhostHostValidation, localhostOriginValidation } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
const handler = createMcpHandler(() => {
  const server = new McpServer({ name: 'petstore-v2-real', version: '1.0.0' });
  server.registerTool(
    "updatePet",
    { description: "Update an existing pet by Id.", inputSchema: z.object({ "requestBody": z.object({ "id": z.number().int().optional(), "name": z.string(), "category": z.object({ "id": z.number().int().optional(), "name": z.string().optional() }).optional(), "photoUrls": z.array(z.string()), "tags": z.array(z.object({ "id": z.number().int().optional(), "name": z.string().optional() })).optional(), "status": z.enum(["available","pending","sold"]).describe("pet status in the store").optional() }).describe("Update an existent pet in the store") }),
      annotations: { readOnlyHint: false, destructiveHint: false } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/pet";
      
      const url = new URL(base.replace(/\/$/, '') + path);
      
      const headers = {};
      
      if (process.env.MCPFORGE_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.MCPFORGE_AUTH_TOKEN;
      headers["Content-Type"] = "application/json";
      const resp = await fetch(url, {
        method: "PUT",
        headers,
        body: args.requestBody !== undefined ? JSON.stringify(args.requestBody) : undefined,
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "addPet",
    { description: "Add a new pet to the store.", inputSchema: z.object({ "requestBody": z.object({ "id": z.number().int().optional(), "name": z.string(), "category": z.object({ "id": z.number().int().optional(), "name": z.string().optional() }).optional(), "photoUrls": z.array(z.string()), "tags": z.array(z.object({ "id": z.number().int().optional(), "name": z.string().optional() })).optional(), "status": z.enum(["available","pending","sold"]).describe("pet status in the store").optional() }).describe("Create a new pet in the store") }),
      annotations: { readOnlyHint: false, destructiveHint: false } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/pet";
      
      const url = new URL(base.replace(/\/$/, '') + path);
      
      const headers = {};
      
      if (process.env.MCPFORGE_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.MCPFORGE_AUTH_TOKEN;
      headers["Content-Type"] = "application/json";
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: args.requestBody !== undefined ? JSON.stringify(args.requestBody) : undefined,
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "findPetsByStatus",
    { description: "Multiple status values can be provided with comma separated strings.", inputSchema: z.object({ "status": z.enum(["available","pending","sold"]).describe("Status values that need to be considered for filter").default("available") }),
      annotations: { readOnlyHint: true, destructiveHint: false } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/pet/findByStatus";
      
      const url = new URL(base.replace(/\/$/, '') + path);
      if (args["status"] !== undefined) url.searchParams.set("status", String(args["status"]));
      const headers = {};
      
      if (process.env.MCPFORGE_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.MCPFORGE_AUTH_TOKEN;
      
      const resp = await fetch(url, {
        method: "GET",
        headers,
        
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "findPetsByTags",
    { description: "Multiple tags can be provided with comma separated strings. Use tag1, tag2, tag3 for testing.", inputSchema: z.object({ "tags": z.array(z.string()).describe("Tags to filter by") }),
      annotations: { readOnlyHint: true, destructiveHint: false } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/pet/findByTags";
      
      const url = new URL(base.replace(/\/$/, '') + path);
      if (args["tags"] !== undefined) url.searchParams.set("tags", String(args["tags"]));
      const headers = {};
      
      if (process.env.MCPFORGE_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.MCPFORGE_AUTH_TOKEN;
      
      const resp = await fetch(url, {
        method: "GET",
        headers,
        
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "getPetById",
    { description: "Returns a single pet.", inputSchema: z.object({ "petId": z.number().int().describe("ID of pet to return") }),
      annotations: { readOnlyHint: true, destructiveHint: false } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/pet/{petId}";
      path = path.replace("{petId}", encodeURIComponent(String(args["petId"])));
      const url = new URL(base.replace(/\/$/, '') + path);
      
      const headers = {};
      
      if (process.env.MCPFORGE_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.MCPFORGE_AUTH_TOKEN;
      
      const resp = await fetch(url, {
        method: "GET",
        headers,
        
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "updatePetWithForm",
    { description: "Updates a pet resource based on the form data.", inputSchema: z.object({ "petId": z.number().int().describe("ID of pet that needs to be updated"), "name": z.string().describe("Name of pet that needs to be updated").optional(), "status": z.string().describe("Status of pet that needs to be updated").optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/pet/{petId}";
      path = path.replace("{petId}", encodeURIComponent(String(args["petId"])));
      const url = new URL(base.replace(/\/$/, '') + path);
      if (args["name"] !== undefined) url.searchParams.set("name", String(args["name"]));
      if (args["status"] !== undefined) url.searchParams.set("status", String(args["status"]));
      const headers = {};
      
      if (process.env.MCPFORGE_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.MCPFORGE_AUTH_TOKEN;
      
      const resp = await fetch(url, {
        method: "POST",
        headers,
        
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "deletePet",
    { description: "Delete a pet.", inputSchema: z.object({ "api_key": z.string().optional(), "petId": z.number().int().describe("Pet id to delete") }),
      annotations: { readOnlyHint: false, destructiveHint: true } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/pet/{petId}";
      path = path.replace("{petId}", encodeURIComponent(String(args["petId"])));
      const url = new URL(base.replace(/\/$/, '') + path);
      
      const headers = {};
      if (args["api_key"] !== undefined) headers["api_key"] = String(args["api_key"]);
      if (process.env.MCPFORGE_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.MCPFORGE_AUTH_TOKEN;
      
      const resp = await fetch(url, {
        method: "DELETE",
        headers,
        
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "uploadFile",
    { description: "Upload image of the pet.", inputSchema: z.object({ "petId": z.number().int().describe("ID of pet to update"), "additionalMetadata": z.string().describe("Additional Metadata").optional(), "requestBody": z.string().describe("Request body (content type: application/octet-stream)").optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/pet/{petId}/uploadImage";
      path = path.replace("{petId}", encodeURIComponent(String(args["petId"])));
      const url = new URL(base.replace(/\/$/, '') + path);
      if (args["additionalMetadata"] !== undefined) url.searchParams.set("additionalMetadata", String(args["additionalMetadata"]));
      const headers = {};
      
      if (process.env.MCPFORGE_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.MCPFORGE_AUTH_TOKEN;
      headers["Content-Type"] = "application/octet-stream";
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: args.requestBody !== undefined ? JSON.stringify(args.requestBody) : undefined,
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "getInventory",
    { description: "Returns a map of status codes to quantities.", inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/store/inventory";
      
      const url = new URL(base.replace(/\/$/, '') + path);
      
      const headers = {};
      
      if (process.env.MCPFORGE_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.MCPFORGE_AUTH_TOKEN;
      
      const resp = await fetch(url, {
        method: "GET",
        headers,
        
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "placeOrder",
    { description: "Place a new order in the store.", inputSchema: z.object({ "requestBody": z.object({ "id": z.number().int().optional(), "petId": z.number().int().optional(), "quantity": z.number().optional(), "shipDate": z.string().datetime({ offset: true }).optional(), "status": z.enum(["placed","approved","delivered"]).describe("Order Status").optional(), "complete": z.boolean().optional() }).describe("The JSON request body.").optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/store/order";
      
      const url = new URL(base.replace(/\/$/, '') + path);
      
      const headers = {};
      
      
      headers["Content-Type"] = "application/json";
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: args.requestBody !== undefined ? JSON.stringify(args.requestBody) : undefined,
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "getOrderById",
    { description: "For valid response try integer IDs with value <= 5 or > 10. Other values will generate exceptions.", inputSchema: z.object({ "orderId": z.number().int().describe("ID of order that needs to be fetched") }),
      annotations: { readOnlyHint: true, destructiveHint: false } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/store/order/{orderId}";
      path = path.replace("{orderId}", encodeURIComponent(String(args["orderId"])));
      const url = new URL(base.replace(/\/$/, '') + path);
      
      const headers = {};
      
      
      
      const resp = await fetch(url, {
        method: "GET",
        headers,
        
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "deleteOrder",
    { description: "For valid response try integer IDs with value < 1000. Anything above 1000 or non-integers will generate API errors.", inputSchema: z.object({ "orderId": z.number().int().describe("ID of the order that needs to be deleted") }),
      annotations: { readOnlyHint: false, destructiveHint: true } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/store/order/{orderId}";
      path = path.replace("{orderId}", encodeURIComponent(String(args["orderId"])));
      const url = new URL(base.replace(/\/$/, '') + path);
      
      const headers = {};
      
      
      
      const resp = await fetch(url, {
        method: "DELETE",
        headers,
        
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "createUser",
    { description: "This can only be done by the logged in user.", inputSchema: z.object({ "requestBody": z.object({ "id": z.number().int().optional(), "username": z.string().optional(), "firstName": z.string().optional(), "lastName": z.string().optional(), "email": z.string().optional(), "password": z.string().optional(), "phone": z.string().optional(), "userStatus": z.number().describe("User Status").optional() }).describe("Created user object").optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/user";
      
      const url = new URL(base.replace(/\/$/, '') + path);
      
      const headers = {};
      
      
      headers["Content-Type"] = "application/json";
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: args.requestBody !== undefined ? JSON.stringify(args.requestBody) : undefined,
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "createUsersWithListInput",
    { description: "Creates list of users with given input array.", inputSchema: z.object({ "requestBody": z.array(z.object({ "id": z.number().int().optional(), "username": z.string().optional(), "firstName": z.string().optional(), "lastName": z.string().optional(), "email": z.string().optional(), "password": z.string().optional(), "phone": z.string().optional(), "userStatus": z.number().describe("User Status").optional() })).describe("The JSON request body.").optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/user/createWithList";
      
      const url = new URL(base.replace(/\/$/, '') + path);
      
      const headers = {};
      
      
      headers["Content-Type"] = "application/json";
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: args.requestBody !== undefined ? JSON.stringify(args.requestBody) : undefined,
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "loginUser",
    { description: "Log into the system.", inputSchema: z.object({ "username": z.string().describe("The user name for login").optional(), "password": z.string().describe("The password for login in clear text").optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/user/login";
      
      const url = new URL(base.replace(/\/$/, '') + path);
      if (args["username"] !== undefined) url.searchParams.set("username", String(args["username"]));
      if (args["password"] !== undefined) url.searchParams.set("password", String(args["password"]));
      const headers = {};
      
      
      
      const resp = await fetch(url, {
        method: "GET",
        headers,
        
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "logoutUser",
    { description: "Log user out of the system.", inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/user/logout";
      
      const url = new URL(base.replace(/\/$/, '') + path);
      
      const headers = {};
      
      
      
      const resp = await fetch(url, {
        method: "GET",
        headers,
        
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "getUserByName",
    { description: "Get user detail based on username.", inputSchema: z.object({ "username": z.string().describe("The name that needs to be fetched. Use user1 for testing") }),
      annotations: { readOnlyHint: true, destructiveHint: false } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/user/{username}";
      path = path.replace("{username}", encodeURIComponent(String(args["username"])));
      const url = new URL(base.replace(/\/$/, '') + path);
      
      const headers = {};
      
      
      
      const resp = await fetch(url, {
        method: "GET",
        headers,
        
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "updateUser",
    { description: "This can only be done by the logged in user.", inputSchema: z.object({ "username": z.string().describe("name that need to be deleted"), "requestBody": z.object({ "id": z.number().int().optional(), "username": z.string().optional(), "firstName": z.string().optional(), "lastName": z.string().optional(), "email": z.string().optional(), "password": z.string().optional(), "phone": z.string().optional(), "userStatus": z.number().describe("User Status").optional() }).describe("Update an existent user in the store").optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/user/{username}";
      path = path.replace("{username}", encodeURIComponent(String(args["username"])));
      const url = new URL(base.replace(/\/$/, '') + path);
      
      const headers = {};
      
      
      headers["Content-Type"] = "application/json";
      const resp = await fetch(url, {
        method: "PUT",
        headers,
        body: args.requestBody !== undefined ? JSON.stringify(args.requestBody) : undefined,
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );

  server.registerTool(
    "deleteUser",
    { description: "This can only be done by the logged in user.", inputSchema: z.object({ "username": z.string().describe("The name that needs to be deleted") }),
      annotations: { readOnlyHint: false, destructiveHint: true } },
    async (args) => {
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = "/user/{username}";
      path = path.replace("{username}", encodeURIComponent(String(args["username"])));
      const url = new URL(base.replace(/\/$/, '') + path);
      
      const headers = {};
      
      
      
      const resp = await fetch(url, {
        method: "DELETE",
        headers,
        
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };
    },
  );
  return server;
});
const nodeHandler = toNodeHandler(handler);
const vh = localhostHostValidation(), vo = localhostOriginValidation();
createServer((req,res)=>{ if(!vh(req,res)||!vo(req,res))return; void nodeHandler(req,res); }).listen(3224,'127.0.0.1',()=>console.error('ready on 3224'));
