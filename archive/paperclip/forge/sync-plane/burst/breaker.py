"""
Per-platform circuit breaker.

ADR-0010 §7.1 — "Remote platform down > 5 min → Adapter's circuit breaker
trips on consecutive 5xx → Queue in `sync.outbox.<platform>`; rate-limit
retries per platform token bucket; emit `sync.platform.degraded`"
ADR-0010 §8.2 R-SYNC-03 — "circuit breaker trips on burst"
FORA-267 AC: "Circuit breaker — when an adapter returns 5xx or 429 in a
window, the queue pauses for that adapter and emits a `sync.burst_circuit_open`
audit event."

State machine
-------------

         CLOSED
           │   any 5xx/429 inside window AND failures >= fail_threshold
           ▼
         OPEN ────── stays OPEN for `cooldown_ms`
           │
           ▼ (cooldown_ms elapsed)
        HALF_OPEN
           │  first probe response:
           │    2xx → CLOSED  (emit `sync.burst_circuit_close`)
           │    5xx/429 → OPEN  (emit nothing; re-arm cooldown)
           ▼

The breaker is *per-adapter* — one breaker per (tenant_id, platform).  This
matches the §8.2 R-SYNC-03 control: a misbehaving Jira instance must not
pause GitHub for the same tenant.

The breaker tracks `failures` in a sliding window of `window_ms`; older
samples are evicted lazily on every `record_*` call.  No background thread.
"""

from __future__ import annotations

import collections
import enum
from dataclasses import dataclass, field
from typing import Callable, Deque, Optional


class BreakerState(enum.Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


# Status-code semantics matched to the §7.1 row.  We intentionally do NOT
# trip on 4xx other than 429 — those are client errors and would otherwise
# break the breaker on a misformed payload (a non-quenchable storm).
def _is_failure_status(status: int) -> bool:
    return status == 429 or 500 <= status < 600


def _default_clock_ms() -> float:
    import time
    return time.monotonic() * 1000.0


@dataclass
class CircuitBreaker:
    """One breaker per (tenant_id, platform).

    `fail_threshold` — minimum failures in the window to trip
    `window_ms`      — sliding-window length for the failure count
    `cooldown_ms`    — OPEN → HALF_OPEN duration
    """

    fail_threshold: int = 5
    window_ms: int = 10_000
    cooldown_ms: int = 30_000
    clock_ms: Callable[[], float] = field(default=_default_clock_ms)

    _state: BreakerState = field(default=BreakerState.CLOSED, init=False)
    _failures: Deque[float] = field(default_factory=collections.deque, init=False)
    _opened_at_ms: Optional[float] = field(default=None, init=False)

    def __post_init__(self) -> None:
        if self.fail_threshold <= 0:
            raise ValueError("fail_threshold must be > 0")
        if self.window_ms <= 0:
            raise ValueError("window_ms must be > 0")
        if self.cooldown_ms <= 0:
            raise ValueError("cooldown_ms must be > 0")

    @property
    def state(self) -> BreakerState:
        # Lazy transition OPEN → HALF_OPEN once cooldown elapses.
        if self._state is BreakerState.OPEN and self._opened_at_ms is not None:
            now = float(self.clock_ms())
            if now - self._opened_at_ms >= self.cooldown_ms:
                self._state = BreakerState.HALF_OPEN
        return self._state

    @property
    def failure_count(self) -> int:
        self._evict_old()
        return len(self._failures)

    def allow_request(self) -> bool:
        """Should the controller forward an outbound event right now?
        - CLOSED:    yes
        - OPEN:      no (the queue pauses; events accumulate)
        - HALF_OPEN: yes for *one* probe — the next record_success/failure
                     resolves the state.
        """
        return self.state in (BreakerState.CLOSED, BreakerState.HALF_OPEN)

    def record_response(self, status: int) -> _Transition:
        """Record an adapter response.  Returns the transition delta so the
        controller can decide whether to emit an audit event.
        """
        if _is_failure_status(status):
            return self._record_failure()
        return self._record_success()

    def force_close(self) -> _Transition:
        """Test-only / operator-only force-close.  Returns a transition if
        we actually moved from OPEN/HALF_OPEN to CLOSED."""
        prev = self._state
        if prev is BreakerState.CLOSED:
            return _Transition(prev=prev, curr=prev, became_open=False, became_closed=False)
        self._state = BreakerState.CLOSED
        self._failures.clear()
        self._opened_at_ms = None
        return _Transition(prev=prev, curr=BreakerState.CLOSED, became_open=False, became_closed=True)

    # ------------- internals -------------

    def _record_success(self) -> _Transition:
        state_in = self.state
        if state_in is BreakerState.HALF_OPEN:
            # Probe passed — close the breaker, drop the failure history.
            self._state = BreakerState.CLOSED
            self._failures.clear()
            self._opened_at_ms = None
            return _Transition(prev=state_in, curr=BreakerState.CLOSED, became_open=False, became_closed=True)
        if state_in is BreakerState.CLOSED:
            # Success outside the half-open probe path doesn't change state,
            # but we still age the failure window (a long burst of successes
            # implicitly clears earlier failures via _evict_old).
            self._evict_old()
            return _Transition(prev=state_in, curr=state_in, became_open=False, became_closed=False)
        # OPEN — should not happen because allow_request() would have refused,
        # but we tolerate the call (e.g., a stale response) without state change.
        return _Transition(prev=state_in, curr=state_in, became_open=False, became_closed=False)

    def _record_failure(self) -> _Transition:
        state_in = self.state
        now = float(self.clock_ms())
        if state_in is BreakerState.HALF_OPEN:
            # Probe failed — re-arm the cooldown.
            self._state = BreakerState.OPEN
            self._opened_at_ms = now
            return _Transition(prev=state_in, curr=BreakerState.OPEN, became_open=False, became_closed=False)
        if state_in is BreakerState.OPEN:
            # Already open; refresh the opened-at so cooldown is from the
            # latest failure.  No audit transition.
            return _Transition(prev=state_in, curr=state_in, became_open=False, became_closed=False)
        # CLOSED.
        self._failures.append(now)
        self._evict_old()
        if len(self._failures) >= self.fail_threshold:
            self._state = BreakerState.OPEN
            self._opened_at_ms = now
            return _Transition(prev=state_in, curr=BreakerState.OPEN, became_open=True, became_closed=False)
        return _Transition(prev=state_in, curr=state_in, became_open=False, became_closed=False)

    def _evict_old(self) -> None:
        if not self._failures:
            return
        cutoff = float(self.clock_ms()) - self.window_ms
        while self._failures and self._failures[0] < cutoff:
            self._failures.popleft()


@dataclass(frozen=True)
class _Transition:
    """Result of a `record_*` call — minimal delta for the controller."""
    prev: BreakerState
    curr: BreakerState
    became_open: bool
    became_closed: bool
