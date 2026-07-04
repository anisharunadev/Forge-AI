"""F15 — Audit / Health / Compliance thin LiteLLM proxy method group.

Phase 3 Feature 15 wraps the LiteLLM admin endpoints for audit, health,
compliance, nudges, event-logging, and callback ingestion. All methods
use admin auth (``LiteLLMBaseClient.admin_client``) because these are
management endpoints, not per-tenant chat endpoints.

Per-tenant scoping is enforced by the Forge Backend layer (Rule 2);
this client is the typed proxy to the upstream LiteLLM API.

Endpoint coverage (one method per LiteLLM endpoint family from
step-78 §"LiteLLM endpoints used", F15):
  - /audit            list, detail
  - /health           aggregate, readiness, liveness, liveliness, services,
                      history, latest, shared-status, license, backlog,
                      test_connection
  - /compliance/eu-ai-act   per-tenant report
  - /compliance/gdpr        per-user data export / delete
  - /in_product_nudges      UI feature tips
  - /api/event_logging      server-side telemetry push
  - /callback               webhook ingress

Sister method groups for F11/F12/F13/F14 live alongside this one.
"""

from __future__ import annotations

from typing import Any

import httpx


class ObservabilityClientGroup:
    """Typed proxy for the F15 observability endpoints on the LiteLLM proxy."""

    __slots__ = ("_base",)

    def __init__(self, base: httpx.AsyncClient) -> None:
        self._base = base

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _ok(response: httpx.Response) -> dict[str, Any]:
        if not (200 <= response.status_code < 300):
            return {"_status": response.status_code, "_body": response.text[:500]}
        if not response.content:
            return {}
        try:
            return response.json()
        except Exception:  # noqa: BLE001
            return {"_raw": response.text[:500]}

    # ------------------------------------------------------------------
    # /audit/*
    # ------------------------------------------------------------------

    async def audit_list(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        r = await self._base.get("/audit", params=params or {})
        return self._ok(r)

    async def audit_get(self, event_id: str) -> dict[str, Any]:
        r = await self._base.get(f"/audit/{event_id}")
        return self._ok(r)

    # ------------------------------------------------------------------
    # /health/*
    # ------------------------------------------------------------------

    async def health(self) -> dict[str, Any]:
        r = await self._base.get("/health")
        return self._ok(r)

    async def health_readiness(self) -> dict[str, Any]:
        r = await self._base.get("/health/readiness")
        return self._ok(r)

    async def health_liveness(self) -> dict[str, Any]:
        r = await self._base.get("/health/liveness")
        return self._ok(r)

    async def health_services(self) -> dict[str, Any]:
        r = await self._base.get("/health/services")
        return self._ok(r)

    async def health_history(self) -> dict[str, Any]:
        r = await self._base.get("/health/history")
        return self._ok(r)

    async def health_latest(self) -> dict[str, Any]:
        r = await self._base.get("/health/latest")
        return self._ok(r)

    async def health_shared_status(self) -> dict[str, Any]:
        r = await self._base.get("/health/shared-status")
        return self._ok(r)

    async def health_license(self) -> dict[str, Any]:
        r = await self._base.get("/health/license")
        return self._ok(r)

    async def health_backlog(self) -> dict[str, Any]:
        r = await self._base.get("/health/backlog")
        return self._ok(r)

    async def health_test_connection(self, provider: str) -> dict[str, Any]:
        r = await self._base.post("/health/test_connection", json={"provider": provider})
        return self._ok(r)

    # ------------------------------------------------------------------
    # /compliance/*
    # ------------------------------------------------------------------

    async def compliance_eu_ai_act(self, tenant_id: str) -> dict[str, Any]:
        r = await self._base.get(
            "/compliance/eu-ai-act", params={"tenant_id": tenant_id}
        )
        return self._ok(r)

    async def compliance_gdpr(self, tenant_id: str, user_id: str) -> dict[str, Any]:
        r = await self._base.get(
            "/compliance/gdpr",
            params={"tenant_id": tenant_id, "user_id": user_id},
        )
        return self._ok(r)

    # ------------------------------------------------------------------
    # /in_product_nudges
    # ------------------------------------------------------------------

    async def in_product_nudges(self) -> dict[str, Any]:
        r = await self._base.get("/in_product_nudges")
        return self._ok(r)

    # ------------------------------------------------------------------
    # /api/event_logging + /callback (push)
    # ------------------------------------------------------------------

    async def event_logging(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/api/event_logging", json=payload)
        return self._ok(r)

    async def callback(self, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._base.post("/callback", json=payload)
        return self._ok(r)


__all__ = ["ObservabilityClientGroup"]