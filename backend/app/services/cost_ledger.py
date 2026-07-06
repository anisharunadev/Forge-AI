"""Cost ledger (DL-027 — append-only spend tracking).

ADR-009 governs the schema: every row carries ``run_id``, ``agent``,
``projected`` so the cumulative-cap rule can sum confirmed spend per
run. The service exposes two write paths:

- :meth:`CostLedger.record_projected` — pre-call reservation row
  (``projected=True``). Does NOT count toward the cap.
- :meth:`CostLedger.record_actual` — post-call settlement row
  (``projected=False``). DOES count toward the cap.

:meth:`CostLedger.sum_spent_for_run` is the building block for the
cumulative-cap rule.

The legacy :meth:`CostLedger.record` is preserved as a thin shim that
calls :meth:`record_actual` so existing tool spend callers
(terminal, ideation services, project-intelligence QA) keep working
without modification during the M2 cut-over. New code MUST use the
explicit ``record_projected`` / ``record_actual`` split.
"""

from __future__ import annotations

from datetime import UTC, datetime
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

    async def record_projected(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        run_id: UUID | str,
        agent: str,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        cost_usd: float,
        source: str = "litellm",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Append a pre-call projected cost row.

        Keyword-only contract (Rule 2): every caller MUST supply the
        binding identity (``tenant_id``, ``project_id``, ``run_id``,
        ``agent``) by keyword — a positional call is a bug.

        ``projected=True`` distinguishes this row from an
        ``record_actual`` settlement. The cumulative-cap rule filters
        on ``projected=False`` so projections never consume the
        budget on their own.
        """
        await self._insert(
            tenant_id=tenant_id,
            project_id=project_id,
            run_id=run_id,
            agent=agent,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=cost_usd,
            source=source,
            projected=True,
            metadata=metadata,
        )

    async def record_actual(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        run_id: UUID | str,
        agent: str,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        cost_usd: float,
        source: str = "litellm",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Append a post-call actual cost row (settles the projection).

        Keyword-only contract (Rule 2): same as
        :meth:`record_projected`. ``projected=False`` so the
        cumulative-cap rule picks this row up.
        """
        await self._insert(
            tenant_id=tenant_id,
            project_id=project_id,
            run_id=run_id,
            agent=agent,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=cost_usd,
            source=source,
            projected=False,
            metadata=metadata,
        )

    async def _insert(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None,
        run_id: UUID | str | None,
        agent: str | None,
        model: str | None,
        prompt_tokens: int,
        completion_tokens: int,
        cost_usd: float,
        source: str,
        projected: bool,
        metadata: dict[str, Any] | None,
    ) -> None:
        """Shared INSERT path for projected + actual rows.

        Append-only invariant (ADR-008 inheritance): never UPDATE
        or DELETE a cost row.
        """
        factory = get_session_factory()
        async with factory() as session:
            entry = CostEntry(
                tenant_id=str(tenant_id),
                project_id=str(project_id) if project_id else None,
                workflow_id=None,
                run_id=str(run_id) if run_id else None,
                agent=agent,
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_usd=cost_usd,
                source=source,
                projected=projected,
                recorded_at=datetime.now(UTC),
                metadata_=metadata or {},
            )
            session.add(entry)
            await session.commit()
            logger.info(
                "cost.recorded",
                tenant_id=str(tenant_id),
                run_id=str(run_id) if run_id else None,
                agent=agent,
                model=model,
                cost_usd=cost_usd,
                projected=projected,
                source=source,
            )

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
        """Legacy single-shot append — preserves pre-M2 call sites.

        Existing tool spend callers (``app/services/ideation/*``,
        ``app/services/project_intelligence/qa.py``,
        ``app/services/terminal/cost_tracker.py``) call
        :meth:`record` without ``run_id`` / ``agent``. During the M2
        cut-over we keep this method working as a thin shim that
        delegates to :meth:`record_actual` with the new fields set
        to ``None`` — those rows remain non-RUN-scoped and the
        cumulative cap rule ignores them.

        New code MUST use :meth:`record_projected` /
        :meth:`record_actual` directly.
        """
        await self._insert(
            tenant_id=tenant_id,
            project_id=project_id,
            run_id=None,
            agent=None,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=cost_usd,
            source=source,
            projected=False,
            metadata=metadata,
        )

    async def sum_spent_for_run(
        self,
        run_id: UUID | str,
        *,
        session: AsyncSession | None = None,
    ) -> float:
        """Sum of confirmed (``projected=False``) ``cost_usd`` for a run.

        Building block for the cumulative-cap rule (ADR-009
        Appendix B). Returns 0.0 when no rows exist — callers can
        treat zero as "no spend yet" without a None check.
        """
        run_uuid = str(run_id)
        stmt = select(func.coalesce(func.sum(CostEntry.cost_usd), 0)).where(
            CostEntry.run_id == run_uuid,
            CostEntry.projected.is_(False),
        )
        if session is not None:
            result = await session.scalar(stmt)
        else:
            factory = get_session_factory()
            async with factory() as s:
                result = await s.scalar(stmt)
        return float(result or 0)

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
            async with factory() as s:
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


__all__ = [
    "CostLedger",
    "cost_ledger",
    "record_spend",
]
