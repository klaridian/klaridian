import os
import httpx

NAME = "updateUser"
INPUT_SCHEMA = {"type": "object", "properties": {"username": {"type": "string", "description": "name that need to be deleted"}, "requestBody": {"type": "object", "properties": {"id": {"type": "number", "format": "int64"}, "username": {"type": "string"}, "firstName": {"type": "string"}, "lastName": {"type": "string"}, "email": {"type": "string"}, "password": {"type": "string"}, "phone": {"type": "string"}, "userStatus": {"type": "number", "description": "User Status", "format": "int32"}}, "description": "Update an existent user in the store"}}, "required": ["username"]}

async def call(arguments: dict) -> dict:
    base = os.environ.get("KLARIDIAN_BASE_URL")
    if not base:
        raise RuntimeError("KLARIDIAN_BASE_URL is not set")
    path = "/user/{username}"
    path = path.replace("{username}", str(arguments.get("username")))
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
