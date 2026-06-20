"""
Input collectors for the QA Agent.

The QA agent consumes three slices of evidence (per
`workspace/memory/qa.md` §1):

    pr_diff       — what the Dev stage just merged
    tech_stack    — `workspace/project/tech-stack.md` (framework choices)
    conventions   — `workspace/customer/conventions.md` (naming, layout, severity)

Each collector returns a normalised `InputSignal` with `mode="sample"`
in v1. The `mode` is honest provenance: v1 never calls a real MCP for
these sources — it reads checked-in files. When a real source ships
(the GitHub MCP for `pr_diff`), the collector flips `mode` to `live`
without changing the rest of the shape.
"""

from __future__ import annotations

import datetime as dt
import os
from typing import Any, Dict, List, Optional

from .schemas import InputSignal


# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
# Project root: agents/qa -> agents -> root
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))


def _read_text(path: str) -> str:
    """Read a UTF-8 text file, returning an empty string if missing."""
    try:
        with open(path, "r", encoding="utf-8") as fp:
            return fp.read()
    except FileNotFoundError:
        return ""


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Collectors
# ---------------------------------------------------------------------------

def collect_pr_diff(pr_diff_path: Optional[str] = None) -> InputSignal:
    """Collect the PR diff the Dev stage just merged.

    v1 reads a checked-in fixture file (a `.diff` next to the agent or
    in `workspace/fixtures/prs/`). When the GitHub MCP wiring lands
    (FORA-49), this collector swaps to a real `get_pull_request` call
    and flips `mode` to `"live"`.

    The signal's `items` is a list of file-level diff entries so
    downstream generators can reason per-file.
    """
    path = pr_diff_path or os.path.join(ROOT, "agents", "qa", "fixtures",
                                        "fixture_pr.diff")
    raw = _read_text(path)
    items: List[Dict[str, Any]] = _parse_unified_diff(raw)
    return InputSignal(
        source="pr_diff",
        fetched_at=_now(),
        mode="sample",
        items=items,
        summary=f"{len(items)} files in diff ({path})",
    )


def collect_tech_stack(tech_stack_path: Optional[str] = None) -> InputSignal:
    """Collect the project's tech stack declaration.

    Reads `workspace/project/tech-stack.md` and harvests a few
    well-known keys (language, test framework per tier). v1 is
    forgiving: missing keys yield empty strings, never an exception.
    """
    path = tech_stack_path or os.path.join(ROOT, "workspace", "project",
                                           "tech-stack.md")
    raw = _read_text(path)
    items = _parse_tech_stack(raw)
    return InputSignal(
        source="tech_stack",
        fetched_at=_now(),
        mode="sample",
        items=items,
        summary=f"tech-stack: language={items.get('language', '?')!r}, "
                f"unit={items.get('unit_framework', '?')!r}",
    )


def collect_conventions(conventions_path: Optional[str] = None) -> InputSignal:
    """Collect the customer conventions the QA agent must respect.

    Reads `workspace/customer/conventions.md` and surfaces the
    convention hierarchy, severity matrix, and PR-bar rules as
    items so generators can quote them in the emitted tests.
    """
    path = conventions_path or os.path.join(ROOT, "workspace", "customer",
                                            "conventions.md")
    raw = _read_text(path)
    items = _parse_conventions(raw)
    return InputSignal(
        source="conventions",
        fetched_at=_now(),
        mode="sample",
        items=items,
        summary=f"conventions: {len(items)} sections parsed",
    )


# ---------------------------------------------------------------------------
# Parsing helpers — kept local so the v1 fixture parser can evolve
# without touching the public collector signatures.
# ---------------------------------------------------------------------------

def _parse_unified_diff(raw: str) -> List[Dict[str, Any]]:
    """Parse a unified diff into one entry per file.

    The output is small on purpose: filename, status, and the hunks
    the generator needs to mint a skeleton test. We do not aim to
    reconstruct the full pre/post tree; that is the Dev agent's job.
    """
    if not raw.strip():
        return []
    files: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None
    for line in raw.splitlines():
        if line.startswith("diff --git "):
            if current is not None:
                files.append(current)
            # diff --git a/<path> b/<path>
            parts = line.split()
            path = parts[-1][2:] if len(parts) >= 4 and parts[-1].startswith("b/") \
                else (parts[-1] if parts else "")
            current = {"path": path, "status": "modified",
                       "hunks": [], "lines_added": 0, "lines_removed": 0}
        elif current is not None:
            if line.startswith("new file"):
                current["status"] = "added"
            elif line.startswith("deleted file"):
                current["status"] = "deleted"
            elif line.startswith("@@"):
                current["hunks"].append(line)
            elif line.startswith("+") and not line.startswith("+++"):
                current["lines_added"] += 1
            elif line.startswith("-") and not line.startswith("---"):
                current["lines_removed"] += 1
    if current is not None:
        files.append(current)
    return files


def _parse_tech_stack(raw: str) -> Dict[str, Any]:
    """Extract a few well-known keys from the tech-stack markdown.

    The file is human-edited; the parser is intentionally permissive
    (case-insensitive, first-match-wins). If `tech-stack.md` is
    missing or empty, every value is an empty string — never an
    exception. Generators treat empty as "ask, do not default" (per
    `workspace/memory/qa.md` §2).
    """
    out: Dict[str, Any] = {
        "language": "",
        "unit_framework": "",
        "integration_framework": "",
        "e2e_framework": "",
        "contract_framework": "",
        "package_manager": "",
        "raw_excerpt": raw[:1024],
    }
    if not raw:
        return out
    lower = raw.lower()
    # Language detection — first match wins.
    for lang in ("python", "typescript", "javascript", "go", "java", "kotlin", "ruby"):
        if lang in lower:
            out["language"] = lang
            break
    # Framework detection per tier — the v1 fixture uses bullet lists.
    rules = [
        ("unit_framework",        ("pytest", "jest", "phpunit", "junit")),
        ("integration_framework", ("pytest", "jest", "testcontainers")),
        ("e2e_framework",         ("playwright", "cypress", "puppeteer")),
        ("contract_framework",    ("pact", "dredd", "schemathesis")),
    ]
    for key, candidates in rules:
        for cand in candidates:
            if cand in lower:
                out[key] = cand
                break
    return out


def _parse_conventions(raw: str) -> List[Dict[str, Any]]:
    """Surface the convention sections as items for the generators."""
    if not raw.strip():
        return []
    items: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None
    for line in raw.splitlines():
        if line.startswith("#"):
            if current is not None:
                items.append(current)
            heading = line.lstrip("#").strip()
            current = {"section": heading, "rules": []}
        elif current is not None and line.lstrip().startswith(("-", "*")):
            current["rules"].append(line.lstrip("-* ").strip())
    if current is not None:
        items.append(current)
    return items
