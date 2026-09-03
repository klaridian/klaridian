// Spike 021 — v2 SDK stateless Streamable HTTP server (throwaway).
// Question: does the official @modelcontextprotocol/server v2 `createMcpHandler`
// (factory-per-request, stateless) survive SEQUENTIAL HTTP requests — the exact
// case where openapi-mcp-generator's v1 session-based streamable-http.ts crashes
// with `ReadableStream is locked` on the 2nd request?
import { createServer } from 'node:http';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import {
  toNodeHandler,
  localhostHostValidation,
  localhostOriginValidation,
} from '@modelcontextprotocol/node';
import * as z from 'zod/v4';

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: 'spike-021', version: '1.0.0' });
  server.registerTool(
    'echo',
    {
      description: 'Echo back the provided message',
      inputSchema: z.object({ message: z.string() }),
    },
    async ({ message }) => ({ content: [{ type: 'text', text: `echo: ${message}` }] }),
  );
  return server;
});

const nodeHandler = toNodeHandler(handler);
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

createServer((req, res) => {
  if (!validateHost(req, res) || !validateOrigin(req, res)) return;
  void nodeHandler(req, res);
}).listen(3222, '127.0.0.1', () => {
  console.error('spike-021 stateless MCP server on http://127.0.0.1:3222/mcp');
});
