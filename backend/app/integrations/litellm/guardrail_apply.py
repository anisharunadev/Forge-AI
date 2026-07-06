"""step-77 Slice 1 — Guardrail apply + management on top of LiteLLM.

Thin wrapper over the LiteLLM Guardrails endpoints that the Phase 2
spec names in ``docs/goals/step-77.md`` §Feature 6. Reads the proxy
catalog; registers new guardrails; runs the per-call ``/apply_guardrail``
envelope; surfaces the submissions log; proxies the UI rule-builder.

This module deliberately does NOT cache anything — caching is the
service layer's job (60s TTL on the per-tenant catalog; the apply
endpoint is per-call and stays fresh by design). The proxy is the
authoritative state for every field except the per-tenant
*assignment*, which lives in :class:`GuardrailSync`.

Sibling agents own:
* :class:`GuardrailSync` — per-tenant assignment mirror (F-829d).
* :class:`LiteLLMBaseClient` — the pooled httpx client + header overlay
  (F-829a); every request in this file routes through it.

Rules respected:
* Rule 1 — LiteLLM is the only LLM gateway; this module talks to it
  via :class:`LiteLLMBaseClient` (httpx).
* Rule 4 — every response shape is normalized into a typed dict; the
  router is the only place that may project further.
"""

from __future__ import annotations

import time
from typing import Any

from app.core.logging import get_logger
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

logger = get_logger(__name__)


# ---------------------------------------------------------------------
# Response shapes — the liteLLM proxy's actual JSON shapes are
# inconsistent across versions; the normalizers here pin them so
# upstream drift doesn't break the call sites. See
# ``docs/litellm/litellm-critical-schemas.json`` for the canonical
# shapes the proxy returns.
# ---------------------------------------------------------------------


def _normalize_apply_response(raw: dict[str, Any]) -> dict[str, Any]:
    """Coerce an ``/apply_guardrail`` response to a stable shape.

    The proxy returns either:
        ``{"verdict": "safe", "text": "...", "metadata": {...}}``  (newer)
    or ``{"blocked": true, "reason": "..."}``                     (legacy)
    or ``{"decision": "block", "text": "...", "reason": "..."}`` (alternate)

    The normalized output has these keys, always:
        ``decision``  — one of ``pass``, ``block``, ``mask``
        ``text``      — the (possibly-masked) output text; equal to
                        the input when no masking occurred
        ``reason``    — when ``decision in {block, mask}``
        ``latency_ms``— always present; 0 when the proxy omits it
    """
    decision = "pass"
    text = raw.get("text")
    reason: str | None = None

    if raw.get("blocked") is True:
        decision = "block"
        reason = raw.get("reason") or raw.get("message") or "guardrail blocked"
    elif raw.get("verdict") == "unsafe" or raw.get("decision") == "block":
        decision = "block"
        reason = raw.get("reason") or raw.get("message")
    elif raw.get("verdict") == "masked" or raw.get("decision") == "mask":
        decision = "mask"
        reason = raw.get("reason") or raw.get("message")
    elif text is not None and text != raw.get("text"):
        # Conservative: if a different text was returned and the
        # verdict is "safe", treat it as a mask.
        decision = "mask"

    latency_ms = int(
        raw.get("latency_ms")
        or raw.get("latencyMs")
        or raw.get("metadata", {}).get("latency_ms")
        or 0
    )
    return {
        "decision": decision,
        "text": text if text is not None else raw.get("input", ""),
        "reason": reason,
        "latency_ms": latency_ms,
        "metadata": raw.get("metadata") or {},
    }


# ---------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------


async def apply_guardrail(
    *,
    guardrail_name: str,
    text: str,
    user_id: str | None = None,
    request_id: str | None = None,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    """Call ``POST /apply_guardrail`` and return the normalized result.

    Per the spec, this is the pre-call and post-call envelope. The
    caller (the guardrails service) decides what to do with the
    ``decision`` field. On any proxy error the call raises — the
    service layer's job is to choose fail-open vs fail-closed per the
    tenant's policy.
    """
    body: dict[str, Any] = {
        "guardrail_name": guardrail_name,
        "text": text,
    }
    if user_id is not None:
        body["user_id"] = user_id
    if request_id is not None:
        body["request_id"] = request_id

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        started = time.monotonic()
        response = await client.admin_client.post("/apply_guardrail", json=body)
        if response.status_code >= 400:
            raise RuntimeError(
                f"apply_guardrail {guardrail_name!r} returned "
                f"{response.status_code}: {response.text[:200]}"
            )
        elapsed_ms = int((time.monotonic() - started) * 1000)
        raw = response.json() or {}
        normalized = _normalize_apply_response(raw)
        if normalized["latency_ms"] == 0:
            normalized["latency_ms"] = elapsed_ms
        return normalized

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------


async def list_guardrails(
    *,
    prefer_v2: bool = True,
    base_client: LiteLLMBaseClient | None = None,
) -> list[dict[str, Any]]:
    """Return the LiteLLM guardrail catalog.

    Prefers ``GET /v2/guardrails/list`` (canonical per spec §"v2 list")
    but falls back to ``GET /guardrails/list`` on 404. Returns a list
    of ``{id, name, description, default_params, kind}`` dicts. On
    any error returns an empty list — the caller (service layer) is
    responsible for fail-open behavior.
    """
    paths = (
        ["/v2/guardrails/list", "/guardrails/list"]
        if prefer_v2
        else ["/guardrails/list", "/v2/guardrails/list"]
    )

    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        for path in paths:
            response = await client.admin_client.get(path)
            if response.status_code == 404:
                continue
            if response.status_code >= 400:
                logger.warning(
                    "litellm.guardrail_apply.list_failed",
                    path=path,
                    status=response.status_code,
                )
                return []
            raw = response.json() or {}
            return _extract_catalog_rows(raw)
        return []

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def get_guardrail_info(
    guardrail_name: str,
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """Return one guardrail's metadata, or ``None`` if it doesn't exist.

    Used by the register path to check idempotency: a re-registration
    with the same name is an update, not a new row (AC #7).
    """

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        response = await client.admin_client.get(
            "/guardrails/info", params={"guardrail_name": guardrail_name}
        )
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            return None
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------


async def register_guardrail(
    *,
    guardrail_name: str,
    litellm_params: dict[str, Any],
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    """Call ``POST /guardrails/register``.

    Idempotent on ``guardrail_name`` (the proxy updates in place).
    The body shape is the same as the v2/legacy path; the proxy
    discriminates by name. See spec §"Registration".
    """
    body = {
        "guardrail_name": guardrail_name,
        "litellm_params": litellm_params,
    }

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        response = await client.admin_client.post("/guardrails/register", json=body)
        if response.status_code >= 400:
            raise RuntimeError(
                f"register_guardrail {guardrail_name!r} returned "
                f"{response.status_code}: {response.text[:200]}"
            )
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Custom-code validation (AC #5)
# ---------------------------------------------------------------------


async def test_custom_code(
    *,
    code: str,
    sample_text: str = "ping",
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    """Call ``POST /guardrails/test_custom_code`` to validate before deploy.

    Returns ``{"valid": bool, "error": str|None, "result": dict|None}``.
    A failed test rejects the registration in the service layer (AC #5).
    """
    body = {"code": code, "text": sample_text}

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        response = await client.admin_client.post("/guardrails/test_custom_code", json=body)
        raw: dict[str, Any] = (response.json() or {}) if response.status_code < 500 else {}
        if response.status_code >= 400:
            return {"valid": False, "error": raw.get("error") or response.text[:200], "result": raw}
        return {
            "valid": bool(raw.get("valid", True)),
            "error": raw.get("error"),
            "result": raw.get("result") or raw,
        }

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Submissions log
# ---------------------------------------------------------------------


async def list_submissions(
    *,
    since_hours: int = 24,
    guardrail_name: str | None = None,
    base_client: LiteLLMBaseClient | None = None,
) -> list[dict[str, Any]]:
    """Call ``GET /guardrails/submissions/list``.

    The proxy may return either ``{"submissions": [...]}`` or a bare
    list. Both are normalized to a list of dicts that always carry
    ``latency_ms`` (AC #6).
    """
    params: dict[str, Any] = {"since_hours": since_hours}
    if guardrail_name is not None:
        params["guardrail_name"] = guardrail_name

    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        response = await client.admin_client.get("/guardrails/submissions/list", params=params)
        if response.status_code >= 400:
            return []
        raw = response.json() or {}
        if isinstance(raw, list):
            rows = raw
        elif isinstance(raw, dict):
            rows = raw.get("submissions") or raw.get("data") or raw.get("items") or []
        else:
            rows = []
        # Guarantee latency_ms on every row (AC #6).
        normalized: list[dict[str, Any]] = []
        for r in rows:
            if not isinstance(r, dict):
                continue
            r.setdefault("latency_ms", 0)
            normalized.append(r)
        return normalized

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# UI rule-builder
# ---------------------------------------------------------------------


async def list_ui_rules(
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> list[dict[str, Any]]:
    """Call ``GET /guardrails/ui/list`` (UI rule-builder surface)."""

    async def _call(client: LiteLLMBaseClient) -> list[dict[str, Any]]:
        response = await client.admin_client.get("/guardrails/ui/list")
        if response.status_code >= 400:
            return []
        raw = response.json() or {}
        if isinstance(raw, list):
            return raw
        if isinstance(raw, dict):
            return raw.get("rules") or raw.get("data") or raw.get("items") or []
        return []

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def save_ui_rule(
    rule: dict[str, Any],
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any]:
    """Call ``POST /guardrails/ui/save`` (persist a rule-builder rule)."""

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any]:
        response = await client.admin_client.post("/guardrails/ui/save", json=rule)
        if response.status_code >= 400:
            raise RuntimeError(
                f"save_ui_rule returned {response.status_code}: {response.text[:200]}"
            )
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


async def get_ui_rule(
    rule_id: str,
    *,
    base_client: LiteLLMBaseClient | None = None,
) -> dict[str, Any] | None:
    """Call ``GET /guardrails/ui/get?id=...`` (one rule)."""

    async def _call(client: LiteLLMBaseClient) -> dict[str, Any] | None:
        response = await client.admin_client.get("/guardrails/ui/get", params={"id": rule_id})
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            return None
        return response.json() or {}

    if base_client is not None:
        return await _call(base_client)
    async with LiteLLMBaseClient() as client:
        return await _call(client)


# ---------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------


def _extract_catalog_rows(raw: dict[str, Any] | list[Any]) -> list[dict[str, Any]]:
    """Mirror of :meth:`GuardrailSync._extract_catalog_rows` — duplicated
    here so the wrapper is importable without the sync module's tenant
    context machinery. Output shape is the same.
    """
    if isinstance(raw, list):
        rows = raw
    elif isinstance(raw, dict):
        for key in ("guardrails", "data", "items"):
            if key in raw and isinstance(raw[key], list):
                rows = raw[key]
                break
        else:
            if "guardrail_name" in raw or "id" in raw:
                rows = [raw]
            else:
                return []
    else:
        return []

    normalized: list[dict[str, Any]] = []
    for raw_row in rows:
        if not isinstance(raw_row, dict):
            continue
        gid = raw_row.get("guardrail_name") or raw_row.get("id") or raw_row.get("name")
        if not gid:
            continue
        normalized.append(
            {
                "id": str(gid),
                "name": raw_row.get("display_name") or raw_row.get("name") or str(gid),
                "description": raw_row.get("description") or "",
                "default_params": raw_row.get("default_params") or {},
                "kind": raw_row.get("kind") or raw_row.get("type"),
            }
        )
    return normalized


__all__ = [
    "apply_guardrail",
    "get_guardrail_info",
    "get_ui_rule",
    "list_guardrails",
    "list_submissions",
    "list_ui_rules",
    "register_guardrail",
    "save_ui_rule",
    "test_custom_code",
]
