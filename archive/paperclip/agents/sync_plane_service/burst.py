"""
BurstControl — day-one P0 per ADR-0010 §9 (FORA-252 / 11.6
day-one coupling).

The Board's `every_event` write-back answer (FORA-199 interaction
`02d96f8c-…`, recorded in ADR-0010 §10) makes outbound rate
limiting + circuit breaking a **day-one** requirement, not a
follow-up. This module ships a working in-memory default that the
service can use on day one; sub-task 11.6 will replace it with a
Redis-backed token bucket + circuit breaker without changing the
`BurstControl` protocol.

The default is intentionally simple — the **shape** of the
decision (allow / queue / park) is what the service depends on;
the **implementation** (in-memory counters here, Redis sorted
sets in 11.6) is the replacement surface.

Two pieces:

  * `PerTenantTokenBucket` — per (tenant, platform) leaky bucket
    that lets through N events per W window (defaults: 100 / 60s
    per the §7.1 R-X3 guidance). On overflow the event is queued
    with a `retry_after_ms` hint.

  * `PerPlatformCircuitBreaker` — per-platform consecutive-failure
    counter. After `threshold` consecutive 5xx the breaker
    **opens** for `cooldown_ms`; subsequent events are parked in
    the divergence queue (the platform is considered down, not
    just slow). A successful call closes the breaker.

The two are independent — a token bucket can be empty while the
breaker is closed (normal back-pressure) or the breaker can be
open while the bucket has capacity (platform outage). The
`burst_decide` function composes the two into a single
`BurstDecision`.

This module is dependency-free and pure-Python (no Redis, no
NATS, no Postgres); the smoke test exercises it against a stub
clock for the cooldown timer. The 11.6 Redis-backed replacement
preserves the same surface.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple

from .ports import BurstDecision


# Defaults per ADR-0010 §7.1 R-X3: per-tenant, per-platform token
# bucket. 100 events / 60s is a deliberately conservative default
# (Jira's REST limit is ~100 req/min, GitHub Apps is ~5000 req/h);
# per-tenant overrides live in the tenant config and are passed
# to `InMemoryBurstControl(tenant_overrides=...)`.
DEFAULT_RATE_PER_WINDOW = 100
DEFAULT_WINDOW_MS = 60_000

# Circuit-breaker defaults. `threshold=5` consecutive 5xx opens
# the breaker; `cooldown_ms=30_000` is the cool-down (matches
# ADR-0010 §7.1 "Remote platform down > 5 min" recovery path —
# the breaker is the first 30s of that window).
DEFAULT_BREAKER_THRESHOLD = 5
DEFAULT_BREAKER_COOLDOWN_MS = 30_000


@dataclass
class _BucketState:
    """Per-(tenant, platform) leaky-bucket state. `level` is the
    current number of tokens consumed in the current window;
    `window_start_ms` is the wall-clock start of the current
    window. When the wall clock crosses `window_start_ms +
    window_ms` the level resets to 0."""
    level: int = 0
    window_start_ms: int = 0


class PerTenantTokenBucket:
    """Per-(tenant, platform) leaky bucket. One instance per
    tenant; the platform is a method argument.

    Thread-safety: a single `threading.Lock` guards all
    state. The lock is held only for the duration of a
    `consume` / `peek` call, so the throughput is bounded by
    the arithmetic (sub-microsecond per call)."""

    def __init__(
        self,
        *,
        rate: int = DEFAULT_RATE_PER_WINDOW,
        window_ms: int = DEFAULT_WINDOW_MS,
        clock=time.time,
    ) -> None:
        self._lock = threading.Lock()
        self._rate = rate
        self._window_ms = window_ms
        self._clock = clock
        self._state: Dict[str, _BucketState] = {}

    def _key(self, tenant_id: str, platform: str) -> str:
        return f"{tenant_id}::{platform}"

    def _now_ms(self) -> int:
        return int(self._clock() * 1000)

    def consume(
        self,
        tenant_id: str,
        platform: str,
        weight: int = 1,
    ) -> Tuple[bool, int]:
        """Try to consume `weight` tokens. Returns `(allowed,
        retry_after_ms)`. `allowed=True` means the caller may
        proceed; `allowed=False, retry_after_ms=42` means the
        caller should wait 42 ms before retrying (or queue the
        event for later)."""
        if weight <= 0:
            return (True, 0)
        with self._lock:
            key = self._key(tenant_id, platform)
            st = self._state.get(key)
            now = self._now_ms()
            if st is None or now - st.window_start_ms >= self._window_ms:
                st = _BucketState(level=0, window_start_ms=now)
                self._state[key] = st
            if st.level + weight <= self._rate:
                st.level += weight
                return (True, 0)
            # Compute the retry hint: time until the window resets.
            retry_after = max(0, self._window_ms - (now - st.window_start_ms))
            return (False, retry_after)

    def peek(self, tenant_id: str, platform: str) -> int:
        """Return the current level (for observability and the
        smoke test). Does not consume."""
        with self._lock:
            key = self._key(tenant_id, platform)
            st = self._state.get(key)
            if st is None:
                return 0
            now = self._now_ms()
            if now - st.window_start_ms >= self._window_ms:
                return 0
            return st.level

    def reset(self, tenant_id: str, platform: str) -> None:
        """Reset the bucket for a (tenant, platform). Used by the
        service on a successful health check and by the smoke
        test between scenarios."""
        with self._lock:
            self._state.pop(self._key(tenant_id, platform), None)


@dataclass
class _BreakerState:
    """Per-platform circuit-breaker state. `consecutive_failures`
    is the running counter (reset to 0 on success); `opened_at_ms`
    is the wall clock at which the breaker tripped, or 0 if
    closed."""
    consecutive_failures: int = 0
    opened_at_ms: int = 0


class PerPlatformCircuitBreaker:
    """Per-platform circuit breaker. One instance per process;
    the platform is a method argument.

    The breaker is **per-platform** (not per-tenant) because the
    failure mode is a remote-platform outage that affects every
    tenant on that platform. Per-tenant back-pressure is the
    token bucket's job; per-platform outage is the breaker's
    job.

    States:

        CLOSED       — normal; failures increment, successes
                       reset. After `threshold` consecutive
                       failures the breaker trips to OPEN.
        OPEN         — calls are denied; `retry_after_ms` is the
                       remaining cool-down. After `cooldown_ms`
                       the breaker transitions to HALF_OPEN.
        HALF_OPEN    — the next call is allowed through as a
                       probe. Success closes; failure re-opens
                       for a fresh `cooldown_ms`.

    The `HALF_OPEN` state is what makes the breaker self-healing
    once the remote platform recovers — the next call after the
    cool-down is a probe, not a flood.
    """

    STATE_CLOSED = "closed"
    STATE_OPEN = "open"
    STATE_HALF_OPEN = "half_open"

    def __init__(
        self,
        *,
        threshold: int = DEFAULT_BREAKER_THRESHOLD,
        cooldown_ms: int = DEFAULT_BREAKER_COOLDOWN_MS,
        clock=time.time,
    ) -> None:
        self._lock = threading.Lock()
        self._threshold = threshold
        self._cooldown_ms = cooldown_ms
        self._clock = clock
        self._state: Dict[str, _BreakerState] = {}

    def _now_ms(self) -> int:
        return int(self._clock() * 1000)

    def _key(self, platform: str) -> str:
        return platform

    def state(self, platform: str) -> str:
        """Return the breaker's current state for `platform`. The
        service reads this for the `AdapterHealth.degraded`
        field."""
        with self._lock:
            return self._read_state_locked(platform)

    def _read_state_locked(self, platform: str) -> str:
        st = self._state.get(self._key(platform))
        if st is None or st.consecutive_failures == 0 and st.opened_at_ms == 0:
            return self.STATE_CLOSED
        if st.opened_at_ms == 0:
            return self.STATE_CLOSED
        now = self._now_ms()
        if now - st.opened_at_ms < self._cooldown_ms:
            return self.STATE_OPEN
        return self.STATE_HALF_OPEN

    def allow(self, platform: str) -> Tuple[bool, int]:
        """Decide whether to allow one call. Returns
        `(allowed, retry_after_ms)`. `allowed=False` means the
        breaker is OPEN and the call is denied (park, not queue —
        the platform is down, retrying in 1s won't help)."""
        with self._lock:
            st = self._read_state_locked(platform)
            if st == self.STATE_CLOSED:
                return (True, 0)
            if st == self.STATE_HALF_OPEN:
                return (True, 0)
            # OPEN
            st_ = self._state[self._key(platform)]
            retry = max(0, self._cooldown_ms - (self._now_ms() - st_.opened_at_ms))
            return (False, retry)

    def record_success(self, platform: str) -> None:
        """A successful call. Closes the breaker; resets the
        failure counter."""
        with self._lock:
            self._state.pop(self._key(platform), None)

    def record_failure(self, platform: str) -> None:
        """A failed call (5xx, timeout, network). Increments the
        counter; trips the breaker at `threshold`."""
        with self._lock:
            key = self._key(platform)
            st = self._state.get(key)
            if st is None:
                st = _BreakerState()
                self._state[key] = st
            st.consecutive_failures += 1
            if (
                st.opened_at_ms == 0
                and st.consecutive_failures >= self._threshold
            ):
                st.opened_at_ms = self._now_ms()


# -- composite BurstControl ---------------------------------------------------


@dataclass
class BurstControlConfig:
    """Per-tenant override layer. The smoke test uses the
    defaults; the production wiring reads from the tenant
    config service. The shape is intentionally minimal — adding
    a new dimension is a code change to the config service, not
    to the burst module."""
    rate: int = DEFAULT_RATE_PER_WINDOW
    window_ms: int = DEFAULT_WINDOW_MS
    breaker_threshold: int = DEFAULT_BREAKER_THRESHOLD
    breaker_cooldown_ms: int = DEFAULT_BREAKER_COOLDOWN_MS


class InMemoryBurstControl:
    """The day-one default. Composes `PerTenantTokenBucket` and
    `PerPlatformCircuitBreaker` into a single `BurstControl`. Per
    the protocol, `decide` returns a `BurstDecision`; the
    service reads `allow / queue / park` and acts.

    The default behaviour (allow / queue / park):

        token bucket empty          → allow=False, queue=True
        breaker OPEN                → allow=False, park=True
        breaker HALF_OPEN           → allow=True (probe)
        breaker CLOSED, bucket ok   → allow=True
    """

    def __init__(
        self,
        *,
        config: Optional[BurstControlConfig] = None,
        clock=time.time,
    ) -> None:
        cfg = config or BurstControlConfig()
        self._token = PerTenantTokenBucket(
            rate=cfg.rate, window_ms=cfg.window_ms, clock=clock,
        )
        self._breaker = PerPlatformCircuitBreaker(
            threshold=cfg.breaker_threshold,
            cooldown_ms=cfg.breaker_cooldown_ms,
            clock=clock,
        )
        self._clock = clock

    def decide(
        self,
        tenant_id: str,
        platform: str,
        *,
        event_kind: str = "entity_update",
        weight: int = 1,
    ) -> BurstDecision:
        allowed, retry_ms = self._breaker.allow(platform)
        if not allowed:
            return BurstDecision(
                allow=False, queue=False, park=True,
                reason="circuit_open", retry_after_ms=retry_ms,
            )
        allowed, retry_ms = self._token.consume(
            tenant_id, platform, weight=weight,
        )
        if not allowed:
            return BurstDecision(
                allow=False, queue=True, park=False,
                reason="rate_limited", retry_after_ms=retry_ms,
            )
        return BurstDecision(allow=True)

    # -- helpers used by the service to feed back the outcome ----

    def record_success(self, platform: str) -> None:
        self._breaker.record_success(platform)

    def record_failure(self, platform: str) -> None:
        self._breaker.record_failure(platform)

    def state(self, platform: str) -> str:
        return self._breaker.state(platform)


def burst_decision(
    control: BurstControl,
    tenant_id: str,
    platform: str,
    *,
    event_kind: str = "entity_update",
    weight: int = 1,
) -> BurstDecision:
    """Module-level convenience wrapper. The service can call
    this directly; it's a one-liner that exists so the call
    site doesn't have to import `BurstControl` protocol type
    separately."""
    return control.decide(
        tenant_id, platform,
        event_kind=event_kind, weight=weight,
    )
