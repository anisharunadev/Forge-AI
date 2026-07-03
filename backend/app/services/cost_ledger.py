"""Cost ledger (DL-027 — append-only spend tracking).

The ledger writes one row per cost-incurring event and exposes
aggregations for tenant/project dashboards.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.models.cost import CostEntry
from app.db.session import get_session_factory

logger = get_logger(__name__)


class CostLedger:
    """Records and aggregates LLM/tool spend."""

    async def record(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        workflow_id: UUID | str | None,
        model: str | None,
        prompt_tokens: int,
        completion_tokens: int,
        cost_usd: float,
        source: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Append a single cost entry. Never updates/deletes existing rows."""
        factory = get_session_factory()
        async with factory() as session:
            entry = CostEntry(
                tenant_id=str(tenant_id),
                project_id=str(project_id) if project_id else None,
                workflow_id=str(workflow_id) if workflow_id else None,
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_usd=cost_usd,
                source=source,
                recorded_at=datetime.now(timezone.utc),
                metadata_=metadata or {},
            )
            session.add(entry)
            await session.commit()
            logger.info(
                "cost.recorded",
                tenant_id=str(tenant_id),
                model=model,
                cost_usd=cost_usd,
                source=source,
            )

    async def get_total_for_tenant(
        self,
        tenant_id: UUID | str,
        since: datetime,
        session: AsyncSession | None = None,
    ) -> float:
        """Sum of cost_usd for a tenant since `since`."""
        stmt = select(func.coalesce(func.sum(CostEntry.cost_usd), 0)).where(
            CostEntry.tenant_id == str(tenant_id),
            CostEntry.recorded_at >= since,
        )
        if session is not None:
            result = await session.scalar(stmt)
        else:
            factory = get_session_factory()
            async with factory() as s:
                result = await s.scalar(stmt)
        return float(result or 0)

    async def get_total_for_project(
        self,
        project_id: UUID | str,
        since: datetime,
        session: AsyncSession | None = None,
    ) -> float:
        """Sum of cost_usd for a project since `since`."""
        stmt = select(func.coalesce(func.sum(CostEntry.cost_usd), 0)).where(
            CostEntry.project_id == str(project_id),
            CostEntry.recorded_at >= since,
        )
        if session is not None:
            result = await session.scalar(stmt)
        else:
            factory = get_session_factory()
            async with s:
                result = await s.scalar(stmt)
        return float(result or 0)

    async def get_breakdown_by_model(
        self,
        tenant_id: UUID | str,
        since: datetime,
        session: AsyncSession | None = None,
    ) -> list[dict[str, Any]]:
        """Return [{model, cost_usd, prompt_tokens, completion_tokens}, ...]."""
        stmt = (
            select(
                CostEntry.model,
                func.coalesce(func.sum(CostEntry.cost_usd), 0).label("cost_usd"),
                func.coalesce(func.sum(CostEntry.prompt_tokens), 0).label("prompt_tokens"),
                func.coalesce(func.sum(CostEntry.completion_tokens), 0).label("completion_tokens"),
            )
            .where(
                CostEntry.tenant_id == str(tenant_id),
                CostEntry.recorded_at >= since,
            )
            .group_by(CostEntry.model)
            .order_by(func.sum(CostEntry.cost_usd).desc())
        )
        if session is not None:
            rows = (await session.execute(stmt)).all()
        else:
            factory = get_session_factory()
            async with factory() as s:
                rows = (await s.execute(stmt)).all()
        return [
            {
                "model": r.model,
                "cost_usd": float(r.cost_usd or 0),
                "prompt_tokens": int(r.prompt_tokens or 0),
                "completion_tokens": int(r.completion_tokens or 0),
            }
            for r in rows
        ]


# Module-level singleton for convenience (DI-friendly).
cost_ledger = CostLedger()


async def record_spend(
    *,
    tenant_id: UUID,
    project_id: UUID,
    agent_id: UUID,
    user_id: UUID,
    team_id: UUID | None,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    litellm_request_id: str,
    cost_usd: float,
):
    """Thin shim — forwards to SpendService.record_from_usage (step-75 F5)."""
    # ponytail: lazy import avoids circular spend ↔ ledger at module load
    from app.services.forge_spend import SpendService

    return await SpendService().record_from_usage(
        tenant_id=tenant_id,
        project_id=project_id,
        agent_id=agent_id,
        user_id=user_id,
        team_id=team_id,
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        litellm_request_id=litellm_request_id,
        cost_usd=cost_usd,
    )


__all__ = ["CostLedger", "cost_ledger", "record_spend"]
