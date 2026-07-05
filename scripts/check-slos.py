#!/usr/bin/env python3
"""Validate that every surface in docs/standards/slos.md has all required metrics.

Used in CI to fail PRs that drop an SLO row without an accompanying
update to `install_default_alerts()` in `slo_alerts.py`.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

SURFACES = {"chat", "kg", "ideation", "forge-models", "terminal", "copilot"}
REQUIRED_METRICS = {"latency_p95_ms", "error_rate", "availability"}


def main() -> int:
    slos_path = Path(__file__).resolve().parents[1] / "docs" / "standards" / "slos.md"
    if not slos_path.exists():
        print(f"MISSING: {slos_path} not found", file=sys.stderr)
        return 1
    text = slos_path.read_text(encoding="utf-8")
    # Match rows like: `| chat | latency_p95_ms | 1500 | 5 |`
    rows = re.findall(r"\|\s*([\w-]+)\s*\|\s*(latency_p95_ms|error_rate|availability)\s*\|", text)
    have = {(s, m) for s, m in rows if s in SURFACES}
    missing = [
        (s, m) for s in SURFACES for m in REQUIRED_METRICS if (s, m) not in have
    ]
    if missing:
        print(f"MISSING: {missing}", file=sys.stderr)
        return 1
    print(f"OK: {len(SURFACES)} surfaces x {len(REQUIRED_METRICS)} metrics")
    return 0


if __name__ == "__main__":
    sys.exit(main())
