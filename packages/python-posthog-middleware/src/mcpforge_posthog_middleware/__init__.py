"""FastMCP middleware: one PostHog Product Analytics event per tool call.

The Python counterpart to mcpforge's TypeScript `posthog` plugin (see
mcpforge's ARCHITECTURE.md sections 21-23). Deliberately shaped as ordinary
FastMCP middleware rather than a generated/patched artifact — FastMCP
already has a first-class middleware pipeline (unlike the TypeScript
openapi-mcp-generator output mcpforge patches directly), so attaching via
`add_middleware()` is the idiomatic way to do this, and it composes cleanly
with FastMCP's other built-in middleware for free.

stdio-safety note (mirrors the TypeScript plugin's own explicit check,
ARCHITECTURE.md section 20): the `posthog` Python SDK's internal logging
uses the standard `logging` module, which defaults to stderr, not stdout —
confirmed by inspecting the installed package directly (only its own test
files use `print()`, never shipped runtime code). So there's no
stdout-corruption risk for stdio-transport MCP servers here either.
"""

from __future__ import annotations

import os
import time
from typing import Any

from fastmcp.server.middleware import CallNext, Middleware, MiddlewareContext
from fastmcp.tools import ToolResult
from mcp import types as mt
from posthog import Posthog


class PostHogMiddleware(Middleware):
    """Captures a ``"mcp tool called"`` Product Analytics event per tool call.

    Mirrors the TypeScript ``posthog`` plugin's event shape exactly, so a
    fleet mixing TypeScript- and Python-generated MCP servers produces
    consistent, comparable events in the same PostHog project.
    """

    def __init__(
        self,
        api_key: str | None = None,
        host: str | None = None,
        distinct_id: str = "mcp-server",
    ) -> None:
        resolved_key = api_key or os.environ.get("POSTHOG_API_KEY")
        if not resolved_key:
            raise ValueError(
                "PostHogMiddleware requires an API key. Pass api_key=... explicitly, "
                "or set the POSTHOG_API_KEY environment variable."
            )
        resolved_host = host or os.environ.get("POSTHOG_API_HOST") or "https://us.i.posthog.com"

        self._client = Posthog(project_api_key=resolved_key, host=resolved_host)
        # Fixed distinct_id for v0 — an MCP server has no inherent notion of
        # end-user identity (the caller is an MCP client, not a logged-in
        # human); same deliberate simplification as the TypeScript plugin.
        # Override at construction time if real caller identity is
        # available in your deployment.
        self._distinct_id = distinct_id

    async def on_call_tool(
        self,
        context: MiddlewareContext[mt.CallToolRequestParams],
        call_next: CallNext[mt.CallToolRequestParams, ToolResult],
    ) -> ToolResult:
        tool_name = context.message.name
        started_at = time.monotonic()
        try:
            result = await call_next(context)
            self._capture(tool_name, started_at, success=True)
            return result
        except Exception as exc:
            self._capture(tool_name, started_at, success=False, error_message=str(exc))
            raise

    def _capture(
        self,
        tool_name: str,
        started_at: float,
        *,
        success: bool,
        error_message: str | None = None,
    ) -> None:
        duration_ms = int((time.monotonic() - started_at) * 1000)
        properties: dict[str, Any] = {
            "tool_name": tool_name,
            "duration_ms": duration_ms,
            "success": success,
        }
        if error_message is not None:
            properties["error_message"] = error_message
        self._client.capture(
            distinct_id=self._distinct_id,
            event="mcp tool called",
            properties=properties,
        )

    def shutdown(self) -> None:
        """Flush any buffered events. Call on process exit (SIGINT/SIGTERM)."""
        self._client.shutdown()
