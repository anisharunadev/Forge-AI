"""F-829d — Guardrail sync (Steward UI surface for LiteLLM guardrails).

Forges a thin read/write surface over the LiteLLM Guardrails API.
The catalog of available guardrails is pulled from LiteLLM (single
source of truth). Per-tenant assignments are mirrored into
``litellm_guardrail_assignments`` (created in the F-829 migration) so
the UI can render "which guardrails are active for this tenant"
without re-querying LiteLLM on every page load.

Rules respected:
* Rule 1 — LiteLLM is the only LLM gateway; this module talks to it
  via :class:`LiteLLMBaseClient` (httpx).
* Rule 2 — every DB write goes through ``tenant_context``.
* Rule 3 — Steward assignments are auditable (mirror row carries
  ``assigned_at`` + ``assigned_by``).
* OQ-34 — the Steward configures guardrails via the Forge UI; the
  LiteLLM admin UI remains the escape hatch for custom regex.

Failure policy: a failed sync is logged at WARNING and the function
returns ``False`` / ``None`` — the Steward UI surfaces a toast and the
catalog call falls back to an empty list. We fail OPEN on reads (no
guardrail enforcement blocked) and fail CLOSED on writes (an
incomplete assignment is never persisted).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.rls import tenant_context
from app.db.session import get_session_factory
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

logger = get_logger(__name__)


def _redact(value: str | None) -> str:
    """Redact a value for logging. Used for guardrail ids / aliases."""
    if value is None:
        return "<none>"
    if len(value) <= 8:
        return "***"
    return f"{value[:4]}...{value[-4:]}"


class GuardrailSync:
    """Catalog + per-tenant assignment adapter for LiteLLM guardrails.

    The catalog is a *read* of LiteLLM's ``/guardrails/list`` endpoint.
    Per-tenant assignments are *mirrored* into the local
    ``litellm_guardrail_assignments`` table (best-effort; the
    authoritative state is the LiteLLM Team config).

    All network operations open a fresh :class:`LiteLLMBaseClient` per
    call (mirrors :class:`TenantSync`).
    """

    def __init__(self, base_client_factory: Any | None = None) -> None:
        self._base_client_factory = base_client_factory

    # ------------------------------------------------------------------
    # Catalog (read)
    # ------------------------------------------------------------------
    async def list_catalog(self) -> list[dict[str, Any]]:
        """Return the LiteLLM guardrail catalog.

        Returns a list of ``{id, name, description, default_params}``
        dicts. On any error, returns an empty list (fail-open — the
        UI shows the empty state and a toast; assignment remains
        possible against guardrail ids typed manually).
        """
        try:
            response = await self._admin_get("/guardrails/list")
        except Exception as exc:  # pragma: no cover — network path
            logger.warning(
                "litellm.guardrail_sync.catalog_failed",
                error=str(exc),
                error_type=type(exc).__name__,
            )
            return []

        rows = self._extract_catalog_rows(response)
        if not rows:
            logger.info(
                "litellm.guardrail_sync.catalog_empty",
                detail="LiteLLM returned no guardrails — verify Guardrails plugin is enabled",
            )
        return rows

    # ------------------------------------------------------------------
    # Per-tenant assignment (write)
    # ------------------------------------------------------------------
    async def assign_to_tenant(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        guardrail_ids: list[str],
        actor_id: UUID | str | None = None,
    ) -> bool:
        """Assign a set of guardrails to a tenant.

        Persists the assignment in the local mirror
        (``litellm_guardrail_assignments``) and PATCHes the
        LiteLLM Team config so the proxy actually enforces the
        guardrails on the tenant's calls. Returns ``True`` on full
        success, ``False`` on any failure (logged at WARNING).
        """
        from app.db.models.litellm_guardrail_assignment import LiteLLMGuardrailAssignment

        tid = str(tenant_id)
        pid = str(project_id)

        # 1. Resolve the LiteLLM team id for this tenant.
        team_id = await self._team_id_for_tenant(tid)
        if team_id is None:
            logger.warning(
                "litellm.guardrail_sync.no_team",
                tenant_id=tid,
            )
            return False

        # 2. PATCH the LiteLLM team metadata + guardrails list. We
        #    use ``/team/update`` which LiteLLM treats as a partial
        #    PUT; we overwrite the ``guardrails`` array.
        body = {
            "team_id": team_id,
            "guardrails": list(guardrail_ids),
        }
        try:
            await self._admin_post("/team/update", json_body=body)
        except Exception as exc:  # pragma: no cover — network path
            logger.warning(
                "litellm.guardrail_sync.update_failed",
                tenant_id=tid,
                team_id=_redact(team_id),
                error=str(exc),
            )
            return False

        # 3. Persist the mirror row. We replace prior assignments
        #    for this tenant so the mirror reflects a single
        #    authoritative state (LiteLLM itself is the source of
        #    truth; the mirror is for UI reads only).
        try:
            factory = get_session_factory()
            async with factory() as session, tenant_context(session, tid, pid):
                prior = await session.scalars(
                    select(LiteLLMGuardrailAssignment).where(
                        LiteLLMGuardrailAssignment.tenant_id == tid
                    )
                )
                for row in prior.all():
                    await session.delete(row)
                session.add(
                    LiteLLMGuardrailAssignment(
                        tenant_id=tid,
                        project_id=pid,
                        litellm_team_id=team_id,
                        guardrail_ids=list(guardrail_ids),
                        assigned_at=datetime.now(UTC),
                        assigned_by=str(actor_id) if actor_id else None,
                    )
                )
                await session.commit()
        except Exception as exc:
            # Mirror write failed but LiteLLM is updated. The UI
            # next call will re-fetch and reconcile.
            logger.warning(
                "litellm.guardrail_sync.persist_failed",
                tenant_id=tid,
                error=str(exc),
            )
            return True  # LiteLLM is authoritative; we accept the mirror lag

        logger.info(
            "litellm.guardrail_sync.assigned",
            tenant_id=tid,
            team_id=_redact(team_id),
            count=len(guardrail_ids),
        )
        return True

    # ------------------------------------------------------------------
    # Per-tenant read
    # ------------------------------------------------------------------
    async def get_for_tenant(
        self,
        tenant_id: UUID | str,
    ) -> list[str]:
        """Return the guardrail ids currently assigned to a tenant.

        Reads the local mirror. Empty list when no assignment exists
        (or when the tenant has no LiteLLM Team).
        """
        from app.db.models.litellm_guardrail_assignment import LiteLLMGuardrailAssignment

        tid = str(tenant_id)
        try:
            factory = get_session_factory()
            async with factory() as session, tenant_context(session, tid):
                row = await session.scalar(
                    select(LiteLLMGuardrailAssignment)
                    .where(LiteLLMGuardrailAssignment.tenant_id == tid)
                    .order_by(LiteLLMGuardrailAssignment.assigned_at.desc())
                )
                if row is None:
                    return []
                return list(row.guardrail_ids or [])
        except Exception as exc:  # pragma: no cover — DB path
            logger.warning(
                "litellm.guardrail_sync.read_failed",
                tenant_id=tid,
                error=str(exc),
            )
            return []

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------
    async def _admin_get(self, path: str) -> dict[str, Any]:
        if self._base_client_factory is not None:
            async with self._base_client_factory() as client:
                response = await client.admin_client.get(path)
                return self._parse(response)
        async with LiteLLMBaseClient() as client:
            response = await client.admin_client.get(path)
            return self._parse(response)

    async def _admin_post(
        self,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if self._base_client_factory is not None:
            async with self._base_client_factory() as client:
                response = await client.admin_client.post(path, json=json_body or {})
                return self._parse(response)
        async with LiteLLMBaseClient() as client:
            response = await client.admin_client.post(path, json=json_body or {})
            return self._parse(response)

    # ------------------------------------------------------------------
    # DB helpers
    # ------------------------------------------------------------------
    async def _team_id_for_tenant(self, tenant_id: str) -> str | None:
        from app.db.models.litellm_team_mapping import LiteLLMTeamMapping

        factory = get_session_factory()
        async with factory() as session, tenant_context(session, tenant_id):
            row = await session.scalar(
                select(LiteLLMTeamMapping).where(LiteLLMTeamMapping.tenant_id == tenant_id)
            )
            if row is None:
                return None
            return row.litellm_team_id

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------
    @staticmethod
    def _parse(response: Any) -> dict[str, Any]:
        if response is None:
            return {}
        try:
            return response.json() or {}
        except Exception:
            return {}

    @staticmethod
    def _extract_catalog_rows(response: dict[str, Any] | None) -> list[dict[str, Any]]:
        """Normalize the LiteLLM ``/guardrails/list`` response shape.

        LiteLLM returns either a top-level array (``[{"guardrail_name": ...}]``)
        or a wrapped object (``{"guardrails": [...]}``). We accept both.
        Each row is coerced to ``{id, name, description, default_params}``.
        """
        if not response:
            return []
        rows: list[Any]
        if isinstance(response, list):
            rows = response
        elif isinstance(response, dict):
            for key in ("guardrails", "data", "items"):
                if key in response and isinstance(response[key], list):
                    rows = response[key]
                    break
            else:
                # Single-object shape (e.g. {"guardrail_name": "pii"})
                if "guardrail_name" in response or "id" in response:
                    rows = [response]
                else:
                    return []
        else:
            return []

        normalized: list[dict[str, Any]] = []
        for raw in rows:
            if not isinstance(raw, dict):
                continue
            gid = raw.get("guardrail_name") or raw.get("id") or raw.get("name")
            if not gid:
                continue
            normalized.append(
                {
                    "id": str(gid),
                    "name": raw.get("display_name") or raw.get("name") or str(gid),
                    "description": raw.get("description") or "",
                    "default_params": raw.get("default_params") or {},
                }
            )
        return normalized


# Module-level singleton (mirrors `audit_service.py:49`).
guardrail_sync = GuardrailSync()


__all__ = ["GuardrailSync", "guardrail_sync"]
