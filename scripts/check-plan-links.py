#!/usr/bin/env python3
"""Verify docs/plan/README.md checklist items link bidirectionally to phase docs.

Rules:
  1. Every numbered row in the 'Definition of 10/10' table in
     docs/plan/README.md must be listed under 'Checklist items owned' in the
     phase doc that owns it (column 3 of the master table).
  2. Every phase doc (phase-N.md, N in 1..8) must have a section
     'Checklist items owned' that lists the row numbers it owns.
  3. Reverse direction: every 'Checklist items owned' row number must
     appear in the master checklist.

Usage:
    ./scripts/check-plan-links.sh
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PLAN = REPO / "docs" / "plan"


def parse_master_rows() -> list[tuple[str, str, str]]:
    """Return [(row_num, property, owner_phase)] from the master checklist."""
    text = (PLAN / "README.md").read_text(encoding="utf-8")
    rows: list[tuple[str, str, str]] = []
    row_re = re.compile(r"^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*$", re.MULTILINE)
    for m in row_re.finditer(text):
        n, prop, owner = m.group(1), m.group(2).strip(), m.group(3).strip()
        if not owner.isdigit():
            continue
        rows.append((n, prop, owner))
    return rows


def phase_doc_owns(phase: int, row_num: str) -> bool:
    p = PLAN / f"phase-{phase}.md"
    if not p.exists():
        return False
    text = p.read_text(encoding="utf-8")
    m = re.search(
        r"^##\s*Checklist items owned\s*$([\s\S]*?)(?=^##\s|\Z)",
        text, re.MULTILINE | re.IGNORECASE,
    )
    if not m:
        return False
    section = m.group(1)
    return bool(re.search(rf"\b{re.escape(row_num)}\b", section))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    rows = parse_master_rows()
    if not rows:
        print("::error::no master checklist rows found in docs/plan/README.md", file=sys.stderr)
        return 1

    problems: list[str] = []
    for n, prop, owner in rows:
        if not phase_doc_owns(int(owner), n):
            problems.append(
                f"row #{n} ('{prop}') owned by phase {owner}, but phase-{owner}.md "
                f"does not list #{n} under 'Checklist items owned'."
            )

    all_owners = {int(o) for _, _, o in rows}
    all_row_nums = {n for n, _, _ in rows}
    for phase in all_owners:
        p = PLAN / f"phase-{phase}.md"
        text = p.read_text(encoding="utf-8")
        m = re.search(
            r"^##\s*Checklist items owned\s*$([\s\S]*?)(?=^##\s|\Z)",
            text, re.MULTILINE | re.IGNORECASE,
        )
        if not m:
            continue
        section = m.group(1)
        for ref in re.findall(r"\b(\d+)\b", section):
            if ref not in all_row_nums:
                problems.append(
                    f"phase-{phase}.md 'Checklist items owned' references #{ref} which is not in the master checklist."
                )

    if args.verbose:
        print(f"checked {len(rows)} master rows across {len(all_owners)} phase docs")
    if problems:
        print("\n".join(f"::error::{p}" for p in problems), file=sys.stderr)
        return 1
    print(f"✅ Master checklist is bidirectionally linked to phase docs.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
