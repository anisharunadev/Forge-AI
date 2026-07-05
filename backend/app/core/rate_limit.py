"""Per-tenant sliding-window rate limiter.

Phase 6 SC-6.2: every chat completion / copilot / keys / rag-search
surface has a per-tenant cap of ``settings.chat_rate_limit_per_min``
(default 60) requests per rolling 60-second window. Override per
tenant via ``Tenant.settings['rate_limit_overrides'][surface]``.

Redis-backed (ZSET sliding window); falls back to the in-process deque
when Redis is unreachable (single-worker / test mode).
"""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.config import settings
from app.core.logging import get_logger
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory

logger = get_logger(__name__)


@dataclass
class RateLimitResult:
    allowed: bool
    count: int
    limit: int
    retry_after_seconds: int


class RateLimitExceeded(Exception):
    def __init__(self, retry_after_seconds: int, limit: int) -> None:
        self.retry_after_seconds = retry_after_seconds
        self.limit = limit
        super().__init__(
            f"rate limit exceeded ({limit}/min); retry in {retry_after_seconds}s"
        )


class TenantRateLimiter:
    """Redis sliding-window rate limiter keyed by ``(tenant, surface)``."""

    def __init__(self, redis_client: Any | None = None) -> None:
        self._redis = redis_client
        # In-process fallback (test mode + Redis-down)
        self._fallback: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._fallback_lock = asyncio.Lock()

    async def _get_redis(self) -> Any | None:
        """Resolve a Redis client; returns None when Redis is unreachable."""
        if self._redis is not None:
            return self._redis
        try:
            import redis.asyncio as aioredis  # type: ignore[import-untyped]

            client = aioredis.from_url(
                settings.rate_limit_redis_url or settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
            )
            await client.ping()
            self._redis = client
            return client
        except Exception:  # noqa: BLE001
            logger.warning("rate_limit.redis_unavailable_falling_back_inprocess")
            return None

    async def _override_limit(self, tenant_id: UUID, surface: str) -> int | None:
        """Read ``Tenant.settings['rate_limit_overrides'][surface]`` if set."""
        factory = get_session_factory()
        async with factory() as session:
            row = (
                await session.execute(select(Tenant).where(Tenant.id == tenant_id))
            ).scalar_one_or_none()
        if row is None:
            return None
        overrides = (row.settings or {}).get("rate_limit_overrides") or {}
        v = overrides.get(surface)
        return int(v) if v is not None else None

    async def check(
        self,
        tenant_id: UUID,
        surface: str,
        *,
        limit_per_minute: int | None = None,
    ) -> RateLimitResult:
        """Check (and record) one event for ``(tenant_id, surface)``.

        Raises :class:`RateLimitExceeded` on overflow.
        """
        override = await self._override_limit(tenant_id, surface)
        limit = (
            limit_per_minute
            if limit_per_minute is not None
            else override
            if override is not None
            else settings.chat_rate_limit_per_min
        )
        key = f"rl:{tenant_id}:{surface}"
        now = time.monotonic()
        window_start = now - 60.0

        redis = await self._get_redis()
        if redis is not None:
            count = await self._check_redis(redis, key, now, window_start, limit)
        else:
            count = self._check_inprocess(key, now, window_start)

        if count > limit:
            retry_after = max(1, int(60 - (now % 60)) + 1)
            logger.warning(
                "rate_limit.exceeded",
                tenant_id=str(tenant_id),
                surface=surface,
                count=count,
                limit=limit,
                retry_after=retry_after,
            )
            raise RateLimitExceeded(retry_after_seconds=retry_after, limit=limit)

        return RateLimitResult(
            allowed=True, count=count, limit=limit, retry_after_seconds=0
        )

    async def _check_redis(
        self,
        redis: Any,
        key: str,
        now: float,
        window_start: float,
        limit: int,
    ) -> int:
        """ZSET-based sliding window. Atomic via pipeline.

        ponytail: single instance is fine up to ~10k keys; switch to
        per-shard when a hot tenant needs to dodge the global lock.
        """
        member = f"{now}:{id(object())}"
        pipe = redis.pipeline()
        pipe.zremrangebyscore(key, 0, window_start)
        pipe.zadd(key, {member: now})
        pipe.zcard(key)
        pipe.expire(key, 61)
        results = await pipe.execute()
        count = int(results[2])
        if count > limit:
            # Roll back the add so a rejected call doesn't nudge the window
            # forward — without this, self-throttling skews the limiter.
            await redis.zrem(key, member)
        return count

    def _check_inprocess(
        self,
        key: str,
        now: float,
        window_start: float,
    ) -> int:
        dq = self._fallback[key]
        while dq and dq[0] < window_start:
            dq.popleft()
        dq.append(now)
        return len(dq)


# Module-level singleton — process-wide, per-(tenant, surface) sliding window.
tenant_rate_limiter = TenantRateLimiter()


async def enforce_rate_limit(
    surface: str,
    tenant_id: UUID,
    *,
    limit_per_minute: int | None = None,
) -> RateLimitResult:
    """FastAPI dependency: 429 + Retry-After on overflow.

    Usage::

        @router.post("/foo")
        async def foo(
            _: Annotated[None, Depends(enforce_rate_limit("foo", tenant_id_from_principal))],
        ):
            ...
    """
    try:
        return await tenant_rate_limiter.check(
            tenant_id=tenant_id,
            surface=surface,
            limit_per_minute=limit_per_minute,
        )
    except RateLimitExceeded as exc:
        from fastapi import HTTPException, status as _status

        raise HTTPException(
            status_code=_status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "rate_limit_exceeded",
                "surface": surface,
                "retry_after_seconds": exc.retry_after_seconds,
                "limit": exc.limit,
            },
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc


__all__ = [
    "RateLimitExceeded",
    "RateLimitResult",
    "TenantRateLimiter",
    "enforce_rate_limit",
    "tenant_rate_limiter",
]
