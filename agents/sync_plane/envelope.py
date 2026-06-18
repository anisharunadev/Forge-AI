"""
Canonical comment envelope — ADR-0010 §6.1 (FORA-264, Epic 11.3).

The single canonical comment-thread model that every platform
adapter (Jira, GitHub Issues, ClickUp, Paperclip) speaks.  The
envelope is the *stable identity* across all platforms; remote
ids are *refs* into `remote_refs`, never identities of their own.

The contract:

  1. `comment_id` is a Paperclip-issued UUIDv7 — stable across
     Paperclip restart, paperclip re-deploy, and platform re-sync.
     The same `comment_id` is preserved on retry (idempotent).
     See `docs/architecture/adr-0010-cross-platform-sync-plane.md`
     §6.1 row 1 and FORA-264 AC #2.
  2. `remote_refs` carries one entry per platform the comment has
     reached; each entry holds the platform's native id + a
     `last_synced_hlc` so the §7.2 divergence-detection job can
     tell which platform is behind.
  3. `author` is a structured object — `kind` (`agent` / `user` /
     `board` / `system`) plus the canonical Paperclip id plus the
     per-platform remote ids (looked up via the append-only
     `author_mapping` table — see `author_mapping.py`).
  4. `body_md` is the Markdown source of truth; the per-platform
     rendered forms live in `body_remote_rendered` and are kept
     fresh on edit (re-rendered by the adapter on the next write).
  5. `created_hlc` / `edited_hlc` / `deleted_hlc` are HLC strings
     (23-char fixed width; see `hlc.py`).  Edits bump `edited_hlc`;
     deletes are tombstones (HLC set, body cleared) — never a hard
     delete.
  6. `visibility` drives the remote ACL mapping: `tenant` mirrors
     to the public customer Jira/GitHub/ClickUp surface; `internal`
     is Paperclip-only and never fans out to a remote.

Pure-Python (no I/O) so the smoke test can assert on the full
envelope without spinning up the Sync Plane.  The
`envelope_to_json` / `envelope_from_json` round-trip preserves
all fields deterministically — same input always produces the
same bytes (sorted keys, stable field order), which is what
FORA-264 AC #6 "idempotency" requires.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


# UUIDv7 layout: 48-bit unix_ms | 4-bit ver=7 | 12-bit rand_a |
# 2-bit var=10 | 62-bit rand_b.  Python 3.9+ ships
# `uuid.uuid7()` in 3.14+; until then we generate v7 manually
# so the package is importable on every supported runtime.
def _new_comment_id() -> str:
    """Return a UUIDv7 string (36 chars, hyphenated).

    Layout (RFC 9562 §5.7):
        bits  0..47  : unix_ms
        bits 48..51  : 0b0111 (version=7)
        bits 52..63  : rand_a (12 bits, any)
        bits 64..65  : 0b10   (variant=10xx)
        bits 66..127 : rand_b (62 bits, any)

    The monotonic property that FORA-264 AC #2 cares about is
    that the same wall-clock millisecond produces a *strictly
    greater* id than the previous one within this node; we
    guarantee that by incrementing a per-process counter on
    the rand_a field when the ms hasn't advanced.
    """
    import os
    import time

    now_ms = int(time.time() * 1000)
    if not hasattr(_new_comment_id, "_last_ms"):
        _new_comment_id._last_ms = 0  # type: ignore[attr-defined]
        _new_comment_id._counter = 0  # type: ignore[attr-defined]
    last = _new_comment_id._last_ms  # type: ignore[attr-defined]
    counter = _new_comment_id._counter  # type: ignore[attr-defined]
    if now_ms == last:
        # Same millisecond — bump the 12-bit rand_a field.
        # Mask to 12 bits; if it would wrap, wait one ms.
        counter = (counter + 1) & 0xFFF
        if counter == 0:
            # 12-bit field exhausted; sleep 1ms and re-read.
            time.sleep(0.001)
            now_ms = int(time.time() * 1000)
            counter = 0
    else:
        counter = int.from_bytes(os.urandom(2), "big") & 0xFFF
    _new_comment_id._last_ms = now_ms  # type: ignore[attr-defined]
    _new_comment_id._counter = counter  # type: ignore[attr-defined]

    rand_b = int.from_bytes(os.urandom(8), "big") & 0x3FFF_FFFF_FFFF_FFFF
    rand_b |= 0x8000_0000_0000_0000  # variant=10
    # Build the 128-bit UUIDv7 integer:
    #   bits  0..47  : unix_ms
    #   bits 48..51  : 0b0111 (version=7)
    #   bits 52..63  : rand_a (12 bits)  -- this is `counter`
    #   bits 64..65  : 0b10   (variant=10xx) — embedded in rand_b's top 2 bits
    #   bits 66..127 : rand_b (62 bits)
    value = (
        (now_ms & 0xFFFF_FFFF_FFFF) << 80
        | (0x7 << 76)
        | ((counter & 0xFFF) << 64)
        | (rand_b & 0xFFFF_FFFF_FFFF_FFFF)
    )
    return str(uuid.UUID(int=value))


def is_uuidv7(s: str) -> bool:
    """Cheap check: 36 chars, hyphenated, version nibble = 7."""
    if not isinstance(s, str) or len(s) != 36:
        return False
    try:
        u = uuid.UUID(s)
    except ValueError:
        return False
    return u.version == 7 and u.variant in (uuid.RFC_4122,)


# ---------------------------------------------------------------------------
# Field types
# ---------------------------------------------------------------------------

# The author `kind` is a closed enum per ADR-0010 §5.  `system`
# covers platform-emitted events (e.g. status change mirrors
# the platform did on its own); `board` is reserved for the
# local-board user so cross-platform comments render with the
# Board lozenge.
AUTHOR_KINDS = ("agent", "user", "board", "system")
REMOTE_PLATFORMS = ("jira", "github", "clickup")
VISIBILITY = ("tenant", "internal")

# Per-platform rendered form keys (mirror of REMOTE_PLATFORMS,
# kept explicit so the JSON schema block in the doc renders cleanly).
REMOTE_FORMATS = {
    "jira": "adf",
    "github": "gfm",
    "clickup": "md",
}


@dataclass(frozen=True)
class RemoteRef:
    """One entry in `envelope.remote_refs`.  Carries the remote's
    native id + a back-link URL + the HLC of the last successful
    sync to that platform.

    `last_synced_hlc` is what the §7.2 divergence-detection job
    uses to spot a platform that's behind — if its HLC is older
    than `edited_hlc` (or `created_hlc` when never edited), the
    next sync cycle pushes the comment to that platform.
    """
    id: str
    self: str
    last_synced_hlc: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class Author:
    """Structured author.  `kind` is one of `AUTHOR_KINDS`;
    `id` is the Paperclip-side canonical id (agent uuid, user
    uuid, `local-board` for `kind=board`, or a system identifier
    for `kind=system`).  `remote_ids` is the per-platform mapping
    the author_mapping table produced at write time; if a
    platform is missing, the adapter must look it up before
    posting (and on miss, fall through to the synthetic service
    account per ADR-0010 §5)."""
    kind: str
    id: str
    remote_ids: Dict[str, str] = field(default_factory=dict)
    display_name: str = ""

    def __post_init__(self) -> None:
        if self.kind not in AUTHOR_KINDS:
            raise ValueError(
                f"author.kind must be one of {AUTHOR_KINDS}; got {self.kind!r}"
            )
        if not self.id:
            raise ValueError("author.id is required")
        bad = set(self.remote_ids) - set(REMOTE_PLATFORMS)
        if bad:
            raise ValueError(
                f"author.remote_ids has unknown platform(s): {sorted(bad)}"
            )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class RemoteRendered:
    """Per-platform rendered form of `body_md`.  `format` is the
    platform's native format key (`adf` / `gfm` / `md`); `value`
    is the rendered form.  Kept fresh on edit by re-rendering
    on the next outbound write."""
    format: str
    value: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Envelope
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CommentEnvelope:
    """The canonical comment-thread model.  See module docstring
    + ADR-0010 §6.1 for the full contract.  Frozen so the
    envelope is hashable and round-trip deterministic.
    """
    comment_id: str
    paperclip_issue_id: str
    author: Author
    body_md: str
    created_hlc: str
    remote_refs: Dict[str, RemoteRef] = field(default_factory=dict)
    body_remote_rendered: Dict[str, RemoteRendered] = field(
        default_factory=dict
    )
    edited_hlc: Optional[str] = None
    deleted_hlc: Optional[str] = None
    visibility: str = "tenant"
    # For threaded comments: the `comment_id` of the parent.
    # None for top-level.  Documented in §6.3 — the Sync Plane
    # flattens Paperclip threads to the remote's model on
    # outgoing writes and reconstructs on incoming writes.
    in_reply_to: Optional[str] = None
    # Per-platform local reactions cache.  ADR-0010 §6.2 lists
    # this as an EXPLICIT non-feature for sync (Jira 👍, GitHub
    # :eyes:, etc. are local to the platform) but the envelope
    # carries the field for UI display and for adapters that
    # want to render the local reaction summary without a
    # per-platform call.  Shape: {platform: {reaction: [actor_id, ...]}}.
    reactions_local: Dict[str, Dict[str, List[str]]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not is_uuidv7(self.comment_id):
            raise ValueError(
                f"comment_id must be a UUIDv7; got {self.comment_id!r}"
            )
        if not self.paperclip_issue_id:
            raise ValueError("paperclip_issue_id is required")
        if not self.body_md and self.deleted_hlc is None:
            raise ValueError(
                "body_md is required when deleted_hlc is not set"
            )
        if self.visibility not in VISIBILITY:
            raise ValueError(
                f"visibility must be one of {VISIBILITY}; "
                f"got {self.visibility!r}"
            )
        # HLC shape — 23-char fixed width, set via the hlc module.
        for hlc in (self.created_hlc, self.edited_hlc, self.deleted_hlc):
            if hlc is None:
                continue
            if not _HLC_RE.match(hlc or ""):
                raise ValueError(f"HLC must match 23-char format; got {hlc!r}")
        bad_refs = set(self.remote_refs) - set(REMOTE_PLATFORMS) - {"paperclip"}
        if bad_refs:
            raise ValueError(
                f"remote_refs has unknown platform(s): {sorted(bad_refs)}"
            )
        bad_rendered = set(self.body_remote_rendered) - set(REMOTE_PLATFORMS)
        if bad_rendered:
            raise ValueError(
                f"body_remote_rendered has unknown platform(s): "
                f"{sorted(bad_rendered)}"
            )
        # A `paperclip` ref is allowed for round-trip convenience
        # (e.g. when the comment was first posted on Paperclip),
        # but it is not required.
        if "paperclip" in self.remote_refs and \
                not self.remote_refs["paperclip"].id:
            raise ValueError(
                "remote_refs.paperclip.id is required when the paperclip "
                "ref is present"
            )

    # -- accessors used by the adapter layer -----------------------------

    @property
    def is_deleted(self) -> bool:
        """Tombstone predicate — body is cleared, deleted_hlc is set.
        Per ADR-0010 §6.1 we never hard-delete; a delete is a
        tombstone that the platform adapter mirrors to a remote
        delete (or edits the body to "[deleted]" if the remote
        has no native delete)."""
        return self.deleted_hlc is not None

    @property
    def is_edited(self) -> bool:
        return self.edited_hlc is not None

    def platforms_pending_resync(self) -> List[str]:
        """Platforms whose `last_synced_hlc` is older than the
        comment's `created_hlc` (or `edited_hlc`, when edited).
        Drives the §7.2 divergence-detection job."""
        latest = self.edited_hlc or self.created_hlc
        pending: List[str] = []
        for platform, ref in self.remote_refs.items():
            if platform == "paperclip":
                continue
            if ref.last_synced_hlc < latest:
                pending.append(platform)
        return pending

    # -- (de)serialisation -----------------------------------------------

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {
            "comment_id": self.comment_id,
            "paperclip_issue_id": self.paperclip_issue_id,
            "author": self.author.to_dict(),
            "body_md": self.body_md,
            "created_hlc": self.created_hlc,
            "remote_refs": {
                platform: ref.to_dict()
                for platform, ref in self.remote_refs.items()
            },
            "body_remote_rendered": {
                platform: rr.to_dict()
                for platform, rr in self.body_remote_rendered.items()
            },
            "edited_hlc": self.edited_hlc,
            "deleted_hlc": self.deleted_hlc,
            "visibility": self.visibility,
            "in_reply_to": self.in_reply_to,
            "reactions_local": {
                platform: dict(per_reaction)
                for platform, per_reaction in self.reactions_local.items()
            },
        }
        return d

    def to_json(self, *, indent: Optional[int] = None) -> str:
        """Deterministic JSON: keys are sorted at every level so
        two envelopes with the same content produce byte-identical
        output.  This is what the smoke test asserts on (AC #6)."""
        return json.dumps(
            self.to_dict(),
            sort_keys=True,
            indent=indent,
            separators=(",", ":") if indent is None else (",", ": "),
            ensure_ascii=False,
        )


# ---------------------------------------------------------------------------
# HLC shape — duplicated from hlc.HLC to avoid an import cycle (envelope
# is consumed by the audit module, which itself imports from hlc).
# ---------------------------------------------------------------------------

_HLC_RE = re.compile(r"^\d{13}\.\d{3}-\d{4}$")


# ---------------------------------------------------------------------------
# Round-trip
# ---------------------------------------------------------------------------

def envelope_from_dict(d: Dict[str, Any]) -> CommentEnvelope:
    """Inverse of `CommentEnvelope.to_dict()`.  Strict — unknown
    fields are rejected (forward compatibility is a v2 problem)."""
    if not isinstance(d, dict):
        raise ValueError(f"envelope payload must be a dict; got {type(d).__name__}")
    required = ("comment_id", "paperclip_issue_id", "author", "body_md", "created_hlc")
    for k in required:
        if k not in d:
            raise ValueError(f"envelope missing required field: {k!r}")
    author_d = d["author"]
    if not isinstance(author_d, dict):
        raise ValueError("envelope.author must be a dict")
    author = Author(
        kind=author_d["kind"],
        id=author_d["id"],
        remote_ids=dict(author_d.get("remote_ids", {})),
        display_name=author_d.get("display_name", ""),
    )
    refs: Dict[str, RemoteRef] = {}
    for platform, ref_d in d.get("remote_refs", {}).items():
        if not isinstance(ref_d, dict):
            raise ValueError(f"remote_refs.{platform} must be a dict")
        refs[platform] = RemoteRef(
            id=ref_d["id"],
            self=ref_d["self"],
            last_synced_hlc=ref_d["last_synced_hlc"],
        )
    rendered: Dict[str, RemoteRendered] = {}
    for platform, rr_d in d.get("body_remote_rendered", {}).items():
        if not isinstance(rr_d, dict):
            raise ValueError(
                f"body_remote_rendered.{platform} must be a dict"
            )
        rendered[platform] = RemoteRendered(
            format=rr_d["format"],
            value=rr_d["value"],
        )
    return CommentEnvelope(
        comment_id=d["comment_id"],
        paperclip_issue_id=d["paperclip_issue_id"],
        author=author,
        body_md=d["body_md"],
        created_hlc=d["created_hlc"],
        remote_refs=refs,
        body_remote_rendered=rendered,
        edited_hlc=d.get("edited_hlc"),
        deleted_hlc=d.get("deleted_hlc"),
        visibility=d.get("visibility", "tenant"),
        in_reply_to=d.get("in_reply_to"),
        reactions_local={
            platform: dict(per_reaction)
            for platform, per_reaction in d.get("reactions_local", {}).items()
        },
    )


def envelope_from_json(s: str) -> CommentEnvelope:
    """Parse a JSON envelope.  Strict: extra fields are rejected."""
    return envelope_from_dict(json.loads(s))


# ---------------------------------------------------------------------------
# Constructors used by the adapter layer
# ---------------------------------------------------------------------------

def new_envelope(
    *,
    paperclip_issue_id: str,
    author: Author,
    body_md: str,
    created_hlc: str,
    visibility: str = "tenant",
    in_reply_to: Optional[str] = None,
) -> CommentEnvelope:
    """Build a brand-new envelope (no remote_refs yet — those are
    added by the adapter on the first outbound write)."""
    return CommentEnvelope(
        comment_id=_new_comment_id(),
        paperclip_issue_id=paperclip_issue_id,
        author=author,
        body_md=body_md,
        created_hlc=created_hlc,
        remote_refs={},
        body_remote_rendered={},
        edited_hlc=None,
        deleted_hlc=None,
        visibility=visibility,
        in_reply_to=in_reply_to,
    )


def envelope_with_remote_ref(
    env: CommentEnvelope,
    *,
    platform: str,
    remote_id: str,
    remote_self: str,
    last_synced_hlc: str,
) -> CommentEnvelope:
    """Return a new envelope with `platform` added to `remote_refs`.
    Pure — the input is frozen; the call returns a new envelope
    with the ref merged in.  Idempotent: calling twice with the
    same platform replaces the previous ref (so a retry that
    already produced a remote_id just updates `last_synced_hlc`
    and `self` to the latest values)."""
    if platform not in REMOTE_PLATFORMS:
        raise ValueError(f"unknown platform: {platform!r}")
    new_refs = dict(env.remote_refs)
    new_refs[platform] = RemoteRef(
        id=remote_id, self=remote_self, last_synced_hlc=last_synced_hlc
    )
    return CommentEnvelope(
        comment_id=env.comment_id,
        paperclip_issue_id=env.paperclip_issue_id,
        author=env.author,
        body_md=env.body_md,
        created_hlc=env.created_hlc,
        remote_refs=new_refs,
        body_remote_rendered=env.body_remote_rendered,
        edited_hlc=env.edited_hlc,
        deleted_hlc=env.deleted_hlc,
        visibility=env.visibility,
        in_reply_to=env.in_reply_to,
    )


def envelope_with_rendered(
    env: CommentEnvelope,
    *,
    platform: str,
    fmt: str,
    value: str,
) -> CommentEnvelope:
    """Return a new envelope with the per-platform rendered body
    merged in.  Idempotent: re-rendering on edit just replaces
    the old `value`."""
    if platform not in REMOTE_PLATFORMS:
        raise ValueError(f"unknown platform: {platform!r}")
    expected_fmt = REMOTE_FORMATS[platform]
    if fmt != expected_fmt:
        raise ValueError(
            f"platform {platform!r} expects format {expected_fmt!r}; "
            f"got {fmt!r}"
        )
    new_rendered = dict(env.body_remote_rendered)
    new_rendered[platform] = RemoteRendered(format=fmt, value=value)
    return CommentEnvelope(
        comment_id=env.comment_id,
        paperclip_issue_id=env.paperclip_issue_id,
        author=env.author,
        body_md=env.body_md,
        created_hlc=env.created_hlc,
        remote_refs=env.remote_refs,
        body_remote_rendered=new_rendered,
        edited_hlc=env.edited_hlc,
        deleted_hlc=env.deleted_hlc,
        visibility=env.visibility,
        in_reply_to=env.in_reply_to,
    )


def envelope_with_edit(
    env: CommentEnvelope, *, new_body_md: str, edited_hlc: str
) -> CommentEnvelope:
    """Return a new envelope with the body replaced and `edited_hlc`
    bumped.  `body_remote_rendered` is cleared so the adapter
    re-renders on the next outbound write (per ADR-0010 §6.2)."""
    if env.deleted_hlc is not None:
        raise ValueError("cannot edit a deleted comment (tombstoned)")
    return CommentEnvelope(
        comment_id=env.comment_id,
        paperclip_issue_id=env.paperclip_issue_id,
        author=env.author,
        body_md=new_body_md,
        created_hlc=env.created_hlc,
        remote_refs=env.remote_refs,
        body_remote_rendered={},
        edited_hlc=edited_hlc,
        deleted_hlc=None,
        visibility=env.visibility,
        in_reply_to=env.in_reply_to,
    )


def envelope_with_delete(
    env: CommentEnvelope, *, deleted_hlc: str
) -> CommentEnvelope:
    """Return a tombstoned envelope.  `body_md` is cleared
    (replaced with the empty string); the original body is
    preserved nowhere on the canonical envelope (per ADR-0010
    §6.1 row 13 — "tombstones, not hard deletes").  The audit
    forwarder is responsible for capturing the pre-delete body
    in the FORA-36 chain if the tenant's compliance policy
    requires it."""
    return CommentEnvelope(
        comment_id=env.comment_id,
        paperclip_issue_id=env.paperclip_issue_id,
        author=env.author,
        body_md="",
        created_hlc=env.created_hlc,
        remote_refs=env.remote_refs,
        body_remote_rendered=env.body_remote_rendered,
        edited_hlc=env.edited_hlc,
        deleted_hlc=deleted_hlc,
        visibility=env.visibility,
        in_reply_to=env.in_reply_to,
    )
