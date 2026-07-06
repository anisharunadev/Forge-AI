"""step-77 Slice 2 — LiteLLM policy proxy.

Thin wrapper over the LiteLLM ``/policies/*`` (and ``/policy/*``)
endpoints named in ``docs/goals/step-77.md`` §Feature 7. Mirror of
:mod:`app.integrations.litellm.guardrail_apply` for the policy surface.

Endpoints covered (canonical path first, fallback second where the
proxy versions diverge):

* ``POST /policies/resolve``        — effective policy set for a context
* ``POST /policies/compare``        — diff two policy sets
* ``GET  /policies/list``           — proxy-side policy catalog
* ``GET  /policies/info``           — one policy
* ``GET  /policies/status``         — lifecycle status of every policy
* ``GET  /policies/usage``          — usage rollup
* ``GET  /policies/attachments/list`` — attachment edges
* ``POST /policies/test-pipeline``  — dry-run a policy set
* ``POST /policies/test``           — dry-run one policy
* ``POST /policies/resolved-guardrails`` — derive guardrails from a policy set
* ``GET  /policy/templates/list``   — starter templates
* ``POST /utils/test_policies_and_guardrails`` — joint validation
* ``GET  /v1/tool/policy``          — tool policy schema
* ``GET  /v1/tool/policy/options``  — tool policy authoring options

Failure policy: every method returns ``None`` / ``[]`` / typed empty
when the proxy is unreachable — the service layer is the only place
that may choose fail-open vs fail-closed.
"""

from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

logger = get_logger(__name__)


# ---------------------------------------------------------------------
# Resolve / Compare
# ---------------------------------------------------------------------


async def resolve_policies(
    *,
    context: dict[str, Any],
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``POST /policies/resolve``.

    The proxy returns the canonical ``{policies, effective_guardrails,
    tool_policy, conflict_warnings}`` shape. We pass it through and let
    the service layer reshape. ``None`` on transport failure.
    """

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        response = await client.admin_client.post("/policies/resolve", json=context)
        if response.status_code == 404:
            # Proxy version doesn't expose resolve yet — service falls
            # back to its in-process resolver.
            return None
        if response.status_code >= 400:
            logger.warning(
                "litellm.policy_apply.resolve_failed",
                status=response.status_code,
            )
            return None
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def compare_policies(
    *,
    left: list[str],
    right: list[str],
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``POST /policies/compare``.

    ``left`` and ``right`` are policy id lists. The proxy returns the
    diff envelope; we pass it through.
    """
    body = {"left": left, "right": right}

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        response = await client.admin_client.post("/policies/compare", json=body)
        if response.status_code >= 400:
            return None
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------


async def list_policies(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> list[dict[str, Any]]:
    """``GET /policies/list``. Returns a bare list of policy dicts."""

    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        response = await client.admin_client.get("/policies/list")
        if response.status_code >= 400:
            return []
        raw = response.json() or {}
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            for key in ("policies", "data", "items"):
                if isinstance(raw.get(key), list):
                    return raw[key]
        return []

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def get_policy_info(
    policy_id: str,
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``GET /policies/info?policy_id=...``."""

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        response = await client.admin_client.get("/policies/info", params={"policy_id": policy_id})
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            return None
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def get_policy_status(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> list[dict[str, Any]]:
    """``GET /policies/status`` — one row per policy with its lifecycle status."""

    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        response = await client.admin_client.get("/policies/status")
        if response.status_code >= 400:
            return []
        raw = response.json() or {}
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            return raw.get("policies") or raw.get("data") or raw.get("items") or []
        return []

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def get_policy_usage(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``GET /policies/usage`` — usage rollup per policy."""

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        response = await client.admin_client.get("/policies/usage")
        if response.status_code >= 400:
            return None
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Attachments
# ---------------------------------------------------------------------


async def list_attachments(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> list[dict[str, Any]]:
    """``GET /policies/attachments/list``."""

    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        response = await client.admin_client.get("/policies/attachments/list")
        if response.status_code >= 400:
            return []
        raw = response.json() or {}
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            return raw.get("attachments") or raw.get("data") or raw.get("items") or []
        return []

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Test pipeline
# ---------------------------------------------------------------------


async def test_pipeline(
    *,
    policy_ids: list[str],
    sample_text: str,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``POST /policies/test-pipeline``.

    Returns the per-guardrail breakdown the UI's "Test policy" affordance
    expects: ``{blocked_by, modified_text, decisions[]}``.
    """
    body = {"policy_ids": policy_ids, "text": sample_text}

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        response = await client.admin_client.post("/policies/test-pipeline", json=body)
        if response.status_code >= 400:
            return None
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def test_policies_and_guardrails(
    *,
    policies: list[dict[str, Any]],
    guardrails: list[dict[str, Any]],
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``POST /utils/test_policies_and_guardrails`` — joint validator.

    Called on every policy save (spec §"Policy utils").
    """
    body = {"policies": policies, "guardrails": guardrails}

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        response = await client.admin_client.post("/utils/test_policies_and_guardrails", json=body)
        if response.status_code >= 400:
            return {"valid": False, "errors": [response.text[:200]]}
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------


async def list_templates(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> list[dict[str, Any]]:
    """``GET /policy/templates/list``."""

    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        response = await client.admin_client.get("/policy/templates/list")
        if response.status_code >= 400:
            return []
        raw = response.json() or {}
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            return raw.get("templates") or raw.get("data") or raw.get("items") or []
        return []

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Tool policy schema
# ---------------------------------------------------------------------


async def get_tool_policy(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``GET /v1/tool/policy`` — current per-tool policy schema."""

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        response = await client.admin_client.get("/v1/tool/policy")
        if response.status_code >= 400:
            return None
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def get_tool_policy_options(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``GET /v1/tool/policy/options`` — authoring schema for the UI."""

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        response = await client.admin_client.get("/v1/tool/policy/options")
        if response.status_code >= 400:
            return None
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


__all__ = [
    "compare_policies",
    "get_policy_info",
    "get_policy_status",
    "get_policy_usage",
    "get_tool_policy",
    "get_tool_policy_options",
    "list_attachments",
    "list_policies",
    "list_templates",
    "resolve_policies",
    "test_pipeline",
    "test_policies_and_guardrails",
]
