"""
BurstController — composes TokenBucket + AdapterQueue + Coalescer + CircuitBreaker.

ADR-0010 §7.1 / §8.2 R-SYNC-03 / FORA-267 §Components.

End-to-end flow for one outbound event
--------------------------------------

  caller.submit(event, now_ms)
      │
      ▼
  Coalescer.accept(event, now_ms)   ── non-coalescable kinds bypass
      │                                   (transitions, system events)
      ▼
  (controller ticks; flush_due returns ready events)
      │
      ▼
  AdapterQueue.enqueue(event)        ── per (tenant, platform) priority queue
      │
      ▼
  controller.drain(now_ms, max_n)
      │
      ▼
  for each dequeued event:
      breaker.allow_request()?       ── OPEN → re-queue, skip
      bucket.take()?                 ── empty → re-queue, skip
      dispatch_fn(event) → status
      breaker.record_response(status)
        ── transition delta emits sync.burst_circuit_open / _close

Latency
-------
Every dequeue path computes `queue_latency_ms = now_ms - event.enqueued_at_ms`
and feeds it into a per-platform p99 sample (P-square approximation kept
in-process for the load-test).  This is the AC #2 measurement.
"""

from __future__ import annotations

import enum
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from .audit import (
    BURST_CIRCUIT_CLOSE,
    BURST_CIRCUIT_OPEN,
    BURST_COALESCE,
    BurstAuditRow,
    build_burst_audit_row,
)
from .breaker import BreakerState, CircuitBreaker
from .coalescer import Coalescer, CoalesceResult
from .queue import AdapterQueue, Lane, OutboundEvent
from .token_bucket import TokenBucket


class DispatchOutcome(enum.Enum):
    DISPATCHED = "dispatched"
    BREAKER_OPEN = "breaker_open"
    BUCKET_EMPTY = "bucket_empty"
    QUEUE_OVERFLOW = "queue_overflow"


@dataclass
class DispatchResult:
    event: OutboundEvent
    outcome: DispatchOutcome
    status: int = 0
    queue_latency_ms: float = 0.0


# `dispatch_fn(event) -> status_code` is injected by production wiring.
# The smoke / load test passes a fake that returns 200 unless told to fail.
DispatchFn = Callable[[OutboundEvent], int]


@dataclass
class _AdapterContext:
    queue: AdapterQueue
    breaker: CircuitBreaker
    # Latency p99 — Welford-ish keyed on rolling window
    latencies_ms: List[float] = field(default_factory=list)


# A `(tenant_id, platform)` key — bucket and queue are scoped together.
_AdapterKey = Tuple[str, str]


def _default_clock_ms() -> float:
    return time.monotonic() * 1000.0


class BurstController:
    """The composed entry point for outbound burst control.

    One controller is created per Sync-Plane hub instance.  Tenants and
    platforms are discovered lazily on first `submit()`.

    Configuration is `per_platform_config`: a dict whose keys are platform
    names (`"jira"`, `"github"`, `"clickup"`) and whose values are
    `PlatformConfig` instances.  Per-tenant overrides live in `tenant_overrides`.
    """

    def __init__(
        self,
        *,
        per_platform_config: Dict[str, "PlatformConfig"],
        tenant_overrides: Optional[Dict[Tuple[str, str], "PlatformConfig"]] = None,
        clock_ms: Callable[[], float] = _default_clock_ms,
        coalesce_window_ms: int = Coalescer.DEFAULT_WINDOW_MS,
        audit_sink: Optional[Callable[[BurstAuditRow], None]] = None,
    ) -> None:
        if not per_platform_config:
            raise ValueError("per_platform_config cannot be empty")
        self._cfg = dict(per_platform_config)
        self._overrides = dict(tenant_overrides or {})
        self._clock_ms = clock_ms
        self._coalescer = Coalescer(window_ms=coalesce_window_ms)
        self._adapters: Dict[_AdapterKey, _AdapterContext] = {}
        self._buckets: Dict[_AdapterKey, TokenBucket] = {}
        self._audit_sink = audit_sink or (lambda row: None)
        self._audit_log: List[BurstAuditRow] = []   # in-process tap for tests

    # ------------- public surface -------------

    @property
    def audit_log(self) -> List[BurstAuditRow]:
        """In-process audit log — populated whether or not `audit_sink` is set.
        Used by the smoke/load test to assert events were emitted."""
        return list(self._audit_log)

    def submit(self, event: OutboundEvent) -> None:
        """Stage one outbound event for the burst pipeline."""
        now_ms = float(self._clock_ms())
        if not event.id:
            event.id = str(uuid.uuid4())
        event.enqueued_at_ms = now_ms
        result = self._coalescer.accept(event, now_ms)
        if result is not None:
            # Non-coalescable kind — go straight to the queue.
            self._enqueue(result.event, now_ms, merged_count=1)

    def tick(self, now_ms: Optional[float] = None) -> None:
        """Flush expired coalesce buffers into the queue.  Idempotent."""
        ts = float(now_ms if now_ms is not None else self._clock_ms())
        for result in self._coalescer.flush_due(ts):
            self._enqueue(result.event, ts, merged_count=result.merged_count)

    def drain(
        self,
        *,
        dispatch_fn: DispatchFn,
        max_n: int = 64,
        now_ms: Optional[float] = None,
    ) -> List[DispatchResult]:
        """Pull up to `max_n` events across all adapters and dispatch them.

        Returns one `DispatchResult` per attempted dispatch; events that
        couldn't be sent (breaker open, bucket empty) are re-queued and
        reported with the matching outcome.
        """
        ts = float(now_ms if now_ms is not None else self._clock_ms())
        out: List[DispatchResult] = []
        for _ in range(max_n):
            picked = self._pick_next()
            if picked is None:
                break
            key, event = picked
            ctx = self._adapters[key]
            bucket = self._buckets[key]

            if not ctx.breaker.allow_request():
                # Breaker open — re-queue at the front (same lane, FIFO retains
                # by re-enqueue at the heap tail; system events bypass).
                ctx.queue.enqueue(event)
                out.append(DispatchResult(event=event, outcome=DispatchOutcome.BREAKER_OPEN))
                continue

            if not bucket.take():
                ctx.queue.enqueue(event)
                out.append(DispatchResult(event=event, outcome=DispatchOutcome.BUCKET_EMPTY))
                # Bucket empty for this adapter — stop draining this adapter
                # for this tick; other adapters still get a chance via _pick_next.
                continue

            status = int(dispatch_fn(event))
            queue_latency = max(0.0, ts - event.enqueued_at_ms)
            ctx.latencies_ms.append(queue_latency)
            transition = ctx.breaker.record_response(status)
            self._maybe_emit_breaker_event(key, transition)
            out.append(
                DispatchResult(
                    event=event,
                    outcome=DispatchOutcome.DISPATCHED,
                    status=status,
                    queue_latency_ms=queue_latency,
                )
            )
        return out

    def force_flush(self) -> None:
        """Drain coalescer into queues without any dispatch.  Test helper."""
        ts = float(self._clock_ms())
        for result in self._coalescer.flush_all():
            self._enqueue(result.event, ts, merged_count=result.merged_count)

    def queue_depth(self, tenant_id: str, platform: str) -> int:
        key = (tenant_id, platform)
        ctx = self._adapters.get(key)
        return 0 if ctx is None else ctx.queue.depth

    def breaker_state(self, tenant_id: str, platform: str) -> Optional[BreakerState]:
        key = (tenant_id, platform)
        ctx = self._adapters.get(key)
        return None if ctx is None else ctx.breaker.state

    def p99_queue_latency_ms(self, tenant_id: str, platform: str) -> float:
        key = (tenant_id, platform)
        ctx = self._adapters.get(key)
        if ctx is None or not ctx.latencies_ms:
            return 0.0
        # Use the exact 99th percentile — the load test only collects
        # a few thousand samples so we don't need a streaming estimator.
        s = sorted(ctx.latencies_ms)
        # Index of p99 in a sorted list of length N.
        idx = max(0, int(0.99 * (len(s) - 1)))
        return s[idx]

    # ------------- internals -------------

    def _enqueue(self, event: OutboundEvent, now_ms: float, *, merged_count: int) -> None:
        key = (event.tenant_id, event.platform)
        ctx = self._adapter(key)
        # Mark when it actually entered the queue (post-coalesce).
        event.enqueued_at_ms = now_ms
        accepted = ctx.queue.enqueue(event)
        if not accepted:
            # Overflow — treat as an internal 500: trip the breaker on
            # the queue side.  This is the "queue has a hard ceiling"
            # path in R-SYNC-08.
            transition = ctx.breaker.record_response(500)
            self._maybe_emit_breaker_event(key, transition)
            return
        if merged_count >= 2:
            self._emit_audit(
                event_type=BURST_COALESCE,
                tenant_id=event.tenant_id,
                actor=f"sync-plane:burst:{event.platform}",
                metadata={
                    "platform": event.platform,
                    "remote_issue_id": event.remote_issue_id,
                    "event_kind": event.event_kind,
                    "merged_count": merged_count,
                    "coalesced_ids": list(event.coalesced_ids),
                },
            )

    def _pick_next(self) -> Optional[Tuple[_AdapterKey, OutboundEvent]]:
        """Cross-adapter round-robin-ish picker — earliest enqueue wins,
        ties broken by lane priority (SYSTEM > HUMAN > AGENT)."""
        best_key: Optional[_AdapterKey] = None
        best_lane: Optional[Lane] = None
        for key, ctx in self._adapters.items():
            lane = ctx.queue.peek_lane()
            if lane is None:
                continue
            # Prefer the adapter with the most urgent lane; within the same
            # lane we just round-robin via dict-iteration order (Python dicts
            # are insertion-ordered, which gives us a deterministic order).
            if best_lane is None or int(lane) < int(best_lane):
                best_lane = lane
                best_key = key
        if best_key is None:
            return None
        ctx = self._adapters[best_key]
        event = ctx.queue.dequeue()
        if event is None:
            return None
        return best_key, event

    def _adapter(self, key: _AdapterKey) -> _AdapterContext:
        ctx = self._adapters.get(key)
        if ctx is not None:
            return ctx
        cfg = self._overrides.get(key) or self._cfg.get(key[1])
        if cfg is None:
            raise KeyError(f"no PlatformConfig for {key[1]!r}")
        breaker = CircuitBreaker(
            fail_threshold=cfg.breaker_fail_threshold,
            window_ms=cfg.breaker_window_ms,
            cooldown_ms=cfg.breaker_cooldown_ms,
            clock_ms=self._clock_ms,
        )
        queue = AdapterQueue(max_depth=cfg.queue_max_depth)
        self._adapters[key] = _AdapterContext(queue=queue, breaker=breaker)
        self._buckets[key] = TokenBucket(
            capacity=cfg.bucket_capacity,
            refill_rate_per_s=cfg.bucket_refill_per_s,
            clock_ms=self._clock_ms,
        )
        return self._adapters[key]

    def _maybe_emit_breaker_event(self, key: _AdapterKey, transition) -> None:
        tenant_id, platform = key
        if transition.became_open:
            ctx = self._adapters[key]
            self._emit_audit(
                event_type=BURST_CIRCUIT_OPEN,
                tenant_id=tenant_id,
                actor=f"sync-plane:breaker:{platform}",
                metadata={
                    "platform": platform,
                    "failure_count": int(ctx.breaker.fail_threshold),
                    "window_ms": int(ctx.breaker.window_ms),
                },
            )
        elif transition.became_closed:
            ctx = self._adapters[key]
            # Reset the bucket on close so a long-paused tenant doesn't get
            # a sudden credit burst the moment the breaker recovers.
            self._buckets[key].reset()
            self._emit_audit(
                event_type=BURST_CIRCUIT_CLOSE,
                tenant_id=tenant_id,
                actor=f"sync-plane:breaker:{platform}",
                metadata={
                    "platform": platform,
                    "cooldown_ms": int(ctx.breaker.cooldown_ms),
                },
            )

    def _emit_audit(
        self,
        *,
        event_type: str,
        tenant_id: str,
        actor: str,
        metadata: Dict[str, Any],
    ) -> None:
        row = build_burst_audit_row(
            event_type=event_type,
            tenant_id=tenant_id,
            actor=actor,
            metadata=metadata,
        )
        self._audit_log.append(row)
        self._audit_sink(row)


@dataclass(frozen=True)
class PlatformConfig:
    """Per-platform burst-control configuration.

    Defaults follow the §7.1 row: trip on 5 failures in 10 s, recover after
    30 s, allow ~10 outbound events / second per tenant by default.  Real
    production picks per-platform values from the platform's documented
    burst limits (Jira ~10/s, GitHub ~5000/h, ClickUp ~100/min).
    """
    bucket_capacity: float = 10.0
    bucket_refill_per_s: float = 10.0
    queue_max_depth: int = 10_000
    breaker_fail_threshold: int = 5
    breaker_window_ms: int = 10_000
    breaker_cooldown_ms: int = 30_000
