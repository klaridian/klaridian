// EMITTED ARTIFACT (spike): what `klaridian deploy --target cloudflare` would emit
// as the Worker entrypoint. It reuses the SAME MCP factory the node entry uses,
// but exports a web-standard `fetch` instead of calling node:http createServer().
//
// This is the crux of the spike: klaridian's SDK path (createMcpHandler) already
// returns a { fetch(Request): Promise<Response> } — the Worker needs NOTHING from
// @modelcontextprotocol/node. The ONLY reason klaridian can't target Workers today
// is that its emitter bakes the node:http bootstrap into src/index.ts as a
// top-level side effect (`.listen()`), so that file can't be imported by a Worker.
// The fix is an emitter refactor: split tool-registration (the factory) from the
// transport bootstrap, then emit this thin worker entry alongside the node one.
//
// For the spike, the factory below mirrors what the shared module would export
// (two representative petstore tools; the real emitter registers all of them).
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

interface Env {
  KLARIDIAN_BASE_URL?: string;
  KLARIDIAN_ALLOWED_HOSTS?: string;
  KLARIDIAN_AUTH_TOKEN?: string;
}

function buildHandler(env: Env) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: "klaridian-deploy-demo", version: "1.0.0" });

    server.registerTool(
      "findPetsByStatus",
      {
        title: "Finds Pets by status.",
        description: "Multiple status values can be provided with comma separated strings.",
        inputSchema: z.object({
          status: z.enum(["available", "pending", "sold"]).default("available"),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async (args) => {
        const base = env.KLARIDIAN_BASE_URL;
        if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
        const url = new URL(base.replace(/\/$/, "") + "/pet/findByStatus");
        if (args["status"] !== undefined) url.searchParams.set("status", String(args["status"]));
        const headers: Record<string, string> = {};
        if (env.KLARIDIAN_AUTH_TOKEN) headers["Authorization"] = "Bearer " + env.KLARIDIAN_AUTH_TOKEN;
        const resp = await fetch(url, { method: "GET", headers });
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
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async () => {
        const base = env.KLARIDIAN_BASE_URL;
        if (!base) throw new Error("KLARIDIAN_BASE_URL is not set");
        const url = new URL(base.replace(/\/$/, "") + "/store/inventory");
        const headers: Record<string, string> = {};
        if (env.KLARIDIAN_AUTH_TOKEN) headers["Authorization"] = "Bearer " + env.KLARIDIAN_AUTH_TOKEN;
        const resp = await fetch(url, { method: "GET", headers });
        const text = await resp.text();
        return { content: [{ type: "text" as const, text }], isError: !resp.ok };
      },
    );

    return server;
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // One handler per isolate is fine; the SDK's modern transport is per-request.
    const handler = buildHandler(env);
    return handler.fetch(request);
  },
};
