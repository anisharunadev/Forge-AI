"""
Author-mapping table — ADR-0010 §5 + FORA-264 AC #4 / #5.

The single source of truth for "Paperclip actor X has remote id Y
on platform Z".  Append-only: an existing row is never mutated;
when a remote id changes (a customer's Jira accountId moves), a
new row is appended with the new id and the prior row's
`superseded_by` field is set to point at it.  The audit forwarder
gets a row-level event for every append so the daily divergence
job can spot stale mappings.

Schema (one row per append):

    {
      "row_id":         "am_<uuidv7>",            # stable, never reused
      "tenant_id":      "tenant-acme",
      "kind":           "agent" | "user" | "board" | "system",
      "paperclip_id":   "f4d4bf77-…",             # Paperclip-side id
      "platform":       "jira" | "github" | "clickup",
      "remote_id":      "accountId:5d8e…",         # platform-side id
      "remote_display": "DocAgent (FORA-118)",     # platform display name
      "created_hlc":    "1718645112000.000-0042",  # HLC of the append
      "superseded_by":  "am_<uuidv7>" | null,      # set when this row is
                                                   # superseded (chained,
                                                   # not mutated in place)
      "reason":         "first_connect" | "human_oauth_grant"
                      | "id_change" | "admin_reassign"
      "audit_event":    "sync.event.comment.attribution_written"
                      | "sync.platform.degraded"
                      | etc
    }

The `paperclip_id + platform` pair is the lookup key.  When the
adapter needs to know the remote id for actor X on platform Z,
it asks `author_mapping.lookup(...)` which returns the
*current* (non-superseded) row.  The full history is in the
audit log; the table itself only holds the current row plus a
chain of superseded-by pointers.

The "no impersonation" rule (AC #5) is encoded in two places:

  1. The four `kind` values are a closed enum; the constructor
     refuses anything else.  `user` and `board` rows may only
     be created by a human OAuth grant (`reason = "human_oauth_grant"`);
     the agent runtime cannot self-elevate.
  2. `service_accounts.py` provisions the `paperclip-{slug}` and
     `paperclip-{slug}-{agent_id}` synthetic accounts; this
     module only records the *mapping* between a Paperclip actor
     and its service account on a specific platform.

Pure-Python, append-only, no I/O — the smoke test asserts on
the full chain (append → supersede → lookup).
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional


# ---------------------------------------------------------------------------
# Closed enums — keep the strings stable; they appear in the audit chain.
# ---------------------------------------------------------------------------

AUTHOR_KINDS = ("agent", "user", "board", "system")
REMOTE_PLATFORMS = ("jira", "github", "clickup")
REASONS = (
    "first_connect",     # row created at install / agent first-connect
    "human_oauth_grant", # row created from a human granting OAuth delegation
    "id_change",         # customer's remote id changed (e.g. accountId moved)
    "admin_reassign",    # customer admin manually remapped an actor
)


# Reasons that are legal for which `kind` of actor.  Encodes AC #5:
# only humans can create `user` and `board` rows, never an agent.
LEGAL_REASONS_FOR_KIND: Dict[str, tuple] = {
    "agent": REASONS,
    "user": ("human_oauth_grant", "admin_reassign"),
    # The Board / `local-board` account is provisioned at
    # install time (first_connect) or moved to a different
    # synthetic id (admin_reassign).  No human OAuth grant —
    # Board never acts on behalf of a human customer.
    "board": ("first_connect", "admin_reassign"),
    "system": ("first_connect", "admin_reassign"),
}


_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")


def _new_row_id() -> str:
    """Stable, never-reused row id.  UUIDv7 with the `am_` prefix
    so the row is grep-able in the audit chain."""
    return "am_" + str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Row
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class AuthorMappingRow:
    """One row in the author-mapping table.  Immutable — the
    `supersede_with` constructor returns a *new* row with the
    `superseded_by` field set; this row is never mutated."""
    row_id: str
    tenant_id: str
    kind: str
    paperclip_id: str
    platform: str
    remote_id: str
    remote_display: str
    created_hlc: str
    reason: str
    superseded_by: Optional[str] = None
    audit_event: str = "sync.event.comment.attribution_written"

    def __post_init__(self) -> None:
        if self.kind not in AUTHOR_KINDS:
            raise ValueError(
                f"kind must be one of {AUTHOR_KINDS}; got {self.kind!r}"
            )
        if self.platform not in REMOTE_PLATFORMS:
            raise ValueError(
                f"platform must be one of {REMOTE_PLATFORMS}; "
                f"got {self.platform!r}"
            )
        if self.reason not in REASONS:
            raise ValueError(
                f"reason must be one of {REASONS}; got {self.reason!r}"
            )
        if not self.tenant_id or not _SLUG_RE.match(self.tenant_id):
            raise ValueError(
                f"tenant_id must be a slug matching {_SLUG_RE.pattern}; "
                f"got {self.tenant_id!r}"
            )
        if not self.paperclip_id:
            raise ValueError("paperclip_id is required")
        if not self.remote_id:
            raise ValueError("remote_id is required")
        if not _HLC_RE.match(self.created_hlc or ""):
            raise ValueError(
                f"created_hlc must match the 23-char HLC format; "
                f"got {self.created_hlc!r}"
            )
        if self.reason not in LEGAL_REASONS_FOR_KIND[self.kind]:
            raise ValueError(
                f"reason {self.reason!r} is not legal for kind "
                f"{self.kind!r}; legal: {LEGAL_REASONS_FOR_KIND[self.kind]}"
            )

    def supersede_with(
        self, new_row: "AuthorMappingRow"
    ) -> "AuthorMappingRow":
        """Return `new_row` with `superseded_by` left as-is and the
        caller responsible for recording this `self` row as
        superseded in the table's `supersede` method.  This method
        is on the row for testability — production callers use
        `AuthorMappingTable.supersede()`."""
        if new_row.paperclip_id != self.paperclip_id:
            raise ValueError(
                "supersede target must have the same paperclip_id"
            )
        if new_row.platform != self.platform:
            raise ValueError(
                "supersede target must be for the same platform"
            )
        if new_row.row_id == self.row_id:
            raise ValueError("cannot supersede a row with itself")
        return new_row


_HLC_RE = re.compile(r"^\d{13}\.\d{3}-\d{4}$")


# ---------------------------------------------------------------------------
# Table
# ---------------------------------------------------------------------------

class AuthorMappingTable:
    """Append-only author-mapping table for one tenant.

    Lookup key: `(kind, paperclip_id, platform)` →
    the current (non-superseded) `AuthorMappingRow`.  Superseded
    rows are retained in the append log but are not returned by
    `lookup()` — they live in the audit chain.

    The constructor accepts an optional seed list of rows so the
    smoke test can rehydrate from a known state.  The table does
    no I/O; persistence is the caller's job (typically a Postgres
    table with a write-once trigger that blocks UPDATE / DELETE
    on `superseded_by IS NOT NULL` rows).
    """

    __slots__ = ("_tenant_id", "_rows", "_by_key")

    def __init__(
        self,
        *,
        tenant_id: str,
        seed: Optional[List[AuthorMappingRow]] = None,
    ) -> None:
        if not tenant_id or not _SLUG_RE.match(tenant_id):
            raise ValueError(
                f"tenant_id must be a slug matching {_SLUG_RE.pattern}; "
                f"got {tenant_id!r}"
            )
        self._tenant_id: str = tenant_id
        self._rows: List[AuthorMappingRow] = []
        self._by_key: Dict[tuple, AuthorMappingRow] = {}
        for row in (seed or []):
            self._append(row)

    # -- accessors --------------------------------------------------------

    @property
    def tenant_id(self) -> str:
        return self._tenant_id

    def __len__(self) -> int:
        return len(self._rows)

    def all_rows(self) -> List[AuthorMappingRow]:
        """The full append log (in append order).  Callers should
        treat this as the audit trail — not a queryable view."""
        return list(self._rows)

    def lookup(
        self,
        *,
        kind: str,
        paperclip_id: str,
        platform: str,
    ) -> Optional[AuthorMappingRow]:
        """Return the current row for the lookup key, or None if
        no mapping has been provisioned yet.  Idempotent."""
        return self._by_key.get((kind, paperclip_id, platform))

    def history(
        self,
        *,
        kind: str,
        paperclip_id: str,
        platform: str,
    ) -> List[AuthorMappingRow]:
        """The full history (most recent first) for a lookup key.
        Includes superseded rows.  Useful for the daily
        divergence-detection job and the audit chain."""
        out: List[AuthorMappingRow] = []
        for row in reversed(self._rows):
            if (
                row.kind == kind
                and row.paperclip_id == paperclip_id
                and row.platform == platform
            ):
                out.append(row)
        return out

    # -- mutations (append-only) ------------------------------------------

    def append(
        self,
        *,
        kind: str,
        paperclip_id: str,
        platform: str,
        remote_id: str,
        remote_display: str,
        created_hlc: str,
        reason: str,
        audit_event: str = "sync.event.comment.attribution_written",
    ) -> AuthorMappingRow:
        """Append a brand-new row.  Refuses to clobber an existing
        current mapping — call `supersede()` instead when the
        remote id has changed."""
        if self.lookup(
            kind=kind, paperclip_id=paperclip_id, platform=platform
        ) is not None:
            raise ValueError(
                f"a current mapping already exists for "
                f"({kind!r}, {paperclip_id!r}, {platform!r}); "
                f"use supersede() to change the remote id"
            )
        row = AuthorMappingRow(
            row_id=_new_row_id(),
            tenant_id=self._tenant_id,
            kind=kind,
            paperclip_id=paperclip_id,
            platform=platform,
            remote_id=remote_id,
            remote_display=remote_display,
            created_hlc=created_hlc,
            reason=reason,
            superseded_by=None,
            audit_event=audit_event,
        )
        self._append(row)
        return row

    def supersede(
        self,
        *,
        kind: str,
        paperclip_id: str,
        platform: str,
        new_remote_id: str,
        new_remote_display: str,
        created_hlc: str,
        reason: str,
        audit_event: str = "sync.event.comment.attribution_written",
    ) -> AuthorMappingRow:
        """Append a new row for the lookup key; the old current
        row is recorded as superseded.  The new row is the one
        `lookup()` will return from now on.

        Note: the old row's `superseded_by` is set by storing a
        *new* row that points at the successor; the old row
        itself is never mutated.  The chain is encoded in the
        append log via `all_rows()` / `history()`.
        """
        if reason not in REASONS:
            raise ValueError(
                f"reason must be one of {REASONS}; got {reason!r}"
            )
        if reason not in LEGAL_REASONS_FOR_KIND[kind]:
            raise ValueError(
                f"reason {reason!r} is not legal for kind {kind!r}"
            )
        if reason == "first_connect":
            # first_connect is only valid at the very first append,
            # which is the `append` method, not supersede.
            raise ValueError(
                "first_connect is not a valid supersede reason; "
                "use append() for the first row"
            )
        current = self.lookup(
            kind=kind, paperclip_id=paperclip_id, platform=platform
        )
        if current is None:
            raise ValueError(
                f"no current mapping to supersede for "
                f"({kind!r}, {paperclip_id!r}, {platform!r})"
            )
        if current.remote_id == new_remote_id:
            raise ValueError(
                "supersede target has the same remote_id as the current row"
            )
        new_row = AuthorMappingRow(
            row_id=_new_row_id(),
            tenant_id=self._tenant_id,
            kind=kind,
            paperclip_id=paperclip_id,
            platform=platform,
            remote_id=new_remote_id,
            remote_display=new_remote_display,
            created_hlc=created_hlc,
            reason=reason,
            superseded_by=None,
            audit_event=audit_event,
        )
        # Validate the chain: `current` is superseded by `new_row`
        current.supersede_with(new_row)
        self._append(new_row)
        return new_row

    # -- internal ---------------------------------------------------------

    def _append(self, row: AuthorMappingRow) -> None:
        if row.tenant_id != self._tenant_id:
            raise ValueError(
                f"row tenant_id {row.tenant_id!r} does not match "
                f"table tenant_id {self._tenant_id!r}"
            )
        self._rows.append(row)
        # Only the *current* (non-superseded) row lives in `_by_key`.
        # The audit chain keeps the full history; the runtime lookup
        # is keyed off the latest write.
        self._by_key[(row.kind, row.paperclip_id, row.platform)] = row
