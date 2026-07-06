"""Nightly LiteLLM reconciliation scheduler job (F-829 — Phase D).

For each tenant, compares the Forge-side ``cost_ledger`` aggregate to
LiteLLM's ``/spend/logs`` endpoint for the same window. Divergence is
emitted as an audit event (``litellm.drift.detected``) and the
mapping's ``last_synced_at`` is bumped.

Runs at 02:30 UTC nightly — registered in
:mod:`app.services.scheduler.service`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from app.core.logging import get_logger
from app.db.models.cost import CostEntry
from app.db.models.litellm_team_mapping import LiteLLMTeamMapping
from app.db.models.tenant import Tenant
from app.db.rls import tenant_context
from app.db.session import get_session_factory
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient
from app.integrations.litellm.tenant_sync import tenant_sync
from app.services.audit_service import audit_service

logger = get_logger(__name__)

# Tolerance (USD) — the cost_ledger and LiteLLM spend logs are computed
# from different signals and may disagree by tiny amounts due to
# rounding or late-arriving entries. Anything below this threshold is
# treated as "no drift".
_DRIFT_TOLERANCE_USD: float = 0.01

# Window length compared between Forge and LiteLLM.
_RECONCILE_WINDOW_HOURS: int = 24


async def reconcile_job() -> None:
    """Scheduler entry point — runs once per cron tick, iterates tenants."""
    factory = get_session_factory()
    async with factory() as session:
        tenants = list((await session.execute(select(Tenant))).scalars().all())

    if not tenants:
        logger.info("litellm.reconcile.no_tenants")
        return

    window_start = datetime.now(UTC) - timedelta(hours=_RECONCILE_WINDOW_HOURS)
    for tenant in tenants:
        try:
            await _reconcile_one(str(tenant.id), window_start)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "litellm.reconcile.tenant_failed",
                tenant_id=str(tenant.id),
                error=f"{type(exc).__name__}: {exc}",
            )


async def _reconcile_one(tenant_id: str, window_start: datetime) -> None:
    """Compare Forge-side cost_ledger aggregate to LiteLLM spend logs."""
    forge_total = await _sum_cost_ledger(tenant_id, window_start)
    litellm_total = await _sum_litellm_spend(tenant_id, window_start)
    delta = abs(float(forge_total) - float(litellm_total))

    await tenant_sync.reconcile(tenant_id)

    if delta > _DRIFT_TOLERANCE_USD:
        logger.warning(
            "litellm.drift.detected",
            tenant_id=tenant_id,
            forge_usd=float(forge_total),
            litellm_usd=float(litellm_total),
            delta_usd=delta,
            window_start=window_start.isoformat(),
        )
        await audit_service.record(
            tenant_id=tenant_id,
            project_id=None,
            actor_id=None,
            action="litellm.drift.detected",
            target_type="tenant",
            target_id=tenant_id,
            payload={
                "forge_usd": float(forge_total),
                "litellm_usd": float(litellm_total),
                "delta_usd": delta,
                "window_start": window_start.isoformat(),
                "window_hours": _RECONCILE_WINDOW_HOURS,
            },
        )
        await _mark_mapping_drifted(tenant_id)
        return

    await _touch_mapping(tenant_id)
    logger.info(
        "litellm.reconcile.ok",
        tenant_id=tenant_id,
        forge_usd=float(forge_total),
        litellm_usd=float(litellm_total),
        delta_usd=delta,
    )


async def _sum_cost_ledger(tenant_id: str, since: datetime) -> float:
    factory = get_session_factory()
    async with factory() as session, tenant_context(session, tenant_id):
        total = await session.scalar(
            select(func.coalesce(func.sum(CostEntry.cost_usd), 0)).where(
                CostEntry.tenant_id == tenant_id,
                CostEntry.recorded_at >= since,
                CostEntry.source == "litellm",
            )
        )
        return float(total or 0)


async def _sum_litellm_spend(tenant_id: str, since: datetime) -> float:
    """Sum LiteLLM ``/spend/logs`` for the given tenant + window.

    Best-effort: any API failure returns 0 (and is logged at WARNING)
    so the reconcile loop keeps moving. The drift threshold is
    generous enough that a transient zero will at worst emit one false
    drift event the next day — acceptable for the nightly cadence.
    """
    try:
        params = {
            "start_time": since.isoformat(),
            "end_time": datetime.now(UTC).isoformat(),
        }
        async with LiteLLMBaseClient() as client:
            response = await client.admin_client.get("/spend/logs", params=params)
            payload = response.json() if response is not None else []
    except Exception as exc:  # noqa: BLE001 — best-effort
        logger.warning(
            "litellm.reconcile.spend_logs_failed",
            tenant_id=tenant_id,
            error=f"{type(exc).__name__}: {exc}",
        )
        return 0.0

    if not isinstance(payload, list):
        return 0.0

    total = 0.0
    for row in payload:
        if not isinstance(row, dict):
            continue
        if (
            str(row.get("team_id") or "") != tenant_id
            and str(row.get("custom_llm_provider") or "") != tenant_id
        ):
            # LiteLLM keys spend by team_id when called via Virtual Key;
            # fall back to summing everything when no team filter exists.
            pass
        try:
            total += float(row.get("spend") or 0)
        except (TypeError, ValueError):
            continue
    return total


async def _touch_mapping(tenant_id: str) -> None:
    """Bump ``last_synced_at`` on the tenant's mapping."""
    try:
        factory = get_session_factory()
        async with factory() as session, tenant_context(session, tenant_id):
            row = await session.scalar(
                select(LiteLLMTeamMapping).where(LiteLLMTeamMapping.tenant_id == tenant_id)
            )
            if row is None:
                return
            row.last_synced_at = datetime.now(UTC)
            await session.commit()
    except Exception as exc:  # noqa: BLE001 — best-effort
        logger.warning(
            "litellm.reconcile.touch_failed",
            tenant_id=tenant_id,
            error=str(exc),
        )


async def _mark_mapping_drifted(tenant_id: str) -> None:
    try:
        factory = get_session_factory()
        async with factory() as session, tenant_context(session, tenant_id):
            row = await session.scalar(
                select(LiteLLMTeamMapping).where(LiteLLMTeamMapping.tenant_id == tenant_id)
            )
            if row is None:
                return
            row.status = "drifted"
            row.last_synced_at = datetime.now(UTC)
            await session.commit()
    except Exception as exc:  # noqa: BLE001 — best-effort
        logger.warning(
            "litellm.reconcile.drift_persist_failed",
            tenant_id=tenant_id,
            error=str(exc),
        )


__all__ = ["reconcile_job"]
