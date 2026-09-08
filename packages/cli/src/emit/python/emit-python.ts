// packages/cli/src/emit/python/emit-python.ts
//
// MCPFO-60.3 — the Python emit target. The first non-TypeScript implementation
// of the MCPFO-60.0 EmitTarget interface, proving the tool-data IR is honestly
// language-neutral (ARCHITECTURE.md section 60, the whole point of the
// multi-language forcing function).
//
// Emits a complete, runnable Python MCP server project from the SAME
// openapi-mcp-generator tool DATA the TypeScript emitter consumes, using the
// official Python SDK (mcp==2.1.1, validated in spike 059). Structure mirrors
// emit-server.ts's TS project:
//   server.py         — entrypoint: tool registry, on_list_tools/on_call_tool,
//                       the single shared _dispatch boundary (MCPFO-60.2), and
//                       both transports (stdio + stateless streamable-http).
//   tools.py          — one async proxy per operation (path/query/header params,
//                       JSON body, env-var Bearer auth) + tool metadata.
//   conformance.py    — vendored, from the Python conformance adapter (60.1):
//                       the spec-error surfaces the low-level SDK lacks.
//   pyproject.toml    — project manifest (PEP 621).
//   requirements.txt  — pinned runtime deps.
//   README.md         — how to install/run.
//
// Reuses annotationsForMethod() and titleForTool() from emit-tool.ts verbatim:
// they operate on the IR, not on any TS-specific rendering, so a second target
// consuming them is direct evidence the annotation/title logic is language-
// neutral (spike 059's "ported 1:1" finding, now enforced by shared code).

import type { McpToolDefinition } from "openapi-mcp-generator";
import type { EmitOptions, EmittedProject, PluginWiring } from "../emit-server.js";
import { annotationsForMethod, titleForTool } from "../emit-tool.js";
import { pythonConformanceAdapter } from "../conformance/python.js";
import { emitDispatchWrap } from "../plugin-dispatch/python.js";

/** mcp SDK pin — the version validated end to end in spike 059. */
const MCP_SDK_VERSION = "2.1.1";
/** httpx: the async HTTP client the generated proxies use. */
const HTTPX_SPEC = ">=0.27,<0.29";

/** Turns a tool name into a unique, valid Python identifier for its proxy fn. */
function toPyIdentifier(name: string, used: Set<string>): string {
  let base = name.replace(/[^A-Za-z0-9_]/g, "_");
  if (!/^[A-Za-z_]/.test(base)) base = "_" + base;
  let candidate = `_call_${base}`;
  let n = 2;
  while (used.has(candidate)) candidate = `_call_${base}_${n++}`;
  used.add(candidate);
  return candidate;
}

/** JSON.stringify produces a valid Python string literal (JSON string escapes
 *  — \n, \", \\, \uXXXX — are all accepted by Python's str literal grammar). */
function pyStr(s: string): string {
  return JSON.stringify(s);
}

/** Embeds an arbitrary JSON value as a Python object via json.loads of its
 *  JSON text — avoids the true/false/null vs True/False/None literal mismatch
 *  entirely (the double stringify makes the JSON text itself a Python str). */
function pyJsonValue(value: unknown): string {
  return `json.loads(${JSON.stringify(JSON.stringify(value))})`;
}

/** Emits one tool's async proxy function body (path/query/header/body/auth). */
function emitToolProxy(tool: McpToolDefinition, fnName: string): string {
  const params = (tool.executionParameters ?? []) as Array<{ name: string; in: string }>;
  const pathParams = params.filter((p) => p.in === "path");
  const queryParams = params.filter((p) => p.in === "query");
  const headerParams = params.filter((p) => p.in === "header");
  const hasBody = Boolean(tool.requestBodyContentType);
  const hasAuth = Array.isArray(tool.securityRequirements) && tool.securityRequirements.length > 0;
  const method = (tool.method || "get").toUpperCase();

  const lines: string[] = [];
  lines.push(`async def ${fnName}(arguments: dict) -> types.CallToolResult:`);
  lines.push(`    base = os.environ.get("KLARIDIAN_BASE_URL")`);
  lines.push(`    if not base:`);
  lines.push(`        raise RuntimeError("KLARIDIAN_BASE_URL is not set")`);
  lines.push(`    path = ${pyStr(tool.pathTemplate)}`);
  for (const p of pathParams) {
    lines.push(
      `    path = path.replace(${pyStr("{" + p.name + "}")}, urllib.parse.quote(str(arguments.get(${pyStr(p.name)})), safe=""))`
    );
  }
  lines.push(`    url = base.rstrip("/") + path`);
  lines.push(`    query: dict = {}`);
  for (const p of queryParams) {
    lines.push(`    if arguments.get(${pyStr(p.name)}) is not None:`);
    lines.push(`        query[${pyStr(p.name)}] = str(arguments.get(${pyStr(p.name)}))`);
  }
  lines.push(`    headers: dict = {}`);
  for (const p of headerParams) {
    lines.push(`    if arguments.get(${pyStr(p.name)}) is not None:`);
    lines.push(`        headers[${pyStr(p.name)}] = str(arguments.get(${pyStr(p.name)}))`);
  }
  if (hasAuth) {
    lines.push(`    token = os.environ.get("KLARIDIAN_AUTH_TOKEN")`);
    lines.push(`    if token:`);
    lines.push(`        headers["Authorization"] = "Bearer " + token`);
  }
  if (hasBody) {
    lines.push(`    headers["Content-Type"] = ${pyStr(tool.requestBodyContentType as string)}`);
    lines.push(`    body = arguments.get("requestBody")`);
    lines.push(`    content = json.dumps(body) if body is not None else None`);
  }
  lines.push(`    async with httpx.AsyncClient() as client:`);
  lines.push(`        resp = await client.request(`);
  lines.push(`            ${pyStr(method)}, url, params=query, headers=headers,`);
  lines.push(`            content=${hasBody ? "content" : "None"}, timeout=30.0,`);
  lines.push(`        )`);
  lines.push(`    return types.CallToolResult(`);
  lines.push(`        content=[types.TextContent(type="text", text=resp.text)],`);
  lines.push(`        is_error=not resp.is_success,`);
  lines.push(`    )`);
  return lines.join("\n");
}

/** Emits tools.py — every proxy fn + the TOOLS metadata registry. */
function emitToolsModule(tools: McpToolDefinition[]): string {
  const used = new Set<string>();
  const entries = tools.map((t) => ({ tool: t, fn: toPyIdentifier(t.name, used) }));

  const proxies = entries.map(({ tool, fn }) => emitToolProxy(tool, fn)).join("\n\n\n");

  const registry = entries
    .map(({ tool, fn }) => {
      const ann = annotationsForMethod(tool.method || "get");
      const title = titleForTool(tool as { name: string; operationId?: string; summary?: string });
      return `    {
        "name": ${pyStr(tool.name)},
        "title": ${pyStr(title)},
        "description": ${pyStr(tool.description ?? "")},
        "input_schema": ${pyJsonValue(tool.inputSchema ?? { type: "object", properties: {} })},
        "annotations": types.ToolAnnotations(
            read_only_hint=${ann.readOnlyHint ? "True" : "False"},
            destructive_hint=${ann.destructiveHint ? "True" : "False"},
            idempotent_hint=${ann.idempotentHint ? "True" : "False"},
            open_world_hint=${ann.openWorldHint ? "True" : "False"},
        ),
        "call": ${fn},
    },`;
    })
    .join("\n");

  return `# GENERATED by klaridian (Python emit target, MCPFO-60.3) — do not edit.
#
# One async proxy per OpenAPI operation + the TOOLS metadata registry the
# server builds tools/list and tools/call from. Proxies read KLARIDIAN_BASE_URL
# (upstream host) and, when the operation declares a security requirement,
# KLARIDIAN_AUTH_TOKEN (sent as a Bearer header) — the same env-var contract the
# TypeScript target uses, so a server behaves identically in either language.
import json
import os
import urllib.parse

import httpx
from mcp import types


${proxies}


# Tool registry. Order preserved from the OpenAPI spec (matches the TS target).
TOOLS: list[dict] = [
${registry}
]
`;
}

/** Emits server.py — the entrypoint, dispatch boundary, and both transports. */
function emitServerModule(opts: EmitOptions): string {
  const transport = opts.transport ?? "stdio";
  const port = opts.port ?? 3000;
  const pluginImport = opts.wiring ? opts.wiring.importStatement : "";
  const dispatchWrap = emitDispatchWrap(opts.wiring as PluginWiring | undefined);

  return `# GENERATED by klaridian (Python emit target, MCPFO-60.3) — do not edit.
#
# Stateless MCP server (@modelcontextprotocol Python SDK, mcp==${MCP_SDK_VERSION}),
# built directly from the tool DATA — the Python peer of the TypeScript emitter
# (ARCHITECTURE.md sections 60, 60.3). Targets the same protocol the SDK
# negotiates. Conformance (unknown-tool -32602, invalid-args tool-error) is
# guaranteed by the vendored conformance.py (the low-level SDK does not provide
# it for free — spike 059).
import argparse
import asyncio
import os
import sys

from mcp import types
from mcp.server.lowlevel import Server
from mcp.server.lowlevel.server import NotificationOptions
from mcp.server.stdio import stdio_server

import conformance
from tools import TOOLS
${pluginImport ? pluginImport + "\n" : ""}
SERVER_NAME = ${pyStr(opts.serverName)}

TOOL_MAP = {t["name"]: t for t in TOOLS}


async def _dispatch(tool_name: str, arguments: dict) -> types.CallToolResult:
    """The single tool-dispatch boundary every call flows through (MCPFO-60.2
    shared-dispatch granularity). A plugin instruments the server by wrapping
    THIS function once, below — coarser than the TS per-tool wrap, but every
    tool call is still covered because every call passes through here."""
    entry = TOOL_MAP[tool_name]
    return await entry["call"](arguments)


${dispatchWrap ? dispatchWrap + "  # plugin instrumentation: wrap the shared dispatch once\n" : ""}
async def on_list_tools(ctx, params):
    return types.ListToolsResult(
        tools=[
            types.Tool(
                name=e["name"],
                title=e["title"],
                description=e["description"],
                input_schema=e["input_schema"],
                annotations=e["annotations"],
            )
            for e in TOOLS
        ]
    )


async def on_call_tool(ctx, params):
    entry = TOOL_MAP.get(params.name)
    if entry is None:
        # Protocol error -32602 (NOT a tool-error result) — see conformance.py.
        conformance.raise_unknown_tool(params.name)
    arguments = params.arguments or {}
    invalid = conformance.validate_arguments(entry["input_schema"], arguments)
    if invalid is not None:
        # Two-tier model: invalid arguments are a tool-error RESULT, not a
        # protocol error.
        return invalid
    try:
        return await _dispatch(params.name, arguments)
    except Exception as exc:  # noqa: BLE001 — upstream/proxy failures are tool errors
        return conformance.tool_error(str(exc))


def _build_server() -> Server:
    return Server(
        SERVER_NAME,
        version="1.0.0",
        on_list_tools=on_list_tools,
        on_call_tool=on_call_tool,
    )


async def _run_stdio() -> None:
    server = _build_server()
    init_options = server.create_initialization_options(NotificationOptions())
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, init_options)


def _run_streamable_http(host: str, port: int) -> None:
    # Stateless streamable-http: one ephemeral session per request, so there is
    # no cross-request session state to corrupt (the Python peer of the TS
    # emitter's stateless createMcpHandler design).
    #
    # A minimal hand-written ASGI app (not a Starlette Route/Mount) routes the
    # single "/mcp" path straight to the SDK's session manager. Starlette's
    # Mount("/mcp") issues a 307 redirect to "/mcp/" that breaks POST bodies,
    # and a Route passes a Request (not raw ASGI) to the handler — the manager
    # needs raw (scope, receive, send). This wrapper sidesteps both, serving
    # exactly "/mcp" like the TypeScript server does.
    from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
    import uvicorn

    server = _build_server()
    manager = StreamableHTTPSessionManager(app=server, stateless=True, json_response=True)

    async def app(scope, receive, send):
        if scope["type"] == "lifespan":
            async with manager.run():
                while True:
                    message = await receive()
                    if message["type"] == "lifespan.startup":
                        await send({"type": "lifespan.startup.complete"})
                    elif message["type"] == "lifespan.shutdown":
                        await send({"type": "lifespan.shutdown.complete"})
                        return
            return
        if scope["type"] == "http" and scope.get("path", "").rstrip("/") == "/mcp":
            await manager.handle_request(scope, receive, send)
            return
        await send({"type": "http.response.start", "status": 404,
                    "headers": [(b"content-type", b"text/plain")]})
        await send({"type": "http.response.body", "body": b"Not Found"})

    print(f"MCP server (streamable-http) on http://{host}:{port}/mcp", file=sys.stderr)
    uvicorn.run(app, host=host, port=port, log_level="error")


def main() -> None:
    parser = argparse.ArgumentParser(description=f"{SERVER_NAME} — MCP server generated by klaridian")
    parser.add_argument("--transport", default=${pyStr(transport)}, choices=["stdio", "streamable-http"])
    parser.add_argument("--host", default=os.environ.get("KLARIDIAN_BIND_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=${port})
    args = parser.parse_args()

    if args.transport == "streamable-http":
        _run_streamable_http(args.host, args.port)
    else:
        asyncio.run(_run_stdio())


if __name__ == "__main__":
    main()
`;
}

/** pyproject.toml (PEP 621) — the project manifest. */
function emitPyproject(opts: EmitOptions, extraDeps: string[]): string {
  const deps = [
    `"mcp==${MCP_SDK_VERSION}"`,
    `"httpx${HTTPX_SPEC}"`,
    `"jsonschema>=4.20"`,
    ...extraDeps.map((d) => `"${d}"`),
  ];
  return `[project]
name = ${pyStr(opts.serverName)}
version = "1.0.0"
description = ${pyStr(opts.description ?? `${opts.serverName} — MCP server generated by klaridian`)}
requires-python = ">=3.10"
dependencies = [
    ${deps.join(",\n    ")},
]

[project.scripts]
${opts.serverName.replace(/[^A-Za-z0-9_-]/g, "-")} = "server:main"

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools]
py-modules = ["server", "tools", "conformance"]
`;
}

/** requirements.txt — a pip-installable pin list (parity with the TS npm set). */
function emitRequirements(extraDeps: string[]): string {
  return [
    `mcp==${MCP_SDK_VERSION}`,
    `httpx${HTTPX_SPEC}`,
    `jsonschema>=4.20`,
    ...extraDeps,
    "",
  ].join("\n");
}

function emitReadme(opts: EmitOptions): string {
  const transport = opts.transport ?? "stdio";
  const runLine =
    transport === "streamable-http"
      ? `python server.py --transport streamable-http --port ${opts.port ?? 3000}`
      : `python server.py`;
  return `# ${opts.serverName}

MCP server generated by [klaridian](https://github.com/klaridian/klaridian) (Python target).

## Run

\`\`\`bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export KLARIDIAN_BASE_URL=${opts.baseUrl || "https://api.example.com"}
# export KLARIDIAN_AUTH_TOKEN=... # if the upstream API needs a Bearer token
${runLine}
\`\`\`
`;
}

/**
 * Emit the complete Python project. The pythonTarget (target.ts) calls this.
 * Fails loudly on an un-emittable configuration rather than emitting a broken
 * project, matching the "fail loudly, don't guess" rule the TS emitter follows.
 */
export function emitPythonProject(opts: EmitOptions): EmittedProject {
  const transport = opts.transport ?? "stdio";
  if (opts.auth) {
    // OAuth resource-server is explicitly out of Python launch parity
    // (MCPFO-60.3 scope note) — fail loudly instead of silently dropping it.
    throw new Error(
      "The Python target does not support OAuth (--oauth-*) yet — it is a post-launch follow-up (MCPFO-22). Use --language typescript for an OAuth resource server."
    );
  }
  if ((opts.architecture ?? "tools") === "code-mode") {
    // code-mode for Python is its own ticket (MCPFO-60.35).
    throw new Error(
      "The Python target does not support --architecture code-mode yet (tracked as MCPFO-60.35). Use the default 'tools' architecture, or --language typescript for code-mode."
    );
  }

  // Extra Python deps a plugin contributes (pip requirement strings), passed
  // via extraDependencies as { "<pip-name>": "<version-spec>" }.
  const extraDeps = Object.entries(opts.extraDependencies ?? {}).map(([name, spec]) =>
    spec && spec.trim() ? `${name}${spec}` : name
  );

  const files: EmittedProject = {
    "server.py": emitServerModule(opts),
    "tools.py": emitToolsModule(opts.tools),
    // The vendored conformance module comes from the Python conformance adapter
    // (MCPFO-60.1 slot) — the emitter never hand-rolls spec-error surfacing.
    "conformance.py": pythonConformanceAdapter.emitServerContributions(),
    "pyproject.toml": emitPyproject(opts, extraDeps),
    "requirements.txt": emitRequirements(extraDeps),
    "README.md": emitReadme(opts),
  };

  // Plugin instrumentation files (src/instrumentation/<id>.py etc.) and any
  // other vendored files a plugin contributes.
  for (const [p, content] of Object.entries(opts.extraFiles ?? {})) {
    files[p] = content;
  }

  // Sanity: streamable-http needs starlette/uvicorn, which ship with mcp — no
  // extra pin required, but assert the transport is one we emit for.
  if (transport !== "stdio" && transport !== "streamable-http") {
    throw new Error(`Python target: unsupported transport "${transport}".`);
  }

  return files;
}
