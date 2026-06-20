"""
Alert log tests (FORA-75, 0.6).

Verifies the alert log is append-only, idempotent on `alert_key`,
and that the `is_paused` walk handles a pause -> resume -> pause
sequence correctly.
"""

from __future__ import annotations

import os
import sys

from .common import run

from agents.cost import AlertKind, AlertLog


def _scenario_first_insert_succeeds() -> tuple[dict, list[str]]:
    log = AlertLog()
    rec = AlertLog.make_soft("t1", "2026-06", spend_cents=100,
                             ceiling_cents=200, soft_cents=80)
    inserted = log.append(rec)
    failures: list[str] = []
    if inserted is None:
        failures.append("first insert returned None")
    if len(log.for_tenant("t1")) != 1:
        failures.append(f"expected 1 alert, got {len(log.for_tenant('t1'))}")
    return {"inserted": inserted is not None, "count": len(log.for_tenant("t1"))}, failures


def _scenario_duplicate_key_is_rejected() -> tuple[dict, list[str]]:
    log = AlertLog()
    rec = AlertLog.make_soft("t1", "2026-06", spend_cents=100,
                             ceiling_cents=200, soft_cents=80)
    log.append(rec)
    second = log.append(rec)  # same key
    failures: list[str] = []
    if second is not None:
        failures.append("duplicate insert returned non-None")
    if len(log.for_tenant("t1")) != 1:
        failures.append(f"duplicate insert created a row: count={len(log.for_tenant('t1'))}")
    return {"secondInsert": second is not None, "count": len(log.for_tenant("t1"))}, failures


def _scenario_pause_resume_walk() -> tuple[dict, list[str]]:
    log = AlertLog()
    log.append(AlertLog.make_paused("t1", "2026-06", 100, 200, 80))
    log.append(AlertLog.make_resumed("t1", reason="admin"))
    log.append(AlertLog.make_paused("t1", "2026-07", 150, 200, 80))
    log.append(AlertLog.make_resumed("t1", reason="auto"))
    log.append(AlertLog.make_paused("t1", "2026-08", 200, 200, 80))
    failures: list[str] = []
    if not log.is_paused("t1"):
        failures.append("expected pause active at end of walk")
    # Drop the most recent pause
    log.append(AlertLog.make_resumed("t1", reason="admin"))
    if log.is_paused("t1"):
        failures.append("expected pause cleared after final resume")
    return {"paused": log.is_paused("t1")}, failures


def _scenario_latest_for() -> tuple[dict, list[str]]:
    log = AlertLog()
    log.append(AlertLog.make_soft("t1", "2026-06", 100, 200, 80))
    log.append(AlertLog.make_soft("t1", "2026-07", 110, 200, 80))
    log.append(AlertLog.make_hard("t1", "2026-07", 200, 200, 80))
    latest_soft = log.latest_for("t1", AlertKind.SOFT_THRESHOLD)
    latest_hard = log.latest_for("t1", AlertKind.HARD_THRESHOLD)
    failures: list[str] = []
    if latest_soft is None or latest_soft.month_key != "2026-07":
        failures.append(f"latest soft: {latest_soft.month_key if latest_soft else None}")
    if latest_hard is None or latest_hard.month_key != "2026-07":
        failures.append(f"latest hard: {latest_hard.month_key if latest_hard else None}")
    return {
        "latestSoft": latest_soft.month_key if latest_soft else None,
        "latestHard": latest_hard.month_key if latest_hard else None,
    }, failures


def main() -> int:
    return run([
        ("first_insert_succeeds", _scenario_first_insert_succeeds),
        ("duplicate_key_is_rejected", _scenario_duplicate_key_is_rejected),
        ("pause_resume_walk", _scenario_pause_resume_walk),
        ("latest_for", _scenario_latest_for),
    ], test_name="test_alerts")


if __name__ == "__main__":
    sys.exit(main())
