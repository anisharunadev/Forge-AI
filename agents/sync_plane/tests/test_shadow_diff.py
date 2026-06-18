"""
Smoke test for FORA-268 Epic 11.7 — Polling backstop + divergence
detection (shadow_log diff → shadow_drift).

30+ assertions covering the four ACs:

  AC #1:  Polling job runs every 5 min per active (tenant, platform) tuple
  AC #2:  Diff logic produces a deterministic shadow_drift event
          with old/new field values + HLC
  AC #3:  Daily report renders as a markdown file at
          forge/sync-plane/reports/<tenant>/<YYYY-MM-DD>.md
  AC #4:  Alert wiring: any shadow_drift event older than 60 min
          unprocessed triggers a Slack alert via FORA-36
  AC #5:  7-day clean-run smoke (deterministic via mocked clock)

Invocation:
    cd forge/0.7-platform/
    python -m agents.sync_plane.tests.test_shadow_diff
"""

from __future__ import annotations

import datetime as dt
import hashlib
import os
import sys
import time
import uuid
from typing import Dict, List, Optional, Tuple

# Repo-root import shim so this file works as a script.
_HERE = os.path.dirname(os.path.abspath(__file__))
_AGENTS = os.path.dirname(os.path.dirname(_HERE))
if _AGENTS not in sys.path:
    sys.path.insert(0, _AGENTS)

from sync_plane.audit import (                                # noqa: E402
    AuditRow,
    DIVERGENCE_RESOLVED_EVENT,
    EVENT_APPLIED,
    SHADOW_DRIFT_EVENT,
    build_audit_row,
    digest_payload,
)
from sync_plane.hlc import Clock                              # noqa: E402
from sync_plane.shadow_diff import (                          # noqa: E402
    InMemoryAuditSink,
    InMemoryCursorStore,
    InMemoryShadowLog,
    POLL_INTERVAL_SECONDS,
    RemoteEntity,
    RemoteFetch,
    RemoteStateReader,
    ShadowDiffPoller,
    SUPPORTED_PLATFORMS,
    diff_field_names,
)
from sync_plane.daily_report import (                         # noqa: E402
    DEFAULT_REPORT_ROOT,
    DAILY_CRON_HOUR_UTC,
    DailyReportRenderer,
    InMemoryReportStore,
    FilesystemReportStore,
    next_run_after,
    render_markdown,
    report_window_for,
)
from sync_plane.alert_wiring import (                         # noqa: E402
    DEFAULT_SLACK_CHANNEL,
    InMemorySlackChannel,
    ListAuditLogReader,
    OOH_THRESHOLD_SECONDS,
    ShadowDriftOOHAlerter,
    is_ooh,
    page_digest,
)


# --- tiny test harness ----------------------------------------------------

_PASS = 0
_FAIL = 0
_FAILURES: List[str] = []


def _check(name: str, cond: bool, detail: str = "") -> None:
    global _PASS, _FAIL
    if cond:
        _PASS += 1
        print(f"[PASS] {name}")
    else:
        _FAIL += 1
        msg = f"{name}  --  {detail}"
        _FAILURES.append(msg)
        print(f"[FAIL] {msg}")


def _make_hlc(physical_ms: int, laa: int = 0, seq: int = 0) -> str:
    return f"{physical_ms:013d}.{laa:03d}-{seq:04d}"


def _fixed_wall(t: dt.datetime):
    """A wall-clock factory pinned to a fixed datetime."""
    fixed = t
    def _now() -> dt.datetime:
        return fixed
    return _now


def _stepping_wall(start: dt.datetime, step_seconds: int = 0):
    """A wall-clock factory that returns the same `start` on every
    call, but bumps the clock by `step_seconds` per call when > 0.
    Used for the OOH test where the wall clock must advance."""
    state = {"t": start, "calls": 0}
    def _now() -> dt.datetime:
        state["calls"] += 1
        if step_seconds > 0:
            state["t"] = state["t"] + dt.timedelta(seconds=step_seconds)
        return state["t"]
    return _now


# --- a stub remote reader -------------------------------------------------

class _StubRemote:
    """A list-backed RemoteStateReader.  Each `fetch()` pops the
    next programmed delta; the queue is empty by default.  The
    smoke test programs the queue per test."""
    def __init__(self, queue: Optional[List[RemoteFetch]] = None) -> None:
        self.queue: List[RemoteFetch] = list(queue or [])

    def fetch(self, *, tenant_id: str, platform: str, cursor: str) -> RemoteFetch:
        if self.queue:
            return self.queue.pop(0)
        return RemoteFetch(entities=[], next_cursor=cursor or f"start-{uuid.uuid4().hex[:6]}")


# --- AC #1: 5-min tick ----------------------------------------------------

def test_poll_interval_is_five_minutes() -> None:
    """AC #1: the polling backstop ticks every 5 min."""
    _check(
        "POLL_INTERVAL_SECONDS == 300 (ADR-0010 §3.2)",
        POLL_INTERVAL_SECONDS == 5 * 60,
        f"got {POLL_INTERVAL_SECONDS}",
    )


def test_supported_platforms_are_jira_github_clickup() -> None:
    """AC #1: per-platform 5-min tick; the platforms are the
    three from the Board answer (ClickUp replaces "clipup")."""
    _check(
        "SUPPORTED_PLATFORMS == (jira, github, clickup)",
        SUPPORTED_PLATFORMS == ("jira", "github", "clickup"),
        f"got {SUPPORTED_PLATFORMS}",
    )


def test_poller_advances_cursor_on_success() -> None:
    """AC #1: cursor advances so the next cycle only diffs newer state."""
    shadow = InMemoryShadowLog()
    cursors = InMemoryCursorStore()
    audit = InMemoryAuditSink()
    remote = _StubRemote([
        RemoteFetch(
            entities=[RemoteEntity(entity_id="FORA-1", field_values={
                "title": {"value": "new title", "hlc": _make_hlc(1_700_000_000_000)},
            })],
            next_cursor="cursor-A",
        ),
    ])
    p = ShadowDiffPoller(
        tenant_id="acme", platform="jira", clock=Clock(node_id="t"),
        shadow=shadow, remote=remote, cursors=cursors, audit=audit,
    )
    cycle = p.run_once()
    _check("Cursor advanced to next_cursor",
           cursors.get(tenant_id="acme", platform="jira") == "cursor-A",
           f"got {cursors.get(tenant_id='acme', platform='jira')!r}")
    _check("Cycle.cursor_after records the new cursor",
           cycle.cursor_after == "cursor-A",
           f"got {cycle.cursor_after!r}")
    _check("Cycle.entities_seen reflects remote fetch",
           cycle.entities_seen == 1,
           f"got {cycle.entities_seen}")


def test_poller_no_delta_keeps_cursor() -> None:
    """AC #1: on a no-delta fetch the cursor advances to the
    next_cursor but no drifts are emitted."""
    shadow = InMemoryShadowLog()
    cursors = InMemoryCursorStore()
    audit = InMemoryAuditSink()
    remote = _StubRemote([
        RemoteFetch(entities=[], next_cursor="cursor-B"),
    ])
    p = ShadowDiffPoller(
        tenant_id="acme", platform="github", clock=Clock(node_id="t"),
        shadow=shadow, remote=remote, cursors=cursors, audit=audit,
    )
    cycle = p.run_once()
    _check("No-drift cycle emits 0 audit rows",
           audit.rows == [] and cycle.drifts_emitted == [],
           f"got {len(audit.rows)} rows")
    _check("No-drift cycle still advances cursor (empty fetch OK)",
           cycle.cursor_after == "cursor-B",
           f"got {cycle.cursor_after!r}")


# --- AC #2: deterministic shadow_drift with old/new + HLC ----------------

def test_diff_emits_shadow_drift_with_old_and_new() -> None:
    """AC #2: a disagreement on a known field emits a
    `sync.shadow_drift` row with old_value, new_value, and HLC."""
    shadow = InMemoryShadowLog()
    shadow.put(
        tenant_id="acme", platform="jira", entity_id="FORA-42",
        field="title", value="old title", hlc=_make_hlc(1_700_000_000_000),
    )
    remote = _StubRemote([
        RemoteFetch(
            entities=[RemoteEntity(entity_id="FORA-42", field_values={
                "title": {
                    "value": "new title",
                    "hlc": _make_hlc(1_700_000_001_000),
                },
            })],
            next_cursor="cursor-X",
        ),
    ])
    audit = InMemoryAuditSink()
    p = ShadowDiffPoller(
        tenant_id="acme", platform="jira", clock=Clock(node_id="t"),
        shadow=shadow, remote=remote, cursors=InMemoryCursorStore(), audit=audit,
    )
    cycle = p.run_once()
    _check("Drift emitted on field disagreement",
           len(cycle.drifts_emitted) == 1,
           f"got {len(cycle.drifts_emitted)} drifts")
    row = cycle.drifts_emitted[0]
    _check("Drift event_type is sync.shadow_drift",
           row.event_type == SHADOW_DRIFT_EVENT,
           f"got {row.event_type!r}")
    _check("Drift carries old_value in metadata",
           (row.metadata or {}).get("old_value") == "old title",
           f"got {(row.metadata or {}).get('old_value')!r}")
    _check("Drift carries new_value in metadata",
           (row.metadata or {}).get("new_value") == "new title",
           f"got {(row.metadata or {}).get('new_value')!r}")
    _check("Drift carries detected_hlc (HLC present)",
           bool((row.metadata or {}).get("detected_hlc")),
           f"got {(row.metadata or {}).get('detected_hlc')!r}")
    _check("Drift carries remote_hlc in metadata",
           (row.metadata or {}).get("remote_hlc") == _make_hlc(1_700_000_001_000),
           f"got {(row.metadata or {}).get('remote_hlc')!r}")
    _check("Drift carries entity_id in metadata",
           (row.metadata or {}).get("entity_id") == "FORA-42",
           f"got {(row.metadata or {}).get('entity_id')!r}")
    _check("Drift carries platform in metadata",
           (row.metadata or {}).get("platform") == "jira",
           f"got {(row.metadata or {}).get('platform')!r}")
    _check("Drift carries run_id (per-cycle, for OOH alert lookup)",
           bool((row.metadata or {}).get("run_id")),
           f"got {(row.metadata or {}).get('run_id')!r}")


def test_diff_digest_is_deterministic() -> None:
    """AC #2: re-running the same diff on the same inputs produces
    the same row (digest_payload is stable)."""
    def run_once() -> AuditRow:
        shadow = InMemoryShadowLog()
        shadow.put(
            tenant_id="acme", platform="jira", entity_id="FORA-7",
            field="title", value="v0", hlc=_make_hlc(1_700_000_000_000),
        )
        remote = _StubRemote([
            RemoteFetch(
                entities=[RemoteEntity(entity_id="FORA-7", field_values={
                    "title": {"value": "v1", "hlc": _make_hlc(1_700_000_001_000)},
                })],
                next_cursor="c",
            ),
        ])
        audit = InMemoryAuditSink()
        p = ShadowDiffPoller(
            tenant_id="acme", platform="jira", clock=Clock(node_id="t"),
            shadow=shadow, remote=remote, cursors=InMemoryCursorStore(), audit=audit,
        )
        return p.run_once().drifts_emitted[0]
    row_a = run_once()
    row_b = run_once()
    _check("Re-run produces the same digest_payload",
           digest_payload(row_a) == digest_payload(row_b),
           f"got {digest_payload(row_a)} vs {digest_payload(row_b)}")
    _check("Re-run produces the same metadata.entity_id",
           (row_a.metadata or {}).get("entity_id")
           == (row_b.metadata or {}).get("entity_id"),
           "entity_id changed across runs")


def test_diff_no_drift_when_in_sync() -> None:
    """AC #2 (negative): no shadow_drift when shadow == remote."""
    shadow = InMemoryShadowLog()
    shadow.put(
        tenant_id="acme", platform="jira", entity_id="FORA-7",
        field="title", value="same", hlc=_make_hlc(1_700_000_000_000),
    )
    remote = _StubRemote([
        RemoteFetch(
            entities=[RemoteEntity(entity_id="FORA-7", field_values={
                "title": {"value": "same", "hlc": _make_hlc(1_700_000_000_500)},
            })],
            next_cursor="c",
        ),
    ])
    audit = InMemoryAuditSink()
    p = ShadowDiffPoller(
        tenant_id="acme", platform="jira", clock=Clock(node_id="t"),
        shadow=shadow, remote=remote, cursors=InMemoryCursorStore(), audit=audit,
    )
    cycle = p.run_once()
    _check("In-sync shadow + remote emits no drift",
           cycle.drifts_emitted == [] and audit.rows == [],
           f"got {len(cycle.drifts_emitted)} drifts")


def test_diff_first_sighting_emits_drift() -> None:
    """AC #2: a new entity the remote shows but the shadow log
    does not (the §7.2 #3 comment divergence path) is drift."""
    shadow = InMemoryShadowLog()  # empty
    remote = _StubRemote([
        RemoteFetch(
            entities=[RemoteEntity(entity_id="FORA-99", field_values={
                "title": {"value": "fresh", "hlc": _make_hlc(1_700_000_010_000)},
            })],
            next_cursor="c",
        ),
    ])
    audit = InMemoryAuditSink()
    p = ShadowDiffPoller(
        tenant_id="acme", platform="github", clock=Clock(node_id="t"),
        shadow=shadow, remote=remote, cursors=InMemoryCursorStore(), audit=audit,
    )
    cycle = p.run_once()
    _check("First sighting (shadow None) emits drift",
           len(cycle.drifts_emitted) == 1,
           f"got {len(cycle.drifts_emitted)} drifts")
    _check("First-sighting drift old_value is None",
           (cycle.drifts_emitted[0].metadata or {}).get("old_value") is None,
           f"got {(cycle.drifts_emitted[0].metadata or {}).get('old_value')!r}")


def test_diff_field_names_helper() -> None:
    """AC #2 (helper): diff_field_names produces the same set the
    job would emit, but without writing audit rows."""
    shadow = {
        "title": {"value": "v0", "hlc": "x"},
        "body": {"value": "same", "hlc": "x"},
    }
    remote = {
        "title": {"value": "v1", "hlc": "y"},
        "body": {"value": "same", "hlc": "y"},
    }
    _check("diff_field_names returns only the drifted field",
           diff_field_names(shadow, remote) == ["title"],
           f"got {diff_field_names(shadow, remote)}")


def test_build_audit_row_validates_shadow_drift_event_type() -> None:
    """AC #2: build_audit_row accepts the new shadow_drift type."""
    row = build_audit_row(
        event_type=SHADOW_DRIFT_EVENT,
        tenant_id="acme",
        actor="system:test",
        field="title",
        reason="shadow_drift",
        metadata={"entity_id": "FORA-1"},
    )
    _check("build_audit_row accepts sync.shadow_drift",
           row.event_type == SHADOW_DRIFT_EVENT,
           f"got {row.event_type!r}")


# --- AC #3: daily markdown report ----------------------------------------

def test_daily_report_renders_to_markdown_path() -> None:
    """AC #3: the daily report renders as a markdown file at
    forge/sync-plane/reports/<tenant>/<YYYY-MM-DD>.md."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        store = FilesystemReportStore(root=tmp)
        renderer = DailyReportRenderer(store=store, root=tmp)
        drifts: List[AuditRow] = []
        report = renderer.render(
            tenant_id="acme",
            day="2026-06-18",
            shadow_drifts=drifts,
            now=dt.datetime(2026, 6, 18, 2, 0, 0, tzinfo=dt.timezone.utc),
        )
        expected = os.path.join(tmp, "acme", "2026-06-18.md")
        _check("Report path is <root>/<tenant>/<day>.md",
               report.path == expected,
               f"got {report.path!r}")
        _check("Report file written to disk",
               os.path.exists(expected),
               f"missing {expected!r}")
        body = open(expected, encoding="utf-8").read()
        _check("Empty report says 'no drift events'",
               "No drift events" in body,
               f"got body[:120]={body[:120]!r}")
        _check("Empty report includes audit_summary_digest",
               "audit_summary_digest" in body,
               "front-matter missing digest key")


def test_daily_report_includes_drift_rows() -> None:
    """AC #3: the daily report includes the per-row drift table
    when there are drifts."""
    drift = build_audit_row(
        event_type=SHADOW_DRIFT_EVENT,
        tenant_id="acme",
        actor="system:shadow-diff-poll",
        field="title",
        winner_platform="jira",
        loser_platform="paperclip",
        winner_hlc=_make_hlc(1_700_000_000_000),
        loser_hlc=_make_hlc(1_700_000_000_500),
        reason="shadow_drift",
        metadata={
            "entity_id": "FORA-7",
            "platform": "jira",
            "old_value": "old",
            "new_value": "new",
            "detected_hlc": _make_hlc(1_700_000_000_500),
            "remote_hlc": _make_hlc(1_700_000_000_500),
            "run_id": "poll-aaa",
        },
    )
    drift.timestamp = "2026-06-17T15:00:00.000000+00:00"
    renderer = DailyReportRenderer(store=InMemoryReportStore())
    report = renderer.render(
        tenant_id="acme",
        day="2026-06-18",
        shadow_drifts=[drift],
        now=dt.datetime(2026, 6, 18, 2, 0, 0, tzinfo=dt.timezone.utc),
    )
    _check("Drift count == 1",
           report.drift_count == 1,
           f"got {report.drift_count}")
    _check("field_breakdown has 'title': 1",
           report.field_breakdown == {"title": 1},
           f"got {report.field_breakdown}")
    _check("platform_breakdown has 'jira': 1",
           report.platform_breakdown == {"jira": 1},
           f"got {report.platform_breakdown}")
    _check("first_drift_hlc == drift.detected_hlc",
           report.first_drift_hlc == _make_hlc(1_700_000_000_500),
           f"got {report.first_drift_hlc!r}")
    _check("Body contains entity id 'FORA-7'",
           "FORA-7" in report.body_md,
           "entity id missing from body")
    _check("Body contains 'Per-field tally' section",
           "Per-field tally" in report.body_md,
           "section missing")
    _check("Body contains 'Per-platform tally' section",
           "Per-platform tally" in report.body_md,
           "section missing")


def test_daily_report_summary_digest_is_stable_across_runs() -> None:
    """AC #5: re-rendering the same drift set produces the same
    `audit_summary_digest` (the §AC #5 determinism anchor)."""
    def one_run() -> str:
        drift = build_audit_row(
            event_type=SHADOW_DRIFT_EVENT,
            tenant_id="acme",
            actor="system:shadow-diff-poll",
            field="title",
            reason="shadow_drift",
            metadata={
                "entity_id": "FORA-7",
                "platform": "jira",
                "old_value": "a",
                "new_value": "b",
                "detected_hlc": _make_hlc(1_700_000_000_500),
                "run_id": "poll-1",
            },
        )
        drift.timestamp = "2026-06-17T15:00:00.000000+00:00"
        return DailyReportRenderer(
            store=InMemoryReportStore(),
        ).render(
            tenant_id="acme", day="2026-06-18",
            shadow_drifts=[drift],
            now=dt.datetime(2026, 6, 18, 2, 0, 0, tzinfo=dt.timezone.utc),
        ).audit_summary_digest
    d1 = one_run()
    d2 = one_run()
    _check("audit_summary_digest is stable across re-runs",
           d1 == d2 and len(d1) == 64,
           f"got {d1!r} vs {d2!r}")


def test_daily_report_window_is_24h_ending_02_00_utc() -> None:
    """AC #3: the 24 h window is [D 02:00 UTC, D+1 02:00 UTC)."""
    start, end = report_window_for("2026-06-18")
    _check("Window start == 2026-06-18 02:00 UTC",
           start == dt.datetime(2026, 6, 18, 2, 0, tzinfo=dt.timezone.utc),
           f"got {start}")
    _check("Window end == 2026-06-19 02:00 UTC",
           end == dt.datetime(2026, 6, 19, 2, 0, tzinfo=dt.timezone.utc),
           f"got {end}")


def test_daily_report_cron_hour_is_02_utc() -> None:
    """AC #3: the cron schedule is 02:00 UTC."""
    nxt = next_run_after(dt.datetime(2026, 6, 18, 1, 0, tzinfo=dt.timezone.utc))
    _check("Next run after 01:00 UTC is 02:00 UTC same day",
           nxt == dt.datetime(2026, 6, 18, 2, 0, tzinfo=dt.timezone.utc),
           f"got {nxt}")
    nxt2 = next_run_after(dt.datetime(2026, 6, 18, 3, 0, tzinfo=dt.timezone.utc))
    _check("Next run after 03:00 UTC is 02:00 UTC next day",
           nxt2 == dt.datetime(2026, 6, 19, 2, 0, tzinfo=dt.timezone.utc),
           f"got {nxt2}")


def test_render_markdown_pure_determinism() -> None:
    """AC #5: render_markdown is a pure function; same inputs →
    same output (byte-for-byte)."""
    args = dict(
        tenant_id="acme", day="2026-06-18",
        drifts=[],
        field_breakdown={}, platform_breakdown={},
        first_hlc="", last_hlc="", has_p0=False,
        audit_digest="deadbeef" * 8,
        rendered_at=dt.datetime(2026, 6, 18, 2, 0, tzinfo=dt.timezone.utc),
        actor="system:test",
    )
    _check("render_markdown is deterministic (byte-equal)",
           render_markdown(**args) == render_markdown(**args),
           "two renders produced different bytes")


# --- AC #4: 60-min OOH alert wiring ---------------------------------------

def test_ooh_threshold_is_60_minutes() -> None:
    """AC #4: the OOH threshold is 60 min (3600 s)."""
    _check("OOH_THRESHOLD_SECONDS == 3600",
           OOH_THRESHOLD_SECONDS == 60 * 60,
           f"got {OOH_THRESHOLD_SECONDS}")


def test_is_ooh_boundary() -> None:
    """AC #4: boundary behaviour — 59:59 is not OOH; 60:01 is."""
    now = dt.datetime(2026, 6, 18, 12, 0, 0, tzinfo=dt.timezone.utc)
    inside = (now - dt.timedelta(seconds=59 * 60 + 59)).isoformat()
    outside = (now - dt.timedelta(seconds=60 * 60 + 1)).isoformat()
    _check("is_ooh: 59:59 is not OOH",
           is_ooh(drift_timestamp=inside, now=now) is False,
           "59:59 should not be OOH")
    _check("is_ooh: 60:01 is OOH",
           is_ooh(drift_timestamp=outside, now=now) is True,
           "60:01 should be OOH")


def test_alerter_fires_for_unprocessed_drift() -> None:
    """AC #4: an unprocessed shadow_drift > 60 min old fires a
    Slack page with the correct (tenant, run_id) keys."""
    now = dt.datetime(2026, 6, 18, 12, 0, 0, tzinfo=dt.timezone.utc)
    drift_ts = (now - dt.timedelta(minutes=90)).isoformat()
    drift = build_audit_row(
        event_type=SHADOW_DRIFT_EVENT,
        tenant_id="acme",
        actor="system:shadow-diff-poll",
        field="title",
        reason="shadow_drift",
        metadata={
            "entity_id": "FORA-7",
            "platform": "jira",
            "old_value": "v0",
            "new_value": "v1",
            "detected_hlc": _make_hlc(1_700_000_000_500),
            "run_id": "poll-aaa",
        },
    )
    drift.timestamp = drift_ts
    audit = ListAuditLogReader([drift])
    slack = InMemorySlackChannel()
    alerter = ShadowDriftOOHAlerter(
        audit_log=audit, slack=slack,
        clock=lambda: now, channel=DEFAULT_SLACK_CHANNEL,
    )
    pending = alerter.scan(tenant_id="acme", now=now)
    _check("Alerter fired one OOH page",
           len(pending) == 1 and slack.count() == 1,
           f"got {len(pending)} pending / {slack.count()} pages")
    _check("Slack page severity is P1 (R-SYNC-05 reserves P0)",
           slack.pages()[0].severity == "P1",
           f"got {slack.pages()[0].severity}")
    _check("Slack page tenant_id is 'acme'",
           slack.pages()[0].tenant_id == "acme",
           f"got {slack.pages()[0].tenant_id}")
    _check("Slack page run_id is the drift's run_id",
           slack.pages()[0].run_id == "poll-aaa",
           f"got {slack.pages()[0].run_id}")
    _check("Slack page details carry entity_id",
           slack.pages()[0].details.get("entity_id") == "FORA-7",
           f"got {slack.pages()[0].details.get('entity_id')!r}")
    _check("Slack page details carry field",
           slack.pages()[0].details.get("field") == "title",
           f"got {slack.pages()[0].details.get('field')!r}")


def test_alerter_skips_processed_drift() -> None:
    """AC #4: a drift the resolver has applied is NOT OOH."""
    now = dt.datetime(2026, 6, 18, 12, 0, 0, tzinfo=dt.timezone.utc)
    drift_ts = (now - dt.timedelta(minutes=120)).isoformat()
    drift = build_audit_row(
        event_type=SHADOW_DRIFT_EVENT,
        tenant_id="acme", actor="system:shadow-diff-poll", field="title",
        reason="shadow_drift",
        metadata={"entity_id": "FORA-7", "platform": "jira",
                  "old_value": "v0", "new_value": "v1",
                  "detected_hlc": _make_hlc(1_700_000_000_500),
                  "run_id": "poll-bbb"},
    )
    drift.timestamp = drift_ts
    applied = build_audit_row(
        event_type=EVENT_APPLIED,
        tenant_id="acme", actor="system:resolver", field="title",
        reason="hlc_lww",
        metadata={"run_id": "poll-bbb", "idempotency_key": "poll-bbb"},
    )
    applied.timestamp = drift_ts
    audit = ListAuditLogReader([drift, applied])
    slack = InMemorySlackChannel()
    alerter = ShadowDriftOOHAlerter(
        audit_log=audit, slack=slack, clock=lambda: now,
    )
    pending = alerter.scan(tenant_id="acme", now=now)
    _check("Alerter does NOT fire for an applied drift",
           pending == [] and slack.count() == 0,
           f"got {len(pending)} pending / {slack.count()} pages")


def test_alerter_skips_drift_under_60_min() -> None:
    """AC #4: a 30-min-old drift is not yet OOH."""
    now = dt.datetime(2026, 6, 18, 12, 0, 0, tzinfo=dt.timezone.utc)
    drift_ts = (now - dt.timedelta(minutes=30)).isoformat()
    drift = build_audit_row(
        event_type=SHADOW_DRIFT_EVENT,
        tenant_id="acme", actor="system:shadow-diff-poll", field="title",
        reason="shadow_drift",
        metadata={"entity_id": "FORA-7", "platform": "github",
                  "old_value": "v0", "new_value": "v1",
                  "detected_hlc": _make_hlc(1_700_000_000_500),
                  "run_id": "poll-ccc"},
    )
    drift.timestamp = drift_ts
    audit = ListAuditLogReader([drift])
    slack = InMemorySlackChannel()
    alerter = ShadowDriftOOHAlerter(
        audit_log=audit, slack=slack, clock=lambda: now,
    )
    pending = alerter.scan(tenant_id="acme", now=now)
    _check("Alerter does NOT fire for a 30-min-old drift",
           pending == [] and slack.count() == 0,
           f"got {len(pending)} pending / {slack.count()} pages")


def test_alerter_is_idempotent_on_rescan() -> None:
    """AC #4 + idempotency: rescanning the same drift set fires
    no new pages (the Slack channel dedups on run_id)."""
    now = dt.datetime(2026, 6, 18, 12, 0, 0, tzinfo=dt.timezone.utc)
    drift_ts = (now - dt.timedelta(minutes=90)).isoformat()
    drift = build_audit_row(
        event_type=SHADOW_DRIFT_EVENT,
        tenant_id="acme", actor="system:shadow-diff-poll", field="title",
        reason="shadow_drift",
        metadata={"entity_id": "FORA-7", "platform": "jira",
                  "old_value": "v0", "new_value": "v1",
                  "detected_hlc": _make_hlc(1_700_000_000_500),
                  "run_id": "poll-ddd"},
    )
    drift.timestamp = drift_ts
    audit = ListAuditLogReader([drift])
    slack = InMemorySlackChannel()
    alerter = ShadowDriftOOHAlerter(
        audit_log=audit, slack=slack, clock=lambda: now,
    )
    a = alerter.scan(tenant_id="acme", now=now)
    b = alerter.scan(tenant_id="acme", now=now)
    _check("First scan fires one page",
           len(a) == 1 and slack.count() == 1,
           f"got {len(a)} / {slack.count()}")
    _check("Rescan does NOT fire a duplicate",
           b == [] and slack.count() == 1,
           f"got {len(b)} / {slack.count()}")


def test_page_digest_stable() -> None:
    """AC #4 + AC #5: the same drift always produces the same
    Slack page digest (for the QA exit-gate)."""
    from sync_plane.alert_wiring import SlackPage
    page = SlackPage(
        channel=DEFAULT_SLACK_CHANNEL, severity="P1", tenant_id="acme",
        run_id="poll-x", title="t", summary="s", details={"k": "v"},
        fired_at=dt.datetime(2026, 6, 18, 12, 0, 0, tzinfo=dt.timezone.utc),
    )
    _check("page_digest is stable across calls (sha256 hex)",
           page_digest(page) == page_digest(page)
           and len(page_digest(page)) == 64,
           f"got {page_digest(page)!r}")


# --- AC #5: 7-day clean-run smoke ----------------------------------------

def test_seven_day_clean_run() -> None:
    """AC #5: simulate 7 consecutive daily runs with zero drift
    and zero OOH alerts — the exit-gate #3 contract.

    Each simulated day: 0 shadow_drift events, 0 OOH alerts, 1
    rendered markdown report (clean).  Across 7 days the report
    digests follow the empty-run pattern; no Slack page fires.
    """
    audit = ListAuditLogReader()  # no drifts
    slack = InMemorySlackChannel()
    alerter = ShadowDriftOOHAlerter(audit_log=audit, slack=slack)
    store = InMemoryReportStore()
    renderer = DailyReportRenderer(store=store)
    day_zero = dt.date(2026, 6, 12)
    drift_count = 0
    page_count = 0
    for i in range(7):
        d = day_zero + dt.timedelta(days=i)
        day_str = d.isoformat()
        report = renderer.render(
            tenant_id="acme", day=day_str, shadow_drifts=[],
            now=dt.datetime(d.year, d.month, d.day, DAILY_CRON_HOUR_UTC, 0, 0,
                            tzinfo=dt.timezone.utc),
        )
        drift_count += report.drift_count
        # OOH check: at end of each day, scan the (still empty) log.
        pending = alerter.scan(
            tenant_id="acme",
            now=dt.datetime(d.year, d.month, d.day, 23, 59, 59,
                            tzinfo=dt.timezone.utc),
        )
        page_count += len(pending)
    _check("7-day clean run: total drift count == 0",
           drift_count == 0, f"got {drift_count}")
    _check("7-day clean run: total OOH pages == 0",
           page_count == 0, f"got {page_count}")
    _check("7-day clean run: Slack channel has no pages",
           slack.count() == 0, f"got {slack.count()}")
    _check("7-day clean run: store has 7 report files",
           len(store._store) == 7, f"got {len(store._store)}")


def test_seven_day_with_single_drift() -> None:
    """AC #5 (drift case): one drift on day 3 produces one OOH
    page once it ages past 60 min.  All 7 reports still render;
    only the OOH check fires the Slack alert."""
    audit = ListAuditLogReader()
    slack = InMemorySlackChannel()
    alerter = ShadowDriftOOHAlerter(audit_log=audit, slack=slack)
    store = InMemoryReportStore()
    renderer = DailyReportRenderer(store=store)
    day_zero = dt.date(2026, 6, 12)
    pending_total = 0
    for i in range(7):
        d = day_zero + dt.timedelta(days=i)
        day_str = d.isoformat()
        # Day 3: emit one drift.  We stamp the timestamp at the
        # start of day 3 so the daily report picks it up, then
        # the OOH check at end-of-day-3 (16 h later) trips.
        drifts: List[AuditRow] = []
        if i == 2:
            drift = build_audit_row(
                event_type=SHADOW_DRIFT_EVENT,
                tenant_id="acme", actor="system:shadow-diff-poll",
                field="title", reason="shadow_drift",
                metadata={"entity_id": "FORA-1", "platform": "jira",
                          "old_value": "a", "new_value": "b",
                          "detected_hlc": _make_hlc(1_700_000_000_500),
                          "run_id": "poll-day3"},
            )
            drift.timestamp = dt.datetime(d.year, d.month, d.day, 8, 0, 0,
                                          tzinfo=dt.timezone.utc).isoformat()
            audit.append(drift)
            drifts.append(drift)
        renderer.render(
            tenant_id="acme", day=day_str, shadow_drifts=drifts,
            now=dt.datetime(d.year, d.month, d.day, DAILY_CRON_HOUR_UTC, 0, 0,
                            tzinfo=dt.timezone.utc),
        )
        pending_total += len(alerter.scan(
            tenant_id="acme",
            now=dt.datetime(d.year, d.month, d.day, 23, 59, 59,
                            tzinfo=dt.timezone.utc),
        ))
    _check("Day-3 drift produces exactly one OOH page across the 7-day window",
           pending_total == 1 and slack.count() == 1,
           f"got {pending_total} pending / {slack.count()} pages")
    pages = slack.pages()
    _check("OOH page run_id is the day-3 drift's run_id",
           pages[0].run_id == "poll-day3",
           f"got {pages[0].run_id!r}")


# --- main -----------------------------------------------------------------

def main() -> int:
    tests = [
        # AC #1
        test_poll_interval_is_five_minutes,
        test_supported_platforms_are_jira_github_clickup,
        test_poller_advances_cursor_on_success,
        test_poller_no_delta_keeps_cursor,
        # AC #2
        test_diff_emits_shadow_drift_with_old_and_new,
        test_diff_digest_is_deterministic,
        test_diff_no_drift_when_in_sync,
        test_diff_first_sighting_emits_drift,
        test_diff_field_names_helper,
        test_build_audit_row_validates_shadow_drift_event_type,
        # AC #3
        test_daily_report_renders_to_markdown_path,
        test_daily_report_includes_drift_rows,
        test_daily_report_summary_digest_is_stable_across_runs,
        test_daily_report_window_is_24h_ending_02_00_utc,
        test_daily_report_cron_hour_is_02_utc,
        test_render_markdown_pure_determinism,
        # AC #4
        test_ooh_threshold_is_60_minutes,
        test_is_ooh_boundary,
        test_alerter_fires_for_unprocessed_drift,
        test_alerter_skips_processed_drift,
        test_alerter_skips_drift_under_60_min,
        test_alerter_is_idempotent_on_rescan,
        test_page_digest_stable,
        # AC #5
        test_seven_day_clean_run,
        test_seven_day_with_single_drift,
    ]
    t0 = time.perf_counter()
    for t in tests:
        try:
            t()
        except Exception as e:
            global _FAIL
            _FAIL += 1
            _FAILURES.append(f"{t.__name__} raised {type(e).__name__}: {e}")
            print(f"[FAIL] {t.__name__} raised {type(e).__name__}: {e}")
    dt_ms = (time.perf_counter() - t0) * 1000
    total = _PASS + _FAIL
    print()
    print(f"{_PASS}/{total} assertions PASS in {dt_ms:.1f} ms")
    if _FAIL:
        print("FAILURES:")
        for f in _FAILURES:
            print(f"  - {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
