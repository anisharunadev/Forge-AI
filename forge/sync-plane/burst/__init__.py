"""
Sync Plane — Outbound rate limiter + circuit breaker + burst control.

Reference: ADR-0010 §7.1 (failure modes) + §8.1 (audit events) + §9 sub-task #6.
Issue:     FORA-267 (Epic 11.6, day-one P0 per Board `every_event` answer).

The four building blocks land in one package because they're composed in one
flow: `BurstController.submit(event)` → coalesce → priority queue → token-bucket
gate → adapter dispatch (or `breaker.record_*()` on the response).

This module is dependency-free (the same constraint as
`agents/sync_plane/__init__.py` carries) so the smoke test runs without
JetStream / Postgres / the adapter implementations.  Production wires
`dispatch_fn` to the real platform adapter; the smoke test wires a fake.

Public surface
--------------
    TokenBucket             — per-tenant refill-rate bucket (FORA-126 pattern)
    AdapterQueue            — per-platform priority queue
    Lane                    — SYSTEM / AGENT / HUMAN priority lanes
    Coalescer               — composite-edit window (default 250 ms)
    CircuitBreaker          — opens on 5xx/429 storm, closes on 2xx
    BreakerState            — CLOSED / OPEN / HALF_OPEN
    BurstController         — the composed entry point
    BurstAuditEvent         — audit row constants:
        BURST_CIRCUIT_OPEN  = "sync.burst_circuit_open"
        BURST_CIRCUIT_CLOSE = "sync.burst_circuit_close"
        BURST_COALESCE      = "sync.burst_coalesce"
    build_burst_audit_row   — pure factory routed through FORA-36 forwarder

All time inputs are millisecond floats and accept a `clock` callable so the
smoke test can drive deterministic time without `sleep()`.
"""

from .token_bucket import TokenBucket
from .queue import AdapterQueue, Lane, OutboundEvent
from .coalescer import Coalescer, CoalesceResult
from .breaker import CircuitBreaker, BreakerState
from .controller import BurstController, DispatchOutcome, DispatchResult
from .audit import (
    BURST_CIRCUIT_OPEN,
    BURST_CIRCUIT_CLOSE,
    BURST_COALESCE,
    BurstAuditEvent,
    build_burst_audit_row,
)

__all__ = [
    "TokenBucket",
    "AdapterQueue",
    "Lane",
    "OutboundEvent",
    "Coalescer",
    "CoalesceResult",
    "CircuitBreaker",
    "BreakerState",
    "BurstController",
    "DispatchOutcome",
    "DispatchResult",
    "BURST_CIRCUIT_OPEN",
    "BURST_CIRCUIT_CLOSE",
    "BURST_COALESCE",
    "BurstAuditEvent",
    "build_burst_audit_row",
]
