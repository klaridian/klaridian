import os
import httpx

NAME = "loginUser"
INPUT_SCHEMA = {"type": "object", "properties": {"username": {"type": "string", "description": "The user name for login"}, "password": {"type": "string", "description": "The password for login in clear text"}}}

async def call(arguments: dict) -> dict:
    base = os.environ.get("KLARIDIAN_BASE_URL")
    if not base:
        raise RuntimeError("KLARIDIAN_BASE_URL is not set")
    path = "/user/login"
    query = {}
    if arguments.get("username") is not None:
        query["username"] = arguments.get("username")
    if arguments.get("password") is not None:
        query["password"] = arguments.get("password")
    headers = {}
    body = None
    async with httpx.AsyncClient(base_url=base) as client:
        resp = await client.request("GET", path, params=query, headers=headers, json=body)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            return resp.json()
        return {"text": resp.text}
