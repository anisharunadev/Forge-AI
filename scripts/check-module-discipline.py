#!/usr/bin/env python3
"""scripts/check-module-discipline.py — M15-6 module-discipline gate.

For Rec #6 ("finish one before starting another"). The gate reads the
files added/modified in the working tree (or in a git ref range when
``--base`` is given) and asks: for each touched page under
``apps/forge/app/<route>/``, what center does it belong to, and is
that center at DoD ≥ 80%?

If any touched center is below 80% the gate exits 1 with a per-center
verdict that links to ``docs/product/center-status.md`` for the
human review. If all touched centers are ≥ 80% (or are not yet
scored, in which case treat them as not-blocking) the gate passes.

The "not yet scored" escape hatch is deliberate: it lets a brand-new
center or a one-off page land without false-flagging. Centers that
*have* a score must clear it.

Usage:

    ./scripts/check-module-discipline.py                       # working tree vs HEAD
    ./scripts/check-module-discipline.py --base origin/main    # PR-like diff
    ./scripts/check-module-discipline.py --verbose             # print every page
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST = REPO_ROOT / "docs" / "product" / "center-status.yaml"
THRESHOLD_PCT = 80.0  # Center must score ≥ 80% to accept new work on it.

# Match a route from an app-path. Examples:
#   apps/forge/app/ideation/page.tsx → /ideation
#   apps/forge/app/architecture/page.tsx → /architecture
#   apps/forge/app/api/healthz/route.ts → /api/healthz (still picked up)
_ROUTE_RE = re.compile(r"^apps/forge/app/(?P<route>[^/]+)(?P<rest>/.*)?$")


@dataclass
class PageRef:
    file: str
    route: str


def _route_for(apps_path: str) -> str | None:
    m = _ROUTE_RE.match(apps_path)
    if not m:
        return None
    return "/" + m.group("route").lstrip("/")


def _diff_files(base: str | None) -> list[str]:
    """Return the list of files touched between ``base`` and HEAD.

    With no base: ``git status --porcelain`` then extract the path
    for each M/A/C/R/D line. With a base: ``git diff --name-only
    base...HEAD``.
    """
    if base is None:
        out = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True,
            text=True,
            check=True,
            cwd=REPO_ROOT,
        )
        paths: list[str] = []
        for line in out.stdout.splitlines():
            if not line.strip():
                continue
            # Format: "XY <path>" with rename suffix in angle brackets.
            payload = line[3:].strip()
            if " -> " in payload:
                payload = payload.split(" -> ", 1)[1]
            paths.append(payload)
        return paths
    out = subprocess.run(
        ["git", "diff", "--name-only", f"{base}...HEAD"],
        capture_output=True,
        text=True,
        check=True,
        cwd=REPO_ROOT,
    )
    return [p for p in out.stdout.splitlines() if p]


def _center_score_map() -> dict[str, float]:
    """Return per-center highest doD_score from manifest, computed
    on demand by averaging per-route verdicts declared in the YAML.

    Empty verdicts score 0 per route. Manual flags (``unchecked``)
    are NOT counted as passing — only ``pass``/``checked`` do.
    """
    if not MANIFEST.exists():
        return {}
    data = yaml.safe_load(MANIFEST.read_text())
    out: dict[str, float] = {}
    for center in data.get("centers", []):
        name = center.get("center")
        if not name:
            continue
        route_scores: list[float] = []
        for entry in center.get("top_routes", []):
            verdicts = entry.get("verdicts") or {}
            if not verdicts:
                continue
            n_pass = sum(1 for v in verdicts.values() if v in ("pass", "checked"))
            if not verdicts:
                continue
            score_pct = n_pass / len(verdicts) * 100
            route_scores.append(score_pct)
        if route_scores:
            out[name] = max(route_scores)  # worst-case route gates the center
        else:
            out[name] = 0.0
    return out


def _route_to_center(manifest_data: dict) -> dict[str, str]:
    """Inverse-map a route path to its declared center name."""
    out: dict[str, str] = {}
    for center in manifest_data.get("centers", []):
        name = center.get("center")
        if not name:
            continue
        for entry in center.get("top_routes", []):
            route = entry.get("route")
            if route:
                out["/" + route.lstrip("/")] = name
    return out


def evaluate(files: list[str], verbose: bool = False) -> tuple[int, list[str]]:
    if not MANIFEST.exists():
        sys.stderr.write(f"error: manifest not found: {MANIFEST}\n")
        return 2, []
    data = yaml.safe_load(MANIFEST.read_text())
    center_scores = _center_score_map()
    route_to_center = _route_to_center(data)

    touched: dict[str, list[PageRef]] = {}
    for f in files:
        route = _route_for(f)
        if route is None:
            continue
        # Best-effort center match. Unknown centers get a "?" sentinel
        # so we surface them — they're not auto-blocked.
        center = route_to_center.get(route, "?")
        touched.setdefault(center, []).append(PageRef(file=f, route=route))

    if not touched:
        print("Module-discipline gate — no app routes touched; pass.")
        return 0, []

    lines = [f"Module-discipline gate — {sum(len(v) for v in touched.values())} file(s) across {len(touched)} center(s):"]
    blocked: list[str] = []
    for center, refs in sorted(touched.items()):
        score = center_scores.get(center)
        if score is None:
            verdict = "PASS (unscored center — first-touch safe)"
            mark = "✓"
        elif score >= THRESHOLD_PCT:
            verdict = f"PASS ({score:.0f}% ≥ {THRESHOLD_PCT:.0f}%)"
            mark = "✓"
        else:
            verdict = f"BLOCK ({score:.0f}% < {THRESHOLD_PCT:.0f}%)"
            mark = "✗"
            blocked.append(f"{center} ({score:.0f}%)")
        lines.append(f"  {mark} {center:<16} {verdict}")
        if verbose:
            for ref in refs:
                lines.append(f"     {ref.file}")

    lines.append("")
    lines.append(
        f"=> {len(touched) - len(blocked)} passing, {len(blocked)} blocked centers."
    )
    if blocked:
        lines.append(
            f"   Blocked centers below the {THRESHOLD_PCT:.0f}% DoD threshold: "
            + ", ".join(blocked)
            + "."
        )
        lines.append(
            "   See docs/product/center-status.md for the per-route score "
            "and the manual gates that have not yet been signed off."
        )

    print("\n".join(lines))
    return (1 if blocked else 0), blocked


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default=None,
                    help="git ref to diff against (e.g. origin/main)")
    ap.add_argument("--verbose", action="store_true", help="print every touched file")
    args = ap.parse_args()
    try:
        files = _diff_files(args.base)
    except subprocess.CalledProcessError as exc:
        sys.stderr.write(f"error: git failed: {exc.stderr or exc.stdout}\n")
        return 2
    code, _ = evaluate(files, verbose=args.verbose)
    return code


if __name__ == "__main__":
    sys.exit(main())
