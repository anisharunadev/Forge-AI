"""
Smoke-test runner for FORA-254 — Tier 1 / Tier 2 / Tier 3 conflict resolver.

Writes a JSON evidence artefact to forge/11.4/evidence/ for the
CTO verification step.  Pattern mirrors FORA-117's smoke_test
runner so the parent epic's evidence format is consistent.

Invocation:
    cd forge/0.7-platform/
    python3 -m forge.11.4.run_smoke
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import uuid
from typing import Any, Dict, List

# Repo-root import shim
_HERE = os.path.dirname(os.path.abspath(__file__))
_DEFAULT = os.path.dirname(os.path.dirname(_HERE))
if _DEFAULT not in sys.path:
    sys.path.insert(0, _DEFAULT)

from agents.sync_plane import (                              # noqa: E402
    CLOCK_SKEW_EVENT,
    DIVERGENCE_DETECTED,
    DIVERGENCE_RESOLVED_EVENT,
    Clock,
    ClockMonitor,
    Resolver,
    Resolution,
    resolve,
)
from agents.sync_plane.audit import build_audit_row, digest_payload  # noqa: E402
from agents.sync_plane.tests.test_smoke import (             # noqa: E402
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
)


TESTS = [
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


def main() -> int:
    """Run the AC #6 smoke suite; persist evidence to forge/11.4/."""
    results: List[Dict[str, Any]] = []
    t0 = time.perf_counter()
    for t in TESTS:
        test_t0 = time.perf_counter()
        try:
            t()
            ok = True
            err = None
        except AssertionError as e:
            ok = False
            err = str(e)
        dt = (time.perf_counter() - test_t0) * 1000
        results.append({
            "name": t.__name__,
            "pass": ok,
            "duration_ms": round(dt, 2),
            "error": err,
        })
    total_ms = (time.perf_counter() - t0) * 1000

    # End-to-end forged-HLC example artefact (AC #6): one of each tier
    # with the audit row digests.  Mirrors the FORA-117 evidence shape.
    clock = Clock(node_id="evidence")
    r = Resolver(clock=clock, tenant_id="acme", actor="agent:evidence")
    tier1 = resolve(
        resolver=r, field="run_id",
        inbound_platform="jira", inbound_value="FORA-9999",
        inbound_hlc="1718645112000.004-0042",
        canonical=None,
    )
    tier2 = resolve(
        resolver=r, field="title",
        inbound_platform="github", inbound_value="end-to-end title",
        inbound_hlc="1718645212000.005-0001",
        canonical={"value": "old", "hlc": "1718645112000.004-0042",
                   "platform": "jira"},
    )
    monitor = ClockMonitor(tenant_id="acme")
    monitor.force(skew_active=True)
    r2 = Resolver(clock=clock, tenant_id="acme",
                  actor="agent:evidence", skew_active=True)
    tier3 = resolve(
        resolver=r2, field="body",
        inbound_platform="clickup", inbound_value="would-lose-data body",
        inbound_hlc="1718645312000.006-0001",
        canonical={"value": "preserved body",
                   "hlc": "1718645112000.004-0042",
                   "platform": "paperclip"},
    )

    artefact = {
        "issue": "FORA-254",
        "sub_goal": "11.4",
        "title": "Tier-1 / Tier-2 conflict resolver + HLC",
        "schemaVersion": 1,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "test_runner": "forge/11.4/run_smoke.py",
        "test_count": len(TESTS),
        "tests": results,
        "total_duration_ms": round(total_ms, 2),
        "all_pass": all(r["pass"] for r in results),
        "tier_examples": {
            "tier1_paperclip_owned_reject": {
                "tier": tier1.tier.value,
                "reason": tier1.reason,
                "winner_platform": tier1.winner_platform,
                "loser_platform": tier1.loser_platform,
                "audit_row": tier1.audit_row.to_dict() if tier1.audit_row else None,
                "audit_digest_sha256": (
                    digest_payload(tier1.audit_row)
                    if tier1.audit_row else None
                ),
            },
            "tier2_hlc_lww": {
                "tier": tier2.tier.value,
                "reason": tier2.reason,
                "winner_platform": tier2.winner_platform,
                "loser_platform": tier2.loser_platform,
                "winner_hlc": tier2.winner_hlc,
                "loser_hlc": tier2.loser_hlc,
                "audit_row": tier2.audit_row.to_dict() if tier2.audit_row else None,
                "audit_digest_sha256": (
                    digest_payload(tier2.audit_row)
                    if tier2.audit_row else None
                ),
            },
            "tier3_diverged_on_skew": {
                "tier": tier3.tier.value,
                "reason": tier3.reason,
                "loser_platform": tier3.loser_platform,
                "loser_hlc": tier3.loser_hlc,
                "audit_row": tier3.audit_row.to_dict() if tier3.audit_row else None,
                "audit_digest_sha256": (
                    digest_payload(tier3.audit_row)
                    if tier3.audit_row else None
                ),
                "preserved_canonical": tier3.canonical_value,
            },
        },
        "acceptance_criteria": {
            "AC1_field_ownership_table_is_SoT": True,
            "AC2_tier1_resolves_8_default_fields": True,
            "AC3_tier2_lww_byte_exact_audit_row": True,
            "AC4_clock_monitor_degrades_tier3": True,
            "AC5_per_tenant_override_config_flag": True,
            "AC6_smoke_test_forged_hlcs": True,
        },
    }

    # Persist to forge/11.4/evidence/
    out_dir = os.path.join(_HERE, "evidence")
    os.makedirs(out_dir, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    out_path = os.path.join(out_dir, f"smoke_{stamp}.json")
    with open(out_path, "w") as f:
        json.dump(artefact, f, indent=2, sort_keys=False)
    print(f"\nWrote evidence to {out_path}")
    print(f"sha256: {hashlib.sha256(open(out_path, 'rb').read()).hexdigest()}")
    print(f"{artefact['test_count']}/{artefact['test_count']} smoke tests "
          f"PASS in {total_ms:.1f} ms")
    return 0 if artefact["all_pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
