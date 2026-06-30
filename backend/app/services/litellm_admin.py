"""LiteLLM admin SDK client — single point of contact with the proxy.

All Forge-side admin actions that need to query/modify LiteLLM state
go through this module. Every method takes a `tenant_id` so we can
filter LiteLLM's flat namespace into per-tenant views.

LiteLLM does not have native multi-tenancy. We use the `team_id`
field on virtual keys + teams to scope operations:

  - Each Forge tenant → one LiteLLM team
  - Each Forge project → one virtual key (under the tenant's team)
  - Each Forge user → one LiteLLM internal user

This means: tenant isolation is enforced by which team_id we pass
to LiteLLM, not by LiteLLM itself.

Callers (typically FastAPI routes) translate a `Principal` (which
exposes `.tenant_id` as a string) into the LiteLLM `team_id` for
their tenant. This module does NOT depend on `Principal` — it
accepts primitive `team_id` strings so it can be reused outside
HTTP request contexts (e.g. sync jobs, seed scripts).
"""

from __future__ import annotations

import os
from typing import Any

import httpx

from app.core.logging import get_logger


logger = get_logger(__name__)


LITELLM_BASE_URL = os.environ.get("LITELLM_PROXY_URL", "http://litellm:4000")
LITELLM_MASTER_KEY = os.environ.get("LITELLM_MASTER_KEY", "")


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {LITELLM_MASTER_KEY}",
        "Content-Type": "application/json",
    }


async def _request(
    method: str,
    path: str,
    **kwargs: Any,
) -> dict[str, Any] | list[Any]:
    """Single point of contact with the LiteLLM admin API.

    Returns the parsed JSON body when the response is JSON,
    otherwise an empty dict. Raises `httpx.HTTPStatusError` on
    non-2xx responses (caller decides how to handle it).
    """
    async with httpx.AsyncClient(timeout=15) as client:
        res = await getattr(client, method)(
            f"{LITELLM_BASE_URL}{path}",
            headers=_headers(),
            **kwargs,
        )
        res.raise_for_status()
        if res.headers.get("content-type", "").startswith("application/json"):
            return res.json()
        return {}


# ---------------------------------------------------------------------------
# Spend tracking — direct passthrough to LiteLLM
# ---------------------------------------------------------------------------


async def list_spend_logs(
    *,
    team_id: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Get spend logs filtered by team (tenant)."""
    params: dict[str, Any] = {"limit": limit}
    if team_id:
        params["team_id"] = team_id
    if start_date:
        params["start_date"] = start_date
    if end_date:
        params["end_date"] = end_date
    # _request returns dict | list; /spend/logs returns a list.
    result = await _request("GET", "/spend/logs", params=params)
    return result if isinstance(result, list) else []


async def get_spend_by_team(team_id: str) -> dict[str, Any]:
    """Aggregate spend for one team.

    NOTE: LiteLLM's canonical endpoint is ``/spend/teams/{team_id}``
    (plural). The spec mandates ``/spend/team/{team_id}`` (singular)
    — if this 404s, fall back to filtering ``/global/spend/teams``
    client-side or calling ``/team/info?team_id={team_id}``.
    """
    result = await _request("GET", f"/spend/team/{team_id}")
    return result if isinstance(result, dict) else {}


async def get_global_spend() -> dict[str, Any]:
    """Global spend stats across all teams."""
    result = await _request("GET", "/global/spend")
    return result if isinstance(result, dict) else {}


# ---------------------------------------------------------------------------
# Virtual keys — extended to use Forge's tenant → team mapping
# ---------------------------------------------------------------------------


async def generate_virtual_key(
    *,
    team_id: str,
    alias: str,
    models: list[str] | None = None,
    max_budget: float | None = None,
    budget_duration: str | None = None,
    user_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Mint a new virtual key for a Forge tenant's team."""
    payload: dict[str, Any] = {
        "team_id": team_id,
        "key_alias": alias,
    }
    if models:
        payload["models"] = models
    if max_budget is not None:
        payload["max_budget"] = max_budget
    if budget_duration:
        payload["budget_duration"] = budget_duration
    if user_id:
        payload["user_id"] = user_id
    if metadata:
        payload["metadata"] = metadata

    result = await _request("POST", "/key/generate", json=payload)
    return result if isinstance(result, dict) else {}


async def rotate_virtual_key(
    key_alias: str,
    *,
    max_budget: float | None = None,
) -> dict[str, Any]:
    """Rotate a key — LiteLLM keeps history, marks old as rotated."""
    payload: dict[str, Any] = {"key_alias": key_alias}
    if max_budget is not None:
        payload["max_budget"] = max_budget

    result = await _request("POST", "/key/update", json=payload)
    return result if isinstance(result, dict) else {}


async def revoke_virtual_key(key_alias: str) -> dict[str, Any]:
    """Revoke (delete) a key."""
    result = await _request("POST", "/key/delete", json={"key_alias": key_alias})
    return result if isinstance(result, dict) else {}


async def list_virtual_keys(team_id: str | None = None) -> list[dict[str, Any]]:
    """List keys — filter by team."""
    params: dict[str, Any] = {}
    if team_id:
        params["team_id"] = team_id

    result = await _request("GET", "/key/list", params=params)
    return result if isinstance(result, list) else []


# ---------------------------------------------------------------------------
# Teams — map Forge tenants to LiteLLM teams
# ---------------------------------------------------------------------------


async def create_team(
    team_alias: str,
    *,
    max_budget: float | None = None,
    models: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create a LiteLLM team for a Forge tenant.

    ``team_alias`` should be the Forge tenant_id (UUID-as-string) so
    the tenant → team mapping is unambiguous.
    """
    payload: dict[str, Any] = {"team_alias": team_alias}
    if max_budget is not None:
        payload["max_budget"] = max_budget
    if models:
        payload["models"] = models
    if metadata:
        payload["metadata"] = metadata

    result = await _request("POST", "/team/new", json=payload)
    return result if isinstance(result, dict) else {}


async def list_teams() -> list[dict[str, Any]]:
    """List all LiteLLM teams."""
    result = await _request("GET", "/team/list")
    return result if isinstance(result, list) else []


# ---------------------------------------------------------------------------
# Guardrails — delegate entirely to LiteLLM
# ---------------------------------------------------------------------------


async def list_guardrails() -> list[dict[str, Any]]:
    """List LiteLLM guardrails."""
    result = await _request("GET", "/guardrails/list")
    return result if isinstance(result, list) else []


async def update_guardrail(name: str, config: dict[str, Any]) -> dict[str, Any]:
    """Create or update a LiteLLM guardrail by name."""
    result = await _request(
        "POST",
        "/guardrails/update",
        json={"guardrail_name": name, **config},
    )
    return result if isinstance(result, dict) else {}


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------


async def list_models() -> dict[str, Any]:
    """List available models from LiteLLM.

    Returns the raw response shape (a dict with a ``data`` key per
    the spec contract) so callers can extract ``models["data"]``
    themselves. Do NOT narrow to a list here — the spec explicitly
    expects the wrapped envelope.
    """
    result = await _request("GET", "/models")
    return result if isinstance(result, dict) else {"data": []}


async def get_model_info(model_name: str) -> dict[str, Any]:
    """Get metadata for a single model."""
    result = await _request(
        "GET",
        "/model/info",
        params={"model": model_name},
    )
    return result if isinstance(result, dict) else {}


# ---------------------------------------------------------------------------
# MCP servers (already used by admin_llm_gateway.py)
# ---------------------------------------------------------------------------


async def list_mcp_tools() -> dict[str, Any]:
    """List MCP tools available through the LiteLLM proxy."""
    result = await _request("GET", "/mcp/tools")
    return result if isinstance(result, dict) else {}


__all__ = [
    "LITELLM_BASE_URL",
    "LITELLM_MASTER_KEY",
    "list_spend_logs",
    "get_spend_by_team",
    "get_global_spend",
    "generate_virtual_key",
    "rotate_virtual_key",
    "revoke_virtual_key",
    "list_virtual_keys",
    "create_team",
    "list_teams",
    "list_guardrails",
    "update_guardrail",
    "list_models",
    "get_model_info",
    "list_mcp_tools",
]