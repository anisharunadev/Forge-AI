"""Phase 6 SC-6.4 — graceful degradation queue when LiteLLM is slow/down.

Redis-backed bounded FIFO. When LiteLLM is unreachable, incoming chat
requests are queued (size = ``Tenant.settings['max_queue_size']``,
default 100). On overflow the call returns 503 + ``Retry-After``.

Reads the size from ``Tenant.settings['max_queue_size']`` per tenant
(default ``settings.degradation_queue_max`` = 100).

ponytail: a single Redis LIST per tenant is fine up to ~10k items;
above that, partition by hash bucket. Phase 6 default 100 needs no
sharding.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select

from app.core.config import settings
from app.core.logging import get_logger
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory

logger = get_logger(__name__)


class QueueFull(Exception):
    def __init__(self, retry_after_seconds: int = 5) -> None:
        self.retry_after_seconds = retry_after_seconds
        super().__init__(f"queue full; retry in {retry_after_seconds}s")


class QueuedForLater(Exception):
    """Returned to the HTTP layer so it can emit 202 + X-Forge-Queued."""

    def __init__(self, request_id: str, tenant_id: UUID) -> None:
        self.request_id = request_id
        self.tenant_id = tenant_id
        super().__init__(
            f"queued for later; request_id={request_id} tenant={tenant_id}"
        )


@dataclass
class QueueEntry:
    request_id: UUID
    tenant_id: UUID
    enqueued_at: float


class DegradationQueue:
    def __init__(self, redis_client: Any | None = None) -> None:
        self._redis = redis_client

    async def _get_redis(self) -> Any | None:
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
            logger.warning("degradation_queue.redis_unavailable")
            return None

    async def _max_size(self, tenant_id: UUID) -> int:
        """Per-tenant ceiling; default ``settings.degradation_queue_max``."""
        factory = get_session_factory()
        async with factory() as session:
            row = (
                await session.execute(
                    select(Tenant).where(Tenant.id == tenant_id)
                )
            ).scalar_one_or_none()
        if row is None:
            return settings.degradation_queue_max
        v = (row.settings or {}).get("max_queue_size")
        return int(v) if v is not None else settings.degradation_queue_max

    async def enqueue(
        self,
        *,
        tenant_id: UUID,
        payload: bytes = b"",
    ) -> QueueEntry:
        """Enqueue one request for ``tenant_id``; raise ``QueueFull`` on overflow."""
        redis = await self._get_redis()
        if redis is None:
            # Without Redis the queue is best-effort: every enqueue succeeds,
            # the operator reviews LiteLLM-down events via the audit log.
            entry = QueueEntry(
                request_id=uuid4(),
                tenant_id=tenant_id,
                enqueued_at=time.monotonic(),
            )
            logger.info(
                "degradation_queue.enqueued_inprocess",
                tenant_id=str(tenant_id),
                request_id=str(entry.request_id),
            )
            return entry

        max_size = await self._max_size(tenant_id)
        current = await redis.llen(f"llm-queue:{tenant_id}")
        if current >= max_size:
            raise QueueFull(retry_after_seconds=5)
        entry = QueueEntry(
            request_id=uuid4(),
            tenant_id=tenant_id,
            enqueued_at=time.monotonic(),
        )
        await redis.lpush(
            f"llm-queue:{tenant_id}",
            f"{entry.request_id}|{entry.enqueued_at}".encode("utf-8"),
        )
        await redis.expire(
            f"llm-queue:{tenant_id}",
            settings.degradation_queue_ttl_seconds,
        )
        return entry

    async def drain(self, tenant_id: UUID) -> list[QueueEntry]:
        """Pop and return all queued entries for ``tenant_id``.

        Called by the recovery worker (Phase 7) when LiteLLM is back.
        Phase 6 only ships ``enqueue``; the drain side is a follow-up.
        """
        redis = await self._get_redis()
        if redis is None:
            return []
        items = await redis.lrange(f"llm-queue:{tenant_id}", 0, -1)
        await redis.delete(f"llm-queue:{tenant_id}")
        out: list[QueueEntry] = []
        for raw in items or []:
            try:
                rid, ts = raw.split("|", 1)
                out.append(
                    QueueEntry(
                        request_id=UUID(rid),
                        tenant_id=tenant_id,
                        enqueued_at=float(ts),
                    )
                )
            except Exception:  # noqa: BLE001
                continue
        return out


degradation_queue = DegradationQueue()


__all__ = [
    "DegradationQueue",
    "QueuedForLater",
    "QueueEntry",
    "QueueFull",
    "degradation_queue",
]
