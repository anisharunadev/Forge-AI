"""
Per-tenant token bucket.

ADR-0010 §7.1 — "rate-limit retries per platform token bucket"
ADR-0010 §8.2 R-SYNC-03 — "per-tenant token bucket; per-remote burst control"

This is the *outbound* gate: every outbound event must `take()` a token
before the adapter is called.  Refill is monotonic-clock driven, but the
caller injects the clock so the load-test can advance time deterministically.

Independent of `breaker.py`: the breaker pauses *all* tokens for a platform
when the storm hits; the bucket throttles *one* tenant when it bursts.

Failure-mode mapping
--------------------
    R-SYNC-03 (comment-storm DoS):   take() returns False → caller queues
    R-SYNC-08 (per-tenant rate edge): the same path

Refill semantics
----------------
    capacity     — max tokens the bucket can hold
    refill_rate  — tokens per second (float; can be sub-1.0 for slow tenants)
    clock_ms     — () -> float in milliseconds; injected for tests
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional


def _default_clock_ms() -> float:
    # Pure-Python clock; importable without `time` at module load
    # so the smoke test stays deterministic.  The caller in production
    # passes `time.monotonic` × 1000 (see controller.py).
    import time
    return time.monotonic() * 1000.0


@dataclass
class TokenBucket:
    """One bucket per (tenant_id, platform).

    The bucket starts full at `capacity` tokens.  Every `take()` consumes
    one token and refills based on `clock_ms() - last_refill_ms`.
    """

    capacity: float
    refill_rate_per_s: float
    clock_ms: Callable[[], float] = field(default=_default_clock_ms)
    _tokens: float = field(default=0.0, init=False)
    _last_refill_ms: float = field(default=0.0, init=False)

    def __post_init__(self) -> None:
        if self.capacity <= 0:
            raise ValueError("capacity must be > 0")
        if self.refill_rate_per_s <= 0:
            raise ValueError("refill_rate_per_s must be > 0")
        self._tokens = float(self.capacity)
        self._last_refill_ms = float(self.clock_ms())

    def _refill(self) -> None:
        now_ms = float(self.clock_ms())
        elapsed_ms = max(0.0, now_ms - self._last_refill_ms)
        if elapsed_ms <= 0:
            return
        gained = (elapsed_ms / 1000.0) * self.refill_rate_per_s
        self._tokens = min(self.capacity, self._tokens + gained)
        self._last_refill_ms = now_ms

    def take(self, n: float = 1.0) -> bool:
        """Try to take `n` tokens.  Returns True on success, False if the
        bucket would underflow.  The bucket is never partially drained."""
        if n <= 0:
            raise ValueError("n must be > 0")
        self._refill()
        if self._tokens >= n:
            self._tokens -= n
            return True
        return False

    @property
    def tokens(self) -> float:
        """Refilled-as-of-now token count.  Refills as a side-effect; this
        is what callers should read for diagnostics."""
        self._refill()
        return self._tokens

    @property
    def is_full(self) -> bool:
        return self.tokens >= self.capacity

    def reset(self) -> None:
        """Reset to a full bucket and re-anchor the refill clock.  The
        breaker uses this on a `close()` transition so a long-paused
        tenant doesn't get a sudden burst credit."""
        self._tokens = float(self.capacity)
        self._last_refill_ms = float(self.clock_ms())
