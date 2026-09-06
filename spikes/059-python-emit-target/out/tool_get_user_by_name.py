import os
import httpx

NAME = "getUserByName"
INPUT_SCHEMA = {"type": "object", "properties": {"username": {"type": "string", "description": "The name that needs to be fetched. Use user1 for testing"}}, "required": ["username"]}

async def call(arguments: dict) -> dict:
    base = os.environ.get("KLARIDIAN_BASE_URL")
    if not base:
        raise RuntimeError("KLARIDIAN_BASE_URL is not set")
    path = "/user/{username}"
    path = path.replace("{username}", str(arguments.get("username")))
    query = {}
    headers = {}
    body = None
    async with httpx.AsyncClient(base_url=base) as client:
        resp = await client.request("GET", path, params=query, headers=headers, json=body)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            return resp.json()
        return {"text": resp.text}
