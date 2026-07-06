"""Freshness ledger (DL-027 — every graph node has freshness metadata).

The Apache AGE knowledge graph is only useful if we know how fresh each
node is. The freshness ledger is the single place where freshness is
read or written; every node creation in graph-writers MUST call
`mark_fresh(...)` immediately after persisting.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import redis.asyncio as aioredis

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_TTL_SECONDS = 7 * 24 * 3600  # ledger entries auto-expire after 7 days


@dataclass
class FreshnessRecord:
    node_id: str
    source: str
    at: datetime
    metadata: dict[str, Any]


class FreshnessLedger:
    """Redis-backed freshness tracker.

    Keys: `forge:freshness:<tenant_id>:<node_id>` -> JSON record.
    """

    def __init__(self, redis_url: str | None = None) -> None:
        self._redis_url = redis_url or settings.redis_url
        self._redis: aioredis.Redis | None = None

    async def _client(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(self._redis_url, decode_responses=True)
        return self._redis

    async def close(self) -> None:
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None

    @staticmethod
    def _key(tenant_id: UUID | str, node_id: str) -> str:
        return f"forge:freshness:{tenant_id}:{node_id}"

    async def mark_fresh(
        self,
        node_id: str,
        source: str,
        at: datetime | None = None,
        *,
        tenant_id: UUID | str,
        metadata: dict[str, Any] | None = None,
    ) -> FreshnessRecord:
        """Record that `node_id` is fresh as of `at` (default = now).

        Should be called by every Apache AGE node writer immediately
        after persisting the node.
        """
        record = FreshnessRecord(
            node_id=node_id,
            source=source,
            at=at or datetime.now(UTC),
            metadata=metadata or {},
        )
        payload = asdict(record)
        payload["at"] = record.at.isoformat()
        client = await self._client()
        await client.set(self._key(tenant_id, node_id), json.dumps(payload), ex=_TTL_SECONDS)
        logger.debug(
            "freshness.marked",
            node_id=node_id,
            source=source,
            tenant_id=str(tenant_id),
        )
        return record

    async def get_freshness(self, node_id: str, *, tenant_id: UUID | str) -> FreshnessRecord | None:
        """Return the freshness record for a node, or None if unknown."""
        client = await self._client()
        raw = await client.get(self._key(tenant_id, node_id))
        if raw is None:
            return None
        data = json.loads(raw)
        data["at"] = datetime.fromisoformat(data["at"])
        return FreshnessRecord(**data)

    async def is_stale(
        self,
        node_id: str,
        max_age_seconds: int,
        *,
        tenant_id: UUID | str,
        now: datetime | None = None,
    ) -> bool:
        """Return True if the node is older than `max_age_seconds` or absent."""
        record = await self.get_freshness(node_id, tenant_id=tenant_id)
        if record is None:
            return True
        current = now or datetime.now(UTC)
        return (current - record.at).total_seconds() > max_age_seconds


freshness_ledger = FreshnessLedger()


__all__ = ["FreshnessLedger", "FreshnessRecord", "freshness_ledger"]
