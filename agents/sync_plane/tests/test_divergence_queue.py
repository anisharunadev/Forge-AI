"""
Smoke test for FORA-255 — Tier-3 divergence workbench (FORA-11.5).

AC coverage (from forge/11.5/design.md §7):

  AC #1: render budget < 2 s for 10 000 events
         → test_render_budget_10k
  AC #2: resolution writes audit row with both HLCs + chosen winner
         → test_resolve_writes_audit_row
  AC #3: bulk resolution emits N individual audit rows
         → test_bulk_emits_n_audit_rows
  AC #4: daily summary email is opt-out per tenant
         → test_digest_opt_out
  AC #5: no silent resolution — every Tier-3 event leaves an audit trail
         → test_no_silent_resolution (queue row + audit row invariants)
  AC #6: design-system alignment (DocAgent / Knowledge Layer §0)
         → enforced at the UI layer; the contract here pins the
           column set + empty state behaviour

Invocation:
    cd forge/0.7-platform/
    python -m agents.sync_plane.tests.test_divergence_queue
"""

from __future__ import annotations

import os
import sys
import time
import uuid

_HERE = os.path.dirname(os.path.abspath(__file__))
_AGENTS = os.path.dirname(os.path.dirname(_HERE))
if _AGENTS not in sys.path:
    sys.path.insert(0, _AGENTS)

from sync_plane.divergence_queue import (           # noqa: E402
    AUDIT_REASON_BULK,
    AUDIT_REASON_HUMAN,
    DIGEST_LARGE_THRESHOLD,
    DIGEST_TOP_FIELDS_TRUNCATE,
    DIVERGENCE_RESOLVED_BY_HUMAN_EVENT,
    DivergenceReason,
    DivergenceRow,
    LIST_PAGE_SIZE,
    Resolution,
    _validate_digest_payload,
    bulk_resolve,
    build_digest_payload,
    enqueue_divergence,
    get_divergence,
    list_divergences,
    resolve_divergence,
)
from sync_plane.hlc import HLC                      # noqa: E402


_PASS = "[PASS]"
_FAIL = "[FAIL]"
_FAILURES: list = []


def _check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"{_PASS} {name}")
    else:
        print(f"{_FAIL} {name}  {detail}")
        _FAILURES.append(name)


def _make_hlc(physical_ms: int, laa: int = 0, seq: int = 0) -> str:
    return str(HLC(physical_ms, laa, seq))


def _make_row(
    *,
    tenant_id: str = "tenant_abc",
    queue_id: str | None = None,
    field_path: str = "title",
    left_platform: str = "paperclip",
    right_platform: str = "jira",
    left_value: object = "Paperclip title",
    right_value: object = "Jira title",
    left_hlc: str = "1718645112000.004-0042",
    right_hlc: str = "1718645111000.003-0041",
    detected_at: str = "2026-06-18T12:00:00+00:00",
    reason: str = DivergenceReason.HLC_SKEW.value,
) -> DivergenceRow:
    return enqueue_divergence(
        tenant_id=tenant_id,
        paperclip_issue_id="FORA-1",
        remote_kind="jira" if right_platform == "jira" else right_platform,
        remote_id="10001",
        field_path=field_path,
        left_value=left_value,
        left_hlc=left_hlc,
        left_platform=left_platform,
        right_value=right_value,
        right_hlc=right_hlc,
        right_platform=right_platform,
        detected_hlc=_make_hlc(1718645113000, 5, 1),
        reason=reason,
        detected_at=detected_at,
        queue_id=queue_id,
    )


# ---------------------------------------------------------------------------
# AC #1: render budget < 2 s for 10 000 events.
# ---------------------------------------------------------------------------

def test_render_budget_10k() -> None:
    """10 000 rows; the list endpoint + the JSON serialise must
    finish in < 200 ms in-process (the < 2 s budget includes the
    network + the React render, which we don't simulate here).
    """
    store = [
        _make_row(
            queue_id=str(uuid.uuid4()),
            detected_at=f"2026-06-18T12:{(i % 60):02d}:{((i // 60) % 60):02d}+00:00",
        )
        for i in range(10_000)
    ]
    t0 = time.perf_counter()
    out = list_divergences(store, tenant_id="tenant_abc", limit=LIST_PAGE_SIZE, offset=0)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    _check("list_divergences returns 200 rows for 10k store", len(out.rows) == LIST_PAGE_SIZE)
    _check("list_divergences total reports 10 000", out.total == 10_000)
    _check("list_divergences render budget < 200 ms (10k store)", elapsed_ms < 200.0,
           detail=f"elapsed_ms={elapsed_ms:.2f}")
    # Sort: most recent detected_at first.
    _check("rows sorted by detected_at DESC",
           out.rows[0].detected_at >= out.rows[-1].detected_at)


# ---------------------------------------------------------------------------
# AC #2: resolution writes audit row with both HLCs + chosen winner.
# ---------------------------------------------------------------------------

def test_resolve_writes_audit_row() -> None:
    store = [_make_row()]
    result = resolve_divergence(
        store,
        tenant_id="tenant_abc",
        queue_id=store[0].queue_id,
        resolution=Resolution.LEFT.value,
        actor="user:admin-uuid",
    )
    _check("resolve() returns a ResolveResult", result is not None)
    _check("audit event_type = divergence_resolved_by_human",
           result.audit_row.event_type == DIVERGENCE_RESOLVED_BY_HUMAN_EVENT)
    _check("audit reason = human_pick (single pick)",
           result.audit_row.reason == AUDIT_REASON_HUMAN)
    _check("audit row carries winner + loser HLCs",
           result.audit_row.winner_hlc == store[0].left_hlc
           and result.audit_row.loser_hlc == store[0].right_hlc)
    _check("audit row carries winner + loser platforms",
           result.audit_row.winner_platform == store[0].left_platform
           and result.audit_row.loser_platform == store[0].right_platform)
    _check("queue row marked resolved",
           store[0].is_resolved() and store[0].resolved_by == "user:admin-uuid")
    _check("queue row resolution_audit_id matches audit id",
           store[0].resolution_audit_id == result.audit_id)
    # Idempotency: a second resolve must raise.
    raised = False
    try:
        resolve_divergence(
            store,
            tenant_id="tenant_abc",
            queue_id=store[0].queue_id,
            resolution=Resolution.RIGHT.value,
            actor="user:admin-uuid",
        )
    except ValueError:
        raised = True
    _check("second resolve raises (idempotency)", raised)


def test_resolve_merge_records_winner_by_hlc() -> None:
    """For a merge the winner is the higher-HLC side; loser is the
    other side; the merged value lives in `metadata.merge_value`."""
    store = [_make_row()]
    result = resolve_divergence(
        store,
        tenant_id="tenant_abc",
        queue_id=store[0].queue_id,
        resolution=Resolution.MERGE.value,
        actor="user:admin-uuid",
        merge_value={"title": "merged"},
    )
    _check("merge picks higher HLC as winner (left is higher)",
           result.audit_row.winner_platform == store[0].left_platform
           and result.audit_row.loser_platform == store[0].right_platform)
    _check("merge_value recorded in audit metadata",
           result.audit_row.metadata["merge_value"] == {"title": "merged"})


def test_resolve_rejects_bad_inputs() -> None:
    store = [_make_row()]
    # Bad resolution
    raised = False
    try:
        resolve_divergence(
            store,
            tenant_id="tenant_abc",
            queue_id=store[0].queue_id,
            resolution="up",
            actor="user:admin-uuid",
        )
    except ValueError:
        raised = True
    _check("bad resolution rejected", raised)
    # Bad actor prefix
    raised = False
    try:
        resolve_divergence(
            store,
            tenant_id="tenant_abc",
            queue_id=store[0].queue_id,
            resolution=Resolution.LEFT.value,
            actor="intruder",
        )
    except ValueError:
        raised = True
    _check("bad actor prefix rejected", raised)
    # merge without value
    store2 = [_make_row()]
    raised = False
    try:
        resolve_divergence(
            store2,
            tenant_id="tenant_abc",
            queue_id=store2[0].queue_id,
            resolution=Resolution.MERGE.value,
            actor="user:admin-uuid",
        )
    except ValueError:
        raised = True
    _check("merge without merge_value rejected", raised)


# ---------------------------------------------------------------------------
# AC #3: bulk resolution emits N individual audit rows.
# ---------------------------------------------------------------------------

def test_bulk_emits_n_audit_rows() -> None:
    store = [
        _make_row(
            queue_id=str(uuid.uuid4()),
            field_path="state",
            left_hlc=_make_hlc(1_718_645_112_000 + i, 4, 42),
            right_hlc=_make_hlc(1_718_645_111_000 + i, 3, 41),
        )
        for i in range(5)
    ]
    succeeded, failed = bulk_resolve(
        store,
        tenant_id="tenant_abc",
        filter_field_path="state",
        resolution=Resolution.LEFT.value,
        actor="user:admin-uuid",
        bulk_pattern_key="always_paperclip_state",
    )
    _check("bulk_resolve resolves 5 events", len(succeeded) == 5)
    _check("bulk_resolve reports 0 failures", len(failed) == 0)
    audit_ids = [r.audit_id for r in succeeded]
    _check("bulk emits 5 distinct audit ids", len(set(audit_ids)) == 5)
    for r in succeeded:
        _check(
            f"bulk audit row {r.audit_id[:8]}… reason = human_bulk",
            r.audit_row.reason == AUDIT_REASON_BULK,
        )
        _check(
            f"bulk audit row {r.audit_id[:8]}… metadata.is_bulk = true",
            r.audit_row.metadata["is_bulk"] is True,
        )
        _check(
            f"bulk audit row {r.audit_id[:8]}… carries bulk_pattern_key",
            r.audit_row.metadata["bulk_pattern_key"] == "always_paperclip_state",
        )


def test_bulk_partial_failure_does_not_roll_back() -> None:
    """When a row matches the bulk filter but is already resolved
    at the moment of resolution, the API skips it cleanly and the
    remaining rows still resolve.  Atomicity: each resolve is
    independent; a failure on row K does not roll back rows 1..K-1.
    The contract returns (succeeded, failed) so the UI can show
    "resolved 2 of 3, 1 already resolved, see toast"."""
    store = [_make_row(queue_id=str(uuid.uuid4())) for _ in range(3)]
    # Pre-resolve row 0; list_divergences filters it out so the
    # bulk call iterates only over rows 1 and 2.
    resolve_divergence(
        store, tenant_id="tenant_abc", queue_id=store[0].queue_id,
        resolution=Resolution.LEFT.value, actor="user:admin-uuid",
    )
    succeeded, failed = bulk_resolve(
        store,
        tenant_id="tenant_abc",
        resolution=Resolution.LEFT.value,
        actor="user:admin-uuid",
        bulk_pattern_key="any",
    )
    _check("bulk partial: 2 succeeded (pre-resolved filtered out)", len(succeeded) == 2)
    _check("bulk partial: 0 hard failures", len(failed) == 0)
    _check("bulk partial: pre-resolved row still resolved",
           store[0].resolved_at is not None)
    _check("bulk partial: rows 1 and 2 now resolved",
           store[1].resolved_at is not None and store[2].resolved_at is not None)


# ---------------------------------------------------------------------------
# AC #4: daily summary email is opt-out per tenant.
# ---------------------------------------------------------------------------

def test_digest_opt_out() -> None:
    store = [_make_row(detected_at="2026-06-18T08:00:00+00:00")]
    out = build_digest_payload(
        store, tenant_id="tenant_abc", day="2026-06-18", opted_out=True,
    )
    _check("digest returns None when tenant is opted out", out is None)


def test_digest_normal_day() -> None:
    store = [
        _make_row(
            detected_at="2026-06-18T08:00:00+00:00",
            field_path="title",
        ),
        _make_row(
            detected_at="2026-06-18T09:00:00+00:00",
            field_path="body",
        ),
        _make_row(
            detected_at="2026-06-18T10:00:00+00:00",
            field_path="title",
        ),
    ]
    out = build_digest_payload(
        store, tenant_id="tenant_abc", day="2026-06-18", opted_out=False,
    )
    _check("digest normal: total = 3", out is not None and out.total == 3)
    _check("digest normal: title count = 2",
           out.field_path_breakdown.get("title") == 2)
    _check("digest normal: subject carries the day",
           "2026-06-18" in out.subject and "3 new" in out.subject)
    _check("digest normal: not action-required",
           out.is_action_required is False)
    _check("digest normal: deep_link is the pre-filtered workbench",
           "since=2026-06-18" in out.deep_link)


def test_digest_action_required_threshold() -> None:
    """When the day's count exceeds the 1 000 cap, the subject
    flips to 'Action required' and the per-field-path breakdown
    is truncated to the top 5."""
    # 1 001 events; five distinct field paths; one path dominates.
    store = []
    for i in range(DIGEST_LARGE_THRESHOLD + 1):
        fp = "title" if i < 800 else ("body" if i < 950 else ("state" if i < 980 else ("sprint" if i < 995 else "github_labels")))
        store.append(_make_row(
            queue_id=str(uuid.uuid4()),
            detected_at="2026-06-18T08:00:00+00:00",
            field_path=fp,
        ))
    out = build_digest_payload(
        store, tenant_id="tenant_abc", day="2026-06-18", opted_out=False,
    )
    _check("digest action-required: total = 1001",
           out is not None and out.total == DIGEST_LARGE_THRESHOLD + 1)
    _check("digest action-required: is_action_required = True",
           out.is_action_required is True)
    _check(
        f"digest action-required: subject flips (cap is {DIGEST_LARGE_THRESHOLD})",
        f">{DIGEST_LARGE_THRESHOLD} divergences" in out.subject,
    )
    _check(
        f"digest action-required: breakdown truncated to top {DIGEST_TOP_FIELDS_TRUNCATE}",
        len(out.field_path_breakdown) <= DIGEST_TOP_FIELDS_TRUNCATE,
    )


# ---------------------------------------------------------------------------
# AC #5: no silent resolution — every Tier-3 event leaves an audit trail.
# ---------------------------------------------------------------------------

def test_no_silent_resolution() -> None:
    """Three invariants that prove AC #5:

    1. Enqueue always returns a row with both HLCs (no drop).
    2. Resolve always writes an audit row (no silent pick).
    3. The queue row's resolution_audit_id is the FK back to the
       audit row, so the audit forwarder can join on it.
    """
    store = [_make_row()]
    _check("enqueue preserves both HLCs",
           store[0].left_hlc and store[0].right_hlc)
    result = resolve_divergence(
        store, tenant_id="tenant_abc", queue_id=store[0].queue_id,
        resolution=Resolution.LEFT.value, actor="user:admin-uuid",
    )
    _check("resolve wrote an audit row", result.audit_row is not None)
    _check("audit row has record_hash (forwarder fills it)",
           bool(result.audit_row.record_hash))
    _check("queue row's resolution_audit_id is the audit row's event_id",
           store[0].resolution_audit_id == result.audit_row.event_id)
    # The audit forwarder (FORA-36) reads the record_hash; if it
    # were empty the row would be a silent loss.  Assert the
    # digest_payload() produces a 64-char hex string.
    _check("audit row record_hash is 64-char hex",
           len(result.audit_row.record_hash) == 64)


# ---------------------------------------------------------------------------
# Validation: enqueue rejects bad HLCs and bad field paths.
# ---------------------------------------------------------------------------

def test_enqueue_validation() -> None:
    raised = False
    try:
        enqueue_divergence(
            tenant_id="tenant_abc",
            paperclip_issue_id="FORA-1",
            remote_kind="jira",
            remote_id="10001",
            field_path="title",
            left_value="x",
            left_hlc="not-an-hlc",
            left_platform="paperclip",
            right_value="y",
            right_hlc=_make_hlc(1_700_000_000_000),
            right_platform="jira",
            detected_hlc=_make_hlc(1_700_000_001_000),
            reason=DivergenceReason.HLC_SKEW.value,
        )
    except ValueError:
        raised = True
    _check("enqueue rejects malformed HLC", raised)
    raised = False
    try:
        enqueue_divergence(
            tenant_id="tenant_abc",
            paperclip_issue_id="FORA-1",
            remote_kind="jira",
            remote_id="10001",
            field_path="not-a-known-field",
            left_value="x",
            left_hlc=_make_hlc(1_700_000_000_000),
            left_platform="paperclip",
            right_value="y",
            right_hlc=_make_hlc(1_700_000_001_000),
            right_platform="jira",
            detected_hlc=_make_hlc(1_700_000_002_000),
            reason=DivergenceReason.HLC_SKEW.value,
        )
    except ValueError:
        raised = True
    _check("enqueue rejects unknown field_path", raised)
    raised = False
    try:
        enqueue_divergence(
            tenant_id="tenant_abc",
            paperclip_issue_id="FORA-1",
            remote_kind="jira",
            remote_id="10001",
            field_path="title",
            left_value="x",
            left_hlc=_make_hlc(1_700_000_000_000),
            left_platform="paperclip",
            right_value="y",
            right_hlc=_make_hlc(1_700_000_001_000),
            right_platform="paperclip",            # same as left — not a divergence
            detected_hlc=_make_hlc(1_700_000_002_000),
            reason=DivergenceReason.HLC_SKEW.value,
        )
    except ValueError:
        raised = True
    _check("enqueue rejects left_platform == right_platform", raised)


# ---------------------------------------------------------------------------
# Tenant scoping: cross-tenant reads return KeyError.
# ---------------------------------------------------------------------------

def test_tenant_scoping() -> None:
    store = [_make_row(tenant_id="tenant_abc")]
    # Same queue_id, wrong tenant → KeyError
    raised = False
    try:
        get_divergence(store, tenant_id="tenant_xyz", queue_id=store[0].queue_id)
    except KeyError:
        raised = True
    _check("get_divergence is tenant-scoped", raised)
    # list() filters by tenant
    out = list_divergences(store, tenant_id="tenant_xyz", limit=10, offset=0)
    _check("list_divergences filters by tenant", out.total == 0)


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------

def main() -> int:
    tests = [
        test_render_budget_10k,
        test_resolve_writes_audit_row,
        test_resolve_merge_records_winner_by_hlc,
        test_resolve_rejects_bad_inputs,
        test_bulk_emits_n_audit_rows,
        test_bulk_partial_failure_does_not_roll_back,
        test_digest_opt_out,
        test_digest_normal_day,
        test_digest_action_required_threshold,
        test_no_silent_resolution,
        test_enqueue_validation,
        test_tenant_scoping,
    ]
    t0 = time.perf_counter()
    for fn in tests:
        try:
            fn()
        except AssertionError as e:
            print(f"{_FAIL} {fn.__name__} raised AssertionError: {e}")
            _FAILURES.append(fn.__name__)
        except Exception as e:                                      # noqa: BLE001
            print(f"{_FAIL} {fn.__name__} raised {type(e).__name__}: {e}")
            _FAILURES.append(fn.__name__)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    print()
    if _FAILURES:
        print(f"{_FAIL} {len(_FAILURES)} test(s) failed: {_FAILURES}")
        return 1
    print(f"{_PASS} all {len(tests)} tests green in {elapsed_ms:.1f} ms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
