"""F19 — Cache (Phase 4).

Forge's cache control surface. LiteLLM is the actual cache backend
(Redis); Forge adds:

  * per-tenant isolation (cache key rows are tenant-scoped, see
    ``Phase4CacheKey``),
  * metrics (hit/miss/savings aggregated locally),
  * audit (forge.cache.* events on every operation),
  * admin invalidation with explicit double-confirm for flushall.

ponytail: one class, six methods. The FastAPI handler at
``app/api/v1/forge_phase4/cache.py`` is the only caller. When a
new LiteLLM cache endpoint ships, add a method here.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select

from app.core.logging import get_logger
from app.core.phase4_audit_events import Phase4AuditAction
from app.core.phase4_errors import CacheBackendUnreachable
from app.db.models.audit import AuditEvent
from app.db.models.phase4 import Phase4CacheKey
from app.db.session import get_session_factory
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient
from app.services.audit_service import audit_service

logger = get_logger(__name__)


# TTL defaults per cache type (seconds). Override via ``update_settings``.
DEFAULT_TTL = {"exact": 3600, "semantic": 86400, "prefix": 14400, "tool_result": 900}


class Phase4CacheService:
    """Per-tenant cache control + metrics."""

    # ── LiteLLM proxy calls ─────────────────────────────────────────

    async def status(self) -> dict[str, Any]:
        """Ping cache backend and return connection info."""
        try:
            async with LiteLLMBaseClient() as client:
                ping = await client.admin_client.post("/cache/ping")
                ping.raise_for_status()
                info_resp = await client.admin_client.get("/cache/redis/info")
                info = info_resp.json() if info_resp.status_code == 200 else {}
        except Exception as exc:  # noqa: BLE001 — translate to domain error
            raise CacheBackendUnreachable("litellm", last_ok_at=None) from exc
        return {"ping": ping.json() if ping.content else {}, "redis_info": info}

    async def get_settings(self) -> dict[str, Any]:
        async with LiteLLMBaseClient() as client:
            resp = await client.admin_client.get("/cache/settings")
            resp.raise_for_status()
            return resp.json()

    async def update_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        async with LiteLLMBaseClient() as client:
            resp = await client.admin_client.post("/cache/settings/update", json=settings)
            resp.raise_for_status()
            return resp.json()

    async def invalidate(
        self, *, keys: list[str] | None = None, all_: bool = False
    ) -> dict[str, Any]:
        """Invalidate specific keys, or flushall (admin double-confirm upstream)."""
        async with LiteLLMBaseClient() as client:
            if all_:
                resp = await client.admin_client.post("/cache/flushall")
            else:
                resp = await client.admin_client.post("/cache/delete", json={"keys": keys or []})
            resp.raise_for_status()
            return resp.json() if resp.content else {"deleted": 0}

    # ── Local metrics (Phase4CacheKey rows) ─────────────────────────

    async def metrics(
        self, tenant_id: UUID | str, *, since: timedelta = timedelta(hours=24)
    ) -> dict[str, Any]:
        """Hit rate, total hits, total misses for tenant in window."""
        cutoff = datetime.now(UTC) - since
        factory = get_session_factory()
        async with factory() as session:
            row = (
                await session.execute(
                    select(
                        func.count(Phase4CacheKey.id),
                        func.coalesce(func.sum(Phase4CacheKey.hit_count), 0),
                        func.coalesce(func.sum(Phase4CacheKey.size_bytes), 0),
                    ).where(
                        Phase4CacheKey.tenant_id == str(tenant_id),
                        Phase4CacheKey.updated_at >= cutoff,
                    )
                )
            ).one()
        total_keys, total_hits, total_bytes = row
        # Misses aren't tracked in the cache_keys table; they live in audit.
        misses = await self._count_audit(tenant_id, Phase4AuditAction.CACHE_MISS, since)
        total = (total_hits or 0) + misses
        hit_rate = (total_hits or 0) / total if total else 0.0
        return {
            "window_hours": int(since.total_seconds() // 3600),
            "keys": int(total_keys or 0),
            "hits": int(total_hits or 0),
            "misses": int(misses),
            "hit_rate": round(hit_rate, 4),
            "size_bytes": int(total_bytes or 0),
        }

    async def savings(
        self, tenant_id: UUID | str, *, since: timedelta = timedelta(days=30)
    ) -> dict[str, Any]:
        """Cost savings = sum of cost_usd on CACHE_HIT audit rows in window."""
        hits = await self._count_audit(tenant_id, Phase4AuditAction.CACHE_HIT, since)
        # Per-hit savings is recorded in the audit payload.
        factory = get_session_factory()
        async with factory() as session:
            cutoff = datetime.now(UTC) - since
            rows = (
                await session.execute(
                    select(AuditEvent.payload).where(
                        AuditEvent.tenant_id == str(tenant_id),
                        AuditEvent.action == Phase4AuditAction.CACHE_HIT.value,
                        AuditEvent.occurred_at >= cutoff,
                    )
                )
            ).all()
        saved_usd = sum(float((r[0] or {}).get("saved_usd", 0)) for r in rows)
        return {
            "window_days": int(since.total_seconds() // 86400),
            "hit_count": hits,
            "saved_usd": round(saved_usd, 4),
        }

    async def list_keys(
        self, tenant_id: UUID | str, *, limit: int = 50, offset: int = 0
    ) -> list[dict[str, Any]]:
        factory = get_session_factory()
        async with factory() as session:
            rows = (
                (
                    await session.execute(
                        select(Phase4CacheKey)
                        .where(Phase4CacheKey.tenant_id == str(tenant_id))
                        .order_by(Phase4CacheKey.updated_at.desc())
                        .limit(limit)
                        .offset(offset)
                    )
                )
                .scalars()
                .all()
            )
        return [
            {
                "id": str(r.id),
                "key_hash": r.key_hash,
                "model": r.model,
                "cache_type": r.cache_type,
                "size_bytes": r.size_bytes,
                "hit_count": r.hit_count,
                "ttl_seconds": r.ttl_seconds,
                "expires_at": r.expires_at.isoformat(),
            }
            for r in rows
        ]

    # ── Hit/miss recording (called from F16 pass-through on cache lookups) ──

    async def record_hit(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        key_hash: str,
        model: str,
        cache_type: str = "exact",
        saved_usd: float = 0.0,
        ttl_remaining: int | None = None,
    ) -> None:
        factory = get_session_factory()
        async with factory() as session:
            existing = (
                await session.execute(
                    select(Phase4CacheKey).where(
                        Phase4CacheKey.tenant_id == str(tenant_id),
                        Phase4CacheKey.key_hash == key_hash,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                existing.hit_count += 1
                existing.last_hit_at = datetime.now(UTC)
            else:
                ttl = DEFAULT_TTL.get(cache_type, 3600)
                session.add(
                    Phase4CacheKey(
                        tenant_id=str(tenant_id),
                        project_id=str(project_id),
                        key_hash=key_hash,
                        model=model,
                        cache_type=cache_type,
                        size_bytes=0,
                        hit_count=1,
                        last_hit_at=datetime.now(UTC),
                        ttl_seconds=ttl,
                        expires_at=datetime.now(UTC) + timedelta(seconds=ttl),
                    )
                )
            await session.commit()
        await audit_service.record(
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=None,
            action=Phase4AuditAction.CACHE_HIT.value,
            target_type="cache_key",
            target_id=key_hash,
            payload={
                "model": model,
                "cache_type": cache_type,
                "saved_usd": saved_usd,
                "ttl_remaining": ttl_remaining,
            },
        )

    async def record_miss(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        key_hash: str,
        model: str,
        cache_type: str = "exact",
    ) -> None:
        await audit_service.record(
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=None,
            action=Phase4AuditAction.CACHE_MISS.value,
            target_type="cache_key",
            target_id=key_hash,
            payload={"model": model, "cache_type": cache_type},
        )

    async def record_invalidated(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        actor_id: UUID | str | None,
        scope: str,
        keys: list[str] | None = None,
    ) -> None:
        await audit_service.record(
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            action=Phase4AuditAction.CACHE_INVALIDATED.value,
            target_type="cache_namespace",
            target_id=scope,
            payload={"keys_count": len(keys) if keys else 0},
        )

    async def record_settings_changed(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        actor_id: UUID | str,
        before: dict[str, Any],
        after: dict[str, Any],
    ) -> None:
        await audit_service.record(
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            action=Phase4AuditAction.CACHE_SETTINGS_CHANGED.value,
            target_type="cache_settings",
            target_id=str(tenant_id),
            payload={"before": before, "after": after},
        )

    # ── Helpers ──────────────────────────────────────────────────────

    async def _count_audit(
        self, tenant_id: UUID | str, action: Phase4AuditAction, since: timedelta
    ) -> int:
        cutoff = datetime.now(UTC) - since
        factory = get_session_factory()
        async with factory() as session:
            row = (
                await session.execute(
                    select(func.count(AuditEvent.id)).where(
                        AuditEvent.tenant_id == str(tenant_id),
                        AuditEvent.action == action.value,
                        AuditEvent.occurred_at >= cutoff,
                    )
                )
            ).scalar_one()
        return int(row or 0)


phase4_cache_service = Phase4CacheService()


__all__ = ["Phase4CacheService", "phase4_cache_service", "DEFAULT_TTL"]
