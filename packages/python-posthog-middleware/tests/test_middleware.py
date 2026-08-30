"""Real end-to-end test: a real FastMCP server + real Client round-trip,
with only PostHog's outbound network call mocked (mirrors the rigor
mcpforge's TypeScript tests apply via real npm install/build/run)."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastmcp import Client, FastMCP

from mcpforge_posthog_middleware import PostHogMiddleware


def _build_server() -> FastMCP:
    mcp = FastMCP("test-server")

    @mcp.tool()
    def add(a: int, b: int) -> int:
        return a + b

    @mcp.tool()
    def fail_always() -> int:
        raise RuntimeError("boom")

    return mcp


@pytest.mark.asyncio
async def test_posthog_middleware_captures_success_and_failure_events():
    captured_events: list[dict] = []

    with patch("posthog.client.Client.capture") as mock_capture:
        mock_capture.side_effect = lambda *a, **kw: captured_events.append(kw if kw else {"args": a})

        mcp = _build_server()
        mcp.add_middleware(PostHogMiddleware(api_key="phc_fake_test_key"))

        async with Client(mcp) as client:
            tools = await client.list_tools()
            assert len(tools) == 2

            result = await client.call_tool("add", {"a": 2, "b": 3})
            assert result.data == 5

            with pytest.raises(Exception):
                await client.call_tool("fail_always", {})

    assert len(captured_events) == 2

    success_event = captured_events[0]
    assert success_event["distinct_id"] == "mcp-server"
    assert success_event["event"] == "mcp tool called"
    assert success_event["properties"]["tool_name"] == "add"
    assert success_event["properties"]["success"] is True
    assert isinstance(success_event["properties"]["duration_ms"], int)
    assert "error_message" not in success_event["properties"]

    failure_event = captured_events[1]
    assert failure_event["properties"]["tool_name"] == "fail_always"
    assert failure_event["properties"]["success"] is False
    assert "boom" in failure_event["properties"]["error_message"]


def test_posthog_middleware_requires_api_key():
    with patch.dict("os.environ", {}, clear=True):
        with pytest.raises(ValueError, match="requires an API key"):
            PostHogMiddleware()


def test_posthog_middleware_reads_api_key_from_env():
    with patch.dict("os.environ", {"POSTHOG_API_KEY": "phc_from_env"}, clear=True):
        # Should not raise — env var satisfies the requirement.
        PostHogMiddleware()
