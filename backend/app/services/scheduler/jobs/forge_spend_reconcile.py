"""5-minute spend reconciliation scheduler job (step-75 F5).

For each tenant (or a single tenant if the scheduler passes one), pull
``/spend/logs`` since ``now - 5 min`` and upsert into ``spend_records``.
Emits a ``forge.spend.reconciled`` audit event with counters.

Runs at ``*/5 * * * *`` — registered in :mod:`app.services.scheduler.service`.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Iterable

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory
from app.services.audit_service import audit_service

logger = get_logger(__name__)

_RECONCILE_LOOKBACK_MINUTES: int = int(
    os.environ.get("FORGE_SPEND_RECONCILE_LOOKBACK_MIN", "5")
)


async def run(tenant_id: str | None = None) -> None:
    """Scheduler entry point — runs once per cron tick.

    If ``tenant_id`` is provided, reconciles only that tenant. Otherwise
    iterates all known tenants. Failures on one tenant do not stop the loop.
    """
    now = datetime.now(timezone.utc)
    last_sync = now - timedelta(minutes=_RECONCILE_LOOKBACK_MINUTES)

    # ponytail: lazy import avoids scheduler -> spend_service -> scheduler cycles
    from app.services.forge_spend import SpendService

    spend_service = SpendService()

    tenants: Iterable[str]
    if tenant_id is not None:
        tenants = [tenant_id]
    else:
        factory = get_session_factory()
        async with factory() as session:
            tenants = [str(t.id) for t in (await session.execute(select(Tenant))).scalars().all()]

    if not tenants:
        logger.info("forge.spend.reconcile.no_tenants")
        return

    for tid in tenants:
        try:
            result = await spend_service.reconcile(last_sync=last_sync)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "forge.spend.reconcile.tenant_failed",
                tenant_id=tid,
                error=f"{type(exc).__name__}: {exc}",
            )
            continue

        rows_upserted = int(result.get("rows_upserted", 0))
        rows_inserted = int(result.get("rows_inserted", 0))
        drift_count = int(result.get("drift_count", 0))

        logger.info(
            "forge.spend.reconciled",
            tenant_id=tid,
            rows_upserted=rows_upserted,
            rows_inserted=rows_inserted,
            drift_count=drift_count,
            window_start=last_sync.isoformat(),
        )
        try:
            await audit_service.record(
                tenant_id=tid,
                project_id=None,
                actor_id=None,
                action="forge.spend.reconciled",
                target_type="tenant",
                target_id=tid,
                payload={
                    "rows_upserted": rows_upserted,
                    "rows_inserted": rows_inserted,
                    "drift_count": drift_count,
                    "window_start": last_sync.isoformat(),
                    "window_end": now.isoformat(),
                },
            )
        except Exception as exc:  # noqa: BLE001 — audit is best-effort
            logger.warning(
                "forge.spend.reconcile.audit_failed",
                tenant_id=tid,
                error=str(exc),
            )


__all__ = ["run"]
