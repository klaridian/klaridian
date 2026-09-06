import os
import httpx

NAME = "updatePet"
INPUT_SCHEMA = {"type": "object", "properties": {"requestBody": {"required": ["name", "photoUrls"], "type": "object", "properties": {"id": {"type": "number", "format": "int64"}, "name": {"type": "string"}, "category": {"type": "object", "properties": {"id": {"type": "number", "format": "int64"}, "name": {"type": "string"}}}, "photoUrls": {"type": "array", "items": {"type": "string"}}, "tags": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "number", "format": "int64"}, "name": {"type": "string"}}}}, "status": {"type": "string", "description": "pet status in the store", "enum": ["available", "pending", "sold"]}}, "description": "Update an existent pet in the store"}}, "required": ["requestBody"]}

async def call(arguments: dict) -> dict:
    base = os.environ.get("KLARIDIAN_BASE_URL")
    if not base:
        raise RuntimeError("KLARIDIAN_BASE_URL is not set")
    path = "/pet"
    query = {}
    headers = {}
    body = arguments.get("requestBody")
    async with httpx.AsyncClient(base_url=base) as client:
        resp = await client.request("PUT", path, params=query, headers=headers, json=body)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            return resp.json()
        return {"text": resp.text}
