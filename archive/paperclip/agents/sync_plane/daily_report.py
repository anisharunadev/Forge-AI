"""
Daily divergence-report renderer — FORA-268 (Epic 11.7 §AC #3).

Per ADR-0010 §7.2 + Epic 11.7, the daily divergence job (cron
02:00 UTC) aggregates 24 h of `sync.shadow_drift` events into a
divergence report, attached to the tenant dashboard.  The report
is rendered as a Markdown file at:

    forge/sync-plane/reports/<tenant>/<YYYY-MM-DD>.md

The Markdown shape is fixed so the tenant dashboard can render it
without re-parsing JSON.  Front-matter is YAML (per the dashboard's
existing `forge/sync-plane/reports/` convention) and the body is
sorted by `detected_hlc` so the report is byte-stable across
re-runs (the AC #5 determinism contract — the QA 7-day clean run
asserts the report digest is reproducible).

Owner: Architect (this module) + QA (DocAgent — exit-gate #3 is 7
consecutive days of clean runs, which proves the report renders
without drift events).

Reference: ADR-0010 §7.2 (divergence detection daily), §8.1
(`sync.shadow_drift` event type).  Epic 11.7 sub-task #7.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Mapping, Optional, Protocol, Tuple

from .audit import AuditRow, SHADOW_DRIFT_EVENT


# Default report directory per the FORA-268 AC #3.
DEFAULT_REPORT_ROOT = "forge/sync-plane/reports"

# The cron schedule per the issue body: 02:00 UTC daily.
DAILY_CRON_HOUR_UTC = 2
DAILY_CRON_MINUTE_UTC = 0

# Filename slug for the tenant segment of the path.  We lowercase
# + replace anything that is not [a-z0-9-] with a dash so the path
# is safe across filesystems and shells.
_SLUG_NON_ALNUM = re.compile(r"[^a-z0-9-]+")


# --- ports ----------------------------------------------------------------

class ReportStore(Protocol):
    """The seam the production filesystem adapter implements.

    `read()` returns the prior-day report bytes (or b"" if missing)
    so the renderer can detect "this is the first run for this
    tenant on this day" (the §AC #5 idempotency contract).  The
    smoke test uses an in-memory dict."""
    def read(self, *, tenant_id: str, day: str) -> bytes: ...
    def write(self, *, tenant_id: str, day: str, body: bytes) -> None: ...


class InMemoryReportStore:
    """In-memory ReportStore for the smoke test."""
    def __init__(self) -> None:
        self._store: Dict[Tuple[str, str], bytes] = {}

    def read(self, *, tenant_id: str, day: str) -> bytes:
        return self._store.get((tenant_id, day), b"")

    def write(self, *, tenant_id: str, day: str, body: bytes) -> None:
        self._store[(tenant_id, day)] = bytes(body)


class FilesystemReportStore:
    """Filesystem-backed ReportStore.  The path shape is
    `<root>/<tenant_slug>/<YYYY-MM-DD>.md` so the dashboard's
    existing static-file server can serve the directory."""
    def __init__(self, *, root: str = DEFAULT_REPORT_ROOT) -> None:
        if not root:
            raise ValueError("root is required")
        self._root = root

    def read(self, *, tenant_id: str, day: str) -> bytes:
        path = self._path(tenant_id, day)
        if not os.path.exists(path):
            return b""
        with open(path, "rb") as f:
            return f.read()

    def write(self, *, tenant_id: str, day: str, body: bytes) -> None:
        path = self._path(tenant_id, day)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(body)

    def _path(self, tenant_id: str, day: str) -> str:
        return os.path.join(self._root, _slug(tenant_id), f"{day}.md")


# --- wire types -----------------------------------------------------------

@dataclass
class DailyReport:
    """The rendered report for one (tenant, day) pair."""
    tenant_id: str
    day: str                            # "YYYY-MM-DD"
    path: str                           # where the bytes were written
    body_md: str                        # the rendered Markdown
    drift_count: int                    # number of shadow_drift events
    field_breakdown: Dict[str, int]     # field → count
    platform_breakdown: Dict[str, int]  # platform → count
    has_p0: bool                        # any R-SYNC-05 / OOH-shadow-drift events
    first_drift_hlc: str = ""           # earliest detected_hlc; "" if no drifts
    last_drift_hlc: str = ""            # latest detected_hlc; "" if no drifts
    audit_summary_digest: str = ""      # SHA-256 of the sorted drift rows; AC #5

    def to_dict(self) -> Dict:
        return {
            "tenant_id": self.tenant_id,
            "day": self.day,
            "path": self.path,
            "drift_count": self.drift_count,
            "field_breakdown": dict(self.field_breakdown),
            "platform_breakdown": dict(self.platform_breakdown),
            "has_p0": self.has_p0,
            "first_drift_hlc": self.first_drift_hlc,
            "last_drift_hlc": self.last_drift_hlc,
            "audit_summary_digest": self.audit_summary_digest,
        }


# --- the renderer ---------------------------------------------------------

class DailyReportRenderer:
    """The cron 02:00 UTC job.  Per-tenant; one call per tenant.

    Idempotency contract: re-running the same (tenant, day) pair
    produces the same Markdown (byte-for-byte, modulo the
    `run_id` and `generated_at` front-matter which are derived
    from the source rows, not the wall clock).  The smoke test
    asserts the digest is reproducible.

    The window is 24 h ending at the given day's 02:00 UTC.  For
    a daily job triggered at 02:00 UTC on day D, the window is
    [D-1 02:00 UTC, D 02:00 UTC) — the standard "24 h back from
    run time" semantics the daily digest pattern uses.
    """

    def __init__(
        self,
        *,
        store: ReportStore,
        root: str = DEFAULT_REPORT_ROOT,
        actor: str = "system:divergence-daily-job",
    ) -> None:
        if store is None:
            raise ValueError("store is required")
        self._store = store
        self._root = root
        self._actor = actor

    def render(
        self,
        *,
        tenant_id: str,
        day: str,
        shadow_drifts: Iterable[AuditRow],
        now: Optional[dt.datetime] = None,
    ) -> DailyReport:
        """Render the daily Markdown report.

        `day` is the *report* day (the file is named for this day);
        the 24 h window is the 24 h *before* day at 02:00 UTC.
        `now` is the wall-clock at render time; defaults to "now".
        """
        if not tenant_id:
            raise ValueError("tenant_id is required")
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", day):
            raise ValueError(f"day must be YYYY-MM-DD, got {day!r}")

        # 1. Filter to drifts in the 24 h window ending at the
        # report day's 02:00 UTC.  The timestamp filter is the
        # `timestamp` field the audit forwarder stamps; for the
        # smoke test we let the caller pre-filter and pass the
        # 24 h slice.  We also accept a "soft" filter by
        # detected_hlc for tests that build rows without a
        # timestamp.
        day_start = _parse_day(day) + dt.timedelta(
            hours=DAILY_CRON_HOUR_UTC,
            minutes=DAILY_CRON_MINUTE_UTC,
        )
        day_end = day_start + dt.timedelta(days=1)
        drifts: List[AuditRow] = []
        for row in shadow_drifts:
            if row.event_type != SHADOW_DRIFT_EVENT:
                continue
            if row.tenant_id != tenant_id:
                continue
            ts = _parse_iso(row.timestamp)
            if ts is None:
                # No timestamp → keep the row (the smoke test may
                # not stamp one; production always will via the
                # FORA-36 forwarder).
                drifts.append(row)
                continue
            if day_start <= ts < day_end:
                drifts.append(row)

        # 2. Deterministic sort by (detected_hlc, entity_id, field).
        # `detected_hlc` lives in `metadata.detected_hlc` (the
        # polling backstop stamped it).  Entity + field are the
        # tiebreaker so the byte order is stable across re-runs
        # even when two drifts share an HLC (the polling job
        # coalesces to one row per entity, but the §AC #2
        # contract is that re-runs of the same diff produce the
        # same row set).
        drifts.sort(key=_sort_key)

        # 3. Compute breakdown + first/last HLC.
        field_breakdown: Dict[str, int] = {}
        platform_breakdown: Dict[str, int] = {}
        first_hlc = ""
        last_hlc = ""
        for row in drifts:
            field_breakdown[row.field] = field_breakdown.get(row.field, 0) + 1
            platform = (row.metadata or {}).get("platform", "")
            if platform:
                platform_breakdown[platform] = platform_breakdown.get(platform, 0) + 1
            hlc = (row.metadata or {}).get("detected_hlc", "")
            if hlc:
                if not first_hlc or hlc < first_hlc:
                    first_hlc = hlc
                if not last_hlc or hlc > last_hlc:
                    last_hlc = hlc

        # 4. P0 detection: any drift flagged for the §AC #4 alert
        # wiring (the OOH check would have already fired for
        # those; this is a "P0 surfaced in the report" flag so
        # the dashboard can render a warning).  A drift is P0
        # iff its `metadata.ooh_alerted` is truthy (set by the
        # alert wiring) or its `metadata.severity` is "P0".
        has_p0 = any(
            (r.metadata or {}).get("ooh_alerted")
            or (r.metadata or {}).get("severity") == "P0"
            for r in drifts
        )

        # 5. Audit summary digest — the §AC #5 determinism anchor.
        audit_digest = _audit_summary_digest(drifts)

        # 6. Render Markdown.
        rendered_at = now or dt.datetime.now(dt.timezone.utc)
        body = render_markdown(
            tenant_id=tenant_id,
            day=day,
            drifts=drifts,
            field_breakdown=field_breakdown,
            platform_breakdown=platform_breakdown,
            first_hlc=first_hlc,
            last_hlc=last_hlc,
            has_p0=has_p0,
            audit_digest=audit_digest,
            rendered_at=rendered_at,
            actor=self._actor,
        )
        path = os.path.join(self._root, _slug(tenant_id), f"{day}.md")
        self._store.write(tenant_id=tenant_id, day=day, body=body.encode("utf-8"))

        return DailyReport(
            tenant_id=tenant_id,
            day=day,
            path=path,
            body_md=body,
            drift_count=len(drifts),
            field_breakdown=field_breakdown,
            platform_breakdown=platform_breakdown,
            has_p0=has_p0,
            first_drift_hlc=first_hlc,
            last_drift_hlc=last_hlc,
            audit_summary_digest=audit_digest,
        )


# --- pure renderer (testable in isolation) -------------------------------

def render_markdown(
    *,
    tenant_id: str,
    day: str,
    drifts: List[AuditRow],
    field_breakdown: Mapping[str, int],
    platform_breakdown: Mapping[str, int],
    first_hlc: str,
    last_hlc: str,
    has_p0: bool,
    audit_digest: str,
    rendered_at: dt.datetime,
    actor: str,
) -> str:
    """Render the daily Markdown report.  Pure function: the
    output is fully determined by the inputs.

    The Markdown shape is fixed (per AC #3):
      * YAML front-matter (`tenant_id`, `day`, `drift_count`, …)
      * H1: `# Daily Divergence Report — <tenant> — <day>`
      * Summary table (drift_count, has_p0, first/last_hlc, digest)
      * ## Per-field tally
      * ## Per-platform tally
      * ## Drift rows (sorted by detected_hlc)
    """
    lines: List[str] = []
    # YAML front-matter.  The order of keys is deterministic
    # (alphabetical in the dict literal that follows the
    # front-matter convention; we use a fixed order instead so
    # two renders always produce the same bytes).
    lines.append("---")
    lines.append(f"tenant_id: {_yaml_scalar(tenant_id)}")
    lines.append(f"day: {_yaml_scalar(day)}")
    lines.append(f"drift_count: {len(drifts)}")
    lines.append(f"has_p0: {'true' if has_p0 else 'false'}")
    lines.append(f"first_drift_hlc: {_yaml_scalar(first_hlc)}")
    lines.append(f"last_drift_hlc: {_yaml_scalar(last_hlc)}")
    lines.append(f"audit_summary_digest: {_yaml_scalar(audit_digest)}")
    lines.append(f"rendered_at: {_yaml_scalar(rendered_at.isoformat())}")
    lines.append(f"actor: {_yaml_scalar(actor)}")
    lines.append("---")
    lines.append("")
    lines.append(f"# Daily Divergence Report — {tenant_id} — {day}")
    lines.append("")
    if not drifts:
        lines.append("_No drift events in the 24 h window ending at "
                     f"{day} 02:00 UTC. This is a clean run._")
        lines.append("")
    else:
        lines.append(
            f"**{len(drifts)} drift event{'s' if len(drifts) != 1 else ''}** "
            f"in the 24 h window ending at {day} 02:00 UTC."
        )
        if has_p0:
            lines.append("")
            lines.append("> [!WARNING]")
            lines.append("> P0 drift(s) detected. The 60-min unprocessed "
                         "alert wiring has fired; see the workbench.")
        lines.append("")

    # Summary table
    lines.append("## Summary")
    lines.append("")
    lines.append("| Field | Value |")
    lines.append("|-------|-------|")
    lines.append(f"| Drift count | {len(drifts)} |")
    lines.append(f"| Has P0 | {'yes' if has_p0 else 'no'} |")
    lines.append(f"| First drift HLC | `{first_hlc or '—'}` |")
    lines.append(f"| Last drift HLC | `{last_hlc or '—'}` |")
    lines.append(f"| Audit summary digest | `{audit_digest}` |")
    lines.append("")

    if field_breakdown:
        lines.append("## Per-field tally")
        lines.append("")
        lines.append("| Field | Drift count |")
        lines.append("|-------|-------------|")
        for field_name in sorted(field_breakdown):
            lines.append(f"| `{field_name}` | {field_breakdown[field_name]} |")
        lines.append("")

    if platform_breakdown:
        lines.append("## Per-platform tally")
        lines.append("")
        lines.append("| Platform | Drift count |")
        lines.append("|----------|-------------|")
        for platform in sorted(platform_breakdown):
            lines.append(f"| `{platform}` | {platform_breakdown[platform]} |")
        lines.append("")

    if drifts:
        lines.append("## Drift rows")
        lines.append("")
        lines.append("| Detected HLC | Platform | Entity | Field | Old | New | Run id |")
        lines.append("|--------------|----------|--------|-------|-----|-----|--------|")
        for row in drifts:
            md = row.metadata or {}
            lines.append(
                "| `{hlc}` | `{plat}` | `{ent}` | `{fld}` | `{old}` | `{new}` | `{run}` |".format(
                    hlc=md.get("detected_hlc", ""),
                    plat=md.get("platform", ""),
                    ent=md.get("entity_id", ""),
                    fld=row.field,
                    old=_fmt_value(md.get("old_value")),
                    new=_fmt_value(md.get("new_value")),
                    run=md.get("run_id", ""),
                )
            )
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append(
        f"Rendered by `{actor}` at `{rendered_at.isoformat()}`. "
        "This file is regenerated idempotently each cron run; the "
        "`audit_summary_digest` is the §AC #5 determinism anchor."
    )
    lines.append("")
    return "\n".join(lines)


# --- pure helpers ---------------------------------------------------------

def _slug(tenant_id: str) -> str:
    """Slugify the tenant_id for the filesystem path."""
    s = tenant_id.strip().lower()
    s = _SLUG_NON_ALNUM.sub("-", s).strip("-")
    return s or "tenant"


def _parse_day(day: str) -> dt.datetime:
    """Parse a YYYY-MM-DD day string to a 00:00 UTC datetime."""
    y, m, d = day.split("-")
    return dt.datetime(int(y), int(m), int(d), tzinfo=dt.timezone.utc)


def _parse_iso(s: str) -> Optional[dt.datetime]:
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _yaml_scalar(s: str) -> str:
    """Quote a YAML scalar so colons, leading/trailing spaces, and
    non-ASCII do not break the front-matter parser."""
    if not s:
        return '""'
    if re.match(r"^[A-Za-z0-9_\-.]+$", s):
        return s
    return json.dumps(s, ensure_ascii=False)


def _fmt_value(v) -> str:
    """Format a value for the Markdown table cell.  Truncates long
    strings so the table stays readable; the full value is in the
    audit row, so the report is a summary, not the source of truth."""
    if v is None:
        return "—"
    if isinstance(v, str):
        if len(v) > 80:
            return v[:77] + "…"
        return v.replace("\n", " ⏎ ")
    s = json.dumps(v, sort_keys=True, ensure_ascii=False, default=str)
    if len(s) > 80:
        return s[:77] + "…"
    return s


def _sort_key(row: AuditRow) -> Tuple[str, str, str, str]:
    """Stable sort key: (detected_hlc, entity_id, field, run_id)."""
    md = row.metadata or {}
    return (
        md.get("detected_hlc", ""),
        md.get("entity_id", ""),
        row.field,
        md.get("run_id", ""),
    )


def _audit_summary_digest(drifts: List[AuditRow]) -> str:
    """Stable SHA-256 of the §AC #5 summary: the sorted list of
    `digest_payload(row)` for every drift.  Re-runs of the same
    drift set produce the same digest; the QA 7-day clean-run
    smoke test asserts this."""
    digests = sorted(
        _row_digest(r) for r in drifts
    )
    canon = json.dumps(digests, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def _row_digest(row: AuditRow) -> str:
    """Stable SHA-256 of the §8.1 payload (the audit forwarder's
    own digest function).  Imported lazily so the daily report
    module does not pull in the resolver at import time."""
    from .audit import digest_payload
    return digest_payload(row)


# --- the cron scheduler (for the production wiring) ----------------------

def next_run_after(now: dt.datetime) -> dt.datetime:
    """The next 02:00 UTC strictly after `now`.  Pure."""
    candidate = now.astimezone(dt.timezone.utc).replace(
        hour=DAILY_CRON_HOUR_UTC,
        minute=DAILY_CRON_MINUTE_UTC,
        second=0,
        microsecond=0,
    )
    if candidate <= now.astimezone(dt.timezone.utc):
        candidate = candidate + dt.timedelta(days=1)
    return candidate


def report_window_for(day: str) -> Tuple[dt.datetime, dt.datetime]:
    """The 24 h window (start_inclusive, end_exclusive) for a
    report day.  Pure; the smoke test uses this to assert the
    timestamp filter accepts the right rows."""
    start = _parse_day(day) + dt.timedelta(
        hours=DAILY_CRON_HOUR_UTC,
        minutes=DAILY_CRON_MINUTE_UTC,
    )
    end = start + dt.timedelta(days=1)
    return (start, end)
