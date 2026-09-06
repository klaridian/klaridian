import os
import httpx

NAME = "deletePet"
INPUT_SCHEMA = {"type": "object", "properties": {"api_key": {"type": "string"}, "petId": {"type": "number", "format": "int64", "description": "Pet id to delete"}}, "required": ["petId"]}

async def call(arguments: dict) -> dict:
    base = os.environ.get("KLARIDIAN_BASE_URL")
    if not base:
        raise RuntimeError("KLARIDIAN_BASE_URL is not set")
    path = "/pet/{petId}"
    path = path.replace("{petId}", str(arguments.get("petId")))
    query = {}
    headers = {}
    if arguments.get("api_key") is not None:
        headers["api_key"] = str(arguments.get("api_key"))
    body = None
    async with httpx.AsyncClient(base_url=base) as client:
        resp = await client.request("DELETE", path, params=query, headers=headers, json=body)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            return resp.json()
        return {"text": resp.text}
