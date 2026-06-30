#!/usr/bin/env python3
"""
Check that every Built Feature in `built-features.yaml` has a docs page
under `docs-site/src/content/docs/`.

Exit codes:
    0  every required feature has a docs page (or is explicitly self-ref)
    1  one or more required features are missing docs
    2  setup error (manifest not found, YAML invalid, …)

Behaviour:
    - status == Production | Beta | Wired <date>  → docs REQUIRED
    - status == Planned                            → docs optional (warn only)
    - docs == null                                 → self-referential, skipped
                                                   (e.g. the Documentation
                                                   site row in Infra)
    - docs == "<path>" and the .md exists          → pass

Usage:
    ./scripts/check-feature-docs.sh            # CI mode (exit 1 on missing)
    ./scripts/check-feature-docs.sh --verbose  # print every check
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST = REPO_ROOT / "built-features.yaml"
DOCS_ROOT = REPO_ROOT / "docs-site" / "src" / "content" / "docs"

REQUIRED_STATUSES = {"Production", "Beta", "Alpha"}
WIRED_PATTERN = re.compile(r"^Wired \d{4}-\d{2}-\d{2}$")


def is_required(status: str) -> bool:
    if status in REQUIRED_STATUSES:
        return True
    if WIRED_PATTERN.match(status):
        return True
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--verbose", action="store_true",
                    help="print every check, including passing ones")
    args = ap.parse_args()

    if not MANIFEST.exists():
        sys.stderr.write(f"error: manifest not found: {MANIFEST}\n")
        return 2
    if not DOCS_ROOT.is_dir():
        sys.stderr.write(f"error: docs root not found: {DOCS_ROOT}\n")
        return 2

    try:
        data = yaml.safe_load(MANIFEST.read_text())
    except yaml.YAMLError as e:
        sys.stderr.write(f"error: invalid YAML in {MANIFEST}: {e}\n")
        return 2

    features = data.get("features", [])
    if not isinstance(features, list):
        sys.stderr.write("error: 'features' must be a list\n")
        return 2

    missing_required: list[tuple[dict, str]] = []  # (feature, reason)
    missing_optional: list[tuple[dict, str]] = []
    passed = 0

    for f in features:
        feature = f.get("feature", "<unnamed>")
        status = f.get("status", "")
        docs = f.get("docs")
        area = f.get("area", "")

        if docs is None:
            # Explicit self-reference — skip
            if args.verbose:
                sys.stdout.write(f"  skip  {area}/{feature}  (docs=null, self-ref)\n")
            passed += 1
            continue

        if not docs:
            reason = "missing 'docs' field"
        else:
            doc_path = DOCS_ROOT / f"{docs}.md"
            if doc_path.is_file():
                if args.verbose:
                    sys.stdout.write(f"  ok    {area}/{feature}  → {docs}.md\n")
                passed += 1
                continue
            reason = f"docs-site page not found: {doc_path.relative_to(REPO_ROOT)}"

        if is_required(status):
            missing_required.append((f, reason))
            sys.stderr.write(f"  FAIL  {area}/{feature}  ({status}) — {reason}\n")
        else:
            missing_optional.append((f, reason))
            sys.stdout.write(f"  warn  {area}/{feature}  ({status}) — {reason}\n")

    sys.stdout.write(
        f"\n{passed} passed, {len(missing_required)} missing (required), "
        f"{len(missing_optional)} missing (optional)\n"
    )

    if missing_required:
        sys.stderr.write(
            "\nDocs coverage FAILED. To fix:\n"
            "  1. Create the docs page at the path shown above.\n"
            "  2. Or update built-features.yaml — set `docs:` to the correct\n"
            "     path under docs-site/src/content/docs/, or `docs: null`\n"
            "     if the feature is self-referential.\n"
            "  3. Re-run: ./scripts/check-feature-docs.sh\n"
        )
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())