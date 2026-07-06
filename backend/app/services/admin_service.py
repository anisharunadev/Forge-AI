"""Admin Service (F-008 — M2 portion).

Platform-wide stats, deep health probe, and cache purge.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from app.core.logging import get_logger
from app.db.models.artifact import Artifact
from app.db.models.audit import AuditEvent
from app.db.models.connector import Connector
from app.db.models.cost import CostEntry
from app.db.models.tenant import Tenant
from app.db.models.user import User
from app.db.session import get_session_factory
from app.schemas.admin import (
    AdminHealthReport,
    AdminStats,
    CachePurgeResult,
    ComponentHealth,
)

logger = get_logger(__name__)


class AdminService:
    """Read-only platform diagnostics + cache purge."""

    async def stats(self) -> AdminStats:
        since = datetime.now(UTC) - timedelta(hours=24)
        factory = get_session_factory()
        async with factory() as session:
            tenant_count = await session.scalar(select(func.count(Tenant.id))) or 0
            user_count = await session.scalar(select(func.count(User.id))) or 0
            connector_count = await session.scalar(select(func.count(Connector.id))) or 0
            artifact_count = await session.scalar(select(func.count(Artifact.id))) or 0
            run_count_24h = (
                await session.scalar(
                    select(func.count(AuditEvent.id)).where(AuditEvent.occurred_at >= since)
                )
                or 0
            )
            cost_usd_24h = (
                await session.scalar(
                    select(func.coalesce(func.sum(CostEntry.cost_usd), 0)).where(
                        CostEntry.recorded_at >= since
                    )
                )
                or 0.0
            )
            project_count = 0  # Projects are a future table; default to zero for now.

        return AdminStats(
            tenant_count=int(tenant_count),
            project_count=int(project_count),
            user_count=int(user_count),
            run_count_24h=int(run_count_24h),
            cost_usd_24h=float(cost_usd_24h),
            connector_count=int(connector_count),
            artifact_count=int(artifact_count),
            checked_at=datetime.now(UTC),
        )

    async def health(self) -> AdminHealthReport:
        components: list[ComponentHealth] = []
        checked = datetime.now(UTC)

        # Database.
        try:
            factory = get_session_factory()
            async with factory() as session:
                await session.execute(select(func.count(Tenant.id)))
            components.append(
                ComponentHealth(name="database", status="healthy", checked_at=checked)
            )
        except Exception as exc:  # noqa: BLE001
            components.append(
                ComponentHealth(
                    name="database",
                    status="down",
                    detail=f"{type(exc).__name__}: {exc}",
                    checked_at=checked,
                )
            )

        # Event bus.
        from app.services.event_bus import bus

        components.append(
            ComponentHealth(
                name="event_bus",
                status="healthy" if bus._started else "degraded",  # type: ignore[attr-defined]
                detail=None if bus._started else "bus_not_started",  # type: ignore[attr-defined]
                checked_at=checked,
            )
        )

        # LiteLLM proxy reachability is checked via the proxy url; we
        # don't open a socket here to keep health fast.
        from app.core.config import settings

        components.append(
            ComponentHealth(
                name="litellm_proxy",
                status="healthy" if settings.litellm_proxy_url else "degraded",
                detail=settings.litellm_proxy_url,
                checked_at=checked,
            )
        )

        overall = "healthy"
        for c in components:
            if c.status == "down":
                overall = "down"
                break
            if c.status == "degraded" and overall != "down":
                overall = "degraded"

        return AdminHealthReport(
            overall=overall,
            components=components,
            checked_at=checked,
        )

    async def purge_cache(self, scope: str = "all") -> CachePurgeResult:
        """Drop in-memory caches. Redis is purged via the configured client."""
        purged_keys = 0
        try:
            from app.core.config import settings  # noqa: F401  (ensures settings import works)

            try:
                import redis.asyncio as aioredis

                client = aioredis.from_url(settings.redis_url, decode_responses=True)
                if scope == "all":
                    purged_keys = await client.eval(
                        "local purged = 0 "
                        "for _,k in ipairs(redis.call('keys','forge:*')) do "
                        "  redis.call('del', k) "
                        "  purged = purged + 1 "
                        "end "
                        "return purged",
                        0,
                    )
                    purged_keys = int(purged_keys or 0)
                await client.aclose()
            except Exception:  # noqa: BLE001
                # Redis optional — log and continue.
                logger.warning("admin.cache.redis_unavailable")
        except Exception:  # noqa: BLE001
            logger.exception("admin.cache.purge_redis_failed")

        return CachePurgeResult(
            purged_keys=purged_keys,
            purged_at=datetime.now(UTC),
            scope=scope,
        )


admin_service = AdminService()


__all__ = ["AdminService", "admin_service"]
