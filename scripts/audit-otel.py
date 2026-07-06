#!/usr/bin/env python3
"""scripts/audit-otel.py — OpenTelemetry coverage auditor (M15-5).

Scans ``backend/app/services/**/*.py`` and ``backend/app/api/v1/**/*router*.py``
and reports per-file whether:

  * the file uses ``tracer.start_as_current_span(...)`` OR is decorated
    with ``@trace_service`` (lightweight audit primitive) OR relies
    purely on FastAPI auto-instrumentation (a separate category);
  * the file logs structured ``forge.{domain}.{action}`` lines, even
    when no explicit OTel span exists (structlog is the fallback).

The audit is informational by default — it writes a JSON report under
``docs/observability/otel-coverage.json`` for the operations team.
With ``--strict`` it exits 1 if explicit span coverage is below 50%.

Why not just rely on FastAPI auto-instrumentation? Because route-level
spans don't carry tenant_id/project_id/actor_id attributes (Rule 7).
The audit flags routes that need an explicit span decorator so
observability gets the correlation it needs.

Usage:

    python3 scripts/audit-otel.py               # write JSON report
    python3 scripts/audit-otel.py --strict      # exit 1 if coverage < 50%
    python3 scripts/audit-otel.py --verbose     # print every file
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
SERVICES = REPO_ROOT / "backend" / "app" / "services"
ROUTERS = REPO_ROOT / "backend" / "app" / "api" / "v1"
REPORT_PATH = REPO_ROOT / "docs" / "observability" / "otel-coverage.json"

DOMAINS = {
    "ideation",
    "architecture",
    "knowledge",
    "connector",
    "agent",
    "run",
    "project_onboarding",
    "memory",
    "project_intelligence",
    "service",
}


@dataclass
class FileAudit:
    path: str
    domain: str
    has_explicit_span: bool
    has_structlog_event: bool
    has_audit_decorator: bool
    line_count: int
    notes: list[str] = field(default_factory=list)

    @property
    def covered(self) -> str:
        if self.has_explicit_span:
            return "explicit-span"
        if self.has_audit_decorator:
            return "audit-decorator"
        if self.has_structlog_event:
            return "structlog-only"
        return "uncovered"


def _audit_decorator_names() -> set[str]:
    return {
        "audit",
        "require_approval_phase",
        "trace_service",
        "observe",
        "tracer.start_as_current_span",
    }


def audit_file(path: Path) -> FileAudit | None:
    text = path.read_text(errors="ignore")
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return None
    line_count = text.count("\n") + 1

    # Match domain = the first segment under app/services/ or app/api/v1/
    rel = path.relative_to(REPO_ROOT)
    parts = rel.parts
    has_explicit_span = (
        "start_as_current_span" in text or "@trace_service" in text or "@observe" in text
    )
    has_structlog = any(
        token in text
        for token in (
            "logger.info",
            "logger.warning",
            "logger.error",
            'get_logger(__name__)',
            'get_logger("',
        )
    )
    has_audit_decorator = "@audit(" in text or "@require_approval_phase(" in text

    domain = "general"
    for part in parts:
        if part in DOMAINS:
            domain = part
            break

    notes: list[str] = []
    if not has_explicit_span and not has_audit_decorator and not has_structlog:
        notes.append("no observability signal at all")

    return FileAudit(
        path=str(rel),
        domain=domain,
        has_explicit_span=has_explicit_span,
        has_structlog_event=has_structlog,
        has_audit_decorator=has_audit_decorator,
        line_count=line_count,
        notes=notes,
    )


def iter_targets() -> Iterable[Path]:
    if SERVICES.exists():
        for p in SERVICES.rglob("*.py"):
            if "__pycache__" in p.parts or "/tests/" in str(p):
                continue
            yield p
    if ROUTERS.exists():
        for p in ROUTERS.rglob("*.py"):
            if "__pycache__" in p.parts or "/tests/" in str(p):
                continue
            yield p


def compute_coverage(rows: list[FileAudit]) -> tuple[float, dict[str, int]]:
    if not rows:
        return 0.0, {}
    counts: dict[str, int] = {}
    for r in rows:
        counts[r.covered] = counts.get(r.covered, 0) + 1
    explicit_or_audit = counts.get("explicit-span", 0) + counts.get("audit-decorator", 0)
    pct = explicit_or_audit / len(rows) * 100
    return pct, counts


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--strict", action="store_true",
                    help="exit 1 if explicit-span + audit-decorator coverage < 50%")
    ap.add_argument("--verbose", action="store_true", help="print every file")
    args = ap.parse_args()

    rows: list[FileAudit] = []
    for p in iter_targets():
        audit = audit_file(p)
        if audit is not None:
            rows.append(audit)

    pct, counts = compute_coverage(rows)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps({
        "files_total": len(rows),
        "coverage_pct_explicit_or_audit": round(pct, 1),
        "distribution": counts,
        "files": [asdict(r) | {"covered": r.covered} for r in rows],
    }, indent=2))

    print(f"OTel audit — {len(rows)} files scanned")
    print(f"  coverage (explicit-span + audit-decorator): {pct:.1f}%")
    if counts:
        for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
            print(f"    {k:<22} {v}")
    print(f"  report: {REPORT_PATH.relative_to(REPO_ROOT)}")

    if args.verbose:
        for r in rows:
            tag = "✓" if r.covered != "uncovered" else "✗"
            print(f"  {tag} {r.path:<60} {r.covered:<18} lines={r.line_count}")

    if args.strict and pct < 50:
        sys.stderr.write(
            f"OTel coverage FAILED: {pct:.1f}% < 50% threshold.\n"
            f"Add @trace_service, @observe, or @audit(...) decorators to "
            f"more service / router modules so R7 attribute coverage is met.\n"
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
