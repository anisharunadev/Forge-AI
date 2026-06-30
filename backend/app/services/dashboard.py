"""F-014 — Dashboard aggregation service (step-57).

The dashboard reads from many different tables. This service fans out
to the canonical sources (audit_events, run_records, agents, runs, etc.)
and projects the result into the flat shape the UI expects.

Rule 2 — every aggregation filters by `tenant_id` from the JWT.
Rule 6 — aggregations are read-only; we never mutate audit / run data.
Rule 4 — outputs are typed artifacts (Pydantic schemas), not free-form
JSON.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.agent import Agent, AgentStatus
from app.db.models.approval import ApprovalRequest, ApprovalStatus
from app.db.models.audit import AuditEvent
from app.db.models.cost import CostEntry
from app.db.models.dashboard import (
    AIInsight,
    AIInsightRead,
    DashboardLayoutRow,
    PinnedItem,
)
from app.db.models.ideation import Idea
from app.db.models.litellm_call_record import LiteLLMCallRecord
from app.db.models.model_provider import ModelProvider
from app.schemas.dashboard import (
    AIInsightRead as AIInsightReadSchema,
    AlertRead,
    AlertSeverity,
    AlertType,
    CostByDayPoint,
    CostByModelRow,
    DashboardKPIs,
    DashboardLayout,
    DashboardWidget,
    PinnedItemCreate,
    PinnedItemRead,
    RunsByDayPoint,
    TeamActivity,
    TopAgentRow,
    TopProviderRow,
    TopWorkflowRow,
)


# ---------------------------------------------------------------------------
# Default layout (engineering_lead preset) — used the first time a user
# visits the dashboard so the page never renders blank.
# ---------------------------------------------------------------------------

DEFAULT_WIDGETS: list[dict[str, Any]] = [
    {"type": "kpi_strip", "enabled": True, "position": 0, "config": {}},
    {"type": "live_activity", "enabled": True, "position": 1, "config": {}},
    {"type": "your_agents", "enabled": True, "position": 1, "config": {}},
    {"type": "todays_runs", "enabled": True, "position": 1, "config": {}},
    {"type": "cost_breakdown", "enabled": True, "position": 2, "config": {}},
    {"type": "runs_overtime", "enabled": True, "position": 2, "config": {}},
    {"type": "top_agents", "enabled": True, "position": 2, "config": {}},
    {"type": "pending_approvals", "enabled": True, "position": 3, "config": {}},
    {"type": "recent_ideas", "enabled": True, "position": 3, "config": {}},
    {"type": "ai_insights", "enabled": True, "position": 4, "config": {}},
    {"type": "personal_stats", "enabled": False, "position": 4, "config": {}},
    {"type": "pinned", "enabled": True, "position": 5, "config": {}},
    {"type": "quick_actions", "enabled": True, "position": 5, "config": {}},
    {"type": "team_activity", "enabled": True, "position": 6, "config": {}},
    {"type": "recent_alerts", "enabled": True, "position": 7, "config": {}},
]


def _empty_actor_name(actor_id: UUID | None) -> str:
    return "System" if actor_id is None else "Operator"


class DashboardService:
    """Pure aggregation — no I/O outside the database session."""

    # -----------------------------------------------------------------------
    # KPIs
    # -----------------------------------------------------------------------

    async def compute_kpis(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
    ) -> DashboardKPIs:
        now = datetime.now(timezone.utc)
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        yesterday_start = today_start - timedelta(days=1)
        week_start = today_start - timedelta(days=7)

        # Agent counts (status='enabled' = active per backend convention).
        agent_total = (await db.execute(
            select(func.count(Agent.id)).where(Agent.tenant_id == tenant_id)
        )).scalar_one()
        agent_active = (await db.execute(
            select(func.count(Agent.id)).where(
                and_(Agent.tenant_id == tenant_id, Agent.status == AgentStatus.ENABLED)
            )
        )).scalar_one()

        # Run metrics — runs table may not exist in every dev env, so we
        # default to 0s when no rows come back. The day buckets come from
        # the audit log fallback (every run start writes a `runs.start`
        # audit event).
        runs_today = (await db.execute(
            select(func.count(AuditEvent.id)).where(
                and_(
                    AuditEvent.tenant_id == tenant_id,
                    AuditEvent.action.like("run.%"),
                    AuditEvent.occurred_at >= today_start,
                )
            )
        )).scalar_one() or 0
        runs_yesterday = (await db.execute(
            select(func.count(AuditEvent.id)).where(
                and_(
                    AuditEvent.tenant_id == tenant_id,
                    AuditEvent.action.like("run.%"),
                    AuditEvent.occurred_at >= yesterday_start,
                    AuditEvent.occurred_at < today_start,
                )
            )
        )).scalar_one() or 0
        runs_week = (await db.execute(
            select(func.count(AuditEvent.id)).where(
                and_(
                    AuditEvent.tenant_id == tenant_id,
                    AuditEvent.action.like("run.%"),
                    AuditEvent.occurred_at >= week_start,
                )
            )
        )).scalar_one() or 0

        # Success rate — count run.success / run.*  in last 7 days.
        succ = (await db.execute(
            select(func.count(AuditEvent.id)).where(
                and_(
                    AuditEvent.tenant_id == tenant_id,
                    AuditEvent.action.in_([
                        "run.success", "run.completed", "run.finished",
                    ]),
                    AuditEvent.occurred_at >= week_start,
                )
            )
        )).scalar_one() or 0
        fail = (await db.execute(
            select(func.count(AuditEvent.id)).where(
                and_(
                    AuditEvent.tenant_id == tenant_id,
                    AuditEvent.action.in_(["run.failed", "run.error"]),
                    AuditEvent.occurred_at >= week_start,
                )
            )
        )).scalar_one() or 0
        success_rate = (succ / (succ + fail) * 100) if (succ + fail) > 0 else 0.0

        # Cost (last 24h) — sum of CostEntry rows.
        cost_today = (await db.execute(
            select(func.coalesce(func.sum(CostEntry.amount_usd), 0.0)).where(
                and_(
                    CostEntry.tenant_id == tenant_id,
                    CostEntry.occurred_at >= today_start,
                )
            )
        )).scalar_one() or 0.0
        cost_week = (await db.execute(
            select(func.coalesce(func.sum(CostEntry.amount_usd), 0.0)).where(
                and_(
                    CostEntry.tenant_id == tenant_id,
                    CostEntry.occurred_at >= week_start,
                )
            )
        )).scalar_one() or 0.0

        # Tokens (last 24h).
        tokens_today = (await db.execute(
            select(func.coalesce(func.sum(CostEntry.total_tokens), 0)).where(
                and_(
                    CostEntry.tenant_id == tenant_id,
                    CostEntry.occurred_at >= today_start,
                )
            )
        )).scalar_one() or 0
        input_tokens_today = (await db.execute(
            select(func.coalesce(func.sum(CostEntry.input_tokens), 0)).where(
                and_(
                    CostEntry.tenant_id == tenant_id,
                    CostEntry.occurred_at >= today_start,
                )
            )
        )).scalar_one() or 0
        output_tokens_today = (await db.execute(
            select(func.coalesce(func.sum(CostEntry.output_tokens), 0)).where(
                and_(
                    CostEntry.tenant_id == tenant_id,
                    CostEntry.occurred_at >= today_start,
                )
            )
        )).scalar_one() or 0

        # Approvals.
        pending_approvals = (await db.execute(
            select(func.count(ApprovalRequest.id)).where(
                and_(
                    ApprovalRequest.tenant_id == tenant_id,
                    ApprovalRequest.status == ApprovalStatus.PENDING,
                )
            )
        )).scalar_one() or 0

        # Ideas (last 7d).
        ideas_week = (await db.execute(
            select(func.count(Idea.id)).where(
                and_(Idea.tenant_id == tenant_id, Idea.created_at >= week_start)
            )
        )).scalar_one() or 0
        ideas_scored = (await db.execute(
            select(func.count(Idea.id)).where(
                and_(
                    Idea.tenant_id == tenant_id,
                    Idea.tenant_id == tenant_id,
                )
            )
        )).scalar_one() or 0

        # Time-series — bucket by day for the last 7 days.
        runs_by_day: list[RunsByDayPoint] = []
        for offset in range(6, -1, -1):
            day_start = today_start - timedelta(days=offset)
            day_end = day_start + timedelta(days=1)
            day_count = (await db.execute(
                select(func.count(AuditEvent.id)).where(
                    and_(
                        AuditEvent.tenant_id == tenant_id,
                        AuditEvent.action.like("run.%"),
                        AuditEvent.occurred_at >= day_start,
                        AuditEvent.occurred_at < day_end,
                    )
                )
            )).scalar_one() or 0
            day_succ = (await db.execute(
                select(func.count(AuditEvent.id)).where(
                    and_(
                        AuditEvent.tenant_id == tenant_id,
                        AuditEvent.action.in_([
                            "run.success", "run.completed", "run.finished",
                        ]),
                        AuditEvent.occurred_at >= day_start,
                        AuditEvent.occurred_at < day_end,
                    )
                )
            )).scalar_one() or 0
            day_fail = (await db.execute(
                select(func.count(AuditEvent.id)).where(
                    and_(
                        AuditEvent.tenant_id == tenant_id,
                        AuditEvent.action.in_(["run.failed", "run.error"]),
                        AuditEvent.occurred_at >= day_start,
                        AuditEvent.occurred_at < day_end,
                    )
                )
            )).scalar_one() or 0
            runs_by_day.append(RunsByDayPoint(
                date=day_start.date().isoformat(),
                count=int(day_count),
                success=int(day_succ),
                failed=int(day_fail),
            ))

        # Cost by day (last 7 days) and by model (last 24h).
        cost_by_day: list[CostByDayPoint] = []
        for offset in range(6, -1, -1):
            day_start = today_start - timedelta(days=offset)
            day_end = day_start + timedelta(days=1)
            day_amount = (await db.execute(
                select(func.coalesce(func.sum(CostEntry.amount_usd), 0.0)).where(
                    and_(
                        CostEntry.tenant_id == tenant_id,
                        CostEntry.occurred_at >= day_start,
                        CostEntry.occurred_at < day_end,
                    )
                )
            )).scalar_one() or 0.0
            cost_by_day.append(CostByDayPoint(
                date=day_start.date().isoformat(),
                amount=float(day_amount),
            ))

        cost_by_model_rows = (await db.execute(
            select(
                CostEntry.model,
                func.coalesce(func.sum(CostEntry.amount_usd), 0.0).label("amount"),
                func.coalesce(func.sum(CostEntry.total_tokens), 0).label("tokens"),
            )
            .where(
                and_(
                    CostEntry.tenant_id == tenant_id,
                    CostEntry.occurred_at >= today_start,
                )
            )
            .group_by(CostEntry.model)
            .order_by(func.sum(CostEntry.amount_usd).desc())
        )).all()
        cost_by_model = [
            CostByModelRow(model=row.model, amount=float(row.amount), tokens=int(row.tokens))
            for row in cost_by_model_rows
        ]

        # Top agents — count of run.* events per agent target_id in the
        # last 7 days. We can't group by agent name without a join, so
        # we project via Agent.name.
        top_agents_rows = (await db.execute(
            select(
                AuditEvent.target_id,
                func.count(AuditEvent.id).label("runs"),
            )
            .where(
                and_(
                    AuditEvent.tenant_id == tenant_id,
                    AuditEvent.action.like("run.%"),
                    AuditEvent.target_type == "agent",
                    AuditEvent.occurred_at >= week_start,
                )
            )
            .group_by(AuditEvent.target_id)
            .order_by(func.count(AuditEvent.id).desc())
            .limit(5)
        )).all()
        top_agents: list[TopAgentRow] = []
        for row in top_agents_rows:
            # Look up the agent's display name (best effort).
            name = row.target_id
            try:
                agent_uuid = UUID(row.target_id)
                agent = (await db.execute(
                    select(Agent).where(
                        and_(Agent.tenant_id == tenant_id, Agent.id == agent_uuid)
                    )
                )).scalar_one_or_none()
                if agent is not None:
                    name = agent.name
            except (ValueError, TypeError):
                pass
            top_agents.append(TopAgentRow(
                id=str(row.target_id),
                name=name,
                runs=int(row.runs),
                success_rate=success_rate,  # Approximated — full per-agent success rate requires extra join.
            ))

        # Top workflows — same shape, target_type=workflow.
        top_workflows_rows = (await db.execute(
            select(
                AuditEvent.target_id,
                func.count(AuditEvent.id).label("runs"),
            )
            .where(
                and_(
                    AuditEvent.tenant_id == tenant_id,
                    AuditEvent.action.like("run.%"),
                    AuditEvent.target_type == "workflow",
                    AuditEvent.occurred_at >= week_start,
                )
            )
            .group_by(AuditEvent.target_id)
            .order_by(func.count(AuditEvent.id).desc())
            .limit(5)
        )).all()
        top_workflows = [
            TopWorkflowRow(
                id=str(row.target_id),
                name=str(row.target_id),
                runs=int(row.runs),
                avg_duration=0.0,
            )
            for row in top_workflows_rows
        ]

        return DashboardKPIs(
            active_agents=int(agent_active),
            total_agents=int(agent_total),
            runs_today=int(runs_today),
            runs_yesterday=int(runs_yesterday),
            runs_this_week=int(runs_week),
            success_rate=round(float(success_rate), 1),
            avg_duration_seconds=0.0,
            total_cost_today=float(cost_today),
            daily_cost_cap=50.0,
            total_tokens_today=int(tokens_today),
            input_tokens_today=int(input_tokens_today),
            output_tokens_today=int(output_tokens_today),
            pending_approvals=int(pending_approvals),
            critical_approvals=0,
            ideas_this_week=int(ideas_week),
            ideas_scored=int(ideas_scored),
            runs_by_day=runs_by_day,
            cost_by_day=cost_by_day,
            cost_by_model=cost_by_model,
            top_agents=top_agents,
            top_workflows=top_workflows,
            generated_at=now,
        )

    # -----------------------------------------------------------------------
    # Top providers — model+provider rollup over LLM traffic
    # -----------------------------------------------------------------------
    #
    # Source of truth is `litellm_call_records` (one row per call
    # through Forge's LLM client). We aggregate by model and join
    # `ModelProvider` on `litellm_model_alias` to attach a human-readable
    # display name. Calls with no matching provider are still surfaced
    # under `provider_name="Unknown"` so the UI never silently drops
    # traffic.
    #
    # All aggregation filters on `tenant_id` (Rule 2). The widget is
    # tenant-wide by design — provider config is an org-level concern,
    # not a per-project one.

    async def compute_top_providers(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        days: int = 7,
        limit: int = 10,
    ) -> list[TopProviderRow]:
        since = datetime.now(timezone.utc) - timedelta(days=max(1, days))

        # Pull all configured providers for the tenant so we can
        # resolve names even when the call volume for a model is low.
        provider_rows = (await db.execute(
            select(ModelProvider).where(ModelProvider.tenant_id == tenant_id)
        )).scalars().all()
        providers_by_alias: dict[str, ModelProvider] = {
            p.litellm_model_alias: p for p in provider_rows
        }

        # Aggregate LLM calls by model over the window.
        agg_rows = (await db.execute(
            select(
                LiteLLMCallRecord.model.label("model"),
                func.count(LiteLLMCallRecord.id).label("run_count"),
                func.coalesce(func.sum(LiteLLMCallRecord.cost_usd), 0.0).label("total_cost"),
                func.coalesce(func.avg(LiteLLMCallRecord.latency_ms), 0.0).label("avg_latency_ms"),
                func.sum(
                    case(
                        (LiteLLMCallRecord.status == "success", 1),
                        else_=0,
                    )
                ).label("success_count"),
            )
            .where(
                and_(
                    LiteLLMCallRecord.tenant_id == tenant_id,
                    LiteLLMCallRecord.occurred_at >= since,
                )
            )
            .group_by(LiteLLMCallRecord.model)
            .order_by(func.count(LiteLLMCallRecord.id).desc())
            .limit(limit)
        )).all()

        results: list[TopProviderRow] = []
        for row in agg_rows:
            model_alias = row.model
            provider = providers_by_alias.get(model_alias)
            run_count = int(row.run_count or 0)
            success_count = int(row.success_count or 0)
            success_rate = (success_count / run_count * 100.0) if run_count else 0.0
            results.append(TopProviderRow(
                model=model_alias,
                provider_id=str(provider.id) if provider is not None else None,
                provider_name=provider.name if provider is not None else "Unknown",
                provider_type=provider.type.value if provider is not None else None,
                run_count=run_count,
                total_cost=float(row.total_cost or 0.0),
                avg_duration_seconds=float(row.avg_latency_ms or 0.0) / 1000.0,
                success_rate=round(float(success_rate), 2),
                enabled=bool(provider.enabled) if provider is not None else True,
            ))
        return results

    # -----------------------------------------------------------------------
    # Team activity — last N audit events
    # -----------------------------------------------------------------------

    async def list_activity(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        since: datetime | None = None,
        actor_id: UUID | None = None,
        limit: int = 50,
    ) -> list[TeamActivity]:
        if since is None:
            since = datetime.now(timezone.utc) - timedelta(hours=24)
        stmt = (
            select(AuditEvent)
            .where(
                and_(
                    AuditEvent.tenant_id == tenant_id,
                    AuditEvent.occurred_at >= since,
                )
            )
            .order_by(AuditEvent.occurred_at.desc())
            .limit(limit)
        )
        if actor_id is not None:
            stmt = stmt.where(AuditEvent.actor_id == actor_id)
        rows = (await db.execute(stmt)).scalars().all()
        out: list[TeamActivity] = []
        for r in rows:
            payload = r.payload or {}
            out.append(TeamActivity(
                id=str(r.id),
                tenant_id=tenant_id,
                actor_id=r.actor_id,
                actor_name=str(payload.get("actor_name") or _empty_actor_name(r.actor_id)),
                actor_avatar_url=payload.get("actor_avatar_url"),
                action=str(payload.get("action") or r.action),
                target_type=r.target_type,  # type: ignore[arg-type]
                target_id=r.target_id,
                target_name=str(payload.get("target_name") or r.target_id),
                metadata=payload,
                created_at=r.occurred_at,
            ))
        return out

    # -----------------------------------------------------------------------
    # Pinned items — per-user CRUD
    # -----------------------------------------------------------------------

    async def list_pins(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        user_id: UUID,
    ) -> list[PinnedItemRead]:
        rows = (await db.execute(
            select(PinnedItem)
            .where(
                and_(
                    PinnedItem.tenant_id == tenant_id,
                    PinnedItem.user_id == user_id,
                )
            )
            .order_by(PinnedItem.sort_order.asc(), PinnedItem.created_at.asc())
        )).scalars().all()
        return [PinnedItemRead.model_validate(r) for r in rows]

    async def create_pin(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        user_id: UUID,
        body: PinnedItemCreate,
    ) -> PinnedItemRead:
        # Append — default to the next sort_order.
        max_order = (await db.execute(
            select(func.coalesce(func.max(PinnedItem.sort_order), -1)).where(
                and_(
                    PinnedItem.tenant_id == tenant_id,
                    PinnedItem.user_id == user_id,
                )
            )
        )).scalar_one() or -1
        pin = PinnedItem(
            tenant_id=tenant_id,
            user_id=user_id,
            item_type=body.item_type,
            item_id=body.item_id,
            item_data=body.item_data,
            sort_order=body.sort_order if body.sort_order is not None else int(max_order) + 1,
            created_at=datetime.now(timezone.utc),
        )
        db.add(pin)
        await db.commit()
        await db.refresh(pin)
        return PinnedItemRead.model_validate(pin)

    async def delete_pin(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        user_id: UUID,
        pin_id: UUID,
    ) -> None:
        pin = (await db.execute(
            select(PinnedItem).where(
                and_(
                    PinnedItem.tenant_id == tenant_id,
                    PinnedItem.user_id == user_id,
                    PinnedItem.id == pin_id,
                )
            )
        )).scalar_one_or_none()
        if pin is not None:
            await db.delete(pin)
            await db.commit()

    async def reorder_pins(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        user_id: UUID,
        items: list[dict[str, Any]],
    ) -> None:
        for entry in items:
            try:
                pin_uuid = UUID(str(entry["id"]))
            except (KeyError, ValueError, TypeError):
                continue
            sort_order = int(entry.get("sort_order", 0))
            pin = (await db.execute(
                select(PinnedItem).where(
                    and_(
                        PinnedItem.tenant_id == tenant_id,
                        PinnedItem.user_id == user_id,
                        PinnedItem.id == pin_uuid,
                    )
                )
            )).scalar_one_or_none()
            if pin is not None:
                pin.sort_order = sort_order
        await db.commit()

    # -----------------------------------------------------------------------
    # AI insights
    # -----------------------------------------------------------------------

    async def list_insights(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        user_id: UUID,
        limit: int = 10,
    ) -> list[AIInsightReadSchema]:
        # Tenant-wide insights plus per-user insights.
        stmt = (
            select(AIInsight)
            .where(
                and_(
                    AIInsight.tenant_id == tenant_id,
                    (AIInsight.user_id.is_(None)) | (AIInsight.user_id == user_id),
                )
            )
            .order_by(AIInsight.created_at.desc())
            .limit(limit)
        )
        rows = (await db.execute(stmt)).scalars().all()
        # Annotate with read state for this user.
        read_ids = set((await db.execute(
            select(AIInsightRead.insight_id).where(
                and_(
                    AIInsightRead.user_id == user_id,
                    AIInsightRead.insight_id.in_([r.id for r in rows]) or True,
                )
            )
        )).scalars().all())
        out: list[AIInsightReadSchema] = []
        for r in rows:
            out.append(AIInsightReadSchema(
                id=r.id,
                tenant_id=tenant_id,
                user_id=r.user_id,
                title=r.title,
                body=r.body,
                category=r.category,  # type: ignore[arg-type]
                severity=r.severity,  # type: ignore[arg-type]
                related_entities=list(r.related_entities or []),
                action_url=r.action_url,
                action_label=r.action_label,
                created_at=r.created_at,
                read_at=datetime.now(timezone.utc) if r.id in read_ids else None,
            ))
        return out

    async def mark_insight_read(
        self,
        db: AsyncSession,
        *,
        user_id: UUID,
        insight_id: UUID,
    ) -> None:
        existing = (await db.execute(
            select(AIInsightRead).where(
                and_(
                    AIInsightRead.user_id == user_id,
                    AIInsightRead.insight_id == insight_id,
                )
            )
        )).scalar_one_or_none()
        if existing is None:
            db.add(AIInsightRead(
                user_id=user_id,
                insight_id=insight_id,
                read_at=datetime.now(timezone.utc),
            ))
            await db.commit()

    async def dismiss_insight(
        self,
        db: AsyncSession,
        *,
        user_id: UUID,
        insight_id: UUID,
    ) -> None:
        # Same implementation as mark_read — the UI removes the insight
        # from the local cache, and we record the read state for the
        # backend. Future iterations can introduce a `dismissed_at`
        # column on AIInsightRead to model a stronger filter.
        await self.mark_insight_read(db, user_id=user_id, insight_id=insight_id)

    # -----------------------------------------------------------------------
    # Alerts — derived from audit events tagged with severity metadata.
    # -----------------------------------------------------------------------

    async def list_alerts(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        unread_only: bool = False,
        severity: AlertSeverity | None = None,
        limit: int = 25,
    ) -> list[AlertRead]:
        # We model alerts as a small set of recent failure / cost
        # audit events. This is intentionally a thin projection so the
        # UI can render the tile without a second endpoint.
        stmt = (
            select(AuditEvent)
            .where(
                and_(
                    AuditEvent.tenant_id == tenant_id,
                    AuditEvent.action.in_([
                        "run.failed", "run.error",
                        "policy.violation",
                        "cost.threshold",
                        "approval.requested",
                    ]),
                    AuditEvent.occurred_at >= datetime.now(timezone.utc) - timedelta(days=7),
                )
            )
            .order_by(AuditEvent.occurred_at.desc())
            .limit(limit)
        )
        if unread_only:
            stmt = stmt.where(AuditEvent.payload["read_at"].astext.is_(None))
        rows = (await db.execute(stmt)).scalars().all()
        out: list[AlertRead] = []
        for r in rows:
            payload = r.payload or {}
            sev = str(payload.get("severity") or ("critical" if r.action in {"run.error", "policy.violation"} else "warning"))
            if severity is not None and sev != severity:
                continue
            alert_type: AlertType
            if r.action == "policy.violation":
                alert_type = "compliance"
            elif r.action == "cost.threshold":
                alert_type = "cost"
            elif r.action == "approval.requested":
                alert_type = "approval"
            else:
                alert_type = "failure"
            out.append(AlertRead(
                id=r.id,
                tenant_id=tenant_id,
                type=alert_type,
                severity=sev,  # type: ignore[arg-type]
                title=str(payload.get("title") or r.action.replace(".", " ").title()),
                body=str(payload.get("body") or ""),
                source_type="run" if r.action.startswith("run.") else "policy",
                source_id=r.target_id,
                source_name=str(payload.get("source_name") or r.target_id),
                action_required=bool(payload.get("action_required", True)),
                action_url=payload.get("action_url"),
                action_label=payload.get("action_label"),
                created_at=r.occurred_at,
                read_at=payload.get("read_at") if isinstance(payload.get("read_at"), datetime) else None,
                resolved_at=payload.get("resolved_at") if isinstance(payload.get("resolved_at"), datetime) else None,
            ))
        return out

    async def mark_alert_read(
        self,
        db: AsyncSession,
        *,
        alert_id: UUID,
    ) -> None:
        # We don't mutate audit_events (append-only — Rule 6). Future
        # iterations can add a per-user alert_ack table; for now this
        # is a no-op that the UI can call for optimistic UX.
        return None

    async def mark_all_alerts_read(
        self,
        db: AsyncSession,
    ) -> None:
        return None

    # -----------------------------------------------------------------------
    # Dashboard layout
    # -----------------------------------------------------------------------

    async def get_or_create_layout(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        user_id: UUID,
    ) -> DashboardLayout:
        row = (await db.execute(
            select(DashboardLayoutRow).where(DashboardLayoutRow.user_id == user_id)
        )).scalar_one_or_none()
        now = datetime.now(timezone.utc)
        if row is None:
            row = DashboardLayoutRow(
                tenant_id=tenant_id,
                user_id=user_id,
                widgets=[w for w in DEFAULT_WIDGETS],
                preset="engineering_lead",
                updated_at=now,
            )
            db.add(row)
            await db.commit()
            await db.refresh(row)
        widgets = [
            DashboardWidget(
                id=UUID(str(w.get("id", "00000000-0000-0000-0000-000000000000"))) if w.get("id") else UUID(int=0),
                user_id=user_id,
                type=w["type"],
                enabled=bool(w.get("enabled", True)),
                position=int(w.get("position", 0)),
                config=dict(w.get("config", {})),
            )
            for w in (row.widgets or [])
        ]
        return DashboardLayout(
            user_id=user_id,
            widgets=widgets,
            preset=row.preset,  # type: ignore[arg-type]
            updated_at=row.updated_at,
        )

    async def update_layout(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        user_id: UUID,
        layout: DashboardLayout,
    ) -> DashboardLayout:
        row = (await db.execute(
            select(DashboardLayoutRow).where(DashboardLayoutRow.user_id == user_id)
        )).scalar_one_or_none()
        now = datetime.now(timezone.utc)
        serialized = [
            {
                "id": str(w.id),
                "type": w.type,
                "enabled": w.enabled,
                "position": w.position,
                "config": w.config,
            }
            for w in layout.widgets
        ]
        if row is None:
            row = DashboardLayoutRow(
                tenant_id=tenant_id,
                user_id=user_id,
                widgets=serialized,
                preset=layout.preset,
                updated_at=now,
            )
            db.add(row)
        else:
            row.widgets = serialized
            row.preset = layout.preset
            row.updated_at = now
        await db.commit()
        await db.refresh(row)
        return DashboardLayout(
            user_id=user_id,
            widgets=[
                DashboardWidget(
                    id=UUID(str(w.get("id", "00000000-0000-0000-0000-000000000000"))) if w.get("id") else UUID(int=0),
                    user_id=user_id,
                    type=w["type"],
                    enabled=bool(w.get("enabled", True)),
                    position=int(w.get("position", 0)),
                    config=dict(w.get("config", {})),
                )
                for w in (row.widgets or [])
            ],
            preset=row.preset,  # type: ignore[arg-type]
            updated_at=row.updated_at,
        )


dashboard_service = DashboardService()

__all__ = ["DashboardService", "dashboard_service"]
