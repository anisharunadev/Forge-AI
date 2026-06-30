#!/usr/bin/env python3
"""
Regenerate the Built Features table in .claude/CLAUDE.md from built-features.yaml.

Usage:
    ./scripts/generate-built-features.sh            # regenerate table
    ./scripts/generate-built-features.sh --check    # exit 1 if drift
    ./scripts/generate-built-features.sh --dry-run  # print to stdout

The script reads built-features.yaml at the repo root, builds a markdown
table sorted by `area` then `order`, and replaces the content between the
markers in .claude/CLAUDE.md:

    <!-- BEGIN:built-features:auto -->
    ...
    <!-- END:built-features:auto -->

The table heading "Built Features (as of <date>)" is also regenerated.

Requires PyYAML. Install with: pip install pyyaml
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST = REPO_ROOT / "built-features.yaml"
CLAUDE_MD = REPO_ROOT / ".claude" / "CLAUDE.md"

BEGIN_MARKER = "<!-- BEGIN:built-features:auto -->"
END_MARKER = "<!-- END:built-features:auto -->"

# Display order for areas. Anything not listed here falls back to alphabetical
# after the listed ones.
AREA_ORDER = ["Workspace", "Centers", "Lifecycle", "Infra", "Integration"]


def build_table(features: list[dict], today: str) -> str:
    """Build the markdown table including heading and markers."""
    area_rank = {a: i for i, a in enumerate(AREA_ORDER)}

    def sort_key(f: dict) -> tuple:
        area = f.get("area", "")
        return (area_rank.get(area, len(AREA_ORDER)), f.get("order", 0))

    features = sorted(features, key=sort_key)

    lines = [f"## Built Features (as of {today})", ""]
    lines.append("| Area | Feature | Steps | Status |")
    lines.append("|---|---|---|---|")
    for f in features:
        area = _esc(f.get("area", ""))
        feature = _esc(f.get("feature", ""))
        steps_raw = f.get("steps", []) or []
        steps = ", ".join(str(s) for s in steps_raw) if steps_raw else "—"
        status = _esc(f.get("status", ""))
        # Highlight integration rows so active wiring is easy to spot
        if area == "Integration":
            lines.append(f"| {area} | **{feature}** | {steps} | **{status}** |")
        else:
            lines.append(f"| {area} | {feature} | {steps} | {status} |")
    return "\n".join(lines) + "\n"


def _esc(s: str) -> str:
    """Escape pipe characters so they don't break the table."""
    return str(s).replace("|", "\\|")


def render_block(features: list[dict], today: str) -> str:
    """Render the full BEGIN/END block."""
    table = build_table(features, today)
    return (
        f"{BEGIN_MARKER}\n"
        f"<!-- Auto-generated from built-features.yaml — do not edit by hand. -->\n"
        f"<!-- Regenerate: ./scripts/generate-built-features.sh -->\n\n"
        f"{table}\n"
        f"{END_MARKER}\n"
    )


def update_claude_md(block: str, dry_run: bool = False) -> bool:
    """Replace the BEGIN/END block in .claude/CLAUDE.md. Returns True if changed."""
    text = CLAUDE_MD.read_text()
    pattern = re.compile(
        re.escape(BEGIN_MARKER) + r".*?" + re.escape(END_MARKER) + r"\n?",
        re.DOTALL,
    )
    if not pattern.search(text):
        sys.stderr.write(
            f"error: markers not found in {CLAUDE_MD}\n"
            f"  expected both {BEGIN_MARKER} and {END_MARKER}\n"
        )
        sys.exit(2)
    new_text = pattern.sub(block, text)
    if dry_run:
        sys.stdout.write(new_text)
        return new_text != text
    if new_text == text:
        return False
    CLAUDE_MD.write_text(new_text)
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if the table would change (CI drift check)")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the new CLAUDE.md to stdout, do not write")
    args = ap.parse_args()

    if not MANIFEST.exists():
        sys.stderr.write(f"error: manifest not found: {MANIFEST}\n")
        return 2

    try:
        data = yaml.safe_load(MANIFEST.read_text())
    except yaml.YAMLError as e:
        sys.stderr.write(f"error: invalid YAML in {MANIFEST}: {e}\n")
        return 2

    if not isinstance(data, dict):
        sys.stderr.write("error: top-level YAML must be a mapping\n")
        return 2
    features = data.get("features", [])
    if not isinstance(features, list):
        sys.stderr.write("error: 'features' must be a list\n")
        return 2
    for i, f in enumerate(features):
        if not isinstance(f, dict):
            sys.stderr.write(f"error: feature #{i} must be a mapping\n")
            return 2
        for k in ("area", "feature", "status"):
            if k not in f:
                sys.stderr.write(f"error: feature #{i} missing required key '{k}'\n")
                return 2
        if not isinstance(f.get("steps", []), list):
            sys.stderr.write(f"error: feature #{i} 'steps' must be a list\n")
            return 2

    today = dt.date.today().isoformat()
    block = render_block(features, today)

    if args.check:
        original = CLAUDE_MD.read_text()
        pattern = re.compile(
            re.escape(BEGIN_MARKER) + r".*?" + re.escape(END_MARKER) + r"\n?",
            re.DOTALL,
        )
        new_text = pattern.sub(block, original)
        if new_text == original:
            sys.stdout.write("ok: Built Features table is up to date\n")
            return 0
        sys.stderr.write(
            "drift: Built Features table in .claude/CLAUDE.md is stale.\n"
            "  run: ./scripts/generate-built-features.sh\n"
        )
        return 1

    if args.dry_run:
        sys.stdout.write(block)
        return 0

    changed = update_claude_md(block)
    if changed:
        sys.stdout.write(f"updated: {CLAUDE_MD}\n")
    else:
        sys.stdout.write("ok: no changes\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())