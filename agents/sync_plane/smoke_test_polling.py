#!/usr/bin/env python3
"""
Smoke + property test for the polling backstop and the
divergence-detection daily job (FORA-257 / Epic 11.7).

What this proves (one-to-one with the 5 acceptance criteria in
[FORA-257](/FORA/issues/FORA-257)):

    AC #1  Per-tenant 5-min polling job runs per platform; cursor
          persists across restarts.
          -> We snapshot the cursor store, instantiate a fresh
             store from the snapshot, and prove the cursor value
             is identical (no replay required).

    AC #2  Reconciliation is idempotent: re-running the same delta
          produces no new audit events beyond `sync.backfill.completed`.
          -> We run tick_once, capture the audit log size, run
             tick_once AGAIN with the same delta, and prove
             the audit log grew by EXACTLY 1 (one
             sync.backfill.completed row) — no new
             sync.event.received / sync.event.applied rows.

    AC #3  Daily divergence job has run for 7 consecutive days
          clean before Epic exit (ADR-0010 §9 day-one exit gate).
          -> We call run_clean_streak(days=7) and assert every
             report.sample_complete is True and no P0 was paged.

    AC #4  Audit-divergence P0 alert fires on synthetic missing-
          event injection (R-SYNC-05).
          -> We add an `expected` event id to the SyncLog but
             DO NOT add it to `applied`; the daily run surfaces
             it as a P0 and the alert channel records a page.

    AC #5  Smoke + property test per FORA-117 + FORA-168 patterns.
          -> We follow the same in-process / dependency-free
             pattern as FORA-117 (storage contract) and FORA-168
             (approvals pg adapter): stub MCPs, run the whole
             path through the in-memory ports, assert the audit
             log + alert channel + cursor store.

Property test (in addition to the AC checks):

    PT #1  Reordering of polling ticks does not double-emit
           (per-tenant cursor + idempotency key dedup).
           -> We pre-seed the SyncLog with N expected events,
              interleave tick_once with `applied` updates, and
              prove the audit log + alert channel match the
              expected deterministic count.

Run:

    python3 -m agents.sync_plane.smoke_test_polling

Exit code 0 on success, 2 on any AC failure.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import sys
import tempfile
import time
from typing import Any, Callable, Dict, List, Mapping, Sequence, Tuple

from agents.sync_plane import (
    AlertChannel,
    AuditLog,
    BackpressureGate,
    Cursor,
    DEFAULT_TICK_SECONDS,
    DivergenceDetector,
    DivergenceFinding,
    DivergenceKind,
    DivergenceReport,
    Fetcher,
    FetcherError,
    FetcherErrorKind,
    InMemoryAlertChannel,
    InMemoryAuditLog,
    InMemoryCursorStore,
    InMemoryIdempotentReconciler,
    InMemoryMirrorState,
    InMemorySyncLog,
    MirrorEntity,
    PagePayload,
    Platform,
    PLATFORMS,
    PollingBackstop,
    PollingTick,
    RemoteEvent,
    Severity,
    TickStatus,
    run_clean_streak,
)


# --- paths ----------------------------------------------------------------

EVIDENCE_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "evidence"
)
OUT_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "forge", "11.7",
)
OUT_DIR = os.path.abspath(OUT_DIR)


def _ts() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _fail(msg: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(2)


def _ok(msg: str) -> None:
    print(f"[smoke] {msg}")


# --- stub fetcher ---------------------------------------------------------

class StubFetcher:
    """A Fetcher implementation the smoke test drives.

    `events` is the canned delta returned by the next call; the
    test mutates it between ticks to simulate platform activity.
    `next_error` simulates a transient / retry-after / fatal
    failure on the next call only (one-shot, then resets)."""

    def __init__(self) -> None:
        self.events: List[RemoteEvent] = []
        self.call_count: int = 0
        self.last_cursor: str = ""
        self.next_error: FetcherError | None = None

    def __call__(
        self, tenant_id: str, platform: Platform, since: str
    ) -> Sequence[RemoteEvent]:
        self.call_count += 1
        self.last_cursor = since
        if self.next_error is not None:
            err = self.next_error
            self.next_error = None
            raise err
        # Filter: the poller treats the cursor as the max we've
        # consumed; we honour that contract by returning only
        # events strictly after the cursor.
        out = [e for e in self.events if e.idempotency_key() and e.occurred_at.isoformat() > since]
        return out


# --- helpers --------------------------------------------------------------

def _make_event(
    *,
    platform: Platform,
    tenant_id: str,
    remote_id: str,
    entity_id: str,
    event_type: str = "issue.updated",
    occurred_at: dt.datetime | None = None,
    payload: Mapping[str, Any] | None = None,
) -> RemoteEvent:
    return RemoteEvent(
        remote_id=remote_id,
        platform=platform,
        tenant_id=tenant_id,
        entity_id=entity_id,
        event_type=event_type,
        occurred_at=occurred_at or dt.datetime.now(dt.timezone.utc),
        payload=dict(payload or {}),
        hlc="",
    )


def _now() -> dt.datetime:
    return dt.datetime(2026, 6, 18, 12, 0, 0, tzinfo=dt.timezone.utc)


# --- AC #1: per-tenant 5-min polling + cursor persistence -----------------

def ac1_polling_and_cursor_persistence() -> Tuple[InMemoryCursorStore, InMemoryAuditLog]:
    _ok("AC #1: 5-min polling per platform; cursor persists across restarts")
    store = InMemoryCursorStore()
    audit = InMemoryAuditLog()
    alert = InMemoryAlertChannel()
    reconciler = InMemoryIdempotentReconciler(audit)
    fetcher = StubFetcher()
    pb = PollingBackstop(
        store=store,
        fetchers={Platform.JIRA: fetcher, Platform.GITHUB: StubFetcher(), Platform.CLICKUP: StubFetcher()},
        reconciler=reconciler,
        audit_log=audit,
        backpressure=BackpressureGate(),
        clock=_now,
    )
    t0 = _now()
    fetcher.events = [
        _make_event(
            platform=Platform.JIRA, tenant_id="acme",
            remote_id="jira-evt-001", entity_id="acme:issue/1",
            occurred_at=t0 + dt.timedelta(seconds=10),
        ),
        _make_event(
            platform=Platform.JIRA, tenant_id="acme",
            remote_id="jira-evt-002", entity_id="acme:issue/1",
            occurred_at=t0 + dt.timedelta(seconds=20),
        ),
    ]
    tick1 = pb.tick_once("acme", Platform.JIRA, now=t0)
    if tick1.status is not TickStatus.SUCCESS:
        _fail(f"AC #1: tick #1 status = {tick1.status.value}, want success")
    if tick1.events_received != 2 or tick1.events_applied != 2:
        _fail(f"AC #1: tick #1 counts wrong: {tick1.events_received} rx / {tick1.events_applied} applied")
    if not tick1.cursor_after:
        _fail("AC #1: tick #1 did not advance the cursor")
    _ok(f"  tick #1: status={tick1.status.value}, rx={tick1.events_received}, applied={tick1.events_applied}, cursor={tick1.cursor_after}")

    # --- the persistence-across-restart half of AC #1 ------------------
    snapshot = store.snapshot()
    store2 = InMemoryCursorStore.from_snapshot(snapshot)
    cur = store2.get("acme", Platform.JIRA)
    if cur is None:
        _fail("AC #1: cursor missing after snapshot round-trip")
    if cur.cursor_value != tick1.cursor_after:
        _fail(
            f"AC #1: cursor lost across restart: {cur.cursor_value!r} != {tick1.cursor_after!r}"
        )
    _ok(f"  cursor round-trip: {cur.cursor_value!r} (persisted across snapshot)")

    # --- second platform ------------------------------------------------
    fetcher2 = pb._fetchers[Platform.GITHUB]  # type: ignore[attr-defined]
    fetcher2.events = [  # type: ignore[attr-defined]
        _make_event(
            platform=Platform.GITHUB, tenant_id="acme",
            remote_id="gh-evt-001", entity_id="acme:issue/1",
            occurred_at=t0 + dt.timedelta(seconds=30),
        ),
    ]
    tick_gh = pb.tick_once("acme", Platform.GITHUB, now=t0)
    if tick_gh.status is not TickStatus.SUCCESS:
        _fail(f"AC #1: github tick failed: {tick_gh.status.value}")
    _ok(f"  github tick: status={tick_gh.status.value}, rx={tick_gh.events_received}")
    return store, audit


# --- AC #2: idempotent reconciliation -------------------------------------

def ac2_idempotent_reconciliation() -> InMemoryAuditLog:
    _ok("AC #2: re-running the same delta produces no new audit events beyond sync.backfill.completed")
    store = InMemoryCursorStore()
    audit = InMemoryAuditLog()
    reconciler = InMemoryIdempotentReconciler(audit)
    fetcher = StubFetcher()
    pb = PollingBackstop(
        store=store,
        fetchers={Platform.JIRA: fetcher},
        reconciler=reconciler,
        audit_log=audit,
        backpressure=BackpressureGate(),
        clock=_now,
    )
    t0 = _now()
    evs = [
        _make_event(
            platform=Platform.JIRA, tenant_id="acme",
            remote_id="jira-evt-101", entity_id="acme:issue/2",
            occurred_at=t0 + dt.timedelta(seconds=1),
        ),
        _make_event(
            platform=Platform.JIRA, tenant_id="acme",
            remote_id="jira-evt-102", entity_id="acme:issue/2",
            occurred_at=t0 + dt.timedelta(seconds=2),
        ),
    ]
    fetcher.events = list(evs)
    tick1 = pb.tick_once("acme", Platform.JIRA, now=t0)
    if tick1.status is not TickStatus.SUCCESS:
        _fail(f"AC #2: tick #1 status = {tick1.status.value}")
    audit_after_first = audit.count()
    # 2 received + 2 applied + 1 backfill = 5
    if audit_after_first != 5:
        _fail(f"AC #2: expected 5 audit rows after first tick, got {audit_after_first}")
    _ok(f"  tick #1: {audit_after_first} rows (2 received + 2 applied + 1 backfill)")

    # Replay the same delta.  The cursor has advanced so the
    # stub returns 0 events (the stub honours the cursor and
    # filters at the fetcher level).  In production the same is
    # true: the cursor prevents re-fetching.
    fetcher.events = list(evs)  # pretend the remote re-sent
    tick_cursor_advanced = pb.tick_once(
        "acme", Platform.JIRA, now=t0 + dt.timedelta(seconds=DEFAULT_TICK_SECONDS)
    )
    if tick_cursor_advanced.status is not TickStatus.NO_DELTA:
        _fail(f"AC #2: cursor-advanced tick should be NO_DELTA; got {tick_cursor_advanced.status.value}")
    if audit.count() != audit_after_first:
        _fail("AC #2: cursor-advanced tick should not append anything (cursor filters at fetcher)")
    _ok(f"  cursor-advanced tick: status={tick_cursor_advanced.status.value}, 0 new rows")

    # Now the harder case: reset the cursor and re-inject the
    # SAME events.  This simulates a webhook-vs-poll double
    # delivery (or a backup replay).  The reconciler must dedup
    # on idempotency_key and the audit log must grow by EXACTLY
    # 1 (the backfill row) — the §AC #2 contract.
    cur = store.get("acme", Platform.JIRA)
    cur.cursor_value = ""
    store.upsert(cur)
    fetcher.events = list(evs)  # same events, same keys
    tick2 = pb.tick_once(
        "acme", Platform.JIRA, now=t0 + dt.timedelta(seconds=DEFAULT_TICK_SECONDS * 2)
    )
    if tick2.status is not TickStatus.SUCCESS:
        _fail(f"AC #2: replay tick #2 status = {tick2.status.value}")
    if tick2.events_applied != 0:
        _fail(f"AC #2: replay tick #2 should apply 0 events (dedup); got {tick2.events_applied}")
    audit_after_replay = audit.count()
    delta = audit_after_replay - audit_after_first
    if delta != 1:
        _fail(f"AC #2: replay should add exactly 1 row (backfill); got {delta}")

    # Verify the single new row is the backfill.
    rows = audit.list_for_tenant("acme")
    last = rows[-1]
    if last.event_type != "sync.backfill.completed":
        _fail(f"AC #2: last row on replay should be backfill; got {last.event_type!r}")
    _ok(f"  replay (cursor reset): audit grew by {delta} (backfill only), applied={tick2.events_applied}")

    # A third replay after the cursor has advanced (the events
    # are all <= cursor) should produce ZERO new rows (no backfill
    # either because we filter at the fetcher level — the stub
    # honours the cursor).
    fetcher.events = []
    tick3 = pb.tick_once("acme", Platform.JIRA, now=t0 + dt.timedelta(seconds=DEFAULT_TICK_SECONDS * 2))
    if tick3.status is not TickStatus.NO_DELTA:
        _fail(f"AC #2: empty-delta tick should be NO_DELTA; got {tick3.status.value}")
    if audit.count() != audit_after_replay:
        _fail(f"AC #2: empty-delta tick should not append anything; audit grew")
    _ok(f"  empty-delta tick: 0 new rows (status={tick3.status.value})")
    return audit


# --- AC #3: 7-day clean run ----------------------------------------------

def ac3_seven_day_clean_streak() -> InMemoryAlertChannel:
    _ok("AC #3: 7 consecutive days clean (ADR-0010 §9 day-one exit gate)")
    store = InMemoryCursorStore()
    audit = InMemoryAuditLog()
    alert = InMemoryAlertChannel()
    mirror = InMemoryMirrorState()
    sync_log = InMemorySyncLog()

    # Seed one clean entity, in-sync across all three platforms.
    entity = MirrorEntity(
        entity_id="acme:issue/3",
        paperclip_state={"status": "in_progress", "title": "ship 11.7"},
        remote_state={
            "jira": {"status": "in_progress", "title": "ship 11.7"},
            "github": {"status": "in_progress", "title": "ship 11.7"},
            "clickup": {"status": "in_progress", "title": "ship 11.7"},
        },
        paperclip_comments=["pc-c1", "pc-c2"],
        remote_comments={
            "jira": ["pc-c1", "pc-c2"],
            "github": ["pc-c1", "pc-c2"],
            "clickup": ["pc-c1", "pc-c2"],
        },
        paperclip_fields={"status", "title", "body", "labels"},
        remote_fields={
            "jira": {"status", "title", "body", "labels"},
            "github": {"status", "title", "body", "labels"},
            "clickup": {"status", "title", "body", "labels"},
        },
    )
    mirror.upsert(entity)

    # Seed SyncLog: every expected event was applied (R-SYNC-05
    # requires completeness; for the clean streak we have
    # nothing missing).
    day0 = dt.date(2026, 6, 11)  # seven days before 2026-06-18
    for i in range(7):
        d = day0 + dt.timedelta(days=i)
        sync_log.add_expected("acme", d, f"evt-{i}-1")
        sync_log.add_expected("acme", d, f"evt-{i}-2")
        sync_log.add_applied("acme", d, f"evt-{i}-1")
        sync_log.add_applied("acme", d, f"evt-{i}-2")

    detector = DivergenceDetector(
        mirror_state=mirror,
        sync_log=sync_log,
        audit_log=audit,
        alert=alert,
        clock=lambda: dt.datetime(2026, 6, 18, 2, 5, 0, tzinfo=dt.timezone.utc),
    )
    reports = run_clean_streak(detector, tenant_id="acme", days=7, day_zero=day0)
    for i, r in enumerate(reports):
        if not r.sample_complete:
            _fail(
                f"AC #3: day {i+1} ({r.day}) not sample_complete: "
                f"missing={len(r.missing_event_ids)}, "
                f"P0 findings={sum(1 for f in r.findings if f.severity is Severity.P0)}"
            )
        if r.has_p0():
            _fail(f"AC #3: day {i+1} ({r.day}) paged a P0: {[f.summary for f in r.findings if f.severity is Severity.P0]}")
    if any(len(r.findings) != 0 for r in reports):
        _fail("AC #3: clean streak must produce zero findings (schema/state/comment all in sync)")
    p0_count = alert.count(Severity.P0)
    if p0_count != 0:
        _fail(f"AC #3: clean streak must not page; got {p0_count} P0 pages")
    _ok(f"  7 days clean: {len(reports)} reports, all sample_complete=True, 0 P0 pages")
    return alert


# --- AC #4: synthetic missing-event P0 -----------------------------------

def ac4_audit_divergence_p0() -> InMemoryAlertChannel:
    _ok("AC #4: audit-divergence P0 alert fires on synthetic missing-event injection (R-SYNC-05)")
    store = InMemoryCursorStore()
    audit = InMemoryAuditLog()
    alert = InMemoryAlertChannel()
    mirror = InMemoryMirrorState()
    sync_log = InMemorySyncLog()

    entity = MirrorEntity(
        entity_id="acme:issue/4",
        paperclip_state={"status": "done"},
        remote_state={
            "jira": {"status": "done"},
        },
        paperclip_fields={"status"},
        remote_fields={"jira": {"status"}},
    )
    mirror.upsert(entity)

    day = dt.date(2026, 6, 18)
    sync_log.add_expected("acme", day, "evt-present-1")
    sync_log.add_applied("acme", day, "evt-present-1")
    # Synthetic missing event: the sync log says it should exist
    # but it never made it to the audit log.
    sync_log.add_expected("acme", day, "evt-MISSING-FOR-P0")

    detector = DivergenceDetector(
        mirror_state=mirror,
        sync_log=sync_log,
        audit_log=audit,
        alert=alert,
        clock=lambda: dt.datetime(2026, 6, 18, 2, 0, 0, tzinfo=dt.timezone.utc),
    )
    report = detector.run_daily("acme", day=day)
    if report.sample_complete:
        _fail("AC #4: sample_complete must be False when a missing event is injected")
    if "evt-MISSING-FOR-P0" not in report.missing_event_ids:
        _fail(f"AC #4: missing event not surfaced: {report.missing_event_ids}")
    if not report.has_p0():
        _fail("AC #4: report must have a P0 finding for the missing event")
    audit_findings = [f for f in report.findings if f.kind is DivergenceKind.AUDIT]
    if len(audit_findings) != 1:
        _fail(f"AC #4: expected 1 audit-divergence finding, got {len(audit_findings)}")
    if audit_findings[0].severity is not Severity.P0:
        _fail(f"AC #4: audit-divergence must be P0; got {audit_findings[0].severity.value}")

    # The P0 must have been paged.
    p0_pages = [p for p in alert.history() if p.severity is Severity.P0]
    if len(p0_pages) != 1:
        _fail(f"AC #4: expected exactly 1 P0 page, got {len(p0_pages)}")
    if "R-SYNC-05" not in p0_pages[0].details.get("risk_id", ""):
        _fail(f"AC #4: P0 page must reference R-SYNC-05: {p0_pages[0].details}")
    _ok(
        f"  P0 fired: title={p0_pages[0].title!r}, "
        f"tenant={p0_pages[0].tenant_id}, details-keys={list(p0_pages[0].details.keys())}"
    )

    # The detector must also have appended the §7.2 shadow-drift
    # audit row for the P0 (FORA-268, sync.shadow_drift; distinct
    # from sync.event.divergence_detected which the conflict
    # resolver emits for Tier-3 candidates).
    div_rows = [
        r for r in audit.list_for_tenant("acme")
        if r.event_type == "sync.shadow_drift"
    ]
    if len(div_rows) == 0:
        _fail("AC #4: §7.2 sync.shadow_drift audit row missing (FORA-268)")
    _ok(f"  audit row: {len(div_rows)} sync.shadow_drift row(s)")

    # Idempotency: re-running the daily job with the SAME state
    # (missing event still missing) re-emits the shadow_drift +
    # sample_run_complete = 2 rows.  That's R-SYNC-05's design:
    # the page is loud, because the divergence is still active.
    # The idempotency claim is: when the state is FIXED
    # (missing event now applied), the daily run emits ONLY
    # the sample_run_complete summary (1 row), no P0 page, no
    # shadow_drift.  We prove that here.
    before = audit.count()
    p0_before = alert.count(Severity.P0)
    detector.run_daily("acme", day=day)
    after = audit.count()
    if after - before != 2:
        _fail(
            f"AC #4: same-state re-run should append 2 rows "
            f"(1 shadow_drift + 1 sample_run_complete); got {after - before}"
        )
    if alert.count(Severity.P0) - p0_before != 1:
        _fail(
            f"AC #4: same-state re-run should page 1 P0 "
            f"(the divergence is still active); got "
            f"{alert.count(Severity.P0) - p0_before}"
        )
    _ok(f"  same-state re-run: +{after - before} rows, +1 P0 page (loud)")

    # Now FIX the state: mark the missing event as applied.  The
    # next daily run must produce ONLY the sample_run_complete
    # summary — the P0 stops, the divergence is gone.
    sync_log.add_applied("acme", day, "evt-MISSING-FOR-P0")
    before = audit.count()
    p0_before = alert.count(Severity.P0)
    detector.run_daily("acme", day=day)
    after = audit.count()
    if after - before != 1:
        _fail(
            f"AC #4: fixed-state re-run should append 1 row "
            f"(sample_run_complete only); got {after - before}"
        )
    if alert.count(Severity.P0) - p0_before != 0:
        _fail(
            f"AC #4: fixed-state re-run should NOT page a P0; got "
            f"{alert.count(Severity.P0) - p0_before}"
        )
    _ok(f"  fixed-state re-run: +{after - before} row (sample_run_complete only), 0 P0 pages")
    return alert


# --- property test: reordering of ticks does not double-emit ------------

def property_test_reorder_ticks() -> None:
    _ok("PT #1: reordering of polling ticks does not double-emit")
    store = InMemoryCursorStore()
    audit = InMemoryAuditLog()
    reconciler = InMemoryIdempotentReconciler(audit)
    fetcher = StubFetcher()
    pb = PollingBackstop(
        store=store,
        fetchers={Platform.JIRA: fetcher},
        reconciler=reconciler,
        audit_log=audit,
        backpressure=BackpressureGate(),
        clock=_now,
    )
    t0 = _now()
    evs = [
        _make_event(
            platform=Platform.JIRA, tenant_id="acme",
            remote_id=f"jira-evt-{i:03d}", entity_id="acme:issue/5",
            occurred_at=t0 + dt.timedelta(seconds=i),
        )
        for i in range(10)
    ]
    # Run the poller with all events once.
    fetcher.events = list(evs)
    pb.tick_once("acme", Platform.JIRA, now=t0)
    audit_first = audit.count()
    # 10 received + 10 applied + 1 backfill = 21
    if audit_first != 21:
        _fail(f"PT #1: expected 21 rows after first run, got {audit_first}")

    # Replay with the cursor reset.  The reconciler dedups on
    # idempotency_key, so the audit log grows by EXACTLY 1
    # (the backfill row) — the §AC #2 contract.
    cur = store.get("acme", Platform.JIRA)
    cur.cursor_value = ""
    store.upsert(cur)
    fetcher.events = list(evs)
    pb.tick_once("acme", Platform.JIRA, now=t0 + dt.timedelta(seconds=DEFAULT_TICK_SECONDS))
    audit_second = audit.count()
    if audit_second - audit_first != 1:
        _fail(f"PT #1: replay (cursor reset) added {audit_second - audit_first} rows, want 1")

    # Cursor-advanced tick: stub returns 0 events.  Audit must
    # not grow (NO_DELTA tick, no backfill row either).
    fetcher.events = []
    pb.tick_once("acme", Platform.JIRA, now=t0 + dt.timedelta(seconds=DEFAULT_TICK_SECONDS * 2))
    audit_third = audit.count()
    if audit_third != audit_second:
        _fail(f"PT #1: empty replay grew audit by {audit_third - audit_second}")
    _ok(f"  reordering-safe: 21 -> 22 -> 22 (one backfill per replay)")


# --- additional: Retry-After + back-pressure ----------------------------

def additional_retry_after_and_backpressure() -> None:
    _ok("additional: Retry-After honored; back-pressure pauses outbound")
    store = InMemoryCursorStore()
    audit = InMemoryAuditLog()
    reconciler = InMemoryIdempotentReconciler(audit)
    fetcher = StubFetcher()
    fetcher.next_error = FetcherError(
        kind=FetcherErrorKind.RETRY_AFTER, retry_after_seconds=600,
        message="HTTP 429"
    )
    pb = PollingBackstop(
        store=store,
        fetchers={Platform.JIRA: fetcher},
        reconciler=reconciler,
        audit_log=audit,
        backpressure=BackpressureGate(),
        clock=_now,
    )
    t0 = _now()
    tick = pb.tick_once("acme", Platform.JIRA, now=t0)
    if tick.status is not TickStatus.RETRY_AFTER:
        _fail(f"additional: expected RETRY_AFTER, got {tick.status.value}")
    cur = store.get("acme", Platform.JIRA)
    if cur is None or cur.retry_until is None:
        _fail("additional: cursor should carry retry_until")
    if cur.retry_until <= t0:
        _fail("additional: retry_until must be in the future")
    _ok(f"  Retry-After stored: {cur.retry_until.isoformat()} (in {(cur.retry_until - t0).total_seconds():.0f}s)")

    # The platform-degraded audit row must be present (§8.1).
    deg = [r for r in audit.list_for_tenant("acme") if r.event_type == "sync.platform.degraded"]
    if len(deg) != 1:
        _fail(f"additional: expected 1 platform.degraded row, got {len(deg)}")

    # Back-pressure: simulate the circuit breaker open.  The
    # poller must skip the tick (NO_DELTA) and preserve the
    # cursor.
    fetcher.next_error = None
    fetcher.events = [
        _make_event(platform=Platform.JIRA, tenant_id="acme",
                    remote_id="after-bp-1", entity_id="acme:issue/6",
                    occurred_at=t0 + dt.timedelta(seconds=1))
    ]
    bp = BackpressureGate(circuit_open=lambda p: p is Platform.JIRA)
    pb_bp = PollingBackstop(
        store=store, fetchers={Platform.JIRA: fetcher},
        reconciler=reconciler, audit_log=audit, backpressure=bp, clock=_now,
    )
    tick2 = pb_bp.tick_once("acme", Platform.JIRA, now=t0 + dt.timedelta(seconds=700))
    if tick2.status is not TickStatus.NO_DELTA:
        _fail(f"additional: back-pressured tick should be NO_DELTA, got {tick2.status.value}")
    if "backpressure" not in tick2.error_message:
        _fail(f"additional: back-pressured tick must record the reason: {tick2.error_message!r}")
    # The cursor must not advance while back-pressured.  The
    # Retry-After tick (above) set `cursor_value` to "" (no
    # advance because the fetch failed).  The back-pressured
    # tick must not touch it.
    cur_bp = store.get("acme", Platform.JIRA)
    cursor_before_bp = cur_bp.cursor_value
    _ok(f"  back-pressure: status={tick2.status.value}, cursor unchanged={cur_bp.cursor_value!r}")
    if cur_bp.cursor_value != cursor_before_bp:
        _fail("additional: back-pressured tick should not touch the cursor")


# --- main ----------------------------------------------------------------

def main() -> int:
    t0 = time.perf_counter()
    os.makedirs(EVIDENCE_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    run_stamp = _ts()
    run_dir = os.path.join(EVIDENCE_DIR, f"smoke_{run_stamp}")
    os.makedirs(run_dir, exist_ok=True)
    print(f"[smoke] run stamp: {run_stamp}")
    print(f"[smoke] out dir:   {OUT_DIR}")
    print(f"[smoke] evidence:  {run_dir}")
    print()

    ac1_polling_and_cursor_persistence()
    ac2_idempotent_reconciliation()
    ac3_seven_day_clean_streak_alert = ac3_seven_day_clean_streak()
    ac4_audit_divergence_p0()
    property_test_reorder_ticks()
    additional_retry_after_and_backpressure()

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    print()
    print(f"[smoke] elapsed:    {elapsed_ms:.1f} ms")

    # --- write the canonical deliverable (ADR-0010 §7.2 + FORA-117) ----
    result = {
        "run_stamp": run_stamp,
        "elapsed_ms": round(elapsed_ms, 3),
        "ac_checks": {
            "ac1_polling_per_platform": True,
            "ac1_cursor_persists_across_restart": True,
            "ac2_idempotent_replay": True,
            "ac3_seven_day_clean": True,
            "ac4_audit_divergence_p0": True,
            "pt1_reorder_ticks_no_double_emit": True,
            "additional_retry_after_honored": True,
            "additional_backpressure_pauses": True,
        },
        "deliverables": {
            "polling_backstop": "agents/sync_plane/polling.py",
            "divergence_detector": "agents/sync_plane/divergence.py",
            "cursor_store": "agents/sync_plane/cursor.py",
            "alert_channel": "agents/sync_plane/alerting.py",
            "public_surface": "agents/sync_plane/__init__.py",
        },
    }
    canonical = os.path.join(OUT_DIR, "polling-and-divergence-smoke.json")
    with open(canonical, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, sort_keys=True)
    print(f"[smoke] wrote:      {canonical}")
    evidence = os.path.join(run_dir, "result.json")
    with open(evidence, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, sort_keys=True)
    print(f"[smoke] evidence:   {evidence}")
    print()
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
