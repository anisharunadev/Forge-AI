"""step-78 Phase 2 — Skills proxy on top of LiteLLM.

Endpoints covered (spec §Feature 9):
* ``GET    /v1/skills``
* ``POST   /v1/skills``
* ``GET    /v1/skills/{id}``
* ``DELETE /v1/skills/{id}``
* ``GET    /public/agent_hub``
* ``POST   /utils/dotprompt_json_converter``
* ``POST   /utils/transform_request``
* ``GET    /utils/supported_openai_params``
* ``POST   /utils/token_counter``

Rules respected:
* Rule 1 — LiteLLM is the only LLM gateway.
* Rule 4 — response shapes are normalized.
"""

from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

logger = get_logger(__name__)


async def _call_get(
    client: LiteLLMBaseClient,
    path: str,
    *,
    params: dict[str, Any] | None = None,
) -> Any:
    response = await client.admin_client.get(path, params=params)
    if response.status_code == 404:
        return None
    if response.status_code >= 400:
        logger.warning(
            "litellm.skills.get_failed",
            path=path,
            status=response.status_code,
        )
        return None
    return response.json() or {}


async def _call_post(
    client: LiteLLMBaseClient,
    path: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    response = await client.admin_client.post(path, json=body)
    if response.status_code >= 400:
        raise RuntimeError(
            f"skills POST {path} returned "
            f"{response.status_code}: {response.text[:200]}"
        )
    return response.json() or {}


async def _call_delete(
    client: LiteLLMBaseClient,
    path: str,
) -> bool:
    response = await client.admin_client.delete(path)
    return response.status_code < 400


def _unwrap_list(raw: Any) -> list[Any]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        for key in ("skills", "items", "data"):
            value = raw.get(key)
            if isinstance(value, list):
                return value
    return []


# ---------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------


async def list_skills(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> list[dict[str, Any]]:
    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        result = await _call_get(client, "/v1/skills")
        if result is None:
            return []
        return [r for r in _unwrap_list(result) if isinstance(r, dict)]

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def get_skill(
    skill_id: str,
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        result = await _call_get(client, f"/v1/skills/{skill_id}")
        if result is None:
            return None
        if isinstance(result, dict):
            return result
        return None

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def create_or_update_skill(
    *,
    skill: dict[str, Any],
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    """``POST /v1/skills`` — idempotent on (tenant_id, name, version)."""
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        return await _call_post(client, "/v1/skills", skill)

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def delete_skill(
    skill_id: str,
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> bool:
    async def _call(client: LiteLLMBaseClient) -> bool:
        return await _call_delete(client, f"/v1/skills/{skill_id}")

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Public hub + utils
# ---------------------------------------------------------------------


async def public_hub(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> list[dict[str, Any]]:
    """``GET /public/agent_hub`` — no auth, rate-limited at the Forge layer."""
    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        try:
            response = await client.admin_client.get("/public/agent_hub")
            if response.status_code >= 400:
                return []
            raw = response.json() or {}
        except Exception:  # noqa: BLE001 — public endpoint may be unreachable
            return []
        return [r for r in _unwrap_list(raw) if isinstance(r, dict)]

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def dotprompt_to_json(
    *,
    dotprompt: str,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    """``POST /utils/dotprompt_json_converter``."""
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        return await _call_post(
            client, "/utils/dotprompt_json_converter", {"dotprompt": dotprompt}
        )

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def transform_request(
    *,
    skill: dict[str, Any],
    request: dict[str, Any],
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    """``POST /utils/transform_request`` — merge a skill into a chat request."""
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        return await _call_post(
            client,
            "/utils/transform_request",
            {"skill": skill, "request": request},
        )

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def supported_openai_params(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> list[str]:
    async def _call(client: LiteLLMBaseClient) -> list[str]:
        try:
            response = await client.admin_client.get("/utils/supported_openai_params")
            if response.status_code >= 400:
                return []
            raw = response.json() or []
            if isinstance(raw, list):
                return [str(x) for x in raw]
            if isinstance(raw, dict):
                value = raw.get("params") or raw.get("data")
                if isinstance(value, list):
                    return [str(x) for x in value]
        except Exception:  # noqa: BLE001
            return []
        return []

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def count_tokens(
    *,
    text: str,
    model: str | None = None,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    """``POST /utils/token_counter``."""
    body: dict[str, Any] = {"text": text}
    if model:
        body["model"] = model

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        return await _call_post(client, "/utils/token_counter", body)

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


__all__ = [
    "list_skills",
    "get_skill",
    "create_or_update_skill",
    "delete_skill",
    "public_hub",
    "dotprompt_to_json",
    "transform_request",
    "supported_openai_params",
    "count_tokens",
]