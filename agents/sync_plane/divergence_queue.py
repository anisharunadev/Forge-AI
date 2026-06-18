"""
Divergence queue — ADR-0010 §4 Tier 3 (FORA-255 / Epic 11.5).

The Tier 3 workbench is the only surface that surfaces Tier 3
divergences to a human.  The queue is the canonical store the
Tier 1 / Tier 2 resolver (FORA-11.4) writes to when an event would
*lose user-visible data*, and the UI panel + bulk-resolution
actions (this sub-task) read from.

Public surface (mirrors the §5 server endpoints in the design doc):

  enqueue_divergence()   — called by the resolver when a Tier 3 candidate
                           is identified.  Validates HLCs + field_path.
  list_divergences()     — the workbench list view (tenant-scoped,
                           virtualised, unresolved-first).
  get_divergence()       — single-row fetch by queue_id (for the
                           side-by-side diff view).
  resolve_divergence()   — the human pick (or bulk pattern).  Writes
                           the §3 audit row and updates the queue row.
  bulk_resolve()         — N individual resolve() calls in a single
                           API call; emits N audit rows.
  build_digest_payload() — the daily email body (§6); opt-out and
                           the >1000 cap are encoded here.

The module is dependency-free and pure-Python; the Postgres DDL
lives in `forge/11.5/migrations/0001_divergence_queue.sql` and
the production wiring (`enqueue_divergence()` →
`pg.execute(DDL, params)`) is a one-line substitution at the
call site.  Smoke test: `tests/test_divergence_queue.py`.

Reference:
  ADR-0010 §4 Tier 3, §7.2 divergence detection, §8.1 audit event
  types.  Design contract: `forge/11.5/design.md`.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Mapping, Optional, Tuple

from .audit import (
    DIVERGENCE_RESOLVED_EVENT,
    AuditRow,
    build_audit_row,
    digest_payload,
)
from .field_owners import DEFAULT_FIELD_OWNERS, resolve_field_owner
from .hlc import HLC, parse


# ---------------------------------------------------------------------------
# Enum surface (the only public string values the queue ever accepts).
# ---------------------------------------------------------------------------

# Reason values for why a divergence was parked in the queue.  Closed
# enum so a typo in the resolver fails the smoke test.
class DivergenceReason(str, Enum):
    HLC_SKEW = "hlc_skew"                # clock monitor tripped §7.1
    USER_DATA_LOSS = "user_data_loss"    # Tier 2 LWW would drop user content
    TENANT_POLICY = "tenant_policy"      # per-tenant config routed here


# Resolution values the human admin can pick.  Closed enum.
class Resolution(str, Enum):
    LEFT = "left"
    RIGHT = "right"
    MERGE = "merge"


# Audit row reason for the human-resolution path.  Per ADR-0010 §8.1
# the resolver uses `hlc_lww` / `field_owner` / `clock_skew`; the
# human path uses `human_pick`.  Sibling enum.
AUDIT_REASON_HUMAN = "human_pick"
AUDIT_REASON_BULK = "human_bulk"        # bulk actions carry this
DIVERGENCE_RESOLVED_BY_HUMAN_EVENT = "sync.event.divergence_resolved_by_human"

# Bulk-pattern cap: when the daily count exceeds this, the email
# subject flips to "Action required".  Per the design doc §6.
DIGEST_LARGE_THRESHOLD = 1_000
DIGEST_TOP_FIELDS_TRUNCATE = 5

# Render budget for the list view.  Per the design doc §4.1, the
# panel must render in < 2 s for 10 000 events; the windowed list
# returns this many rows per page.
LIST_PAGE_SIZE = 200
LIST_RENDER_BUDGET_MS = 2_000


# ---------------------------------------------------------------------------
# Row shape (mirrors the §2 Postgres table).
# ---------------------------------------------------------------------------

@dataclass
class DivergenceRow:
    """One row of the Tier 3 queue.

    Mirrors the §2 table; production wiring substitutes a Postgres
    adapter that builds the same dataclass from a cursor.  Fields
    the UI never sees (the FORA-36 audit forwarder fields) live
    on the AuditRow, not here.
    """
    queue_id: str
    tenant_id: str
    paperclip_issue_id: str
    remote_kind: str                       # "jira" | "github" | "clickup"
    remote_id: str
    field_path: str
    left_value: Any
    left_hlc: str                          # canonical-form 23-char HLC
    left_platform: str
    right_value: Any
    right_hlc: str
    right_platform: str
    detected_at: str                       # ISO 8601 UTC
    detected_hlc: str
    reason: str                           # DivergenceReason
    metadata: Dict[str, Any] = field(default_factory=dict)
    # Resolution state.  None = unresolved.
    resolved_at: Optional[str] = None
    resolved_by: Optional[str] = None     # "user:<uuid>" | "agent:<uuid>" | "system:bulk"
    resolution: Optional[str] = None      # Resolution
    resolution_audit_id: Optional[str] = None
    tombstoned_at: Optional[str] = None

    def is_resolved(self) -> bool:
        return self.resolved_at is not None and self.tombstoned_at is None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Validation helpers (fail fast on bad input).
# ---------------------------------------------------------------------------

# Platforms the queue accepts.  Closed enum; a typo from the resolver
# is a contract violation.
_VALID_PLATFORMS = frozenset({"paperclip", "jira", "github", "clickup"})
_VALID_REMOTE_KINDS = frozenset({"jira", "github", "clickup"})


def _validate_hlc_string(s: str, *, where: str) -> None:
    """HLC strings must be 23-char canonical form.  We re-parse
    via `hlc.parse()` so the same validation runs on the wire and
    in-process.
    """
    if not isinstance(s, str):
        raise ValueError(f"{where} must be a string, got {type(s).__name__}")
    try:
        parse(s)
    except ValueError as e:
        raise ValueError(f"{where} is not a canonical HLC: {e}") from e


# Free-text fields that the §4 row 5 documents as HLC-LWW, but
# that the §7.1 clock-skew rule still promotes to Tier 3.  The
# detector parks them here when the LWW would lose user data or
# the clock-monitor tripped.  Closed set; a typo from the resolver
# is a contract violation.
FREE_TEXT_FIELDS = frozenset({"title", "body", "description", "comment.body"})


def _validate_field_path(field_path: str, *, custom_fields: Optional[Mapping[str, Any]] = None) -> None:
    """The detector validates field_path before insert.  A field is
    acceptable if any of the following holds:

      * it is in the §4 default ownership table (Tier 1 fields;
        Tier 3 is reached on a clock-skew promotion or a tenant
        policy override), OR
      * it is in `FREE_TEXT_FIELDS` (the §4 row 5 set that the
        §7.1 clock-skew rule promotes to Tier 3), OR
      * the tenant has registered it as a custom field
        (`custom_fields`).

    A field that matches none of the three is rejected so a
    misconfigured resolver cannot spam the queue with bogus rows.
    """
    if not isinstance(field_path, str) or not field_path:
        raise ValueError("field_path is required")
    if field_path in DEFAULT_FIELD_OWNERS:
        return
    if field_path in FREE_TEXT_FIELDS:
        return
    if custom_fields and field_path in custom_fields:
        return
    raise ValueError(
        f"field_path {field_path!r} is not in the field-ownership table, "
        "the §4 free-text set, or the tenant-registered custom fields"
    )


# ---------------------------------------------------------------------------
# Enqueue (called by the Tier 1 / Tier 2 resolver when it identifies a
# Tier 3 candidate).
# ---------------------------------------------------------------------------

def enqueue_divergence(
    *,
    tenant_id: str,
    paperclip_issue_id: str,
    remote_kind: str,
    remote_id: str,
    field_path: str,
    left_value: Any,
    left_hlc: str,
    left_platform: str,
    right_value: Any,
    right_hlc: str,
    right_platform: str,
    detected_hlc: str,
    reason: str,
    metadata: Optional[Dict[str, Any]] = None,
    detected_at: Optional[str] = None,
    queue_id: Optional[str] = None,
    custom_fields: Optional[Mapping[str, Any]] = None,
) -> DivergenceRow:
    """Build a Tier 3 queue row.  Pure factory; the resolver then
    INSERTs it via the Postgres adapter.

    Validates:
      * `remote_kind` is in the closed enum
      * `field_path` is in the §4 ownership table (or tenant-registered)
      * `left_hlc` and `right_hlc` are 23-char canonical HLCs
      * `reason` is a `DivergenceReason`
      * `left_platform` and `right_platform` are valid platform names
    """
    if not tenant_id:
        raise ValueError("tenant_id is required")
    if remote_kind not in _VALID_REMOTE_KINDS:
        raise ValueError(f"remote_kind must be one of {sorted(_VALID_REMOTE_KINDS)}, got {remote_kind!r}")
    if left_platform not in _VALID_PLATFORMS or right_platform not in _VALID_PLATFORMS:
        raise ValueError("left_platform and right_platform must be valid platform names")
    if left_platform == right_platform:
        raise ValueError("left_platform and right_platform must differ (otherwise it is not a divergence)")
    _validate_hlc_string(left_hlc, where="left_hlc")
    _validate_hlc_string(right_hlc, where="right_hlc")
    _validate_hlc_string(detected_hlc, where="detected_hlc")
    _validate_field_path(field_path, custom_fields=custom_fields)
    if reason not in {r.value for r in DivergenceReason}:
        raise ValueError(f"reason must be one of {[r.value for r in DivergenceReason]}, got {reason!r}")
    return DivergenceRow(
        queue_id=queue_id or str(uuid.uuid4()),
        tenant_id=tenant_id,
        paperclip_issue_id=paperclip_issue_id,
        remote_kind=remote_kind,
        remote_id=remote_id,
        field_path=field_path,
        left_value=left_value,
        left_hlc=left_hlc,
        left_platform=left_platform,
        right_value=right_value,
        right_hlc=right_hlc,
        right_platform=right_platform,
        detected_at=detected_at or datetime.now(timezone.utc).isoformat(),
        detected_hlc=detected_hlc,
        reason=reason,
        metadata=dict(metadata or {}),
    )


# ---------------------------------------------------------------------------
# List (the workbench list view).  Pure function over an in-memory
# store; the production wiring hits the `divergence_queue_tenant_unresolved`
# index.  The pagination shape matches the §4.1 virtualised list.
# ---------------------------------------------------------------------------

@dataclass
class ListResult:
    rows: List[DivergenceRow]
    total: int
    limit: int
    offset: int


def list_divergences(
    store: List[DivergenceRow],
    *,
    tenant_id: str,
    limit: int = LIST_PAGE_SIZE,
    offset: int = 0,
    field_path: Optional[str] = None,
    platform: Optional[str] = None,
    since_iso: Optional[str] = None,
) -> ListResult:
    """Return the unresolved divergences for one tenant, in
    `detected_at DESC` order.  Filters: field_path, platform, since_iso.

    The production adapter builds the same shape from a Postgres
    cursor.  The windowed list contract (200 rows per page, deep
    count surfaced in the UI) is preserved.
    """
    if not tenant_id:
        raise ValueError("tenant_id is required")
    if limit <= 0 or limit > LIST_PAGE_SIZE:
        raise ValueError(f"limit must be in 1..{LIST_PAGE_SIZE}, got {limit}")
    if offset < 0:
        raise ValueError("offset must be >= 0")
    if platform and platform not in _VALID_PLATFORMS:
        raise ValueError(f"platform must be one of {sorted(_VALID_PLATFORMS)}, got {platform!r}")
    out: List[DivergenceRow] = []
    for row in store:
        if row.tenant_id != tenant_id:
            continue
        if row.tombstoned_at is not None:
            continue
        if row.resolved_at is not None:
            continue
        if field_path and row.field_path != field_path:
            continue
        if platform and platform not in (row.left_platform, row.right_platform):
            continue
        if since_iso and row.detected_at < since_iso:
            continue
        out.append(row)
    out.sort(key=lambda r: r.detected_at, reverse=True)
    return ListResult(
        rows=out[offset:offset + limit],
        total=len(out),
        limit=limit,
        offset=offset,
    )


def get_divergence(
    store: List[DivergenceRow],
    *,
    tenant_id: str,
    queue_id: str,
) -> DivergenceRow:
    """Single-row fetch by queue_id, tenant-scoped.  Raises
    KeyError if the row is missing or the tenant does not match.
    """
    for row in store:
        if row.queue_id == queue_id:
            if row.tenant_id != tenant_id:
                raise KeyError("queue_id is not visible to this tenant")
            return row
    raise KeyError(f"no divergence row with queue_id={queue_id!r}")


# ---------------------------------------------------------------------------
# Resolve (the human pick).  Writes the §3 audit row and updates
# the queue row.  The audit row is the durable record; the queue
# row's `resolution_audit_id` is the FK back.
# ---------------------------------------------------------------------------

@dataclass
class ResolveResult:
    queue_id: str
    audit_id: str
    audit_row: AuditRow
    updated_row: DivergenceRow


def resolve_divergence(
    store: List[DivergenceRow],
    *,
    tenant_id: str,
    queue_id: str,
    resolution: str,
    actor: str,                              # "user:<uuid>" — the human admin
    merge_value: Optional[Any] = None,
    bulk_pattern_key: Optional[str] = None,
    is_bulk: bool = False,
    now: Optional[str] = None,
) -> ResolveResult:
    """Apply a human resolution (or a bulk-pattern application).

    Side effects:
      1. Writes a §3 audit row with `event_type = DIVERGENCE_RESOLVED_BY_HUMAN_EVENT`
         and `reason = "human_pick"` (or `"human_bulk"` for bulk calls).
      2. Updates the queue row: `resolved_at`, `resolved_by`, `resolution`,
         `resolution_audit_id`.

    Idempotent: a second call on an already-resolved row raises
    ValueError so the UI does not double-emit audit rows.
    """
    if resolution not in {r.value for r in Resolution}:
        raise ValueError(f"resolution must be one of {[r.value for r in Resolution]}, got {resolution!r}")
    if not actor.startswith(("user:", "agent:", "system:")):
        raise ValueError("actor must be one of 'user:<uuid>' / 'agent:<uuid>' / 'system:<name>'")
    if resolution == Resolution.MERGE.value and merge_value is None:
        raise ValueError("merge resolution requires merge_value")
    if resolution != Resolution.MERGE.value and merge_value is not None:
        raise ValueError("merge_value is only valid when resolution='merge'")
    row = get_divergence(store, tenant_id=tenant_id, queue_id=queue_id)
    if row.is_resolved():
        raise ValueError(f"divergence {queue_id!r} is already resolved at {row.resolved_at!r}")
    # Pick the winner / loser platforms from the row.
    if resolution == Resolution.LEFT.value:
        winner_platform, winner_hlc, loser_platform, loser_hlc = (
            row.left_platform, row.left_hlc, row.right_platform, row.right_hlc
        )
    elif resolution == Resolution.RIGHT.value:
        winner_platform, winner_hlc, loser_platform, loser_hlc = (
            row.right_platform, row.right_hlc, row.left_platform, row.left_hlc
        )
    else:                                                          # MERGE
        # A merge is its own value; we still record the HLCs of the
        # two candidates and call the higher-HLC side the "winner" so
        # the audit shape is uniform.
        left_h, right_h = parse(row.left_hlc), parse(row.right_hlc)
        if left_h >= right_h:
            winner_platform, winner_hlc, loser_platform, loser_hlc = (
                row.left_platform, row.left_hlc, row.right_platform, row.right_hlc
            )
        else:
            winner_platform, winner_hlc, loser_platform, loser_hlc = (
                row.right_platform, row.right_hlc, row.left_platform, row.left_hlc
            )
    metadata: Dict[str, Any] = {
        "queue_id": queue_id,
        "paperclip_issue_id": row.paperclip_issue_id,
        "field_path": row.field_path,
        "resolution": resolution,
        "is_bulk": is_bulk,
    }
    if resolution == Resolution.MERGE.value:
        metadata["merge_value"] = merge_value
    if bulk_pattern_key is not None:
        metadata["bulk_pattern_key"] = bulk_pattern_key
    audit_row = build_audit_row(
        event_type=DIVERGENCE_RESOLVED_BY_HUMAN_EVENT,
        tenant_id=tenant_id,
        actor=actor,
        field=row.field_path,
        winner_platform=winner_platform,
        loser_platform=loser_platform,
        winner_hlc=winner_hlc,
        loser_hlc=loser_hlc,
        reason=AUDIT_REASON_BULK if is_bulk else AUDIT_REASON_HUMAN,
        metadata=metadata,
    )
    audit_id = str(uuid.uuid4())
    audit_row.event_id = audit_id
    audit_row.record_hash = digest_payload(audit_row)
    resolved_at = now or datetime.now(timezone.utc).isoformat()
    # Update the queue row in place.  Production wiring translates
    # this to `UPDATE … SET resolved_at = $1, … WHERE queue_id = $2`.
    row.resolved_at = resolved_at
    row.resolved_by = actor
    row.resolution = resolution
    row.resolution_audit_id = audit_id
    if merge_value is not None:
        row.metadata["merge_value"] = merge_value
    if bulk_pattern_key is not None:
        row.metadata["bulk_pattern_key"] = bulk_pattern_key
    row.metadata["is_bulk"] = is_bulk
    return ResolveResult(
        queue_id=queue_id,
        audit_id=audit_id,
        audit_row=audit_row,
        updated_row=row,
    )


def bulk_resolve(
    store: List[DivergenceRow],
    *,
    tenant_id: str,
    filter_field_path: Optional[str] = None,
    filter_platform: Optional[str] = None,
    filter_since_iso: Optional[str] = None,
    resolution: str,
    actor: str,
    bulk_pattern_key: str,
    merge_value: Optional[Any] = None,
    now: Optional[str] = None,
) -> Tuple[List[ResolveResult], List[DivergenceRow]]:
    """Apply a bulk-pattern resolution to every matching row.

    Emits **N individual audit rows** (one per matched event) per
    the §3.1 contract.  Atomicity: each resolve is a separate
    transaction in the production wiring; a failure on row K does
    NOT roll back rows 1..K-1.  The function returns
    `(succeeded, failed)` so the UI can show "resolved 23 of 47,
    24 failed, see toast for queue_ids".

    The filter is the same shape as `list_divergences` minus the
    pagination; the UI applies the same filter chips to the
    workbench list and to the bulk-pattern apply action.
    """
    if not bulk_pattern_key:
        raise ValueError("bulk_pattern_key is required for bulk_resolve")
    matches = list_divergences(
        store,
        tenant_id=tenant_id,
        limit=LIST_PAGE_SIZE,
        offset=0,
        field_path=filter_field_path,
        platform=filter_platform,
        since_iso=filter_since_iso,
    ).rows
    succeeded: List[ResolveResult] = []
    failed: List[DivergenceRow] = []
    for row in matches:
        try:
            result = resolve_divergence(
                store,
                tenant_id=tenant_id,
                queue_id=row.queue_id,
                resolution=resolution,
                actor=actor,
                merge_value=merge_value,
                bulk_pattern_key=bulk_pattern_key,
                is_bulk=True,
                now=now,
            )
            succeeded.append(result)
        except (ValueError, KeyError):
            failed.append(row)
    return succeeded, failed


# ---------------------------------------------------------------------------
# Daily digest payload (the §6 email body).  Pure function; the
# transport (which tenant admin list, which SMTP) is the caller's
# concern.  Returns None when the tenant is opted out.
# ---------------------------------------------------------------------------

@dataclass
class DigestPayload:
    tenant_id: str
    day: str                                  # ISO 8601 date
    subject: str
    body_md: str
    field_path_breakdown: Dict[str, int]
    total: int
    is_action_required: bool
    deep_link: str                            # the pre-filtered workbench URL


def build_digest_payload(
    store: List[DivergenceRow],
    *,
    tenant_id: str,
    day: str,                                 # "YYYY-MM-DD"
    opted_out: bool = False,
    base_url: str = "https://forge.fora.example/divergence",
) -> Optional[DigestPayload]:
    """Build the §6 daily digest for one tenant on one UTC day.

    Returns None when the tenant has opted out (the caller does not
    send).  When the day's count exceeds `DIGEST_LARGE_THRESHOLD`
    the subject flips to "Action required" and the per-`field_path`
    breakdown is truncated to the top `DIGEST_TOP_FIELDS_TRUNCATE`.
    """
    if opted_out:
        return None
    if not tenant_id or not day:
        raise ValueError("tenant_id and day are required")
    # Count events in the day window that landed in the queue.
    rows_in_day = [
        r for r in store
        if r.tenant_id == tenant_id
        and r.detected_at.startswith(day)
        and r.tombstoned_at is None
    ]
    total = len(rows_in_day)
    breakdown: Dict[str, int] = {}
    for r in rows_in_day:
        breakdown[r.field_path] = breakdown.get(r.field_path, 0) + 1
    sorted_breakdown = sorted(breakdown.items(), key=lambda kv: (-kv[1], kv[0]))
    is_action_required = total > DIGEST_LARGE_THRESHOLD
    if is_action_required:
        subject = f"Action required: >{DIGEST_LARGE_THRESHOLD} divergences on {tenant_id} ({day})"
        shown_breakdown = dict(sorted_breakdown[:DIGEST_TOP_FIELDS_TRUNCATE])
        truncation_note = (
            f"\n\n_…and {len(sorted_breakdown) - DIGEST_TOP_FIELDS_TRUNCATE} "
            "more field paths; see the workbench for the full breakdown._"
            if len(sorted_breakdown) > DIGEST_TOP_FIELDS_TRUNCATE else ""
        )
    else:
        subject = f"Daily divergence summary for {tenant_id} ({day}): {total} new"
        shown_breakdown = dict(sorted_breakdown)
        truncation_note = ""
    lines = [
        f"# Divergence summary — {tenant_id} — {day}",
        "",
        f"**{total} new divergences** landed in the Tier 3 queue.",
        "",
    ]
    if shown_breakdown:
        lines.append("## By field path")
        lines.append("")
        for fp, count in shown_breakdown.items():
            lines.append(f"- `{fp}` — {count}")
        lines.append(truncation_note)
    else:
        lines.append("_No new divergences today._")
        lines.append("")
    deep_link = f"{base_url}/{tenant_id}?since={day}"
    lines.append(f"\n[Open the workbench pre-filtered to this day]({deep_link})")
    return DigestPayload(
        tenant_id=tenant_id,
        day=day,
        subject=subject,
        body_md="\n".join(lines),
        field_path_breakdown=shown_breakdown,
        total=total,
        is_action_required=is_action_required,
        deep_link=deep_link,
    )


# ---------------------------------------------------------------------------
# Internal helpers (smoke-test exposed).
# ---------------------------------------------------------------------------

def _validate_digest_payload(payload: DigestPayload) -> str:
    """Stable SHA-256 of the digest body, for the smoke test that
    asserts the email body is reproducible across reruns."""
    canon = json.dumps(
        {
            "tenant_id": payload.tenant_id,
            "day": payload.day,
            "subject": payload.subject,
            "body_md": payload.body_md,
            "field_path_breakdown": payload.field_path_breakdown,
            "total": payload.total,
            "is_action_required": payload.is_action_required,
            "deep_link": payload.deep_link,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()
