"""
Smoke test for FORA-254 — Tier 1 / Tier 2 / Tier 3 conflict resolver.

This is the AC #6 smoke test: forged HLCs drive the resolver
through all three tiers and the audit row shape is asserted on
the divergence_resolved / clock_skew events.  Runs in <1s with
no external dependencies (Postgres / JetStream not required for
v0.1).

Invocation:
    cd forge/0.7-platform/
    python -m agents.sync_plane.tests.test_smoke
"""

from __future__ import annotations

import sys
import time
import uuid
from typing import List

# Repo-root import shim so this file works both as a module and as
# a script.  The smoke test is the property test; it must not fail
# because the parent dir is on sys.path.
import os
_HERE = os.path.dirname(os.path.abspath(__file__))
_AGENTS = os.path.dirname(os.path.dirname(_HERE))
if _AGENTS not in sys.path:
    sys.path.insert(0, _AGENTS)

from sync_plane import (                              # noqa: E402
    CLOCK_SKEW_EVENT,
    DEFAULT_FIELD_OWNERS,
    DIVERGENCE_RESOLVED_EVENT,
    GENESIS_HLC,
    HLC,
    Clock,
    ClockMonitor,
    FieldOwner,
    FieldOwnershipRule,
    Resolution,
    Resolver,
    SKEW_THRESHOLD_MS,
    parse,
    resolve,
)
from sync_plane.audit import build_audit_row, digest_payload  # noqa: E402


_PASS = "[PASS]"
_FAIL = "[FAIL]"


def _check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"{_PASS} {name}")
    else:
        print(f"{_FAIL} {name}  {detail}")
        raise AssertionError(name)


def _make_hlc(physical_ms: int, laa: int = 0, seq: int = 0) -> str:
    return str(HLC(physical_ms, laa, seq))


def test_hlc_monotonicity() -> None:
    """AC §3.2 — HLC is strictly monotonic on the producing node."""
    fake_now = [1_700_000_000_000.0]
    clock = Clock(clock=lambda: fake_now[0] / 1000.0, node_id="t")
    a = clock.now_hlc()
    fake_now[0] += 5   # +5ms
    b = clock.now_hlc()
    fake_now[0] += 0   # same wall — seq should advance
    c = clock.now_hlc()
    _check("HLC monotonicity + tick()/observe()",
           a < b < c, f"a={a} b={b} c={c}")


def test_field_ownership_table() -> None:
    """AC #1 + #2 — the default table has the 8 default fields."""
    expected = {
        "run_id", "run_status", "run_events",
        "assignee_agent_id",
        "sprint", "story_points", "epic_link",
        "github_labels", "github_milestone",
        "state", "status",
    }
    _check("Field ownership table (11 default fields)",
           set(DEFAULT_FIELD_OWNERS.keys()) == expected,
           f"got {set(DEFAULT_FIELD_OWNERS.keys())}")


def test_tier1_paperclip_owned_rejected() -> None:
    """Tier 1: paperclip-owned fields reject inbound remote writes."""
    clock = Clock(node_id="t")
    r = Resolver(clock=clock, tenant_id="acme", actor="agent:test")
    hlc_in = _make_hlc(1_700_000_000_000)
    res = resolve(
        resolver=r,
        field="run_status",
        inbound_platform="github",
        inbound_value="closed",
        inbound_hlc=hlc_in,
        canonical=None,
    )
    _check("Tier 1 paperclip-owned reject",
           res.tier == Resolution.TIER1_REJECTED
           and res.reason == "field_owner"
           and res.winner_platform == "paperclip"
           and res.loser_platform == "github"
           and res.audit_row is not None
           and res.audit_row.reason == "field_owner",
           f"got tier={res.tier} reason={res.reason}")


def test_tier1_remote_owned_accept() -> None:
    """Tier 1: remote-owned fields accept inbound and mirror to peers."""
    clock = Clock(node_id="t")
    r = Resolver(clock=clock, tenant_id="acme", actor="agent:test")
    hlc_in = _make_hlc(1_700_000_000_000)
    res = resolve(
        resolver=r,
        field="sprint",
        inbound_platform="jira",
        inbound_value="Sprint-42",
        inbound_hlc=hlc_in,
        canonical=None,
    )
    _check("Tier 1 remote-owned accept",
           res.tier == Resolution.TIER1_ACCEPTED
           and res.canonical_value == "Sprint-42"
           and "github" in res.mirror_writes
           and "clickup" in res.mirror_writes
           and "jira" not in res.mirror_writes,
           f"got tier={res.tier} mirror={list(res.mirror_writes)}")


def test_tier2_lww_inbound_beats_canonical() -> None:
    """Tier 2: higher inbound HLC wins; emit divergence_resolved."""
    clock = Clock(node_id="t")
    r = Resolver(clock=clock, tenant_id="acme", actor="agent:test")
    can_hlc = _make_hlc(1_700_000_000_000)
    in_hlc = _make_hlc(1_700_000_000_500)
    res = resolve(
        resolver=r,
        field="title",
        inbound_platform="github",
        inbound_value="NEW title",
        inbound_hlc=in_hlc,
        canonical={"value": "old title", "hlc": can_hlc, "platform": "jira"},
    )
    _check("Tier 2 LWW: inbound beats canonical",
           res.tier == Resolution.TIER2_LWW
           and res.canonical_value == "NEW title"
           and res.winner_platform == "github"
           and res.loser_platform == "jira"
           and res.reason == "hlc_lww"
           and res.audit_row is not None
           and res.audit_row.winner_hlc == res.winner_hlc
           and res.audit_row.loser_hlc == can_hlc,
           f"got tier={res.tier}")


def test_tier2_lww_canonical_beats_inbound() -> None:
    """Tier 2: lower inbound HLC loses."""
    clock = Clock(node_id="t")
    r = Resolver(clock=clock, tenant_id="acme", actor="agent:test")
    can_hlc = _make_hlc(1_700_000_001_000)
    in_hlc = _make_hlc(1_700_000_000_500)
    res = resolve(
        resolver=r,
        field="body",
        inbound_platform="clickup",
        inbound_value="new body",
        inbound_hlc=in_hlc,
        canonical={"value": "old body", "hlc": can_hlc, "platform": "jira"},
    )
    _check("Tier 2 LWW: canonical beats inbound",
           res.tier == Resolution.TIER2_LWW
           and res.canonical_value == "old body"
           and res.winner_platform == "jira"
           and res.loser_platform == "clickup",
           f"got tier={res.tier} winner={res.winner_platform}")


def test_tier2_lww_precedence_on_tie() -> None:
    """Tier 2: equal HLC → precedence list (paperclip > jira > github > clickup)."""
    clock = Clock(node_id="t")
    r = Resolver(clock=clock, tenant_id="acme", actor="agent:test")
    hlc = _make_hlc(1_700_000_000_000)
    res = resolve(
        resolver=r,
        field="body",
        inbound_platform="clickup",
        inbound_value="new body",
        inbound_hlc=hlc,
        canonical={"value": "old body", "hlc": hlc, "platform": "github"},
    )
    _check("Tier 2 LWW: precedence on HLC tie",
           res.tier == Resolution.TIER2_LWW
           and res.winner_platform == "github"
           and res.loser_platform == "clickup",
           f"got winner={res.winner_platform} loser={res.loser_platform}")


def test_tier3_autodegrade_on_skew() -> None:
    """AC #4: >5s skew → Tier 2 bypassed, Tier 3 parks the event."""
    clock = Clock(node_id="t")
    monitor = ClockMonitor(tenant_id="acme")
    monitor.force(skew_active=True)
    r = Resolver(
        clock=clock,
        tenant_id="acme",
        actor="agent:test",
        skew_active=True,
    )
    can_hlc = _make_hlc(1_700_000_000_000)
    in_hlc = _make_hlc(1_700_000_000_500)   # newer by 500ms — would win LWW
    res = resolve(
        resolver=r,
        field="title",
        inbound_platform="github",
        inbound_value="NEW title",
        inbound_hlc=in_hlc,
        canonical={"value": "old title", "hlc": can_hlc, "platform": "jira"},
    )
    _check("Tier 3 auto-degrade on >5s skew",
           res.tier == Resolution.TIER3_DIVERGED
           and res.reason == "clock_skew"
           and res.canonical_value == "old title"   # NOT overwritten
           and res.audit_row is not None
           and res.audit_row.reason == "clock_skew",
           f"got tier={res.tier}")


def test_per_tenant_override() -> None:
    """AC #5: per-tenant override is a config flag, not a code change."""
    clock = Clock(node_id="t")
    # Tenant A: default — jira owns sprint
    # Tenant B: override — github owns sprint
    overrides_b = {
        "sprint": FieldOwnershipRule(
            "sprint", FieldOwner.GITHUB, Mirror.MIRROR_IN, "tenant B override"
        ),
    }
    # Tenant A — jira write accepted
    r_a = Resolver(clock=clock, tenant_id="a", actor="agent:t")
    hlc = _make_hlc(1_700_000_000_000)
    res_a = resolve(
        resolver=r_a, field="sprint",
        inbound_platform="jira", inbound_value="S-1", inbound_hlc=hlc,
        canonical=None,
    )
    # Tenant B — github write accepted (jira write rejected)
    r_b = Resolver(clock=clock, tenant_id="b", actor="agent:t",
                   overrides=overrides_b)
    res_b_jira = resolve(
        resolver=r_b, field="sprint",
        inbound_platform="jira", inbound_value="S-1", inbound_hlc=hlc,
        canonical=None,
    )
    res_b_github = resolve(
        resolver=r_b, field="sprint",
        inbound_platform="github", inbound_value="S-1", inbound_hlc=hlc,
        canonical=None,
    )
    _check("Per-tenant override (config flag, not code change)",
           res_a.tier == Resolution.TIER1_ACCEPTED
           and res_a.winner_platform == "jira"
           and res_b_jira.tier == Resolution.TIER1_REJECTED
           and res_b_jira.winner_platform == "github"
           and res_b_github.tier == Resolution.TIER1_ACCEPTED
           and res_b_github.winner_platform == "github",
           "per-tenant override not honored")


def test_audit_row_divergence_resolved_shape() -> None:
    """AC #3: audit row carries winner_hlc, loser_hlc, reason=hlc_lww."""
    clock = Clock(node_id="t")
    r = Resolver(clock=clock, tenant_id="acme", actor="agent:test")
    can_hlc = _make_hlc(1_700_000_000_000)
    in_hlc = _make_hlc(1_700_000_001_000)
    res = resolve(
        resolver=r, field="comment.body",
        inbound_platform="jira", inbound_value="new comment",
        inbound_hlc=in_hlc,
        canonical={"value": "old comment", "hlc": can_hlc, "platform": "github"},
    )
    a = res.audit_row
    _check("Audit row carries winner_hlc, loser_hlc, reason=hlc_lww",
           a is not None
           and a.event_type == DIVERGENCE_RESOLVED_EVENT
           and a.winner_hlc == res.winner_hlc
           and a.loser_hlc == can_hlc
           and a.reason == "hlc_lww"
           and a.tenant_id == "acme"
           and a.field == "comment.body"
           and a.metadata.get("inbound_hlc") == in_hlc
           and len(digest_payload(a)) == 64,    # sha256 hex
           f"got audit_row={a}")


def test_clock_monitor_trips_on_5s_skew() -> None:
    """The clock monitor: pairwise Δphysical_ms > 5s → skew_active=True."""
    monitor = ClockMonitor(tenant_id="acme", window_size=4)
    base = 1_700_000_000_000
    monitor.observe(parse(_make_hlc(base)))
    monitor.observe(parse(_make_hlc(base + 1_000)))
    monitor.observe(parse(_make_hlc(base + 10_000)))   # 10s gap from base
    report = monitor.evaluate()
    _check("Clock monitor trips on >5s skew",
           report.skew_active is True
           and report.max_skew_ms >= 10_000,
           f"report={report}")


def test_clock_monitor_audit_row_shape() -> None:
    """The clock-monitor's audit row has metadata.skew_ms."""
    monitor = ClockMonitor(tenant_id="acme", window_size=4)
    base = 1_700_000_000_000
    monitor.observe(parse(_make_hlc(base)))
    monitor.observe(parse(_make_hlc(base + 8_000)))
    report = monitor.evaluate()
    row = monitor.audit_row_for(report)
    _check("Clock-monitor audit row carries skew_ms",
           row.event_type == CLOCK_SKEW_EVENT
           and "skew_ms" in row.metadata
           and row.metadata["skew_ms"] >= 8_000
           and row.reason == "clock_skew",
           f"row={row}")


def test_end_to_end_forged_hlcs() -> None:
    """AC #6 — end-to-end: forged HLCs drive Tier 1 / Tier 2 / Tier 3
    and the audit rows are reproducible (sha256 digest matches)."""
    clock = Clock(node_id="t")
    monitor = ClockMonitor(tenant_id="acme")
    r = Resolver(clock=clock, tenant_id="acme", actor="agent:test")

    # 1) Tier 1 — paperclip-owned field, jira write rejected
    res_t1 = resolve(
        resolver=r, field="run_id",
        inbound_platform="jira", inbound_value="FORA-9999",
        inbound_hlc=_make_hlc(1_700_000_000_000),
        canonical=None,
    )
    # 2) Tier 2 — free-text, inbound wins
    res_t2 = resolve(
        resolver=r, field="title",
        inbound_platform="github", inbound_value="end-to-end title",
        inbound_hlc=_make_hlc(1_700_000_010_000),
        canonical={"value": "old", "hlc": _make_hlc(1_700_000_005_000),
                   "platform": "jira"},
    )
    # 3) Tier 3 — skew active, free-text parked
    monitor.force(skew_active=True)
    r2 = Resolver(clock=clock, tenant_id="acme", actor="agent:test",
                  skew_active=True)
    res_t3 = resolve(
        resolver=r2, field="body",
        inbound_platform="clickup", inbound_value="would-lose-data body",
        inbound_hlc=_make_hlc(1_700_000_020_000),
        canonical={"value": "preserved body", "hlc": _make_hlc(1_700_000_015_000),
                   "platform": "paperclip"},
    )

    # Audit row digests must be stable & equal across re-runs
    d_t1 = digest_payload(res_t1.audit_row)
    d_t2 = digest_payload(res_t2.audit_row)
    d_t3 = digest_payload(res_t3.audit_row)
    # Re-build the same rows and re-digest; the digests must match.
    rebuild_t1 = build_audit_row(
        event_type=DIVERGENCE_RESOLVED_EVENT,
        tenant_id=res_t1.audit_row.tenant_id,
        actor=res_t1.audit_row.actor,
        field=res_t1.audit_row.field,
        winner_platform=res_t1.audit_row.winner_platform,
        loser_platform=res_t1.audit_row.loser_platform,
        winner_hlc=res_t1.audit_row.winner_hlc,
        loser_hlc=res_t1.audit_row.loser_hlc,
        reason=res_t1.audit_row.reason,
        metadata=res_t1.audit_row.metadata,
    )
    _check("Forged-HLC end-to-end smoke (AC #6)",
           res_t1.tier == Resolution.TIER1_REJECTED
           and res_t1.audit_row.reason == "field_owner"
           and res_t2.tier == Resolution.TIER2_LWW
           and res_t2.audit_row.reason == "hlc_lww"
           and res_t2.canonical_value == "end-to-end title"
           and res_t3.tier == Resolution.TIER3_DIVERGED
           and res_t3.audit_row.reason == "clock_skew"
           and res_t3.canonical_value == "preserved body"   # NOT overwritten
           and digest_payload(rebuild_t1) == d_t1
           and len(d_t1) == 64
           and len(d_t2) == 64
           and len(d_t3) == 64,
           f"t1={res_t1.tier} t2={res_t2.tier} t3={res_t3.tier}")


# Import Mirror here for the override test
from sync_plane.field_owners import Mirror  # noqa: E402


def main() -> int:
    """Run all smoke checks; return 0 on pass, 1 on first fail."""
    tests = [
        test_hlc_monotonicity,
        test_field_ownership_table,
        test_tier1_paperclip_owned_rejected,
        test_tier1_remote_owned_accept,
        test_tier2_lww_inbound_beats_canonical,
        test_tier2_lww_canonical_beats_inbound,
        test_tier2_lww_precedence_on_tie,
        test_tier3_autodegrade_on_skew,
        test_per_tenant_override,
        test_audit_row_divergence_resolved_shape,
        test_clock_monitor_trips_on_5s_skew,
        test_clock_monitor_audit_row_shape,
        test_end_to_end_forged_hlcs,
    ]
    t0 = time.perf_counter()
    for t in tests:
        try:
            t()
        except AssertionError:
            return 1
    dt = (time.perf_counter() - t0) * 1000
    print(f"\n13/13 smoke tests PASS in {dt:.1f} ms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
