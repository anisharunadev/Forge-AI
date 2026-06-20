"""
Smoke test for the burst-control package — FORA-267 / Epic 11.6.

Run as:
    python -m forge.sync_plane.burst.tests.test_smoke

This file is self-contained: it does NOT use pytest so it can run in the
Paperclip smoke-test sandbox without an extra dep.  All assertions are
counted and the final line prints `RESULT: ok=N fail=M`.

Coverage maps to FORA-267 ACs:

    AC #1: Token-bucket + queue implemented in forge/sync-plane/burst/
           → tested via T-001 .. T-099 below
    AC #2: Load test at 3× expected per-tenant event rate (60 s, no drops,
           p99 < 200 ms queue latency)
           → T-LOAD
    AC #3: Circuit breaker fires on simulated 5xx storm; recovers on 2xx
           → T-BREAK-OPEN, T-BREAK-CLOSE
    AC #4: Audit events emitted: sync.burst_circuit_open / _close / _coalesce
           → T-AUDIT-*
    AC #5: 30+ assertions + load-test fixture
           → counted at the end (target: > 100)
"""

from __future__ import annotations

import importlib
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

# ---- Path bootstrap: package lives at forge/sync-plane/burst (dash, not
# underscore).  We import it as `burst` for ergonomics.

# test_smoke.py lives at forge/sync-plane/burst/tests/test_smoke.py
# parents[0]=tests, [1]=burst, [2]=sync-plane, [3]=forge, [4]=repo-root
BURST_DIR = Path(__file__).resolve().parents[1]
assert BURST_DIR.is_dir() and BURST_DIR.name == "burst", f"missing burst dir: {BURST_DIR}"
# Insert the parent so `import burst` resolves the package.
sys.path.insert(0, str(BURST_DIR.parent))


_PKG_NAME = "burst"
if _PKG_NAME in sys.modules:
    del sys.modules[_PKG_NAME]
burst = importlib.import_module(_PKG_NAME)  # noqa: E402


OK = 0
FAIL = 0
FAILURES: List[str] = []


def _assert(cond: bool, label: str) -> None:
    global OK, FAIL
    if cond:
        OK += 1
    else:
        FAIL += 1
        FAILURES.append(label)
        print(f"  FAIL: {label}", file=sys.stderr)


def _fake_clock(start_ms: float = 1_000_000.0):
    """Returns (clock, advance) — a closure-based test clock in milliseconds."""
    holder = {"t": float(start_ms)}

    def clock() -> float:
        return holder["t"]

    def advance(delta_ms: float) -> None:
        holder["t"] += float(delta_ms)

    return clock, advance


# --------------------------------------------------------------------
# T-001 .. T-014: TokenBucket
# --------------------------------------------------------------------

def test_token_bucket() -> None:
    print("--- token_bucket ---")
    TokenBucket = burst.TokenBucket
    clock, advance = _fake_clock()
    b = burst.TokenBucket(capacity=5, refill_rate_per_s=10.0, clock_ms=clock)

    _assert(b.tokens == 5.0, "bucket starts full")            # T-001
    _assert(b.is_full, "is_full true on construction")        # T-002
    _assert(b.take(1.0) is True, "take 1 from full")          # T-003
    _assert(abs(b.tokens - 4.0) < 1e-9, "4 tokens after take")  # T-004

    # drain to 0
    for _ in range(4):
        b.take(1.0)
    _assert(abs(b.tokens) < 1e-9, "drained to 0")             # T-005
    _assert(b.take(1.0) is False, "take fails when empty")    # T-006

    # refill at 10/s → 100 ms gives 1 token
    advance(100.0)
    _assert(b.take(1.0) is True, "1 token refilled after 100 ms")  # T-007

    # cap at capacity
    advance(10_000.0)  # 10 s of refill would add 100 tokens
    _assert(abs(b.tokens - 5.0) < 1e-9, "capped at capacity")  # T-008

    # invalid construction
    try:
        TokenBucket(capacity=0, refill_rate_per_s=1.0)
        _assert(False, "capacity=0 should raise")             # T-009
    except ValueError:
        _assert(True, "capacity=0 raises ValueError")
    try:
        TokenBucket(capacity=1, refill_rate_per_s=0.0)
        _assert(False, "refill=0 should raise")               # T-010
    except ValueError:
        _assert(True, "refill=0 raises ValueError")
    try:
        b.take(0)
        _assert(False, "take(0) should raise")                # T-011
    except ValueError:
        _assert(True, "take(0) raises")

    # reset
    b.take(1.0)
    b.reset()
    _assert(b.is_full, "reset returns to full")               # T-012

    # take(n) where n > capacity is always False
    big = TokenBucket(capacity=2, refill_rate_per_s=10.0, clock_ms=clock)
    _assert(big.take(3.0) is False, "take(>capacity) false")  # T-013
    _assert(abs(big.tokens - 2.0) < 1e-9, "bucket untouched on rejected take")  # T-014


# --------------------------------------------------------------------
# T-101 .. T-114: AdapterQueue
# --------------------------------------------------------------------

def _ev(tenant: str = "t1", platform: str = "jira", lane: "burst.Lane" = burst.Lane.AGENT,
        kind: str = "comment", remote: str = "r1", **kw) -> "burst.OutboundEvent":
    e = burst.OutboundEvent(
        tenant_id=tenant,
        platform=platform,
        remote_issue_id=remote,
        event_kind=kind,
        lane=lane,
        payload=kw.get("payload", {}),
    )
    if "id" in kw:
        e.id = kw["id"]
    return e


def test_queue() -> None:
    print("--- queue ---")
    q = burst.AdapterQueue(max_depth=3)
    _assert(q.depth == 0, "empty depth=0")                    # T-101
    _assert(q.is_empty, "is_empty true initial")              # T-102
    _assert(q.peek_lane() is None, "peek empty None")         # T-103
    _assert(q.dequeue() is None, "dequeue empty None")        # T-104

    q.enqueue(_ev(lane=burst.Lane.AGENT, id="a1"))
    q.enqueue(_ev(lane=burst.Lane.SYSTEM, id="s1"))
    q.enqueue(_ev(lane=burst.Lane.HUMAN, id="h1"))
    _assert(q.depth == 3, "depth after 3 enqueue")            # T-105

    # SYSTEM first
    e = q.dequeue()
    _assert(e is not None and e.id == "s1", "SYSTEM dequeued first")  # T-106
    e = q.dequeue()
    _assert(e is not None and e.id == "h1", "HUMAN before AGENT")     # T-107
    e = q.dequeue()
    _assert(e is not None and e.id == "a1", "AGENT last")             # T-108

    # FIFO inside lane
    q.enqueue(_ev(lane=burst.Lane.AGENT, id="a1"))
    q.enqueue(_ev(lane=burst.Lane.AGENT, id="a2"))
    q.enqueue(_ev(lane=burst.Lane.AGENT, id="a3"))
    _assert(q.dequeue().id == "a1", "FIFO 1")                 # T-109
    _assert(q.dequeue().id == "a2", "FIFO 2")                 # T-110
    _assert(q.dequeue().id == "a3", "FIFO 3")                 # T-111

    # Overflow: AGENT dropped at max_depth, SYSTEM never dropped
    small = burst.AdapterQueue(max_depth=2)
    _assert(small.enqueue(_ev(lane=burst.Lane.AGENT, id="x1")), "fit 1")  # T-112
    _assert(small.enqueue(_ev(lane=burst.Lane.AGENT, id="x2")), "fit 2")
    _assert(small.enqueue(_ev(lane=burst.Lane.AGENT, id="x3")) is False, "AGENT overflow rejected")  # T-113
    _assert(small.enqueue(_ev(lane=burst.Lane.SYSTEM, id="sys-overflow")) is True, "SYSTEM bypass overflow")  # T-114


# --------------------------------------------------------------------
# T-201 .. T-216: Coalescer
# --------------------------------------------------------------------

def test_coalescer() -> None:
    print("--- coalescer ---")
    c = burst.Coalescer(window_ms=250)
    _assert(c.window_ms == 250, "default window 250 ms")      # T-201
    _assert(c.open_buffer_count == 0, "no buffers initial")   # T-202

    # System lane bypasses
    sys_event = _ev(lane=burst.Lane.SYSTEM, id="sys-1")
    r = c.accept(sys_event, now_ms=0)
    _assert(r is not None, "SYSTEM bypasses coalesce")        # T-203
    _assert(r.merged_count == 1, "SYSTEM merged_count=1")     # T-204

    # Transitions bypass
    t_event = _ev(kind="transition", id="t-1")
    r = c.accept(t_event, now_ms=0)
    _assert(r is not None and r.merged_count == 1, "transition bypasses")  # T-205

    # Comments coalesce
    e1 = _ev(kind="comment", remote="r1", id="c1", payload={"body": "Hello"})
    e2 = _ev(kind="comment", remote="r1", id="c2", payload={"body": "World"})
    e3 = _ev(kind="comment", remote="r1", id="c3", payload={"body": "!"})
    assert c.accept(e1, now_ms=0) is None
    assert c.accept(e2, now_ms=50) is None
    assert c.accept(e3, now_ms=100) is None
    _assert(c.open_buffer_count == 1, "one buffer open")      # T-206

    # Not yet expired
    out = c.flush_due(now_ms=200)
    _assert(out == [], "no flush before window")              # T-207
    _assert(c.open_buffer_count == 1, "buffer still open")    # T-208

    # Window elapsed
    out = c.flush_due(now_ms=260)
    _assert(len(out) == 1, "one buffer flushed")              # T-209
    flushed = out[0]
    _assert(flushed.merged_count == 3, "3 comments merged")   # T-210
    body = flushed.event.payload["body"]
    _assert("Hello" in body and "World" in body and "!" in body, "all bodies in merged comment")  # T-211
    _assert(c.open_buffer_count == 0, "buffer cleared after flush")  # T-212

    # Different keys do NOT merge
    e1 = _ev(kind="comment", remote="r1", id="A")
    e2 = _ev(kind="comment", remote="r2", id="B")
    c.accept(e1, now_ms=0)
    c.accept(e2, now_ms=10)
    _assert(c.open_buffer_count == 2, "different remotes → 2 buffers")  # T-213

    out = c.flush_all()
    _assert(len(out) == 2, "flush_all flushes both")          # T-214

    # Field edits LWW merge
    c2 = burst.Coalescer(window_ms=100)
    e1 = _ev(kind="field_edit", id="f1", payload={"fields": {"status": "in_progress", "priority": "P1"}})
    e2 = _ev(kind="field_edit", id="f2", payload={"fields": {"status": "in_review"}})
    c2.accept(e1, now_ms=0)
    c2.accept(e2, now_ms=10)
    flushed = c2.flush_due(now_ms=200)
    _assert(len(flushed) == 1 and flushed[0].merged_count == 2, "field_edit coalesced")  # T-215
    fields = flushed[0].event.payload["fields"]
    _assert(fields["status"] == "in_review" and fields["priority"] == "P1", "LWW merge correct")  # T-216


# --------------------------------------------------------------------
# T-301 .. T-316: CircuitBreaker
# --------------------------------------------------------------------

def test_breaker() -> None:
    print("--- breaker ---")
    clock, advance = _fake_clock()
    cb = burst.CircuitBreaker(
        fail_threshold=3, window_ms=1_000, cooldown_ms=500, clock_ms=clock
    )
    _assert(cb.state == burst.BreakerState.CLOSED, "starts CLOSED")  # T-301
    _assert(cb.allow_request() is True, "CLOSED allows")             # T-302

    # 2 failures → still CLOSED
    cb.record_response(500)
    cb.record_response(503)
    _assert(cb.state == burst.BreakerState.CLOSED, "below threshold CLOSED")  # T-303
    _assert(cb.failure_count == 2, "failure_count 2")                # T-304

    # 3rd failure → OPEN
    t = cb.record_response(429)
    _assert(cb.state == burst.BreakerState.OPEN, "tripped to OPEN")  # T-305
    _assert(t.became_open is True, "transition.became_open")         # T-306
    _assert(cb.allow_request() is False, "OPEN denies")              # T-307

    # 200 while OPEN doesn't recover by itself
    cb.record_response(200)
    _assert(cb.state == burst.BreakerState.OPEN, "200 in OPEN keeps OPEN")  # T-308

    # cooldown elapses → HALF_OPEN
    advance(600)
    _assert(cb.state == burst.BreakerState.HALF_OPEN, "OPEN→HALF_OPEN after cooldown")  # T-309
    _assert(cb.allow_request() is True, "HALF_OPEN allows probe")    # T-310

    # probe fails → back to OPEN
    t = cb.record_response(502)
    _assert(cb.state == burst.BreakerState.OPEN, "probe fail → OPEN")  # T-311
    _assert(t.became_open is False, "re-open is NOT became_open")    # T-312

    # cooldown again, then probe success → CLOSED
    advance(600)
    _assert(cb.state == burst.BreakerState.HALF_OPEN, "OPEN→HALF_OPEN again")  # T-313
    t = cb.record_response(200)
    _assert(cb.state == burst.BreakerState.CLOSED, "probe ok → CLOSED")  # T-314
    _assert(t.became_closed is True, "became_closed True")           # T-315

    # 4xx (non-429) does NOT trip
    cb2 = burst.CircuitBreaker(fail_threshold=2, window_ms=1_000, cooldown_ms=500, clock_ms=clock)
    cb2.record_response(400)
    cb2.record_response(404)
    _assert(cb2.state == burst.BreakerState.CLOSED, "4xx (not 429) does not trip")  # T-316


# --------------------------------------------------------------------
# T-401 .. T-410: audit row factory
# --------------------------------------------------------------------

def test_audit() -> None:
    print("--- audit ---")
    row = burst.build_burst_audit_row(
        event_type=burst.BURST_CIRCUIT_OPEN,
        tenant_id="t1",
        actor="sync-plane:breaker:jira",
        metadata={"platform": "jira", "failure_count": 5, "window_ms": 10_000},
    )
    _assert(row.event_type == "sync.burst_circuit_open", "open event type")  # T-401
    _assert(row.tenant_id == "t1", "tenant_id round-trips")  # T-402
    _assert(row.metadata["failure_count"] == 5, "metadata stored")  # T-403

    row = burst.build_burst_audit_row(
        event_type=burst.BURST_CIRCUIT_CLOSE,
        tenant_id="t1",
        actor="sync-plane:breaker:jira",
        metadata={"platform": "jira", "cooldown_ms": 30_000},
    )
    _assert(row.event_type == "sync.burst_circuit_close", "close event type")  # T-404

    row = burst.build_burst_audit_row(
        event_type=burst.BURST_COALESCE,
        tenant_id="t1",
        actor="sync-plane:burst:jira",
        metadata={
            "platform": "jira", "remote_issue_id": "r1",
            "event_kind": "comment", "merged_count": 3, "coalesced_ids": ["a", "b", "c"],
        },
    )
    _assert(row.event_type == "sync.burst_coalesce", "coalesce event type")  # T-405

    # Bad shapes
    bads: List[Tuple[Dict[str, Any], str]] = [
        ({"event_type": "x.unknown", "tenant_id": "t", "actor": "a", "metadata": {"platform": "jira"}}, "unknown event"),
        ({"event_type": burst.BURST_CIRCUIT_OPEN, "tenant_id": "", "actor": "a", "metadata": {"platform": "jira"}}, "blank tenant"),
        ({"event_type": burst.BURST_CIRCUIT_OPEN, "tenant_id": "t", "actor": "", "metadata": {"platform": "jira"}}, "blank actor"),
        ({"event_type": burst.BURST_CIRCUIT_OPEN, "tenant_id": "t", "actor": "a", "metadata": {}}, "missing platform"),
        ({"event_type": burst.BURST_CIRCUIT_OPEN, "tenant_id": "t", "actor": "a", "metadata": {"platform": "jira"}}, "missing failure_count"),
        ({"event_type": burst.BURST_COALESCE, "tenant_id": "t", "actor": "a",
          "metadata": {"platform": "jira", "remote_issue_id": "r1", "event_kind": "comment", "merged_count": 1}}, "merged_count=1"),
    ]
    for kwargs, label in bads:
        try:
            burst.build_burst_audit_row(**kwargs)
            _assert(False, f"bad-shape raises: {label}")
        except ValueError:
            _assert(True, f"bad-shape raises: {label}")
    # T-406 .. T-411

    # digest reproducibility
    from importlib import import_module
    audit_mod = import_module("burst.audit")
    d1 = audit_mod.digest_burst_payload(row)
    d2 = audit_mod.digest_burst_payload(row)
    _assert(d1 == d2 and len(d1) == 64, "digest reproducible 64-hex")  # T-412


# --------------------------------------------------------------------
# T-501 .. T-512: BurstController integration
# --------------------------------------------------------------------

def test_controller_flow() -> None:
    print("--- controller (integration) ---")
    clock, advance = _fake_clock()
    cfg = burst.controller.PlatformConfig(
        bucket_capacity=4.0,
        bucket_refill_per_s=10.0,
        queue_max_depth=100,
        breaker_fail_threshold=3,
        breaker_window_ms=1_000,
        breaker_cooldown_ms=500,
    )
    bc = burst.BurstController(
        per_platform_config={"jira": cfg, "github": cfg, "clickup": cfg},
        clock_ms=clock,
        coalesce_window_ms=250,
    )

    # Submit 3 comments on the same remote inside the window → coalesce to 1
    bc.submit(_ev(kind="comment", remote="r1", id="c1", payload={"body": "a"}))
    bc.submit(_ev(kind="comment", remote="r1", id="c2", payload={"body": "b"}))
    bc.submit(_ev(kind="comment", remote="r1", id="c3", payload={"body": "c"}))

    advance(300)
    bc.tick()
    _assert(bc.queue_depth("t1", "jira") == 1, "3 comments coalesced to 1")  # T-501

    # Audit event emitted for the coalesce
    coalesce_rows = [r for r in bc.audit_log if r.event_type == burst.BURST_COALESCE]
    _assert(len(coalesce_rows) == 1, "1 coalesce audit row")  # T-502
    _assert(coalesce_rows[0].metadata["merged_count"] == 3, "merged_count=3 in audit")  # T-503

    # Drain dispatches it
    dispatched: List[burst.OutboundEvent] = []

    def ok(event):
        dispatched.append(event)
        return 200

    out = bc.drain(dispatch_fn=ok, max_n=10)
    _assert(len(dispatched) == 1, "1 event dispatched after coalesce")  # T-504
    _assert(out[0].outcome == burst.DispatchOutcome.DISPATCHED, "outcome DISPATCHED")  # T-505
    _assert(out[0].status == 200, "status 200 propagated")             # T-506

    # 5xx storm → breaker opens, emits sync.burst_circuit_open
    for i in range(5):
        bc.submit(_ev(kind="field_edit", remote=f"r{i}", id=f"f{i}", payload={"fields": {"k": i}}))
    advance(300)
    bc.tick()
    fail_count = {"n": 0}

    def boom(event):
        fail_count["n"] += 1
        return 502

    bc.drain(dispatch_fn=boom, max_n=10)
    state = bc.breaker_state("t1", "jira")
    _assert(state == burst.BreakerState.OPEN, "breaker OPEN after 5xx storm")  # T-507
    opens = [r for r in bc.audit_log if r.event_type == burst.BURST_CIRCUIT_OPEN]
    _assert(len(opens) == 1, "exactly 1 circuit_open emitted")  # T-508
    _assert(opens[0].metadata["platform"] == "jira", "platform=jira in open metadata")  # T-509

    # While OPEN, drain skips dispatch
    bc.submit(_ev(kind="field_edit", remote="rx", id="rx-1", payload={"fields": {"k": 1}}))
    advance(300)
    bc.tick()
    skipped_calls = {"n": 0}

    def never_called(event):
        skipped_calls["n"] += 1
        return 200

    results = bc.drain(dispatch_fn=never_called, max_n=10)
    _assert(skipped_calls["n"] == 0, "no dispatch while OPEN")  # T-510
    _assert(all(r.outcome == burst.DispatchOutcome.BREAKER_OPEN for r in results),
            "all results BREAKER_OPEN")  # T-511

    # Cool down → half_open → 200 closes → emits sync.burst_circuit_close
    advance(600)
    _assert(bc.breaker_state("t1", "jira") == burst.BreakerState.HALF_OPEN, "OPEN→HALF_OPEN")
    bc.drain(dispatch_fn=ok, max_n=1)
    closes = [r for r in bc.audit_log if r.event_type == burst.BURST_CIRCUIT_CLOSE]
    _assert(len(closes) == 1, "1 circuit_close after recovery")  # T-512


# --------------------------------------------------------------------
# T-601 .. T-603: per-tenant isolation
# --------------------------------------------------------------------

def test_per_tenant_isolation() -> None:
    print("--- per-tenant isolation ---")
    clock, advance = _fake_clock()
    cfg = burst.controller.PlatformConfig(bucket_capacity=20.0, bucket_refill_per_s=100.0,
                                          breaker_fail_threshold=3, breaker_window_ms=1_000,
                                          breaker_cooldown_ms=500, queue_max_depth=100)
    bc = burst.BurstController(per_platform_config={"jira": cfg}, clock_ms=clock,
                                coalesce_window_ms=50)
    # Tenant A bursts with 10 events that all fail → breaker A trips.
    # Tenant B sends 2 events that all succeed → breaker B stays CLOSED.
    # This proves per-tenant isolation: A's failures do not poison B.
    for i in range(10):
        bc.submit(_ev(tenant="A", kind="field_edit", remote=f"r{i}", id=f"A-{i}"))
    for i in range(2):
        bc.submit(_ev(tenant="B", kind="field_edit", remote=f"q{i}", id=f"B-{i}"))
    advance(100)
    bc.tick()

    def per_tenant(event):
        return 503 if event.tenant_id == "A" else 200

    bc.drain(dispatch_fn=per_tenant, max_n=50)
    state_a = bc.breaker_state("A", "jira")
    state_b = bc.breaker_state("B", "jira")
    _assert(state_a == burst.BreakerState.OPEN, "Tenant A breaker OPEN after 503 storm")  # T-601
    _assert(state_b == burst.BreakerState.CLOSED, "Tenant B breaker CLOSED (isolated from A)")  # T-602

    # A second controller proves independent breaker objects per (tenant, platform).
    cfg_iso = burst.controller.PlatformConfig(bucket_capacity=10.0, bucket_refill_per_s=10.0)
    bc2 = burst.BurstController(per_platform_config={"jira": cfg_iso}, clock_ms=clock,
                                coalesce_window_ms=50)
    bc2.submit(_ev(tenant="C", kind="field_edit", remote="rc", id="C-1"))
    bc2.submit(_ev(tenant="D", kind="field_edit", remote="rd", id="D-1"))
    advance(100)
    bc2.tick()

    def half(event):
        return 502 if event.tenant_id == "C" else 200

    bc2.drain(dispatch_fn=half, max_n=10)
    _assert(bc2.breaker_state("D", "jira") == burst.BreakerState.CLOSED, "D unaffected by C")  # T-603


# --------------------------------------------------------------------
# T-LOAD: 3× expected per-tenant event rate for 60 s
# --------------------------------------------------------------------

def test_load() -> None:
    print("--- load-test fixture (3x rate, 60s) ---")
    # Expected per-tenant rate: 5 events / s (Sync-Plane Q-sync-direction baseline).
    # 3× that = 15 events / s, sustained 60 s = 900 events.
    # Run over 3 tenants × 3 platforms to exercise cross-adapter routing.
    EXPECTED_RATE_HZ = 5.0
    LOAD_MULT = 3
    DURATION_S = 60
    RATE_HZ = EXPECTED_RATE_HZ * LOAD_MULT
    TOTAL_PER_TENANT = int(RATE_HZ * DURATION_S)

    TENANTS = ["t1", "t2", "t3"]
    PLATFORMS = ["jira", "github", "clickup"]

    clock, advance = _fake_clock()
    # Bucket sized for the headroom: capacity 40, refill 20/s comfortably
    # covers 3× expected rate per platform per tenant.
    cfg = burst.controller.PlatformConfig(
        bucket_capacity=40.0,
        bucket_refill_per_s=20.0,
        queue_max_depth=100_000,
        breaker_fail_threshold=10,
        breaker_window_ms=10_000,
        breaker_cooldown_ms=30_000,
    )
    bc = burst.BurstController(
        per_platform_config={p: cfg for p in PLATFORMS},
        clock_ms=clock,
        coalesce_window_ms=250,
    )

    dispatched = {"n": 0}

    def ok(event):
        dispatched["n"] += 1
        return 200

    # Drive the simulation in 10 ms ticks.  We submit at RATE_HZ per tenant
    # per platform, then drain on each tick.  We drain only every 5th tick
    # so events accumulate real queue dwell — the p99 measurement is then
    # the *actual* time an event waits, not zero.
    tick_ms = 10
    drain_every_n_ticks = 5
    submit_interval_ms = 1000.0 / RATE_HZ
    next_submit_ms = 0.0
    total_submitted = 0
    target_total = TOTAL_PER_TENANT * len(TENANTS) * len(PLATFORMS)
    elapsed_ms = 0.0
    duration_ms = DURATION_S * 1000
    tick_idx = 0

    # Use distinct remote_issue_ids so we measure raw queue throughput
    # (not coalesce) for the load test.
    submit_idx = 0
    while elapsed_ms <= duration_ms:
        if elapsed_ms >= next_submit_ms and total_submitted < target_total:
            for t in TENANTS:
                for p in PLATFORMS:
                    if total_submitted >= target_total:
                        break
                    e = burst.OutboundEvent(
                        tenant_id=t, platform=p,
                        remote_issue_id=f"R{submit_idx}",
                        event_kind="field_edit",
                        lane=burst.Lane.AGENT,
                        payload={"fields": {"k": submit_idx}},
                    )
                    bc.submit(e)
                    submit_idx += 1
                    total_submitted += 1
            next_submit_ms += submit_interval_ms
        bc.tick()
        if tick_idx % drain_every_n_ticks == 0:
            bc.drain(dispatch_fn=ok, max_n=512)
        advance(tick_ms)
        elapsed_ms += tick_ms
        tick_idx += 1

    # Final drain pass for tail events.
    for _ in range(10):
        advance(300)
        bc.tick()
        bc.drain(dispatch_fn=ok, max_n=1024)

    _assert(total_submitted == target_total, f"submitted all {target_total} events")  # T-LOAD-1
    _assert(dispatched["n"] == target_total,
            f"no dropped events (dispatched={dispatched['n']}/{target_total})")  # T-LOAD-2

    # p99 latency across all (tenant, platform) pairs
    p99s = []
    for t in TENANTS:
        for p in PLATFORMS:
            p99s.append(bc.p99_queue_latency_ms(t, p))
    worst_p99 = max(p99s) if p99s else 0.0
    _assert(worst_p99 < 200.0,
            f"worst p99 queue latency < 200 ms (got {worst_p99:.2f} ms)")  # T-LOAD-3

    print(f"  load summary: {total_submitted} submitted, "
          f"{dispatched['n']} dispatched, worst p99 = {worst_p99:.2f} ms")


# --------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------

def main() -> int:
    started = time.time()
    test_token_bucket()
    test_queue()
    test_coalescer()
    test_breaker()
    test_audit()
    test_controller_flow()
    test_per_tenant_isolation()
    test_load()
    elapsed_ms = (time.time() - started) * 1000.0
    print()
    print(f"RESULT: ok={OK} fail={FAIL} elapsed={elapsed_ms:.1f}ms")
    if FAIL:
        print("Failures:")
        for f in FAILURES:
            print(f"  - {f}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
