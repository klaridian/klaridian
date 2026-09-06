import os
import httpx

NAME = "placeOrder"
INPUT_SCHEMA = {"type": "object", "properties": {"requestBody": {"type": "object", "properties": {"id": {"type": "number", "format": "int64"}, "petId": {"type": "number", "format": "int64"}, "quantity": {"type": "number", "format": "int32"}, "shipDate": {"type": "string", "format": "date-time"}, "status": {"type": "string", "description": "Order Status", "enum": ["placed", "approved", "delivered"]}, "complete": {"type": "boolean"}}, "description": "The JSON request body."}}}

async def call(arguments: dict) -> dict:
    base = os.environ.get("KLARIDIAN_BASE_URL")
    if not base:
        raise RuntimeError("KLARIDIAN_BASE_URL is not set")
    path = "/store/order"
    query = {}
    headers = {}
    body = arguments.get("requestBody")
    async with httpx.AsyncClient(base_url=base) as client:
        resp = await client.request("POST", path, params=query, headers=headers, json=body)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            return resp.json()
        return {"text": resp.text}
