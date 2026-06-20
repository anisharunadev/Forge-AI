"""
Field-ownership table — ADR-0010 §4 (Tier 1).

The Tier 1 resolver is *synchronous* and *per-field*: for every
incoming remote write, we look up the field in the ownership table
and either accept the write (we don't own the field) or reject
the write (we own the field; the remote mirror is a reverse-mirror
that we'll ignore on the way in).

The table is **the single source of truth** and lives in the Sync
Plane config — `agents/sync_plane/field_owners.DEFAULT_FIELD_OWNERS`
is the shipped default; per-tenant overrides are layered on top in
`Resolver(tenant_overrides=...)` without code changes (AC #5).

Per ADR-0010 §4 the default precedence for **state-machine fields**
is `paperclip > jira > github > clickup`, overridable per tenant.

The mirror semantics for each field are encoded on the rule so the
Tier 1 resolver can drive both:

  * inbound: should this remote write be accepted?
  * outbound: when the canonical owner changes, which remotes
    get the mirror write?

The `FieldOwner` enum is the four platform owners; "FREE_TEXT" is
a sentinel for fields that are not in the table and therefore
fall through to Tier 2 (HLC LWW).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Dict, Mapping, Optional, Tuple


class FieldOwner(str, Enum):
    """The canonical owner of a field.  Per ADR-0010 §4."""
    PAPERCLIP = "paperclip"
    JIRA = "jira"
    GITHUB = "github"
    CLICKUP = "clickup"
    # Sentinel: the field is not in the table; resolver falls through
    # to Tier 2 (HLC LWW).  Never persisted as the canonical owner.
    FREE_TEXT = "free_text"


# Default precedence across state-machine fields (ADR-0010 §4
# closing paragraph).  "lower number wins".  Per-tenant overrides
# can re-order this list.
DEFAULT_PRECEDENCE: Tuple[FieldOwner, ...] = (
    FieldOwner.PAPERCLIP,
    FieldOwner.JIRA,
    FieldOwner.GITHUB,
    FieldOwner.CLICKUP,
)


# Mirror semantics from ADR-0010 §4 table.  Comments are in the
# table at the bottom; the dataclass captures them as a single
# `mirror` string so the resolver can pass it through to the
# outbound adapter and the daily divergence job can pattern-match.
class Mirror(str, Enum):
    READ_ONLY = "read_only_on_remote"          # remote cannot edit
    MIRROR_OUT = "mirror_to_remote"            # paperclip pushes
    MIRROR_IN = "remote_is_canonical"          # paperclip pulls
    FREE_TEXT = "free_text_hlc_lww"            # Tier 2 territory
    PER_PLATFORM = "per_platform_owner"        # state-machine


@dataclass(frozen=True)
class FieldOwnershipRule:
    """One row of the field-ownership table."""
    field: str
    owner: FieldOwner
    mirror: Mirror
    notes: str = ""


# The shipped default table.  Two things to note:
#
#   1. The §4 table in the ADR uses `paperclip.run_id` style
#      qualified names; we strip the platform prefix because the
#      resolver is keyed off the logical field name and the
#      platform is implied by the rule's owner column.
#
#   2. `state` and `status` are *per-platform owner* (no global
#      winner) per ADR-0010 §4 row 6.  They are still in the
#      table so the resolver can recognise them and route to the
#      per-platform mirror logic; the precedence list is only
#      applied for cross-platform state-machine tie-breaks
#      (e.g. closing the same issue from two platforms at once).
DEFAULT_FIELD_OWNERS: Dict[str, FieldOwnershipRule] = {
    r.field: r
    for r in [
        # Paperclip-owned (read-only on remote; remotes cannot edit)
        FieldOwnershipRule(
            "run_id", FieldOwner.PAPERCLIP, Mirror.READ_ONLY,
            "ADR-0010 §4 row 1; remotes cannot edit a Paperclip run id"),
        FieldOwnershipRule(
            "run_status", FieldOwner.PAPERCLIP, Mirror.READ_ONLY,
            "ADR-0010 §4 row 1; remotes cannot edit a Paperclip run status"),
        FieldOwnershipRule(
            "run_events", FieldOwner.PAPERCLIP, Mirror.READ_ONLY,
            "ADR-0010 §4 row 1; remotes cannot edit the run event log"),
        FieldOwnershipRule(
            "assignee_agent_id", FieldOwner.PAPERCLIP, Mirror.MIRROR_OUT,
            "ADR-0010 §4 row 2; mirror to remote assignee with "
            "last_editor=platform:<remote> tag on reverse-mirror"),
        # Jira-owned (or clickup equivalent) — paperclip reads
        FieldOwnershipRule(
            "sprint", FieldOwner.JIRA, Mirror.MIRROR_IN,
            "ADR-0010 §4 row 3; canonical on Jira; clipup equivalent honored"),
        FieldOwnershipRule(
            "story_points", FieldOwner.JIRA, Mirror.MIRROR_IN,
            "ADR-0010 §4 row 3"),
        FieldOwnershipRule(
            "epic_link", FieldOwner.JIRA, Mirror.MIRROR_IN,
            "ADR-0010 §4 row 3"),
        # GitHub-owned
        FieldOwnershipRule(
            "github_labels", FieldOwner.GITHUB, Mirror.MIRROR_IN,
            "ADR-0010 §4 row 4"),
        FieldOwnershipRule(
            "github_milestone", FieldOwner.GITHUB, Mirror.MIRROR_IN,
            "ADR-0010 §4 row 4"),
        # State-machine fields — per ADR-0010 §4 row 6 these are
        # per-platform owners (no global winner); the precedence
        # list applies only on cross-platform ties.
        FieldOwnershipRule(
            "state", FieldOwner.PAPERCLIP, Mirror.PER_PLATFORM,
            "ADR-0010 §4 row 6; open/closed/done; per-platform owner; "
            "precedence on cross-platform ties"),
        FieldOwnershipRule(
            "status", FieldOwner.PAPERCLIP, Mirror.PER_PLATFORM,
            "ADR-0010 §4 row 6; workflow status; per-platform owner; "
            "precedence on cross-platform ties"),
    ]
}


def resolve_field_owner(
    field: str,
    overrides: Optional[Mapping[str, FieldOwnershipRule]] = None,
) -> FieldOwner:
    """Look up the canonical owner of a field.  Returns
    `FieldOwner.FREE_TEXT` if the field is not in the table (the
    resolver will then fall through to Tier 2 HLC LWW).

    `overrides` is the per-tenant layer; rows present in
    `overrides` replace rows in `DEFAULT_FIELD_OWNERS`.  Per the
    AC #5 bar, the override is a config flag, not a code change.
    """
    if overrides and field in overrides:
        return overrides[field].owner
    rule = DEFAULT_FIELD_OWNERS.get(field)
    if rule is None:
        return FieldOwner.FREE_TEXT
    return rule.owner


def resolve_rule(
    field: str,
    overrides: Optional[Mapping[str, FieldOwnershipRule]] = None,
) -> FieldOwnershipRule:
    """Look up the full rule (owner + mirror + notes) for a field.
    Returns a FREE_TEXT rule if the field is not in the table."""
    if overrides and field in overrides:
        return overrides[field]
    rule = DEFAULT_FIELD_OWNERS.get(field)
    if rule is None:
        return FieldOwnershipRule(
            field=field, owner=FieldOwner.FREE_TEXT, mirror=Mirror.FREE_TEXT,
            notes="not in default table; resolver falls through to Tier 2 HLC LWW",
        )
    return rule
