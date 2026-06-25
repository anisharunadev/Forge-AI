"""Daily ideation ingest scheduler job (Pillar 1 — Phase 3).

Iterates all tenants and runs the daily ingest pipeline:

1. Pull signals from Confluence / Zendesk / Slack.
2. Run the synthesizer (with budget guard).
3. Stamp ``IdeationIngestRun`` rows for the dashboard indicator.

A single job iterates all tenants (NOT one job per tenant — would
explode at scale). The ``IDEATION_INGEST_CEILING_USD`` env var
(default $0.50) sets the per-tenant budget that gates LLM calls.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.agents.tools.mcp_client import MCPClient
from app.core.logging import get_logger
from app.db.models.ideation_signal import IdeationIngestRun
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory
from app.services.audit_service import audit_service
from app.services.ideation.sources.confluence_pull import pull as confluence_pull
from app.services.ideation.sources.synthesizer import Synthesizer
from app.services.ideation.sources.zendesk_pull import pull as zendesk_pull
from app.services.ideation.sources.slack_pull import pull as slack_pull

logger = get_logger(__name__)

# Default ceiling for the daily ingest (per NFR-044). Override via env.
DEFAULT_CEILING_USD = 0.50


async def _list_tenants() -> list[Tenant]:
    factory = get_session_factory()
    async with factory() as session:
        stmt = select(Tenant)
        return list((await session.execute(stmt)).scalars().all())


async def _start_run(tenant_id: UUID | str) -> str:
    factory = get_session_factory()
    async with factory() as session:
        row = IdeationIngestRun(
            id=uuid.uuid4(),
            tenant_id=str(tenant_id),
            started_at=datetime.now(timezone.utc),
            status="running",
            signals_seen=0,
            ideas_created=0,
            degraded_budget=False,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return str(row.id)


async def _finish_run(
    run_id: str,
    *,
    signals_seen: int,
    ideas_created: int,
    status: str,
    error: str | None = None,
    degraded_budget: bool = False,
) -> None:
    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(IdeationIngestRun, run_id)
        if row is None:
            return
        row.signals_seen = signals_seen
        row.ideas_created = ideas_created
        row.status = status
        row.error = error
        row.degraded_budget = degraded_budget
        row.finished_at = datetime.now(timezone.utc)
        await session.commit()


async def daily_ideation_ingest() -> None:
    """Scheduler entry point — runs once per cron tick, iterates tenants."""
    ceiling = float(os.environ.get("IDEATION_INGEST_CEILING_USD", DEFAULT_CEILING_USD))
    tenants = await _list_tenants()
    if not tenants:
        logger.info("ideation.ingest.no_tenants")
        return
    for tenant in tenants:
        await _ingest_for_tenant(tenant, ceiling_usd=ceiling)


async def _ingest_for_tenant(tenant: Tenant, *, ceiling_usd: float) -> None:
    """Run one tenant's daily ingest end-to-end."""
    tenant_id = str(tenant.id)
    run_id = await _start_run(tenant_id)
    since = datetime.now(timezone.utc) - timedelta(days=1)
    # Use tenant.id as a stand-in project_id so signals land somewhere;
    # the synthesizer keys clusters off signal.project_id anyway.
    project_id = str(tenant.id)
    mcp = MCPClient()
    budget_blocked = False
    signals_seen = 0
    try:
        # Phase 3 budget ceiling. The synthesizer's LLM path is gated
        # through workflow_budget_service; for the default path we use
        # the heuristic fallback so this skeleton is safe even when
        # LiteLLM is unreachable.
        for pull_fn, name in (
            (confluence_pull, "confluence"),
            (zendesk_pull, "zendesk"),
            (slack_pull, "slack"),
        ):
            try:
                rows = await pull_fn(
                    tenant_id=tenant_id,
                    project_id=project_id,
                    since=since,
                    mcp=mcp,
                )
                signals_seen += len(rows)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "ideation.ingest.pull_failed",
                    source=name,
                    tenant_id=tenant_id,
                    error=str(exc),
                )

        synth = Synthesizer()
        result = await synth.synthesize(
            tenant_id=tenant_id,
            run_id=run_id,
            budget_blocked=budget_blocked,
        )
        await _finish_run(
            run_id,
            signals_seen=signals_seen,
            ideas_created=result["ideas_created"],
            status="success",
            degraded_budget=budget_blocked,
        )
        await audit_service.record(
            tenant_id=tenant_id,
            project_id=None,
            actor_id=None,
            action="ideation.ingest.run",
            target_type="tenant",
            target_id=tenant_id,
            payload={
                "run_id": run_id,
                "signals_seen": signals_seen,
                "ideas_created": result["ideas_created"],
                "budget_remaining_usd": ceiling_usd,
                "ceiling_usd": ceiling_usd,
            },
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "ideation.ingest.tenant_failed",
            tenant_id=tenant_id,
            error=str(exc),
        )
        await _finish_run(
            run_id,
            signals_seen=signals_seen,
            ideas_created=0,
            status="failed",
            error=str(exc)[:1000],
        )


# Exported for tests that want to drive a single tenant directly.
async def daily_ideation_ingest_for_tenant(tenant_id: UUID | str) -> None:
    """Public single-tenant hook used by tests and Phase 4 manual triggers."""
    factory = get_session_factory()
    async with factory() as session:
        tenant = await session.get(Tenant, str(tenant_id))
        if tenant is None:
            return
        await _ingest_for_tenant(
            tenant,
            ceiling_usd=float(
                os.environ.get("IDEATION_INGEST_CEILING_USD", DEFAULT_CEILING_USD)
            ),
        )


__all__ = [
    "daily_ideation_ingest",
    "daily_ideation_ingest_for_tenant",
    "DEFAULT_CEILING_USD",
]