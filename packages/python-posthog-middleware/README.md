# klaridian-posthog-middleware

Product-observability middleware for [FastMCP](https://gofastmcp.com) servers—the Python counterpart to [klaridian](https://github.com/ricardocvasconcelos/klaridian)'s TypeScript `posthog` plugin.

## Why this exists (see [klaridian ARCHITECTURE.md](https://github.com/ricardocvasconcelos/klaridian/blob/main/ARCHITECTURE.md) sections 21-23 for the full reasoning)

FastMCP already ships native, zero-config OpenTelemetry (engineering observability) since v3.0/4.0—there's no gap to fill there. But FastMCP has **no product-observability equivalent**: no per-tool-call event capture for adoption/usage-pattern analysis. This package fills exactly that one gap, as a FastMCP-native middleware—**not** a code generator, **not** a fork of FastMCP, **not** a competing OpenAPI→MCP tool. It attaches to *any* FastMCP server (hand-written, generated via `from_openapi()`, or generated via a third-party tool like `mcp-generator-3.x`) with one line.

This is deliberately the opposite shape from klaridian's TypeScript side: TypeScript's `openapi-mcp-generator` output has no middleware concept, so klaridian patches its generated call site directly (`render/instrument.ts`). FastMCP already has a first-class middleware pipeline, so there's nothing to patch—a middleware class is the idiomatic, zero-surprise way to attach behavior in this ecosystem, and using it means we compose cleanly with all of FastMCP's other built-in middleware (logging, rate limiting, auth) without needing to know anything about them.

## Install

```bash
pip install klaridian-posthog-middleware
```

## Usage

```python
from fastmcp import FastMCP
from klaridian_posthog_middleware import PostHogMiddleware

mcp = FastMCP("my-server")
mcp.add_middleware(PostHogMiddleware(api_key="phc_your_project_key"))

@mcp.tool()
def my_tool(x: int) -> int:
    return x * 2
```

Environment variables work too, if you'd rather not hardcode the key:

```bash
export POSTHOG_API_KEY=phc_your_project_key
export POSTHOG_API_HOST=https://us.i.posthog.com  # optional, this is the default
```

```python
mcp.add_middleware(PostHogMiddleware())  # reads POSTHOG_API_KEY / POSTHOG_API_HOST from env
```

## What it captures

One `"mcp tool called"` event per tool call, via `posthog.capture()` (PostHog's Product Analytics—not PostHog's separate Traces/Logs OTel-based feature, see the klaridian ARCHITECTURE.md note on that distinction):

| Property | Description |
|---|---|
| `tool_name` | The tool that was called |
| `duration_ms` | Wall-clock time for the call |
| `success` | `true`/`false` |
| `error_message` | Present only when `success` is `false` |

Same deliberate v0 restraint as the TypeScript plugin: a fixed `distinct_id` (`"mcp-server"` by default, override via `distinct_id=` if you have real caller identity available), no feature flags/session recording/group analytics wiring—those are real `posthog` SDK capabilities left out until there's a concrete need.

## Composability

Ordinary FastMCP middleware—add it alongside anything else:

```python
mcp.add_middleware(ErrorHandlingMiddleware())
mcp.add_middleware(PostHogMiddleware(api_key="..."))
mcp.add_middleware(LoggingMiddleware())
```

FastMCP's own middleware ordering rules apply (first added runs first on the way in, last on the way out)—see [FastMCP's middleware docs](https://gofastmcp.com/servers/middleware) for that mechanic in general; nothing PostHog-specific about it.
