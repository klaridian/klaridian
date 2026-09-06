import os
import httpx

NAME = "findPetsByTags"
INPUT_SCHEMA = {"type": "object", "properties": {"tags": {"type": "array", "items": {"type": "string"}, "description": "Tags to filter by"}}, "required": ["tags"]}

async def call(arguments: dict) -> dict:
    base = os.environ.get("KLARIDIAN_BASE_URL")
    if not base:
        raise RuntimeError("KLARIDIAN_BASE_URL is not set")
    path = "/pet/findByTags"
    query = {}
    if arguments.get("tags") is not None:
        query["tags"] = arguments.get("tags")
    headers = {}
    body = None
    async with httpx.AsyncClient(base_url=base) as client:
        resp = await client.request("GET", path, params=query, headers=headers, json=body)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            return resp.json()
        return {"text": resp.text}
