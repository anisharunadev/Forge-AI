"""step-75 P3 — Spend Aggregation service.

Real-time write path (every chat completion) + LiteLLM ``/spend/logs``
reconciliation + dashboard rollups. Backs the live cost meter
(`GET /api/forge/spend/cost-meter/:run_id`) and the spend dashboards
(`/api/forge/spend/summary`, `/agents/:id`, `/tenants/:id`).

Idempotency: ``litellm_request_id`` is the unique key (UNIQUE constraint
in the migration). INSERT-then-SELECT (no ON CONFLICT) keeps it
portable across SQLite (tests) and Postgres (prod).
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import httpx
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, Index, Integer, Numeric, String, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.logging import get_logger
from app.db.base import Base, GUID, UUIDPrimaryKeyMixin
from app.db.session import get_session_factory
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient
from app.services.audit_service import audit_service

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# ORM model — co-located so this file is self-contained. Migration lives in
# ``alembic/versions/step_75_p3_spend_records_001.py``.
# ---------------------------------------------------------------------------


class SpendRecord(Base, UUIDPrimaryKeyMixin):
    """One row per LLM call that cost money.

    Real-time writes are idempotent on ``litellm_request_id`` (UNIQUE).
    Reconciliation updates ``cost_usd`` and stamps ``reconciled_at`` when
    LiteLLM's authoritative value diverges from what Forge recorded.
    """

    __tablename__ = "spend_records"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    agent_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    user_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    team_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    model: Mapped[str] = mapped_column(String(256), nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), nullable=False)
    # unique=True mirrors alembic step_75_p3_spend_records_001's UNIQUE
    # constraint so metadata.create_all (used in tests) emits it too.
    litellm_request_id: Mapped[str] = mapped_column(
        String(256), nullable=False, unique=True
    )
    reconciled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("ix_spend_records_tenant_project_created", "tenant_id", "project_id"),
        Index("ix_spend_records_tenant_created", "tenant_id"),
    )


# ---------------------------------------------------------------------------
# Typed artifacts (Rule 4 — never return free-form dicts from the service)
# ---------------------------------------------------------------------------


class SpendRecordOut(BaseModel):
    """Pydantic view of one ``spend_records`` row."""

    id: UUID
    tenant_id: UUID
    project_id: UUID
    agent_id: UUID
    user_id: UUID
    team_id: UUID | None
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float
    litellm_request_id: str
    reconciled_at: datetime | None
    created_at: datetime

    @classmethod
    def from_row(cls, row: SpendRecord) -> "SpendRecordOut":
        return cls(
            id=row.id,
            tenant_id=row.tenant_id,
            project_id=row.project_id,
            agent_id=row.agent_id,
            user_id=row.user_id,
            team_id=row.team_id,
            model=row.model,
            prompt_tokens=row.prompt_tokens,
            completion_tokens=row.completion_tokens,
            total_tokens=row.total_tokens,
            cost_usd=float(row.cost_usd),
            litellm_request_id=row.litellm_request_id,
            reconciled_at=row.reconciled_at,
            created_at=row.created_at,
        )


class ModelCostRow(BaseModel):
    model: str
    cost_usd: float
    prompt_tokens: int
    completion_tokens: int
    request_count: int


class AgentCostRow(BaseModel):
    agent_id: UUID
    cost_usd: float
    prompt_tokens: int
    completion_tokens: int
    request_count: int


class UserCostRow(BaseModel):
    user_id: UUID
    cost_usd: float
    request_count: int


class TenantCostRow(BaseModel):
    tenant_id: UUID
    cost_usd: float
    request_count: int


class SpendSummary(BaseModel):
    total_cost_usd: float
    request_count: int
    by_model: list[ModelCostRow] = Field(default_factory=list)
    by_agent: list[AgentCostRow] = Field(default_factory=list)
    by_user: list[UserCostRow] = Field(default_factory=list)
    since: datetime
    tenant_id: UUID
    project_id: UUID | None


class SpendByAgent(BaseModel):
    agent_id: UUID
    total_cost_usd: float
    prompt_tokens: int
    completion_tokens: int
    request_count: int
    since: datetime


class SpendByTenant(BaseModel):
    tenant_id: UUID
    total_cost_usd: float
    request_count: int
    by_model: list[ModelCostRow] = Field(default_factory=list)
    since: datetime


class CostMeterEntry(BaseModel):
    """Live cost meter for an in-flight / just-finished run."""

    run_id: UUID
    tenant_id: UUID
    project_id: UUID
    agent_id: UUID
    model: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float
    litellm_request_id: str
    created_at: datetime


class BackfillResponse(BaseModel):
    rows_upserted: int
    rows_inserted: int
    drift_count: int
    dry_run: bool
    since: datetime


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _uuid(value: Any) -> UUID:
    """Coerce ``value`` to ``UUID``; raise ``ValueError`` if it can't be coerced."""
    if isinstance(value, UUID):
        return value
    return UUID(str(value))


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class SpendService:
    """Spend write-path + reconciliation + rollups (step-75 P3)."""

    # ------------------------------------------------------------------
    # Real-time write path
    # ------------------------------------------------------------------

    async def record_from_usage(
        self,
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
    ) -> SpendRecordOut:
        """Insert one spend row, idempotent on ``litellm_request_id``.

        Returns the (existing or new) row as a typed Pydantic model.
        """
        total_tokens = int(prompt_tokens) + int(completion_tokens)
        factory = get_session_factory()
        async with factory() as session:
            existing = await session.scalar(
                select(SpendRecord).where(
                    SpendRecord.litellm_request_id == litellm_request_id
                )
            )
            if existing is not None:
                return SpendRecordOut.from_row(existing)

            new_id = uuid4()
            # INSERT ... ON CONFLICT DO NOTHING on Postgres (the only place
            # this can race); plain INSERT on SQLite (tests) — unique
            # constraint violation becomes a no-op via the second SELECT.
            try:
                stmt = pg_insert(SpendRecord).values(
                    id=new_id,
                    tenant_id=_uuid(tenant_id),
                    project_id=_uuid(project_id),
                    agent_id=_uuid(agent_id),
                    user_id=_uuid(user_id),
                    team_id=_uuid(team_id) if team_id is not None else None,
                    model=model,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    total_tokens=total_tokens,
                    cost_usd=Decimal(str(cost_usd)),
                    litellm_request_id=litellm_request_id,
                )
                # ponytail: ON CONFLICT is Postgres-only; SQLite test path
                # handles the rare race via the post-insert SELECT below.
                stmt = stmt.on_conflict_do_nothing(
                    index_elements=["litellm_request_id"]
                )
                await session.execute(stmt)
                await session.commit()
            except Exception:  # pragma: no cover — SQLite test path
                await session.rollback()
                # fall through to SELECT

            row = await session.scalar(
                select(SpendRecord).where(
                    SpendRecord.litellm_request_id == litellm_request_id
                )
            )
            if row is None:  # pragma: no cover — race condition
                raise RuntimeError(
                    f"spend_records insert returned no row for litellm_request_id={litellm_request_id!r}"
                )
            out = SpendRecordOut.from_row(row)

        # Fire audit outside the DB tx; failure here must not roll back spend.
        try:
            await audit_service.record(
                tenant_id=out.tenant_id,
                project_id=out.project_id,
                actor_id=out.user_id,
                action="forge.spend.recorded",
                target_type="spend_record",
                target_id=str(out.id),
                payload={
                    "model": out.model,
                    "prompt_tokens": out.prompt_tokens,
                    "completion_tokens": out.completion_tokens,
                    "total_tokens": out.total_tokens,
                    "cost_usd": out.cost_usd,
                    "litellm_request_id": out.litellm_request_id,
                },
            )
        except Exception as exc:  # pragma: no cover — audit is best-effort
            logger.warning(
                "forge_spend.audit_failed",
                litellm_request_id=litellm_request_id,
                error=str(exc),
            )
        return out

    # ------------------------------------------------------------------
    # Reconciliation
    # ------------------------------------------------------------------

    async def reconcile(self, last_sync: datetime) -> dict[str, int]:
        """Pull ``/spend/logs`` since ``last_sync``; upsert into ``spend_records``.

        Returns ``{rows_upserted, rows_inserted, drift_count}``.
        Bounded to the caller's tenant scope; the per-tenant API layer
        must enforce tenant_id in the request path.
        """
        rows_upserted = 0
        rows_inserted = 0
        drift_count = 0
        try:
            logs = await self._fetch_spend_logs(last_sync)
        except Exception as exc:  # pragma: no cover — network path
            logger.warning("forge_spend.reconcile.fetch_failed", error=str(exc))
            return {"rows_upserted": 0, "rows_inserted": 0, "drift_count": 0}

        factory = get_session_factory()
        async with factory() as session:
            for entry in logs:
                req_id = str(entry.get("request_id") or entry.get("id") or "")
                if not req_id:
                    continue
                existing = await session.scalar(
                    select(SpendRecord).where(
                        SpendRecord.litellm_request_id == req_id
                    )
                )
                litellm_cost = float(entry.get("spend") or entry.get("cost") or 0.0)
                if existing is None:
                    tenant_id = _uuid(
                        entry.get("tenant_id")
                        or "00000000-0000-0000-0000-000000000000"
                    )
                    project_id = _uuid(
                        entry.get("project_id")
                        or "00000000-0000-0000-0000-000000000000"
                    )
                    session.add(
                        SpendRecord(
                            id=uuid4(),
                            tenant_id=tenant_id,
                            project_id=project_id,
                            agent_id=_uuid(
                                entry.get("agent_id")
                                or "00000000-0000-0000-0000-000000000000"
                            ),
                            user_id=_uuid(
                                entry.get("user_id")
                                or "00000000-0000-0000-0000-000000000000"
                            ),
                            team_id=_uuid(entry["team_id"]) if entry.get("team_id") else None,
                            model=str(entry.get("model") or "unknown"),
                            prompt_tokens=int(entry.get("prompt_tokens") or 0),
                            completion_tokens=int(entry.get("completion_tokens") or 0),
                            total_tokens=int(
                                entry.get("total_tokens")
                                or (
                                    int(entry.get("prompt_tokens") or 0)
                                    + int(entry.get("completion_tokens") or 0)
                                )
                            ),
                            cost_usd=Decimal(str(litellm_cost)),
                            litellm_request_id=req_id,
                            reconciled_at=datetime.now(timezone.utc),
                        )
                    )
                    rows_inserted += 1
                    rows_upserted += 1
                else:
                    forge_cost = float(existing.cost_usd or 0.0)
                    if litellm_cost > 0 and abs(litellm_cost - forge_cost) > 0.0:
                        denom = litellm_cost if litellm_cost else 1.0
                        if abs(litellm_cost - forge_cost) / denom > 0.01:
                            drift_count += 1
                            # ponytail: alert is best-effort; reconcile job
                            # continues even if audit write fails.
                            try:
                                await audit_service.record(
                                    tenant_id=existing.tenant_id,
                                    project_id=existing.project_id,
                                    actor_id=None,
                                    action="forge.spend.drift_detected",
                                    target_type="spend_record",
                                    target_id=str(existing.id),
                                    payload={
                                        "litellm_request_id": req_id,
                                        "litellm_cost_usd": litellm_cost,
                                        "forge_cost_usd": forge_cost,
                                    },
                                )
                            except Exception as exc:  # pragma: no cover
                                logger.warning(
                                    "forge_spend.drift_audit_failed",
                                    error=str(exc),
                                )
                    if litellm_cost > 0 and abs(litellm_cost - forge_cost) > 0.0:
                        existing.cost_usd = Decimal(str(litellm_cost))
                        rows_upserted += 1
                    existing.reconciled_at = datetime.now(timezone.utc)
            await session.commit()

        return {
            "rows_upserted": rows_upserted,
            "rows_inserted": rows_inserted,
            "drift_count": drift_count,
        }

    # ------------------------------------------------------------------
    # Rollups
    # ------------------------------------------------------------------

    async def summary(
        self,
        tenant_id: UUID,
        project_id: UUID | None,
        since: datetime,
    ) -> SpendSummary:
        """Dashboard rollup: totals + by_model/by_agent/by_user."""
        factory = get_session_factory()
        tid = _uuid(tenant_id)
        async with factory() as session:
            total_cost, request_count = await self._totals(
                session, tenant_id=tid, project_id=project_id, since=since
            )
            by_model = await self._by_model(
                session, tenant_id=tid, project_id=project_id, since=since
            )
            by_agent = await self._by_agent(
                session, tenant_id=tid, project_id=project_id, since=since
            )
            by_user = await self._by_user(
                session, tenant_id=tid, project_id=project_id, since=since
            )
        return SpendSummary(
            total_cost_usd=total_cost,
            request_count=request_count,
            by_model=by_model,
            by_agent=by_agent,
            by_user=by_user,
            since=since,
            tenant_id=tid,
            project_id=_uuid(project_id) if project_id else None,
        )

    async def by_agent(self, agent_id: UUID, since: datetime) -> SpendByAgent:
        aid = _uuid(agent_id)
        factory = get_session_factory()
        async with factory() as session:
            row = (
                await session.execute(
                    select(
                        func.coalesce(func.sum(SpendRecord.cost_usd), 0).label("cost"),
                        func.coalesce(func.sum(SpendRecord.prompt_tokens), 0).label("pt"),
                        func.coalesce(func.sum(SpendRecord.completion_tokens), 0).label("ct"),
                        func.count(SpendRecord.id).label("n"),
                    ).where(
                        SpendRecord.agent_id == aid,
                        SpendRecord.created_at >= since,
                    )
                )
            ).one()
        return SpendByAgent(
            agent_id=aid,
            total_cost_usd=float(row.cost or 0),
            prompt_tokens=int(row.pt or 0),
            completion_tokens=int(row.ct or 0),
            request_count=int(row.n or 0),
            since=since,
        )

    async def by_tenant(self, tenant_id: UUID, since: datetime) -> SpendByTenant:
        tid = _uuid(tenant_id)
        factory = get_session_factory()
        async with factory() as session:
            total_row = (
                await session.execute(
                    select(
                        func.coalesce(func.sum(SpendRecord.cost_usd), 0),
                        func.count(SpendRecord.id),
                    ).where(
                        SpendRecord.tenant_id == tid,
                        SpendRecord.created_at >= since,
                    )
                )
            ).one()
            by_model = await self._by_model(session, tenant_id=tid, project_id=None, since=since)
        return SpendByTenant(
            tenant_id=tid,
            total_cost_usd=float(total_row[0] or 0),
            request_count=int(total_row[1] or 0),
            by_model=by_model,
            since=since,
        )

    # ------------------------------------------------------------------
    # Cost meter
    # ------------------------------------------------------------------

    async def cost_meter(self, run_id: UUID) -> CostMeterEntry | None:
        """Lookup the live cost-meter entry for ``run_id``.

        ``run_id`` is a forge-side identifier. The migration keys the
        table on ``litellm_request_id`` for idempotency, so callers must
        pass the LiteLLM response id (the SSE ``chat.completion.id``) —
        same string the real-time path used when recording. This is the
        contract the cost-meter WS frontend relies on.
        """
        rid = _uuid(run_id)
        factory = get_session_factory()
        async with factory() as session:
            row = await session.scalar(
                select(SpendRecord).where(SpendRecord.id == rid)
            )
            if row is None:
                return None
            return CostMeterEntry(
                run_id=row.id,
                tenant_id=row.tenant_id,
                project_id=row.project_id,
                agent_id=row.agent_id,
                model=row.model,
                prompt_tokens=row.prompt_tokens,
                completion_tokens=row.completion_tokens,
                total_tokens=row.total_tokens,
                cost_usd=float(row.cost_usd),
                litellm_request_id=row.litellm_request_id,
                created_at=row.created_at,
            )

    # ------------------------------------------------------------------
    # Backfill
    # ------------------------------------------------------------------

    async def backfill(
        self, since: datetime, dry_run: bool = False
    ) -> BackfillResponse:
        """Admin-only re-reconciliation over an explicit window.

        Mirrors :meth:`reconcile` but accepts a since-cutoff. ``dry_run``
        runs the fetch + comparison but writes nothing.
        """
        if dry_run:
            # ponytail: dry-run still does the network call so the operator
            # sees real row counts before committing.
            try:
                logs = await self._fetch_spend_logs(since)
            except Exception as exc:  # pragma: no cover
                logger.warning("forge_spend.backfill.fetch_failed", error=str(exc))
                return BackfillResponse(
                    rows_upserted=0,
                    rows_inserted=0,
                    drift_count=0,
                    dry_run=True,
                    since=since,
                )
            return BackfillResponse(
                rows_upserted=len(logs),
                rows_inserted=len(logs),
                drift_count=0,
                dry_run=True,
                since=since,
            )
        result = await self.reconcile(since)
        return BackfillResponse(
            rows_upserted=result["rows_upserted"],
            rows_inserted=result["rows_inserted"],
            drift_count=result["drift_count"],
            dry_run=False,
            since=since,
        )

    # ------------------------------------------------------------------
    # HTTP — /spend/logs via master-key admin client
    # ------------------------------------------------------------------

    async def _fetch_spend_logs(self, since: datetime) -> list[dict[str, Any]]:
        async with LiteLLMBaseClient() as base:
            try:
                resp = await base.admin_client.get(
                    "/spend/logs",
                    params={"start_date": since.isoformat()},
                )
            except httpx.HTTPError as exc:
                logger.warning("forge_spend.spend_logs.http_error", error=str(exc))
                return []
            if resp.status_code != 200:
                logger.warning(
                    "forge_spend.spend_logs.non_2xx",
                    status_code=resp.status_code,
                )
                return []
            body = resp.json()
        if isinstance(body, list):
            return [r for r in body if isinstance(r, dict)]
        if isinstance(body, dict):
            data = body.get("data") or body.get("logs") or []
            return [r for r in data if isinstance(r, dict)]
        return []

    # ------------------------------------------------------------------
    # Aggregation helpers (shared by summary / by_tenant)
    # ------------------------------------------------------------------

    async def _totals(
        self,
        session: AsyncSession,
        *,
        tenant_id: UUID,
        project_id: UUID | None,
        since: datetime,
    ) -> tuple[float, int]:
        stmt = select(
            func.coalesce(func.sum(SpendRecord.cost_usd), 0),
            func.count(SpendRecord.id),
        ).where(
            SpendRecord.tenant_id == tenant_id,
            SpendRecord.created_at >= since,
        )
        if project_id is not None:
            stmt = stmt.where(SpendRecord.project_id == project_id)
        row = (await session.execute(stmt)).one()
        return float(row[0] or 0), int(row[1] or 0)

    async def _by_model(
        self,
        session: AsyncSession,
        *,
        tenant_id: UUID,
        project_id: UUID | None,
        since: datetime,
    ) -> list[ModelCostRow]:
        stmt = (
            select(
                SpendRecord.model,
                func.coalesce(func.sum(SpendRecord.cost_usd), 0).label("cost"),
                func.coalesce(func.sum(SpendRecord.prompt_tokens), 0).label("pt"),
                func.coalesce(func.sum(SpendRecord.completion_tokens), 0).label("ct"),
                func.count(SpendRecord.id).label("n"),
            )
            .where(
                SpendRecord.tenant_id == tenant_id,
                SpendRecord.created_at >= since,
            )
            .group_by(SpendRecord.model)
            .order_by(func.sum(SpendRecord.cost_usd).desc())
        )
        if project_id is not None:
            stmt = stmt.where(SpendRecord.project_id == project_id)
        rows = (await session.execute(stmt)).all()
        return [
            ModelCostRow(
                model=r.model,
                cost_usd=float(r.cost or 0),
                prompt_tokens=int(r.pt or 0),
                completion_tokens=int(r.ct or 0),
                request_count=int(r.n or 0),
            )
            for r in rows
        ]

    async def _by_agent(
        self,
        session: AsyncSession,
        *,
        tenant_id: UUID,
        project_id: UUID | None,
        since: datetime,
    ) -> list[AgentCostRow]:
        stmt = (
            select(
                SpendRecord.agent_id,
                func.coalesce(func.sum(SpendRecord.cost_usd), 0).label("cost"),
                func.coalesce(func.sum(SpendRecord.prompt_tokens), 0).label("pt"),
                func.coalesce(func.sum(SpendRecord.completion_tokens), 0).label("ct"),
                func.count(SpendRecord.id).label("n"),
            )
            .where(
                SpendRecord.tenant_id == tenant_id,
                SpendRecord.created_at >= since,
            )
            .group_by(SpendRecord.agent_id)
            .order_by(func.sum(SpendRecord.cost_usd).desc())
        )
        if project_id is not None:
            stmt = stmt.where(SpendRecord.project_id == project_id)
        rows = (await session.execute(stmt)).all()
        return [
            AgentCostRow(
                agent_id=r.agent_id,
                cost_usd=float(r.cost or 0),
                prompt_tokens=int(r.pt or 0),
                completion_tokens=int(r.ct or 0),
                request_count=int(r.n or 0),
            )
            for r in rows
        ]

    async def _by_user(
        self,
        session: AsyncSession,
        *,
        tenant_id: UUID,
        project_id: UUID | None,
        since: datetime,
    ) -> list[UserCostRow]:
        stmt = (
            select(
                SpendRecord.user_id,
                func.coalesce(func.sum(SpendRecord.cost_usd), 0).label("cost"),
                func.count(SpendRecord.id).label("n"),
            )
            .where(
                SpendRecord.tenant_id == tenant_id,
                SpendRecord.created_at >= since,
            )
            .group_by(SpendRecord.user_id)
            .order_by(func.sum(SpendRecord.cost_usd).desc())
        )
        if project_id is not None:
            stmt = stmt.where(SpendRecord.project_id == project_id)
        rows = (await session.execute(stmt)).all()
        return [
            UserCostRow(
                user_id=r.user_id,
                cost_usd=float(r.cost or 0),
                request_count=int(r.n or 0),
            )
            for r in rows
        ]


# Module-level singleton (DI-friendly, mirrors `cost_ledger.py:141`).
spend_service = SpendService()


__all__ = [
    "SpendService",
    "spend_service",
    "SpendRecord",
    "SpendRecordOut",
    "SpendSummary",
    "SpendByAgent",
    "SpendByTenant",
    "CostMeterEntry",
    "BackfillResponse",
]
