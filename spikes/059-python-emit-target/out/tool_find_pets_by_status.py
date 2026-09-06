import os
import httpx

NAME = "findPetsByStatus"
INPUT_SCHEMA = {"type": "object", "properties": {"status": {"type": "string", "default": "available", "enum": ["available", "pending", "sold"], "description": "Status values that need to be considered for filter"}}, "required": ["status"]}

async def call(arguments: dict) -> dict:
    base = os.environ.get("KLARIDIAN_BASE_URL")
    if not base:
        raise RuntimeError("KLARIDIAN_BASE_URL is not set")
    path = "/pet/findByStatus"
    query = {}
    if arguments.get("status") is not None:
        query["status"] = arguments.get("status")
    headers = {}
    body = None
    async with httpx.AsyncClient(base_url=base) as client:
        resp = await client.request("GET", path, params=query, headers=headers, json=body)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            return resp.json()
        return {"text": resp.text}
