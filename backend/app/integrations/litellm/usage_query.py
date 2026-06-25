"""F-829h — Per-tenant LLM usage aggregation (LiteLLM integration layer).

Reads from ``litellm_call_records`` (the operation-level audit table
populated by :class:`ForgeLLMClient`) and produces the dashboard
payload that ``/analytics/usage`` renders:

    {
      total_cost_usd: float,
      prompt_tokens: int,
      completion_tokens: int,
      calls: int,
      by_model: [{model, cost_usd, calls}, ...],
      by_user:   [{actor_id, cost_usd, calls}, ...]
    }

Caching layer
-------------
The result of :meth:`UsageQuery.get_tenant_usage` is cached in Redis at
``forge:litellm:usage:<tenant_id>:<since>:<until>`` for
``settings.litellm_usage_cache_ttl_seconds`` (default 60s) so the
dashboard's 60s polling cycle does not hammer Postgres. When Redis is
unavailable the query degrades gracefully — the cache miss is logged at
warning and the SQL path serves a fresh result (slower, but correct).
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.db.models.litellm_call_record import LiteLLMCallRecord
from app.db.rls import tenant_context
from app.db.session import get_session_factory

try:  # pragma: no cover — redis is optional at import time
    import redis.asyncio as aioredis
except ImportError:
    aioredis = None  # type: ignore[assignment]

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------


def _cache_key(tenant_id: UUID | str, since: datetime, until: datetime) -> str:
    """Redis key for the cached usage snapshot.

    Format mirrors ``freshness_ledger.py:57``:
    ``forge:<domain>:<tenant_id>:<entity_id>``.
    """
    return (
        f"forge:litellm:usage:{tenant_id}:"
        f"{int(since.timestamp())}:{int(until.timestamp())}"
    )


async def _cache_get(key: str) -> dict[str, Any] | None:
    """Read the cached payload from Redis. Returns ``None`` on miss."""
    if aioredis is None:
        return None
    try:
        client = aioredis.from_url(settings.redis_url, decode_responses=True)
        raw = await client.get(key)
        await client.aclose()
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as exc:  # noqa: BLE001 — graceful degradation
        logger.warning("litellm.usage_query.cache_get_failed", error=str(exc))
        return None


async def _cache_set(key: str, payload: dict[str, Any], ttl_seconds: int) -> None:
    """Write the cached payload to Redis. Best-effort."""
    if aioredis is None:
        return
    try:
        client = aioredis.from_url(settings.redis_url, decode_responses=True)
        await client.set(key, json.dumps(payload, default=str), ex=ttl_seconds)
        await client.aclose()
    except Exception as exc:  # noqa: BLE001 — never let cache writes break the query
        logger.warning("litellm.usage_query.cache_set_failed", error=str(exc))


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class ModelUsageBucket:
    """Aggregate spend + call count for one model."""

    model: str
    cost_usd: float
    calls: int


@dataclass
class UserUsageBucket:
    """Aggregate spend + call count for one actor."""

    actor_id: str
    cost_usd: float
    calls: int


@dataclass
class WorkflowUsageBucket:
    """Aggregate spend + call count for one workflow (Phase C per-workflow view)."""

    workflow_id: str
    cost_usd: float
    calls: int


@dataclass
class TenantUsageSnapshot:
    """Full dashboard payload returned to ``GET /api/v1/analytics/usage``."""

    total_cost_usd: float
    prompt_tokens: int
    completion_tokens: int
    calls: int
    by_model: list[ModelUsageBucket] = field(default_factory=list)
    by_user: list[UserUsageBucket] = field(default_factory=list)
    since: datetime | None = None
    until: datetime | None = None
    cached: bool = False

    def to_dict(self) -> dict[str, Any]:
        """JSON-serializable view for the API + Redis cache."""
        return {
            "total_cost_usd": round(self.total_cost_usd, 4),
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "calls": self.calls,
            "by_model": [
                {"model": b.model, "cost_usd": round(b.cost_usd, 4), "calls": b.calls}
                for b in self.by_model
            ],
            "by_user": [
                {"actor_id": b.actor_id, "cost_usd": round(b.cost_usd, 4), "calls": b.calls}
                for b in self.by_user
            ],
            "since": self.since.isoformat() if self.since else None,
            "until": self.until.isoformat() if self.until else None,
            "cached": self.cached,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "TenantUsageSnapshot":
        """Inverse of :meth:`to_dict` — used by Redis cache hits."""
        return cls(
            total_cost_usd=float(payload.get("total_cost_usd", 0.0)),
            prompt_tokens=int(payload.get("prompt_tokens", 0)),
            completion_tokens=int(payload.get("completion_tokens", 0)),
            calls=int(payload.get("calls", 0)),
            by_model=[
                ModelUsageBucket(
                    model=str(m["model"]),
                    cost_usd=float(m["cost_usd"]),
                    calls=int(m["calls"]),
                )
                for m in payload.get("by_model", [])
            ],
            by_user=[
                UserUsageBucket(
                    actor_id=str(u["actor_id"]),
                    cost_usd=float(u["cost_usd"]),
                    calls=int(u["calls"]),
                )
                for u in payload.get("by_user", [])
            ],
            since=(
                datetime.fromisoformat(payload["since"])
                if payload.get("since")
                else None
            ),
            until=(
                datetime.fromisoformat(payload["until"])
                if payload.get("until")
                else None
            ),
            cached=True,
        )


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class UsageQuery:
    """Read-side aggregator for ``/analytics/usage`` (F-829h).

    Stateless across calls. The class is intentionally thin — every
    dashboard widget can construct its own instance, or import the
    module-level :data:`usage_query` singleton.
    """

    def __init__(self) -> None:
        self._session_factory = get_session_factory()

    # ------------------------------------------------------------------
    # Tenant-level aggregate
    # ------------------------------------------------------------------

    async def get_tenant_usage(
        self,
        tenant_id: UUID | str,
        since: datetime,
        until: datetime,
    ) -> TenantUsageSnapshot:
        """Return the cached or freshly-computed usage snapshot for a tenant.

        Cache TTL is governed by ``settings.litellm_usage_cache_ttl_seconds``
        (default 60s) — same value the dashboard polls on.
        """
        tid = str(tenant_id)
        key = _cache_key(tid, since, until)
        cached = await _cache_get(key)
        if cached is not None:
            snap = TenantUsageSnapshot.from_dict(cached)
            return snap

        snap = await self._compute_tenant_usage(tid, since, until)
        await _cache_set(key, snap.to_dict(), ttl_seconds=settings.litellm_usage_cache_ttl_seconds)
        return snap

    async def _compute_tenant_usage(
        self,
        tenant_id: str,
        since: datetime,
        until: datetime,
    ) -> TenantUsageSnapshot:
        """Run the SQL aggregate under RLS. All output in the snapshot's dict."""
        factory = self._session_factory
        async with factory() as session:
            async with tenant_context(session, tenant_id=tenant_id):
                # ----- Totals -----
                totals_row = (
                    await session.execute(
                        select(
                            func.coalesce(
                                func.sum(LiteLLMCallRecord.cost_usd), 0.0
                            ).label("total_cost_usd"),
                            func.coalesce(
                                func.sum(LiteLLMCallRecord.prompt_tokens), 0
                            ).label("prompt_tokens"),
                            func.coalesce(
                                func.sum(LiteLLMCallRecord.completion_tokens), 0
                            ).label("completion_tokens"),
                            func.count(LiteLLMCallRecord.id).label("calls"),
                        ).where(
                            LiteLLMCallRecord.tenant_id == tenant_id,
                            LiteLLMCallRecord.occurred_at >= since,
                            LiteLLMCallRecord.occurred_at < until,
                        )
                    )
                ).one()

                # ----- By model -----
                by_model_rows = (
                    await session.execute(
                        select(
                            LiteLLMCallRecord.model.label("model"),
                            func.coalesce(
                                func.sum(LiteLLMCallRecord.cost_usd), 0.0
                            ).label("cost_usd"),
                            func.count(LiteLLMCallRecord.id).label("calls"),
                        )
                        .where(
                            LiteLLMCallRecord.tenant_id == tenant_id,
                            LiteLLMCallRecord.occurred_at >= since,
                            LiteLLMCallRecord.occurred_at < until,
                        )
                        .group_by(LiteLLMCallRecord.model)
                        .order_by(func.sum(LiteLLMCallRecord.cost_usd).desc())
                    )
                ).all()

                # ----- By user (actor) -----
                by_user_rows = (
                    await session.execute(
                        select(
                            LiteLLMCallRecord.actor_id.label("actor_id"),
                            func.coalesce(
                                func.sum(LiteLLMCallRecord.cost_usd), 0.0
                            ).label("cost_usd"),
                            func.count(LiteLLMCallRecord.id).label("calls"),
                        )
                        .where(
                            LiteLLMCallRecord.tenant_id == tenant_id,
                            LiteLLMCallRecord.actor_id.is_not(None),
                            LiteLLMCallRecord.occurred_at >= since,
                            LiteLLMCallRecord.occurred_at < until,
                        )
                        .group_by(LiteLLMCallRecord.actor_id)
                        .order_by(func.sum(LiteLLMCallRecord.cost_usd).desc())
                        .limit(10)
                    )
                ).all()

        return TenantUsageSnapshot(
            total_cost_usd=float(totals_row.total_cost_usd or 0.0),
            prompt_tokens=int(totals_row.prompt_tokens or 0),
            completion_tokens=int(totals_row.completion_tokens or 0),
            calls=int(totals_row.calls or 0),
            by_model=[
                ModelUsageBucket(
                    model=str(row.model),
                    cost_usd=float(row.cost_usd or 0.0),
                    calls=int(row.calls or 0),
                )
                for row in by_model_rows
            ],
            by_user=[
                UserUsageBucket(
                    actor_id=str(row.actor_id),
                    cost_usd=float(row.cost_usd or 0.0),
                    calls=int(row.calls or 0),
                )
                for row in by_user_rows
            ],
            since=since,
            until=until,
            cached=False,
        )

    # ------------------------------------------------------------------
    # Workflow-level aggregate
    # ------------------------------------------------------------------

    async def get_workflow_usage(
        self,
        tenant_id: UUID | str,
        workflow_id: UUID | str,
    ) -> WorkflowUsageBucket:
        """Per-workflow spend snapshot for ``/analytics/usage/workflow/[id]``."""
        tid = str(workflow_id)
        factory = self._session_factory
        async with factory() as session:
            async with tenant_context(session, tenant_id=tid):
                row = (
                    await session.execute(
                        select(
                            func.coalesce(
                                func.sum(LiteLLMCallRecord.cost_usd), 0.0
                            ).label("cost_usd"),
                            func.count(LiteLLMCallRecord.id).label("calls"),
                        ).where(
                            LiteLLMCallRecord.tenant_id == tenant_id,
                            LiteLLMCallRecord.workflow_id == workflow_id,
                        )
                    )
                ).one()
        return WorkflowUsageBucket(
            workflow_id=str(workflow_id),
            cost_usd=float(row.cost_usd or 0.0),
            calls=int(row.calls or 0),
        )


# Module-level singleton for convenience (DI-friendly).
usage_query = UsageQuery()


__all__ = [
    "UsageQuery",
    "usage_query",
    "TenantUsageSnapshot",
    "ModelUsageBucket",
    "UserUsageBucket",
    "WorkflowUsageBucket",
]
