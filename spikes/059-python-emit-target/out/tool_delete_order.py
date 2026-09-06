import os
import httpx

NAME = "deleteOrder"
INPUT_SCHEMA = {"type": "object", "properties": {"orderId": {"type": "number", "format": "int64", "description": "ID of the order that needs to be deleted"}}, "required": ["orderId"]}

async def call(arguments: dict) -> dict:
    base = os.environ.get("KLARIDIAN_BASE_URL")
    if not base:
        raise RuntimeError("KLARIDIAN_BASE_URL is not set")
    path = "/store/order/{orderId}"
    path = path.replace("{orderId}", str(arguments.get("orderId")))
    query = {}
    headers = {}
    body = None
    async with httpx.AsyncClient(base_url=base) as client:
        resp = await client.request("DELETE", path, params=query, headers=headers, json=body)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            return resp.json()
        return {"text": resp.text}
