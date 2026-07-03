"""step-78 Phase 2 — Policies proxy on top of LiteLLM.

Thin wrapper over the LiteLLM Policies endpoints named in
``docs/goals/step-76.md`` §Feature 7. The pattern mirrors
:mod:`app.integrations.litellm.guardrail_apply`:

* One async function per LiteLLM endpoint.
* Each function accepts an optional ``base_client`` for tests; the
  module opens its own :class:`LiteLLMBaseClient` otherwise.
* Network errors propagate; the service layer chooses fail-open vs
  fail-closed per tenant policy.

Endpoints covered (spec §Feature 7):
* ``GET    /policies/list``
* ``GET    /policies/info``
* ``GET    /policies/status``
* ``GET    /policies/usage``
* ``POST   /policies/compare``
* ``POST   /policies/resolve``
* ``POST   /policies/test-pipeline``
* ``POST   /policies/test``
* ``GET    /policies/attachments/list``
* ``POST   /policy/validate``
* ``GET    /policy/templates/list``
* ``GET    /policy/list`` / ``GET /policy/info`` / ``POST /policy/test``
* ``POST   /utils/test_policies_and_guardrails``

Rules respected:
* Rule 1 — LiteLLM is the only LLM gateway.
* Rule 4 — response shapes are normalized (lists coerced; missing
  fields default to ``None``/empty).
"""

from __future__ import annotations

import time
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

logger = get_logger(__name__)


# Ponytail: a single shared helper. Most list-shaped endpoints on the
# proxy either return a top-level array or wrap it in
# ``{items|data|policies|servers|...}``. Centralizing the unwrap
# here keeps the call sites one line.
def _unwrap_list(raw: Any, *, keys: tuple[str, ...] = ("items", "data", "policies")) -> list[Any]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        for key in keys:
            value = raw.get(key)
            if isinstance(value, list):
                return value
    return []


# Ponytail: one shared guard for 404/4xx — return ``None`` so callers
# can decide between "missing" (None) and "empty" (empty list).
async def _safe_get(
    client: LiteLLMBaseClient,
    path: str,
    *,
    params: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    response = await client.admin_client.get(path, params=params)
    if response.status_code == 404:
        return None
    if response.status_code >= 400:
        logger.warning(
            "litellm.policies.get_failed",
            path=path,
            status=response.status_code,
        )
        return None
    return response.json() or {}


async def _safe_post(
    client: LiteLLMBaseClient,
    path: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    """POST and either return JSON or raise — failures are policy-shape errors."""
    response = await client.admin_client.post(path, json=body)
    if response.status_code >= 400:
        raise RuntimeError(
            f"policies POST {path} returned "
            f"{response.status_code}: {response.text[:200]}"
        )
    return response.json() or {}


# ---------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------


async def list_policies(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> list[dict[str, Any]]:
    """``GET /policies/list``."""
    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        result = await _safe_get(client, "/policies/list")
        if result is None:
            return []
        return [r for r in _unwrap_list(result) if isinstance(r, dict)]

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def get_policy_info(
    policy_id: str,
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """``GET /policies/info?policy_id=…``."""
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        return await _safe_get(client, "/policies/info", params={"policy_id": policy_id})

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def policy_status(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    """``GET /policies/status`` — aggregate status counts across policies."""
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        return (await _safe_get(client, "/policies/status")) or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def policy_usage(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    """``GET /policies/usage`` — usage counters for the policies registry."""
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        return (await _safe_get(client, "/policies/usage")) or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Resolve + compare
# ---------------------------------------------------------------------


async def resolve_policies(
    *,
    context: dict[str, Any],
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    """``POST /policies/resolve``.

    Returns the proxy's effective-policy envelope; the service layer
    derives the effective guardrail list + tool policy from this.
    Failures raise — the caller short-circuits the chat.
    """
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        return await _safe_post(client, "/policies/resolve", {"context": context})

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def compare_policies(
    *,
    left: dict[str, Any],
    right: dict[str, Any],
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    """``POST /policies/compare``."""
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        return await _safe_post(
            client,
            "/policies/compare",
            {"left": left, "right": right},
        )

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def resolved_guardrails(
    *,
    context: dict[str, Any],
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    """``POST /policies/resolved-guardrails`` — convenience proxy."""
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        return await _safe_post(
            client, "/policies/resolved-guardrails", {"context": context}
        )

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Test pipeline + validation
# ---------------------------------------------------------------------


async def test_policy_pipeline(
    *,
    policy_id: str,
    sample_chat: dict[str, Any],
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    """``POST /policies/test-pipeline`` — dry-run a full pipeline offline."""
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        return await _safe_post(
            client,
            "/policies/test-pipeline",
            {"policy_id": policy_id, "sample_chat": sample_chat},
        )

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def test_policy(
    *,
    policy_id: str,
    sample_input: dict[str, Any] | None = None,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    """``POST /policies/test`` — single-rule dry-run."""
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        return await _safe_post(
            client,
            "/policies/test",
            {"policy_id": policy_id, "sample_input": sample_input or {}},
        )

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def validate_policy(
    *,
    policy: dict[str, Any],
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    """``POST /policy/validate`` — schema validation only."""
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        return await _safe_post(client, "/policy/validate", {"policy": policy})

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def test_policies_and_guardrails(
    *,
    policy_id: str,
    sample_chat: dict[str, Any],
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    """``POST /utils/test_policies_and_guardrails`` — paired validation on save."""
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        return await _safe_post(
            client,
            "/utils/test_policies_and_guardrails",
            {"policy_id": policy_id, "sample_chat": sample_chat},
        )

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
        result = await _safe_get(client, "/policies/attachments/list")
        if result is None:
            return []
        return [r for r in _unwrap_list(result, keys=("attachments",)) if isinstance(r, dict)]

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
    """``GET /policy/templates/list`` — starter templates shipped by Forge."""
    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        result = await _safe_get(client, "/policy/templates/list")
        if result is None:
            return []
        return [r for r in _unwrap_list(result, keys=("templates",)) if isinstance(r, dict)]

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# Ponytail: tool-policy shape + options proxied under ``/v1/tool/policy*``
# are read-only metadata. Used by the UI rule-builder; no audit cost.

async def get_tool_policy(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        return (await _safe_get(client, "/v1/tool/policy")) or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def get_tool_policy_options(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        return (await _safe_get(client, "/v1/tool/policy/options")) or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


__all__ = [
    "list_policies",
    "get_policy_info",
    "policy_status",
    "policy_usage",
    "resolve_policies",
    "compare_policies",
    "resolved_guardrails",
    "test_policy_pipeline",
    "test_policy",
    "validate_policy",
    "test_policies_and_guardrails",
    "list_attachments",
    "list_templates",
    "get_tool_policy",
    "get_tool_policy_options",
]