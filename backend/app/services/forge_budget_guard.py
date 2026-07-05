"""Per-agent budget guard — pre-call admission control.

Wraps a single agent's last-30-day spend against the per-agent
``agent_virtual_key.max_budget_usd`` ceiling. Called from
:mod:`app.integrations.litellm.llm_client` before any chat completion
so an over-budget agent is blocked before it reaches LiteLLM (AC #4
in ``docs/goals/step-75.md`` §F5).

The Phase 4 ``spend_records`` and ``agent_virtual_key`` tables are
optional: if the migration has not run yet the guard fails open (logs
a warning, returns ``allow=True``) so chat is not blocked by a
missing schema.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
import time
from functools import lru_cache
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.exc import NoSuchTableError, ProgrammingError

from app.core.config import settings
from app.core.logging import get_logger
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory
from app.services import cost_ledger
from app.services.audit_service import audit_service

logger = get_logger(__name__)

DEFAULT_BUDGET_USD = 500.00
WARN_THRESHOLD_PCT = 0.9
SPEND_WINDOW_DAYS = 30


class AgentBudgetExceeded(Exception):
    """Raised when an agent's projected spend would breach its ceiling."""

    def __init__(
        self,
        agent_id: UUID,
        *,
        spent_usd: float,
        ceiling_usd: float,
    ) -> None:
        self.agent_id = agent_id
        self.spent_usd = spent_usd
        self.ceiling_usd = ceiling_usd
        self.code = "agent_budget_exceeded"
        super().__init__(
            f"agent {agent_id} budget exhausted: spent={spent_usd} ceiling={ceiling_usd}"
        )


class AgentBudgetWarning(Exception):
    """Raised/returned when spend has crossed the warn threshold (<= 100%)."""

    def __init__(
        self,
        agent_id: UUID,
        *,
        spent_usd: float,
        ceiling_usd: float,
        pct: float,
    ) -> None:
        self.agent_id = agent_id
        self.spent_usd = spent_usd
        self.ceiling_usd = ceiling_usd
        self.pct = pct
        self.code = "agent_budget_warning"
        super().__init__(
            f"agent {agent_id} budget warning: {pct:.1%} of ceiling used"
        )


# ponytail: 60s lru is fine for one-minute freshness; switch to Redis when
# a hot agent path needs to dodge the SQL SUM across many agents.
@lru_cache(maxsize=1024)
def _cached_spent(agent_id: str, bucket: int) -> float:
    """SUM(cost_usd) for an agent over the last 30 days, cached per minute bucket."""
    factory = get_session_factory()
    aid = UUID(agent_id)
    try:
        with factory() as session:  # type: ignore[call-arg]
            stmt = text(
                "SELECT COALESCE(SUM(cost_usd), 0) FROM spend_records "
                "WHERE agent_id = :aid "
                "AND created_at > NOW() - INTERVAL '30 days'"
            )
            result = session.execute(stmt, {"aid": str(aid)})
            row = result.scalar_one_or_none()
    except (NoSuchTableError, ProgrammingError) as exc:
        # ponytail: fail open — the spend table is Phase 4, missing migration
        # must not block chat. Caller treats a return of 0.0 as "no history".
        logger.warning(
            "forge_budget_guard.spend_table_missing",
            agent_id=str(aid),
            error=str(exc),
        )
        return 0.0
    except Exception:  # noqa: BLE001 — DB hiccup must never block a chat
        logger.exception("forge_budget_guard.spend_lookup_failed", agent_id=str(aid))
        return 0.0
    return float(row or 0.0)


def _cached_ceiling(agent_id: str) -> float:
    """Read agent_virtual_key.max_budget_usd; fall back to DEFAULT_BUDGET_USD."""
    factory = get_session_factory()
    aid = UUID(agent_id)
    try:
        with factory() as session:  # type: ignore[call-arg]
            stmt = text(
                "SELECT max_budget_usd FROM agent_virtual_key "
                "WHERE agent_id = :aid LIMIT 1"
            )
            result = session.execute(stmt, {"aid": str(aid)})
            row = result.scalar_one_or_none()
    except (NoSuchTableError, ProgrammingError) as exc:
        logger.warning(
            "forge_budget_guard.virtual_key_table_missing",
            agent_id=str(aid),
            error=str(exc),
        )
        return DEFAULT_BUDGET_USD
    except Exception:  # noqa: BLE001
        logger.exception("forge_budget_guard.ceiling_lookup_failed", agent_id=str(aid))
        return DEFAULT_BUDGET_USD
    return float(row) if row is not None else DEFAULT_BUDGET_USD


class BudgetGuard:
    """Pre-call admission control for a single agent."""

    async def check_pre_call(
        self,
        agent_id: UUID,
        est_cost_usd: float = 0.0,
    ) -> dict:
        """Admit or block a projected call.

        Returns ``{allow, warn, spent_usd, ceiling_usd, pct}``. Raises
        :class:`AgentBudgetExceeded` when the projected cost would breach
        the ceiling.
        """
        if est_cost_usd < 0:
            raise ValueError("est_cost_usd must be non-negative")

        bucket = int(time.time() // 60)
        spent_usd = _cached_spent(str(agent_id), bucket)
        ceiling_usd = _cached_ceiling(str(agent_id))

        pct = (spent_usd / ceiling_usd) if ceiling_usd > 0 else 0.0

        if spent_usd + est_cost_usd > ceiling_usd:
            try:
                await audit_service.record(
                    tenant_id="00000000-0000-0000-0000-000000000000",
                    project_id=None,
                    actor_id=None,
                    action="forge.spend.budget_exceeded",
                    target_type="agent",
                    target_id=str(agent_id),
                    payload={
                        "spent_usd": spent_usd,
                        "ceiling_usd": ceiling_usd,
                        "projected_cost_usd": est_cost_usd,
                    },
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "forge_budget_guard.audit_failed", agent_id=str(agent_id)
                )
            raise AgentBudgetExceeded(
                agent_id, spent_usd=spent_usd, ceiling_usd=ceiling_usd
            )

        warn = pct > WARN_THRESHOLD_PCT
        if warn:
            try:
                await audit_service.record(
                    tenant_id="00000000-0000-0000-0000-000000000000",
                    project_id=None,
                    actor_id=None,
                    action="forge.spend.budget_warning",
                    target_type="agent",
                    target_id=str(agent_id),
                    payload={
                        "spent_usd": spent_usd,
                        "ceiling_usd": ceiling_usd,
                        "pct": round(pct * 100, 2),
                    },
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "forge_budget_guard.audit_failed", agent_id=str(agent_id)
                )

        return {
            "allow": True,
            "warn": warn,
            "spent_usd": spent_usd,
            "ceiling_usd": ceiling_usd,
            "pct": pct,
        }


budget_guard = BudgetGuard()


class TenantBudgetExceeded(Exception):
    """Raised when a tenant's projected spend would breach its ceiling."""

    def __init__(
        self,
        tenant_id: UUID,
        *,
        spent_usd: float,
        ceiling_usd: float,
        retry_after_seconds: int,
    ) -> None:
        self.tenant_id = tenant_id
        self.spent_usd = spent_usd
        self.ceiling_usd = ceiling_usd
        self.retry_after_seconds = retry_after_seconds
        self.code = "tenant_budget_exceeded"
        super().__init__(
            f"tenant {tenant_id} budget exhausted: "
            f"spent={spent_usd} ceiling={ceiling_usd}"
        )


class TenantBudgetGuard:
    """Pre-call admission control for a tenant (Phase 6 SC-6.1).

    Reads ``Tenant.settings['budget_enforcement_v2']`` to decide whether
    to enforce the tenant ceiling. Reads
    ``Tenant.settings['tenant_budget_usd']`` for the ceiling; falls back
    to ``settings.tenant_default_budget_usd`` (default 5000 USD/mo).
    """

    DEFAULT_CEILING_USD = 5000.00
    WINDOW_DAYS = 30
    DEFAULT_RETRY_AFTER_SECONDS = 3600

    def __init__(self) -> None:
        # ponytail: 60s TTL avoids hammering the SUM; switch to Redis when
        # a multi-tenant dashboard needs to dodge the SQL across many tenants.
        self._cache: dict[str, tuple[float, dict]] = {}
        self._cache_lock = asyncio.Lock()

    async def _load_tenant(
        self, tenant_id: UUID
    ) -> tuple[dict | None, float]:
        """Return (settings_dict, ceiling_usd) for a tenant; default when missing."""
        now = time.monotonic()
        async with self._cache_lock:
            cached = self._cache.get(str(tenant_id))
            if cached and now - cached[0] < 60.0:
                return (
                    cached[1].get("settings"),
                    cached[1].get("ceiling_usd", self.DEFAULT_CEILING_USD),
                )

        factory = get_session_factory()
        async with factory() as session:
            row = (
                await session.execute(select(Tenant).where(Tenant.id == tenant_id))
            ).scalar_one_or_none()
        tenant_settings = (getattr(row, "settings", {}) or {}) if row else {}
        ceiling = float(
            tenant_settings.get("tenant_budget_usd") or self.DEFAULT_CEILING_USD
        )
        async with self._cache_lock:
            self._cache[str(tenant_id)] = (
                now,
                {"settings": tenant_settings, "ceiling_usd": ceiling},
            )
        return tenant_settings, ceiling

    def _is_enforced(self, tenant_settings: dict | None) -> bool:
        if not tenant_settings:
            return bool(settings.tenant_budget_enforcement_v2_default)
        return bool(
            tenant_settings.get(
                "budget_enforcement_v2",
                settings.tenant_budget_enforcement_v2_default,
            )
        )

    async def check_pre_call(
        self,
        tenant_id: UUID,
        est_cost_usd: float = 0.0,
    ) -> dict:
        """Admit or block a projected call for a tenant.

        Returns ``{allow, spent_usd, ceiling_usd, pct, retry_after_seconds}``.
        Raises :class:`TenantBudgetExceeded` on overrun.
        """
        if est_cost_usd < 0:
            raise ValueError("est_cost_usd must be non-negative")

        tenant_settings, ceiling_usd = await self._load_tenant(tenant_id)
        if not self._is_enforced(tenant_settings):
            return {
                "allow": True,
                "spent_usd": 0.0,
                "ceiling_usd": ceiling_usd,
                "pct": 0.0,
                "retry_after_seconds": 0,
            }

        spent_usd = await cost_ledger.cost_ledger.get_total_for_tenant(
            tenant_id=tenant_id,
            since=datetime.now(UTC) - timedelta(days=self.WINDOW_DAYS),
        )

        if spent_usd + est_cost_usd > ceiling_usd:
            try:
                await audit_service.record(
                    tenant_id=tenant_id,
                    project_id=None,
                    actor_id=None,
                    action="forge.spend.tenant_budget_exceeded",
                    target_type="tenant",
                    target_id=str(tenant_id),
                    payload={
                        "spent_usd": spent_usd,
                        "ceiling_usd": ceiling_usd,
                        "projected_cost_usd": est_cost_usd,
                    },
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "forge_budget_guard.tenant_audit_failed",
                    tenant_id=str(tenant_id),
                )
            # ponytail: 1h backoff — daily-burn-aware retry would need an
            # extra SUM query; bump when we have a daily-burn signal.
            raise TenantBudgetExceeded(
                tenant_id,
                spent_usd=spent_usd,
                ceiling_usd=ceiling_usd,
                retry_after_seconds=self.DEFAULT_RETRY_AFTER_SECONDS,
            )

        return {
            "allow": True,
            "spent_usd": spent_usd,
            "ceiling_usd": ceiling_usd,
            "pct": (spent_usd / ceiling_usd) if ceiling_usd > 0 else 0.0,
            "retry_after_seconds": 0,
        }


tenant_budget_guard = TenantBudgetGuard()


__all__ = [
    "AgentBudgetExceeded",
    "AgentBudgetWarning",
    "BudgetGuard",
    "TenantBudgetExceeded",
    "TenantBudgetGuard",
    "budget_guard",
    "tenant_budget_guard",
    "DEFAULT_BUDGET_USD",
]
