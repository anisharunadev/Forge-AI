"""F-829c — Per-tenant budget synchronization (LiteLLM Budgets adapter).

LiteLLM is the source of truth for budget enforcement. This module is
a thin adapter over the LiteLLM Budgets API and a read-side cache
mirrored in ``litellm_budget_configs``.

Rules respected:
* Rule 2 — every DB write goes through ``tenant_context``.
* Rule 6 — budget declarations are reflected in the audit timeline
  (the mirrored row carries a ``last_synced_at`` timestamp).
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.config import settings
from app.core.logging import get_logger
from app.db.models.litellm_budget_config import (
    LiteLLMBudgetConfig,
    LiteLLMBudgetPeriod,
)
from app.db.rls import tenant_context
from app.db.session import get_session_factory
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

logger = get_logger(__name__)


def _redact(value: str | None) -> str:
    if value is None:
        return "<none>"
    if len(value) <= 8:
        return "***"
    return f"{value[:4]}...{value[-4:]}"


class BudgetSync:
    """Adapter over the LiteLLM Budgets API.

    Forwards calls to LiteLLM and mirrors the configuration into the
    ``litellm_budget_configs`` table for fast read paths (workflow
    admission, UI, analytics). All reads consult the local cache first
    and fall back to LiteLLM on miss.
    """

    def __init__(self, base_client_factory: Any | None = None) -> None:
        self._base_client_factory = base_client_factory

    # ------------------------------------------------------------------
    # Declaration
    # ------------------------------------------------------------------
    async def set_tenant_budget(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        max_usd: Decimal | float | None = None,
        period: str | None = None,
        hard_limit: bool = True,
    ) -> str | None:
        """Declare a per-tenant budget in LiteLLM; mirror locally.

        Defaults to ``settings.litellm_budget_default_usd`` (Decimal
        ``"500.00"``) and ``settings.litellm_budget_default_period``
        (``"monthly"``) when not provided — per OQ-32. Returns the
        LiteLLM budget id (string) on success, or ``None`` on failure.
        """
        tid = str(tenant_id)
        pid = str(project_id)

        if max_usd is None:
            max_usd = getattr(settings, "litellm_budget_default_usd", Decimal("500.00"))
        if period is None:
            period = getattr(settings, "litellm_budget_default_period", "monthly")

        max_usd_decimal = Decimal(str(max_usd))

        team_id = await self._team_id_for_tenant(tid)
        if team_id is None:
            logger.warning(
                "litellm.budget_sync.no_team",
                tenant_id=tid,
            )
            return None

        body = {
            "team_id": team_id,
            "max_budget": float(max_usd_decimal),
            "budget_duration": period,
        }
        try:
            response = await self._admin_post("/budget/new", json_body=body)
        except Exception as exc:  # pragma: no cover — network path
            logger.warning(
                "litellm.budget_sync.create_failed",
                tenant_id=tid,
                error=str(exc),
            )
            return None

        litellm_budget_id = self._extract_budget_id(response)

        try:
            await self._mirror(
                tenant_id=tid,
                project_id=pid,
                litellm_team_id=team_id,
                litellm_budget_id=litellm_budget_id,
                max_usd=max_usd_decimal,
                period=period,
                hard_limit=hard_limit,
            )
        except Exception as exc:
            logger.warning(
                "litellm.budget_sync.mirror_failed",
                tenant_id=tid,
                error=str(exc),
            )

        logger.info(
            "litellm.budget_sync.declared",
            tenant_id=tid,
            max_usd=str(max_usd_decimal),
            period=period,
            hard_limit=hard_limit,
            litellm_budget_id=_redact(litellm_budget_id),
        )
        return litellm_budget_id

    # ------------------------------------------------------------------
    # Read path
    # ------------------------------------------------------------------
    async def get_tenant_budget(self, tenant_id: UUID | str) -> dict[str, Any] | None:
        """Return the mirrored budget config, or fetch from LiteLLM on miss."""
        tid = str(tenant_id)
        row = await self._get_mirrored(tid)
        if row is not None:
            return {
                "tenant_id": row.tenant_id,
                "project_id": row.project_id,
                "litellm_team_id": row.litellm_team_id,
                "litellm_budget_id": row.litellm_budget_id,
                "max_usd": float(row.max_usd),
                "period": row.period,
                "hard_limit": row.hard_limit,
                "last_synced_at": (row.last_synced_at.isoformat() if row.last_synced_at else None),
            }

        team_id = await self._team_id_for_tenant(tid)
        if team_id is None:
            return None

        try:
            response = await self._admin_get("/budget/info", params={"team_id": team_id})
        except Exception as exc:
            logger.warning(
                "litellm.budget_sync.info_failed",
                tenant_id=tid,
                error=str(exc),
            )
            return None

        if not response:
            return None
        budget_info = response.get("budget_info") or response
        if not isinstance(budget_info, dict):
            return None

        return {
            "tenant_id": tid,
            "litellm_team_id": budget_info.get("team_id"),
            "max_usd": float(budget_info.get("max_budget", 0.0) or 0.0),
            "period": budget_info.get("budget_duration") or "monthly",
            "hard_limit": True,
            "litellm_budget_id": str(budget_info.get("id") or ""),
        }

    # ------------------------------------------------------------------
    # Spend check
    # ------------------------------------------------------------------
    async def check_budget(self, tenant_id: UUID | str) -> tuple[float, float]:
        """Return ``(spent_usd, max_usd)`` for the tenant.

        ``spent_usd`` is aggregated from LiteLLM ``/spend/logs``;
        ``max_usd`` comes from the mirrored config (or 0.0 if unknown).
        Returns ``(0.0, 0.0)`` on any failure so callers can choose to
        fail-open or fail-closed at a higher layer.
        """
        tid = str(tenant_id)
        team_id = await self._team_id_for_tenant(tid)

        if team_id is None:
            return 0.0, 0.0

        max_usd = 0.0
        row = await self._get_mirrored(tid)
        if row is not None:
            max_usd = float(row.max_usd)

        try:
            response = await self._admin_get("/spend/logs", params={"team_id": team_id})
        except Exception as exc:
            logger.warning(
                "litellm.budget_sync.spend_failed",
                tenant_id=tid,
                error=str(exc),
            )
            return 0.0, max_usd

        spent = self._aggregate_spend(response)
        return spent, max_usd

    # ------------------------------------------------------------------
    # Spend recording
    # ------------------------------------------------------------------
    async def record_spend(self, tenant_id: UUID | str, delta_usd: float) -> None:
        """Best-effort spend recording.

        LiteLLM tracks spend natively (every ``/chat/completions`` and
        ``/embeddings`` call is logged server-side), so this method is
        a no-op in V1. The interface is preserved so callers can use
        the same shape regardless of upstream behavior.
        """
        if delta_usd < 0:
            return
        logger.debug(
            "litellm.budget_sync.record_spend_noop",
            tenant_id=str(tenant_id),
            delta_usd=delta_usd,
        )

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------
    async def _admin_post(
        self, path: str, *, json_body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        if self._base_client_factory is not None:
            async with self._base_client_factory() as client:
                response = await client.admin_client.post(path, json=json_body or {})
                return self._parse(response)

        async with LiteLLMBaseClient() as client:
            response = await client.admin_client.post(path, json=json_body or {})
            return self._parse(response)

    async def _admin_get(
        self, path: str, *, params: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        if self._base_client_factory is not None:
            async with self._base_client_factory() as client:
                response = await client.admin_client.get(path, params=params or {})
                return self._parse(response)

        async with LiteLLMBaseClient() as client:
            response = await client.admin_client.get(path, params=params or {})
            return self._parse(response)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    async def _mirror(
        self,
        tenant_id: str,
        project_id: str,
        litellm_team_id: str,
        litellm_budget_id: str | None,
        max_usd: Decimal,
        period: str,
        hard_limit: bool,
    ) -> None:
        normalized_period = self._normalize_period(period)
        factory = get_session_factory()
        async with factory() as session, tenant_context(session, tenant_id, project_id):
            row = await session.scalar(
                select(LiteLLMBudgetConfig).where(LiteLLMBudgetConfig.tenant_id == tenant_id)
            )
            if row is None:
                row = LiteLLMBudgetConfig(
                    tenant_id=tenant_id,
                    project_id=project_id,
                    litellm_team_id=litellm_team_id,
                    litellm_budget_id=litellm_budget_id,
                    max_usd=max_usd,
                    period=normalized_period,
                    hard_limit=hard_limit,
                    last_synced_at=datetime.now(UTC),
                )
                session.add(row)
            else:
                row.litellm_team_id = litellm_team_id
                if litellm_budget_id is not None:
                    row.litellm_budget_id = litellm_budget_id
                row.max_usd = max_usd
                row.period = normalized_period
                row.hard_limit = hard_limit
                row.last_synced_at = datetime.now(UTC)
            await session.commit()

    async def _get_mirrored(self, tenant_id: str) -> LiteLLMBudgetConfig | None:
        factory = get_session_factory()
        async with factory() as session, tenant_context(session, tenant_id):
            return await session.scalar(
                select(LiteLLMBudgetConfig).where(LiteLLMBudgetConfig.tenant_id == tenant_id)
            )

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

    @staticmethod
    def _normalize_period(period: str) -> str:
        try:
            return LiteLLMBudgetPeriod(period.lower()).value
        except ValueError:
            return LiteLLMBudgetPeriod.MONTHLY.value

    @staticmethod
    def _parse(response: Any) -> dict[str, Any]:
        if response is None:
            return {}
        try:
            return response.json() or {}
        except Exception:
            return {}

    @staticmethod
    def _extract_budget_id(response: dict[str, Any] | None) -> str | None:
        if not response:
            return None
        for key in ("budget_id", "id"):
            value = response.get(key)
            if value is not None:
                return str(value)
        return None

    @staticmethod
    def _aggregate_spend(response: dict[str, Any] | list[Any] | None) -> float:
        if response is None:
            return 0.0
        if isinstance(response, list):
            entries = response
        elif isinstance(response, dict):
            entries = response.get("data") or response.get("logs") or []
            if isinstance(entries, dict):
                entries = entries.get("data") or []
        else:
            return 0.0

        if not isinstance(entries, list):
            return 0.0

        total = 0.0
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            value = entry.get("spend")
            if value is None:
                value = entry.get("cost")
            try:
                total += float(value or 0.0)
            except (TypeError, ValueError):
                continue
        return total


# Module-level singleton (mirrors `audit_service.py:49`).
budget_sync = BudgetSync()


__all__ = ["BudgetSync", "budget_sync"]
