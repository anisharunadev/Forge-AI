"""F-800 Plan 5 — Per-user Co-pilot message rate limiting.

Caps at ``settings.copilot_rate_limit_per_min`` messages per
``(user_id, tenant_id)`` per rolling 60-second window. Sliding-window
implementation backed by an in-process ``deque`` (correct for V1 single-
worker + tests); a Redis path is sketched in :meth:`_check_redis` for
when a Redis client is added in a later plan.

Why per-user (not per-IP):
    - Same person from two devices should share a quota (workstation + laptop).
    - Same NAT'd IP should NOT share a quota (corporate office).

Why in-process for V1:
    - Forge's V1 deployment is single-worker (uvicorn, no gunicorn fanout).
    - Tests use SQLite + a single in-process event bus; adding a Redis
      dependency here would force every test to spin one up.
    - The semantics (sliding window per ``(user, tenant)``) are identical
      to a Redis ZSET implementation; the in-process deque is the
      authoritative implementation. A future multi-worker deployment can
      swap in :meth:`_check_redis` without changing the public surface.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Any
from uuid import UUID

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class RateLimitExceeded(Exception):
    """Raised when a user exceeds their Co-pilot message rate limit."""

    def __init__(self, retry_after_seconds: int) -> None:
        self.retry_after_seconds = retry_after_seconds
        super().__init__(f"rate limit exceeded; retry after {retry_after_seconds}s")


class CoPilotRateLimiter:
    """Sliding-window rate limiter.

    At most ``max_per_minute`` events per rolling 60-second window keyed
    by ``(user_id, tenant_id)``. The in-process implementation is correct
    for single-worker deployments and tests; a Redis ZSET backend is
    stubbed for the multi-worker case (see :meth:`_check_redis`).
    """

    def __init__(self, max_per_minute: int | None = None) -> None:
        self._max = max_per_minute or settings.copilot_rate_limit_per_min
        self._window_seconds = 60
        # In-process fallback keyed by ``(tenant_id, user_id)`` (string).
        self._fallback: dict[tuple[str, str], deque[float]] = defaultdict(deque)

    # ------------------------------------------------------------------
    # Public surface
    # ------------------------------------------------------------------

    async def check_and_record(self, user_id: UUID | str, tenant_id: UUID | str) -> None:
        """Record one event for ``(user_id, tenant_id)``; raise on overflow.

        Args:
            user_id: Authenticated user UUID.
            tenant_id: Authenticated tenant UUID.

        Raises:
            RateLimitExceeded: If the user has already submitted
                ``max_per_minute`` messages within the trailing 60s.
        """
        key = (str(tenant_id), str(user_id))
        now = time.monotonic()
        window_start = now - self._window_seconds

        self._check_inprocess(key, now, window_start)

    def reset(self) -> None:
        """Clear all in-process counters. Test-only helper."""
        self._fallback.clear()

    # ------------------------------------------------------------------
    # In-process implementation
    # ------------------------------------------------------------------

    def _check_inprocess(self, key: tuple[str, str], now: float, window_start: float) -> None:
        dq = self._fallback[key]
        # Evict entries that fell out of the trailing window.
        while dq and dq[0] < window_start:
            dq.popleft()
        if len(dq) >= self._max:
            # Compute a sane retry-after: time until the oldest entry
            # exits the window, rounded up to the next second.
            retry_after = int(self._window_seconds - (now - dq[0])) + 1
            logger.warning(
                "copilot.rate_limit.exceeded",
                tenant_id=key[0],
                user_id=key[1],
                count=len(dq),
                limit=self._max,
            )
            raise RateLimitExceeded(retry_after_seconds=retry_after)
        dq.append(now)

    # ------------------------------------------------------------------
    # Redis implementation (stubbed)
    # ------------------------------------------------------------------

    async def _check_redis(
        self,
        redis: Any,
        key: str,
        now: float,
        window_start: float,
    ) -> None:
        """Sliding-window via Redis sorted set.

        Not wired in V1 because no Redis client ships with the current
        backend; left here as the reference for a future multi-worker
        deployment. To enable, swap :meth:`check_and_record` to call
        ``await self._get_redis()`` and dispatch to this method.
        """
        member = f"{now}:{id(object())}"
        pipe = redis.pipeline()
        pipe.zremrangebyscore(key, 0, window_start)
        pipe.zcard(key)
        pipe.zadd(key, {member: now})
        pipe.expire(key, self._window_seconds + 1)
        results = await pipe.execute()
        count_before_add = results[1]
        if count_before_add >= self._max:
            # Roll back the add we just did — we never got the slot.
            await redis.zrem(key, member)
            retry_after = self._window_seconds
            logger.warning(
                "copilot.rate_limit.exceeded",
                redis_key=key,
                count=count_before_add,
                limit=self._max,
            )
            raise RateLimitExceeded(retry_after_seconds=retry_after)


# Module-level singleton — process-wide, per-(user,tenant) sliding window.
copilot_rate_limiter = CoPilotRateLimiter()


__all__ = [
    "CoPilotRateLimiter",
    "RateLimitExceeded",
    "copilot_rate_limiter",
]
