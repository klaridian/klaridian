import os
import httpx

NAME = "updatePetWithForm"
INPUT_SCHEMA = {"type": "object", "properties": {"petId": {"type": "number", "format": "int64", "description": "ID of pet that needs to be updated"}, "name": {"type": "string", "description": "Name of pet that needs to be updated"}, "status": {"type": "string", "description": "Status of pet that needs to be updated"}}, "required": ["petId"]}

async def call(arguments: dict) -> dict:
    base = os.environ.get("KLARIDIAN_BASE_URL")
    if not base:
        raise RuntimeError("KLARIDIAN_BASE_URL is not set")
    path = "/pet/{petId}"
    path = path.replace("{petId}", str(arguments.get("petId")))
    query = {}
    if arguments.get("name") is not None:
        query["name"] = arguments.get("name")
    if arguments.get("status") is not None:
        query["status"] = arguments.get("status")
    headers = {}
    body = None
    async with httpx.AsyncClient(base_url=base) as client:
        resp = await client.request("POST", path, params=query, headers=headers, json=body)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            return resp.json()
        return {"text": resp.text}
