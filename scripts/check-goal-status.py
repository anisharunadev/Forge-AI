#!/usr/bin/env python3
"""Verify every docs/goals/step-*.md has a top-of-file Status header.

The header must appear in the first 10 lines and match one of:
  > **Status:** <state>
  **Status:** <state>

where <state> resolves (via a small synonym table) to one of:
  implemented | in-progress | cancelled

For 'implemented' goals, a 'Last verified:' date in the first 30 lines is
also required.

Usage:
    ./scripts/check-goal-status.sh            # CI mode
    ./scripts/check-goal-status.sh --list     # show every goal + resolved status

Exit codes:
    0  every goal has a valid Status header
    1  one or more goals are missing / wrong
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GOALS = REPO / "docs" / "goals"

STATES = {"implemented", "in-progress", "cancelled"}
SYNONYMS = {
    "ready to run": "in-progress",
    "ready to go": "in-progress",
    "in progress": "in-progress",
    "in-progress": "in-progress",
    "wip": "in-progress",
    "draft": "in-progress",
    "tested": "in-progress",
    "beta": "in-progress",
    "production": "implemented",
    "shipped": "implemented",
    "shipped.": "implemented",
    "complete": "implemented",
    "done": "implemented",
    "✅ complete": "implemented",
    "✅ complete — 10/10 zones implemented and verified.": "implemented",
    "implemented": "implemented",
    "goal met": "implemented",
    "outdated": "cancelled",
    "out of scope": "cancelled",
    "cancelled": "cancelled",
    "canceled": "cancelled",
}


STATUS_RE = re.compile(
    r"""^(?:>\s*)?\*\*Status:\*\*\s+(?P<raw>.+?)\s*$""",
    re.IGNORECASE | re.MULTILINE,
)
LAST_VERIFIED_RE = re.compile(
    r"""^(?:>\s*)?\*\*Last verified:\*\*\s+(?P<date>\d{4}-\d{2}-\d{2})\s*$""",
    re.IGNORECASE | re.MULTILINE,
)


def resolve(raw: str) -> str | None:
    raw = raw.strip().rstrip(".").lower()
    # Strip leading emoji + whitespace for matching.
    raw = re.sub(r"^[^\w]+", "", raw).strip()
    if raw in STATES:
        return raw
    if raw in SYNONYMS:
        return SYNONYMS[raw]
    # Trailing-period-tolerant comparison.
    for k, v in SYNONYMS.items():
        if raw == k.rstrip("."):
            return v
    return None


def check_one(path: Path) -> tuple[str, list[str]]:
    text = path.read_text(encoding="utf-8")
    head = "\n".join(text.splitlines()[:10])
    m = STATUS_RE.search(head)
    if not m:
        return ("?", [f"missing top-of-file **Status:** header in {path}"])
    state = resolve(m.group("raw"))
    if state is None:
        return ("?", [f"unknown Status value '{m.group('raw').strip()}' in {path}"])
    problems: list[str] = []
    if state == "implemented":
        if not LAST_VERIFIED_RE.search("\n".join(text.splitlines()[:30])):
            problems.append(
                f"{path} is 'implemented' but lacks '**Last verified:** YYYY-MM-DD' in first 30 lines"
            )
    return (state, problems)


def primary_goals() -> list[Path]:
    """Return step-N.md primaries, excluding -deliverable / -verification /
    -rationale / -vN variants."""
    step_files = sorted(GOALS.glob("step-*.md"))
    primaries = [
        p for p in step_files
        if not re.search(r"-(deliverable|verification|rationale|v\d)\.md$", p.name, re.IGNORECASE)
    ]
    return primaries


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    primaries = primary_goals()
    bad: list[str] = []
    counts = {"implemented": 0, "in-progress": 0, "cancelled": 0, "?": 0}
    for p in primaries:
        state, problems = check_one(p)
        counts[state if state in counts else "?"] = counts.get(state if state in counts else "?", 0) + 1
        if args.list:
            print(f"{state}\t{p.relative_to(REPO)}")
        bad.extend(problems)
    if bad:
        print("\n".join(f"::error::{p}" for p in bad), file=sys.stderr)
        return 1
    if not args.list:
        print(
            f"✅ All {len(primaries)} primary goal docs have a valid Status header. "
            f"(implemented={counts['implemented']}, in-progress={counts['in-progress']}, "
            f"cancelled={counts['cancelled']})"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
