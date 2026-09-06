import os
import httpx

NAME = "createUsersWithListInput"
INPUT_SCHEMA = {"type": "object", "properties": {"requestBody": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "number", "format": "int64"}, "username": {"type": "string"}, "firstName": {"type": "string"}, "lastName": {"type": "string"}, "email": {"type": "string"}, "password": {"type": "string"}, "phone": {"type": "string"}, "userStatus": {"type": "number", "description": "User Status", "format": "int32"}}}, "description": "The JSON request body."}}}

async def call(arguments: dict) -> dict:
    base = os.environ.get("KLARIDIAN_BASE_URL")
    if not base:
        raise RuntimeError("KLARIDIAN_BASE_URL is not set")
    path = "/user/createWithList"
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
