"""
Conflict resolver — Tier 1 / Tier 2 / Tier 3 dispatcher (FORA-254).

Per ADR-0010 §4, the resolver applies the tiers in order:

  Tier 1 (synchronous)  — field-ownership table; remote writes for
                          fields Paperclip owns are rejected on
                          ingest; remote writes for fields the
                          remote owns are accepted immediately.
                          Audit row reason = "field_owner".

  Tier 2 (async LWW)    — for free-text fields (title, body,
                          comment.body, custom fields without an
                          owner) the highest-HLC value wins.  The
                          audit row carries `winner_hlc`,
                          `loser_hlc`, `reason = "hlc_lww"`.

  Tier 3 (degrade)      — when the clock monitor reports >5s skew
                          between two physical timestamps in the
                          event log, Tier 2 is bypassed and the
                          event is routed to the divergence
                          workbench (the customer admin resolves).
                          The resolver's role here is to *not*
                          lose user-visible data: it returns
                          `Resolution.DIVERGED` and the caller
                          parks the event in `sync.divergence_queue`.

The default precedence (ADR-0010 §4 closing paragraph) is
Paperclip > Jira > GitHub > ClickUp for state-machine fields
(`state` / `status`); this is overridable per tenant.

The Tier 2 conflict path is **byte-exact on the canonical store**
(AC #3): the resolver does not re-encode the value; it returns a
`ResolverResult` carrying the winner's *raw bytes* (or pointer
thereto in the production wiring) so the FORA-36 audit chain
hashes the exact same bytes that hit the store.

This module is dependency-free.  The smoke test
(`tests/test_smoke.py`) exercises all three tiers with forged
HLCs and asserts the audit row, the canonical value, and the
HLC pair.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Mapping, Optional, Tuple

from .audit import (
    AuditRow,
    DIVERGENCE_DETECTED,
    DIVERGENCE_RESOLVED_EVENT,
    build_audit_row,
)
from .field_owners import (
    DEFAULT_FIELD_OWNERS,
    DEFAULT_PRECEDENCE,
    FieldOwner,
    FieldOwnershipRule,
    Mirror,
    resolve_field_owner,
    resolve_rule,
)
from .hlc import HLC, parse


# Auto-degrade threshold from ADR-0010 §7.1.  >5s skew between two
# physical timestamps in the event log is the trigger; Tier 2 is
# bypassed and the event is routed to the divergence workbench.
SKEW_THRESHOLD_MS = 5000


class Resolution(str, Enum):
    """How an inbound remote write was resolved."""
    TIER1_ACCEPTED = "tier1_accepted"      # remote owns the field
    TIER1_REJECTED = "tier1_rejected"      # paperclip owns the field
    TIER2_LWW = "tier2_lww"                # HLC LWW applied
    TIER3_DIVERGED = "tier3_diverged"      # parked for human resolution


@dataclass
class ResolverResult:
    """The outcome of one `resolve()` call.  The caller persists
    `canonical_value` to the canonical store, dispatches the
    `mirror_writes` to the outbound adapters, and routes the
    `audit_row` to the FORA-36 forwarder.

    `tier` records which tier fired; the audit row's `reason` is
    derived from it (`field_owner` / `hlc_lww` / `clock_skew`).
    """
    tier: Resolution
    field: str
    canonical_value: Any
    winner_platform: str
    winner_hlc: str
    loser_platform: Optional[str] = None
    loser_hlc: Optional[str] = None
    reason: str = ""
    audit_row: Optional[AuditRow] = None
    # Free-form notes — the divergence workbench (Tier 3) uses this
    # to explain to the human why the event was parked.
    notes: str = ""
    # Outbound mirror-write plan: {platform: value}.  Empty for
    # Tier-1-rejected (we don't mirror a rejected write).
    mirror_writes: Dict[str, Any] = field(default_factory=dict)

    @property
    def is_accepted(self) -> bool:
        """Did the resolver accept the inbound write into the
        canonical store?  Tier 3 diverged writes are *not*
        accepted; they are parked for human resolution."""
        return self.tier in (Resolution.TIER1_ACCEPTED, Resolution.TIER2_LWW)


@dataclass
class Resolver:
    """The stateful resolver: one per (tenant) process.

    `clock`        — the local HLC tick source.  `resolve()` calls
                     `clock.tick()` to stamp the inbound write and
                     `clock.observe()` on the *previous* canonical
                     HLC so the next write is causally after it.
    `overrides`    — per-tenant field-ownership override layer
                     (AC #5 — config flag, not a code change).
    `precedence`   — per-tenant state-machine precedence
                     (AC #5 — config flag).
    `skew_active`  — when True, the clock monitor has flagged
                     >5s skew; Tier 2 is bypassed and every
                     free-text write is routed to Tier 3.  The
                     `clock_monitor` module flips this; the
                     resolver reads it.
    """
    clock: Any                       # sync_plane.hlc.Clock
    tenant_id: str
    actor: str                       # "agent:<id>" / "system:resolver"
    overrides: Optional[Mapping[str, FieldOwnershipRule]] = None
    precedence: Tuple[FieldOwner, ...] = DEFAULT_PRECEDENCE
    skew_active: bool = False        # flipped by ClockMonitor

    def resolve(
        self,
        *,
        field: str,
        inbound_platform: str,         # "paperclip" / "jira" / "github" / "clickup"
        inbound_value: Any,
        inbound_hlc: str,              # the HLC the inbound event carries
        canonical: Optional[Dict[str, Any]] = None,
        # canonical is {"value": ..., "hlc": "...", "platform": "..."}
    ) -> ResolverResult:
        """Resolve one inbound remote write.

        `canonical` is the current canonical value (read from the
        store) or None if this is the first write for the field.
        The resolver either accepts the inbound (Tier 1 or 2),
        rejects it (Tier 1, Paperclip-owned), or diverges it
        (Tier 3, clock skew).
        """
        if not field:
            raise ValueError("field is required")
        if not inbound_platform:
            raise ValueError("inbound_platform is required")
        if not inbound_hlc:
            raise ValueError("inbound_hlc is required")

        # 1. Tier 1 — synchronous field-ownership rule.
        rule = resolve_rule(field, self.overrides)
        owner = rule.owner

        # Paperclip-owned field: reject the inbound write.  The
        # mirror semantics for `assignee_agent_id` is `MIRROR_OUT`
        # which means *we* push to the remote; the inbound reverse
        # mirror is dropped on the floor (with an audit row so the
        # divergence-detection job can see it).
        if owner == FieldOwner.PAPERCLIP:
            notes = (
                f"inbound from {inbound_platform} dropped: field "
                f"{field!r} is paperclip-owned ({rule.notes})"
            )
            audit = build_audit_row(
                event_type=DIVERGENCE_RESOLVED_EVENT,
                tenant_id=self.tenant_id,
                actor=self.actor,
                field=field,
                winner_platform="paperclip",
                loser_platform=inbound_platform,
                winner_hlc=canonical["hlc"] if canonical else self.clock.now_hlc().__str__(),
                loser_hlc=inbound_hlc,
                reason="field_owner",
                metadata={"mirror": rule.mirror.value, "rule": rule.notes},
            )
            return ResolverResult(
                tier=Resolution.TIER1_REJECTED,
                field=field,
                canonical_value=canonical["value"] if canonical else None,
                winner_platform="paperclip",
                winner_hlc=canonical["hlc"] if canonical else GENESIS_FALLBACK,
                loser_platform=inbound_platform,
                loser_hlc=inbound_hlc,
                reason="field_owner",
                audit_row=audit,
                notes=notes,
            )

        # Field is FREE_TEXT (not in the §4 table) — fall through to
        # Tier 2 HLC LWW below.  This check must come BEFORE the
        # strict-ownership check below, because for FREE_TEXT the
        # canonical owner is the highest-HLC writer, not a single
        # platform.
        if owner != FieldOwner.FREE_TEXT:
            # Field is remote-owned (jira / github / clickup).  Two cases:
            #
            #   1. The inbound platform is the canonical owner → accept
            #      immediately.  This is Tier 1's "synchronous" path.
            #
            #   2. The inbound platform is NOT the canonical owner (e.g.
            #      github writes a jira-owned field) → reject.  The
            #      §4 table says "X is canonical"; we treat any other
            #      inbound as a non-canonical write that has to be
            #      mediated by the field owner.
            inbound_owner = _platform_to_owner(inbound_platform)
            if inbound_owner != owner:
                notes = (
                    f"inbound from {inbound_platform} dropped: field "
                    f"{field!r} is owned by {owner.value} ({rule.notes})"
                )
                audit = build_audit_row(
                    event_type=DIVERGENCE_RESOLVED_EVENT,
                    tenant_id=self.tenant_id,
                    actor=self.actor,
                    field=field,
                    winner_platform=owner.value,
                    loser_platform=inbound_platform,
                    winner_hlc=canonical["hlc"] if canonical else self.clock.now_hlc().__str__(),
                    loser_hlc=inbound_hlc,
                    reason="field_owner",
                    metadata={
                        "mirror": rule.mirror.value,
                        "rule": rule.notes,
                        "rejected_non_owner": inbound_platform,
                    },
                )
                return ResolverResult(
                    tier=Resolution.TIER1_REJECTED,
                    field=field,
                    canonical_value=canonical["value"] if canonical else None,
                    winner_platform=owner.value,
                    winner_hlc=canonical["hlc"] if canonical else GENESIS_FALLBACK,
                    loser_platform=inbound_platform,
                    loser_hlc=inbound_hlc,
                    reason="field_owner",
                    audit_row=audit,
                    notes=notes,
                )
            # Accept the inbound; this is Tier 1's owner match path.
            self.clock.observe(parse(inbound_hlc))
            new_hlc = self.clock.now_hlc().__str__()
            audit = build_audit_row(
                event_type=DIVERGENCE_RESOLVED_EVENT,
                tenant_id=self.tenant_id,
                actor=self.actor,
                field=field,
                winner_platform=inbound_platform,
                loser_platform=(canonical["platform"] if canonical else "none"),
                winner_hlc=new_hlc,
                loser_hlc=canonical["hlc"] if canonical else "",
                reason="field_owner",
                metadata={"mirror": rule.mirror.value, "rule": rule.notes},
            )
            return ResolverResult(
                tier=Resolution.TIER1_ACCEPTED,
                field=field,
                canonical_value=inbound_value,
                winner_platform=inbound_platform,
                winner_hlc=new_hlc,
                loser_platform=(canonical["platform"] if canonical else None),
                loser_hlc=canonical["hlc"] if canonical else None,
                reason="field_owner",
                audit_row=audit,
                notes=f"Tier 1: {inbound_platform} owns {field!r}; accepted",
                # Mirror to all other remotes (precedence list minus
                # the winner), so they see the change too.
                mirror_writes=self._mirror_plan_for(
                    field, inbound_value, inbound_platform
                ),
            )

        # 2. Tier 2 — HLC LWW for free-text fields.
        # If the clock monitor is flagging skew, degrade to Tier 3.
        if self.skew_active:
            return self._tier3(field, inbound_platform, inbound_value,
                               inbound_hlc, canonical,
                               reason="clock_skew",
                               notes="clock monitor flagged >5s skew; "
                                     "Tier 2 bypassed to avoid LWW data loss")

        # No prior canonical → first write wins trivially.
        if canonical is None:
            self.clock.observe(parse(inbound_hlc))
            new_hlc = self.clock.now_hlc().__str__()
            audit = build_audit_row(
                event_type=DIVERGENCE_RESOLVED_EVENT,
                tenant_id=self.tenant_id,
                actor=self.actor,
                field=field,
                winner_platform=inbound_platform,
                winner_hlc=new_hlc,
                reason="hlc_lww",
                metadata={"first_write": True},
            )
            return ResolverResult(
                tier=Resolution.TIER2_LWW,
                field=field,
                canonical_value=inbound_value,
                winner_platform=inbound_platform,
                winner_hlc=new_hlc,
                reason="hlc_lww",
                audit_row=audit,
                notes="first write to field; HLC LWW applied trivially",
            )

        # Real LWW: highest HLC wins.
        winner_hlc_str, winner_platform, winner_value, loser_hlc_str, loser_platform = (
            self._lww_decide(inbound_platform, inbound_value, inbound_hlc, canonical)
        )
        # Stamp a fresh local HLC on the winner so the audit chain
        # has a known cause.
        self.clock.observe(parse(winner_hlc_str))
        new_hlc = self.clock.now_hlc().__str__()
        audit = build_audit_row(
            event_type=DIVERGENCE_RESOLVED_EVENT,
            tenant_id=self.tenant_id,
            actor=self.actor,
            field=field,
            winner_platform=winner_platform,
            loser_platform=loser_platform,
            winner_hlc=new_hlc,
            loser_hlc=loser_hlc_str,
            reason="hlc_lww",
            metadata={
                "inbound_hlc": inbound_hlc,
                "prev_canonical_hlc": canonical.get("hlc"),
            },
        )
        # The audit row carries the *fresh* local HLC for the
        # winner (the new chain head); the loser's HLC is the
        # pre-existing HLC so the divergence-detection job can
        # compute the actual lost data.
        return ResolverResult(
            tier=Resolution.TIER2_LWW,
            field=field,
            canonical_value=winner_value,
            winner_platform=winner_platform,
            winner_hlc=new_hlc,
            loser_platform=loser_platform,
            loser_hlc=loser_hlc_str,
            reason="hlc_lww",
            audit_row=audit,
            notes=(
                f"Tier 2 LWW: {winner_platform} ({winner_hlc_str}) beat "
                f"{loser_platform} ({loser_hlc_str})"
            ),
            mirror_writes=self._mirror_plan_for(field, winner_value, winner_platform),
        )

    # -- helpers -----------------------------------------------------------

    def _lww_decide(
        self,
        inbound_platform: str,
        inbound_value: Any,
        inbound_hlc: str,
        canonical: Dict[str, Any],
    ) -> Tuple[str, str, Any, str, str]:
        """Pure LWW.  Returns (winner_hlc, winner_platform, winner_value,
        loser_hlc, loser_platform)."""
        in_h = parse(inbound_hlc)
        can_h = parse(canonical["hlc"])
        if in_h > can_h:
            return (inbound_hlc, inbound_platform, inbound_value,
                    canonical["hlc"], canonical["platform"])
        if in_h < can_h:
            return (canonical["hlc"], canonical["platform"], canonical["value"],
                    inbound_hlc, inbound_platform)
        # HLC tie at the same timestamp: fall through to the
        # precedence list (ADR-0010 §4 closing paragraph).
        inbound_owner = _platform_to_owner(inbound_platform)
        canonical_owner = _platform_to_owner(canonical["platform"])
        if _precedence_rank(self.precedence, inbound_owner) < _precedence_rank(
            self.precedence, canonical_owner
        ):
            return (inbound_hlc, inbound_platform, inbound_value,
                    canonical["hlc"], canonical["platform"])
        return (canonical["hlc"], canonical["platform"], canonical["value"],
                inbound_hlc, inbound_platform)

    def _tier3(
        self,
        field: str,
        inbound_platform: str,
        inbound_value: Any,
        inbound_hlc: str,
        canonical: Optional[Dict[str, Any]],
        *,
        reason: str,
        notes: str,
    ) -> ResolverResult:
        """Park the event in the divergence workbench.  No LWW; the
        human picks the winner.  An audit row is still produced so
        the daily divergence-detection job sees the event."""
        audit = build_audit_row(
            event_type=DIVERGENCE_DETECTED,
            tenant_id=self.tenant_id,
            actor=self.actor,
            field=field,
            winner_platform="",
            loser_platform=inbound_platform,
            winner_hlc="",
            loser_hlc=inbound_hlc,
            reason=reason,
            metadata={
                "diverged_to": "sync.divergence_queue",
                "prev_canonical_hlc": canonical.get("hlc") if canonical else "",
                "prev_canonical_value": canonical.get("value") if canonical else None,
            },
        )
        return ResolverResult(
            tier=Resolution.TIER3_DIVERGED,
            field=field,
            canonical_value=canonical["value"] if canonical else None,
            winner_platform="",
            winner_hlc="",
            loser_platform=inbound_platform,
            loser_hlc=inbound_hlc,
            reason=reason,
            audit_row=audit,
            notes=notes,
        )

    def _mirror_plan_for(
        self, field: str, value: Any, winner_platform: str
    ) -> Dict[str, Any]:
        """The outbound mirror-write plan: every remote platform
        other than the winner gets the new value.  The actual write
        is performed by the platform adapter, not the resolver."""
        return {
            p.value: value
            for p in FieldOwner
            if p != FieldOwner.FREE_TEXT and p.value != winner_platform
        }


# Helpers ----------------------------------------------------------------

GENESIS_FALLBACK = "0000000000000.000-0000"  # matches hlc.GENESIS_HLC


def _platform_to_owner(platform: str) -> FieldOwner:
    """Map a platform string to its `FieldOwner` enum value.  Paperclip
    is its own owner; "jira" / "github" / "clickup" map 1:1."""
    if platform == "paperclip":
        return FieldOwner.PAPERCLIP
    if platform == "jira":
        return FieldOwner.JIRA
    if platform == "github":
        return FieldOwner.GITHUB
    if platform == "clickup":
        return FieldOwner.CLICKUP
    raise ValueError(f"unknown platform: {platform!r}")


def _precedence_rank(precedence: Tuple[FieldOwner, ...], owner: FieldOwner) -> int:
    """Lower rank = higher precedence.  Unknown owners sort last."""
    try:
        return precedence.index(owner)
    except ValueError:
        return len(precedence) + 1


# Functional façade -------------------------------------------------------

def resolve(
    *,
    resolver: Resolver,
    field: str,
    inbound_platform: str,
    inbound_value: Any,
    inbound_hlc: str,
    canonical: Optional[Dict[str, Any]] = None,
) -> ResolverResult:
    """Functional façade.  Equivalent to `resolver.resolve(...)`."""
    return resolver.resolve(
        field=field,
        inbound_platform=inbound_platform,
        inbound_value=inbound_value,
        inbound_hlc=inbound_hlc,
        canonical=canonical,
    )
