// Spike 021d — prove the REAL upstream fetch on a v2-emitted handler (Task 0.1 gate).
// Emits a server whose handlers actually call an upstream HTTP API, mapping
// executionParameters (path/query/header) + requestBody + auth header.
import { getToolsFromOpenApi } from 'openapi-mcp-generator';
import { jsonSchemaToZod } from 'json-schema-to-zod';
import { writeFileSync } from 'node:fs';

const SPEC = '/Users/ricardo.vasconcelos/projects/mcpforge/examples/petstore/openapi.json';

const tools = await getToolsFromOpenApi(SPEC, { dereference: true });

function emitHandlerBody(t) {
  const params = t.executionParameters ?? [];
  const pathParams = params.filter(p => p.in === 'path').map(p => p.name);
  const queryParams = params.filter(p => p.in === 'query').map(p => p.name);
  const headerParams = params.filter(p => p.in === 'header').map(p => p.name);
  const hasBody = !!t.requestBodyContentType;
  const hasAuth = Array.isArray(t.securityRequirements) && t.securityRequirements.length > 0;
  return `
      const base = process.env.MCPFORGE_BASE_URL;
      if (!base) throw new Error("MCPFORGE_BASE_URL not set");
      let path = ${JSON.stringify(t.pathTemplate)};
      ${pathParams.map(p => `path = path.replace(${JSON.stringify('{'+p+'}')}, encodeURIComponent(String(args[${JSON.stringify(p)}])));`).join('\n      ')}
      const url = new URL(base.replace(/\\/$/, '') + path);
      ${queryParams.map(p => `if (args[${JSON.stringify(p)}] !== undefined) url.searchParams.set(${JSON.stringify(p)}, String(args[${JSON.stringify(p)}]));`).join('\n      ')}
      const headers = {};
      ${headerParams.map(p => `if (args[${JSON.stringify(p)}] !== undefined) headers[${JSON.stringify(p)}] = String(args[${JSON.stringify(p)}]);`).join('\n      ')}
      ${hasAuth ? `if (process.env.MCPFORGE_AUTH_TOKEN) headers["Authorization"] = "Bearer " + process.env.MCPFORGE_AUTH_TOKEN;` : ''}
      ${hasBody ? `headers["Content-Type"] = ${JSON.stringify(t.requestBodyContentType)};` : ''}
      const resp = await fetch(url, {
        method: ${JSON.stringify((t.method || 'get').toUpperCase())},
        headers,
        ${hasBody ? `body: args.requestBody !== undefined ? JSON.stringify(args.requestBody) : undefined,` : ''}
      });
      const text = await resp.text();
      return { content: [{ type: "text", text }], isError: !resp.ok };`;
}

const blocks = tools.map(t => {
  const zodSrc = jsonSchemaToZod(t.inputSchema ?? { type:'object', properties:{} });
  const method = (t.method || 'get').toLowerCase();
  return `  server.registerTool(
    ${JSON.stringify(t.name)},
    { description: ${JSON.stringify(t.description||'')}, inputSchema: ${zodSrc},
      annotations: { readOnlyHint: ${method==='get'}, destructiveHint: ${method==='delete'} } },
    async (args) => {${emitHandlerBody(t)}
    },
  );`;
}).join('\n\n');

const src = `import { createServer } from 'node:http';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler, localhostHostValidation, localhostOriginValidation } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
const handler = createMcpHandler(() => {
  const server = new McpServer({ name: 'petstore-v2-real', version: '1.0.0' });
${blocks}
  return server;
});
const nodeHandler = toNodeHandler(handler);
const vh = localhostHostValidation(), vo = localhostOriginValidation();
createServer((req,res)=>{ if(!vh(req,res)||!vo(req,res))return; void nodeHandler(req,res); }).listen(3224,'127.0.0.1',()=>console.error('ready on 3224'));
`;
writeFileSync(new URL('./generated-real.mjs', import.meta.url), src);
console.error('wrote generated-real.mjs ('+tools.length+' tools)');
