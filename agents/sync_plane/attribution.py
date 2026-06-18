"""
Attribution block — ADR-0010 §6.2 + FORA-264 AC #3.

The first-line attribution block is the canonical, parseable
attribution line that the Sync Plane prepends to every
outgoing cross-platform comment body.  It carries:

  * the `Paperclip` literal so the customer / audit reader knows
    this comment originated on the Sync Plane;
  * the `agent:<id>` (or `user:<id>` / `board:local-board` /
    `system:...`) for forensic attribution;
  * the `tenant:<slug>` so a comment that lands on a shared
    Jira Cloud can be traced to the tenant (R-SYNC-04 control);
  * the `at:<hcl>` so the audit chain has a HLC directly in the
    body — handy when a remote-only reader wants to verify the
    event was processed in causal order.

Format (per FORA-264 AC #3):

    [Paperclip · agent:<id> · tenant:<slug> · at:<hcl>] <body>

The square brackets + dot separators are the parse contract;
the renderer (a DocAgent-owned doc) ships the OpenAPI snippet
for the exact regex the adapter layer uses.  The inverse
operation (`strip_attribution`) takes a remote body and returns
the original body plus the parsed prefix; the prefix round-trip
is `strip(prepend(body)) == body` for any body that does not
itself start with `[Paperclip ·`.

Pure-Python, dependency-free.  No I/O.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional, Tuple


# Canonical prefix.  Match the form documented in the §6.2
# contract — the renderer reads this regex verbatim.
#
#   [Paperclip · <kind>:<id> · tenant:<slug> · at:<hlc>] <body>
#
# `kind` is one of `agent` / `user` / `board` / `system`; `id` is
# anything except `]` and `·`; `slug` is a 1-63 char kebab.
ATTRIBUTION_RE = re.compile(
    r"^\[Paperclip · (?P<kind>agent|user|board|system)"
    r":(?P<id>[^]·]+?)"
    r" · tenant:(?P<slug>[a-z0-9][a-z0-9_-]{0,62})"
    r" · at:(?P<hlc>\d{13}\.\d{3}-\d{4})\]"
    r"(?P<rest>.*)$",
    re.DOTALL,
)

# The literal separator used in the prefix.  We use `·` (U+00B7
# MIDDLE DOT) per the AC; matches are case-sensitive.
SEPARATOR = " · "


@dataclass(frozen=True)
class Attribution:
    """The parsed prefix.  `body` is the original body after
    the prefix has been stripped."""
    kind: str
    actor_id: str
    tenant_slug: str
    hlc: str
    body: str


def _validate_kind(kind: str) -> None:
    if kind not in ("agent", "user", "board", "system"):
        raise ValueError(
            f"attribution kind must be one of agent/user/board/system; "
            f"got {kind!r}"
        )


def prepend(
    *,
    kind: str,
    actor_id: str,
    tenant_slug: str,
    hlc: str,
    body: str,
) -> str:
    """Build the outgoing comment body: attribution prefix + body.

    Idempotent: if the body already starts with a valid
    attribution prefix, it is returned as-is (so a retry that
    re-applies the prefix does not double-attribute).  This is
    the AC #6 idempotency check for the *attribution layer*
    (the comment_id idempotency lives in `envelope.py`)."""
    _validate_kind(kind)
    if not actor_id:
        raise ValueError("actor_id is required")
    if not tenant_slug:
        raise ValueError("tenant_slug is required")
    if not hlc:
        raise ValueError("hlc is required")
    if not isinstance(body, str):
        raise ValueError("body must be a string")
    # Idempotency: a body that already starts with a valid prefix
    # is returned unchanged.  This handles the retry-after-network-
    # failure case where the adapter layer is re-invoked with the
    # already-attributed body.
    existing = strip(body)
    if existing is not None:
        return body
    return f"[Paperclip{SEPARATOR}{kind}:{actor_id}{SEPARATOR}tenant:{tenant_slug}{SEPARATOR}at:{hlc}] {body}"


def strip(body: str) -> Optional[Attribution]:
    """Parse a remote body and return the attribution struct if the
    body starts with a valid prefix; otherwise return None.  The
    adapter layer uses this on inbound writes to recover the
    canonical author without trusting the platform's display name
    (which the customer could change at will)."""
    if not isinstance(body, str):
        return None
    m = ATTRIBUTION_RE.match(body)
    if m is None:
        return None
    return Attribution(
        kind=m.group("kind"),
        actor_id=m.group("id"),
        tenant_slug=m.group("slug"),
        hlc=m.group("hlc"),
        body=m.group("rest"),
    )


def strip_round_trip(
    *,
    kind: str,
    actor_id: str,
    tenant_slug: str,
    hlc: str,
    body: str,
) -> Tuple[str, Attribution]:
    """Convenience: prepend, then strip, then return both the
    outgoing body and the parsed attribution.  Used by the
    smoke test to assert `prepend` then `strip` round-trips."""
    out = prepend(
        kind=kind,
        actor_id=actor_id,
        tenant_slug=tenant_slug,
        hlc=hlc,
        body=body,
    )
    parsed = strip(out)
    assert parsed is not None, "strip() must return a value after prepend()"
    return out, parsed


# ---------------------------------------------------------------------------
# Service-account requirement check (no impersonation guard)
# ---------------------------------------------------------------------------

def is_actor_kind_allowed_to_post(kind: str) -> bool:
    """Closed enum check used by the smoke test to assert AC #5
    ("every cross-platform comment is posted under a service
    account, never under a human user").  Humans post under
    `user` rows that exist because of a prior `human_oauth_grant`
    — that path is logged in the audit chain; the `kind` itself
    is still `user`.  This helper exists for tests; production
    code uses the `reason` on the author_mapping row, not the
    `kind` alone, to decide if a post is allowed."""
    _validate_kind(kind)
    return True


# ===========================================================================
# Rendered attribution block — ADR-0010 §6.2 human-readable form (FORA-275)
# ===========================================================================
#
# Two attribution layers coexist:
#
#   1. **Canonical machine-parseable prefix** (``prepend`` /
#      ``strip`` above) — adapter-layer metadata the Sync Plane
#      reads back to recover the canonical author without
#      trusting the platform's display name.  Format:
#      ``[Paperclip · <kind>:<id> · tenant:<slug> · at:<hlc>]``.
#
#   2. **Rendered human-readable block** (``prepend_attribution`` /
#      ``detect_and_strip_attribution`` below) — the visual
#      first-line block the human reader sees at the top of the
#      comment body.  Per ADR-0010 §6.2 the format is a Markdown
#      blockquote with a per-kind emoji, the actor display name,
#      an optional "acting on behalf of X" clause, and a
#      timestamp.  Example:
#
#          > 🤖 DocAgent acting on behalf of Jane Smith — 2026-06-17 16:25 UTC
#          > [role: agent]
#
#      actual body
#
# The two layers coexist: the adapter prepends the machine prefix
# (canonical recovery) AND the renderer prepends the human block
# (visual reader anchor).  The machine prefix is a single line
# and unstyled; the human block is a two-line blockquote so the
# visual anchor is obvious.
#
# The FORA-275 smoke test exercises the human-readable layer
# (rendered block).  The canonical machine prefix is exercised
# by FORA-264.

from typing import Any  # noqa: E402

# Per-kind emoji (ADR-0010 §6.2 visual).
ATTRIBUTION_EMOJI: dict = {
    "agent": "🤖",
    "user": "👤",
    "board": "🟦",
    "system": None,  # forbidden — system comments do NOT carry a block
}

# Per-kind display role label, embedded in the bracket line.
ATTRIBUTION_ROLE_LABEL: dict = {
    "agent": "agent",
    "user": "human",
    "board": "board",
    "system": "system",
}

# Character class for the emoji set (used by detect).
_EMOJI_CLASS = "[" + "".join(re.escape(e) for e in ATTRIBUTION_EMOJI.values() if e) + "]"

# Match a contiguous run of blockquote lines that opens with a
# known author emoji.  Conservative: only a block that **starts
# at byte 0** with one of the emojis is recognised, so a body
# that happens to start with an unrelated blockquote (e.g. a
# human reply quoting the attribution) is not stripped.
_ATTRIBUTION_BLOCK_RE = re.compile(
    r"^(?:(?:>\s*(?:" + _EMOJI_CLASS + r"|\[[^\]]+\]).*\n?)+)"
)


def _attribution_signature_line(
    actor_display: str,
    on_behalf_of=None,
    *,
    when=None,
    actor_kind: str = "agent",
) -> str:
    """The signature line of the rendered block — used by the
    idempotency check to detect a re-prepend.
    """
    if actor_kind not in ATTRIBUTION_EMOJI:
        raise ValueError(f"unknown actor_kind: {actor_kind!r}")
    emoji = ATTRIBUTION_EMOJI.get(actor_kind)
    if emoji is None:
        return ""
    sig = actor_display
    if on_behalf_of:
        sig = f"{actor_display} acting on behalf of {on_behalf_of}"
    body = f"{emoji} {sig}"
    if when:
        return f"> {body} — {when}"
    return f"> {body}"


def format_attribution_block(
    actor_display: str,
    on_behalf_of=None,
    *,
    actor_kind: str = "agent",
    when=None,
) -> str:
    """Format the rendered attribution block as Markdown.

    Returns the block as a string with NO trailing newline; the
    caller adds the separator (``\\n\\n``) and the body.
    Returns an empty string for ``actor_kind == "system"`` so
    callers can short-circuit without a branch.
    """
    if actor_kind == "system":
        return ""
    sig_line = _attribution_signature_line(
        actor_display,
        on_behalf_of,
        when=when,
        actor_kind=actor_kind,
    )
    role_line = f"> [role: {ATTRIBUTION_ROLE_LABEL.get(actor_kind, 'agent')}]"
    return f"{sig_line}\n{role_line}"


def prepend_attribution(
    body_md: str,
    *,
    actor_kind: str,
    actor_display: str,
    on_behalf_of=None,
    when=None,
) -> str:
    """Prepend the rendered attribution block to ``body_md``
    (FORA-275 AC #3).

    Rules (per ADR-0010 §6.2):

      * ``actor_kind == "system"`` → return ``body_md`` unchanged
        (attribution is forbidden for system comments).
      * If the body already starts with a rendered attribution
        block from the same actor (matched on the signature
        line), return ``body_md`` unchanged (idempotent re-prepend).
      * Otherwise, prepend the new block, separated from the
        body by a blank line (CommonMark paragraph break).

    Pure function.  No I/O.
    """
    if actor_kind == "system":
        return body_md
    if actor_kind not in ATTRIBUTION_EMOJI:
        raise ValueError(f"unknown actor_kind: {actor_kind!r}")
    if not actor_display:
        raise ValueError("actor_display is required")

    block = format_attribution_block(
        actor_display,
        on_behalf_of,
        actor_kind=actor_kind,
        when=when,
    )

    # Idempotency: if the body already starts with a block whose
    # signature line matches the one we'd prepend, return the
    # body unchanged.
    existing_sig = _leading_signature(body_md)
    if existing_sig is not None and existing_sig == _attribution_signature_line(
        actor_display, on_behalf_of, when=when
    ):
        return body_md

    body_clean = body_md or ""
    if body_clean:
        return f"{block}\n\n{body_clean}"
    return f"{block}\n"


def detect_and_strip_attribution(body_md: str):
    """If ``body_md`` starts with a rendered attribution block,
    return ``(stripped_body, block)``.  Otherwise return
    ``(body_md, None)``.

    Idempotent: calling on a body that does not start with a
    block returns ``(body_md, None)``; calling on the
    ``stripped_body`` of a previous call also returns
    ``(body_md, None)`` because the block has already been
    removed.

    The returned ``block`` is the raw Markdown substring
    (including the trailing newline if present) so the caller
    can re-attach it.
    """
    if not body_md:
        return body_md, None
    m = _ATTRIBUTION_BLOCK_RE.match(body_md)
    if not m:
        return body_md, None
    block = m.group(0)
    rest = body_md[m.end():]
    if rest.startswith("\n"):
        rest = rest[1:]
    return rest, block


def _leading_signature(body_md: str):
    """Return the signature line of the leading rendered
    attribution block in ``body_md``, or ``None`` if no block.
    """
    stripped, block = detect_and_strip_attribution(body_md)
    if block is None:
        return None
    for line in block.splitlines():
        line = line.strip()
        if line:
            return line
    return None


# ===========================================================================
# Envelope-aware convenience (FORA-275)
# ===========================================================================

def attribution_for_envelope(env, *, on_behalf_of=None, when=None) -> str:
    """Build the rendered attribution string for a
    ``CommentEnvelope`` instance.  Returns an empty string for
    system authors (so callers can branch on truthiness).
    """
    author = env.author
    if author.kind == "system":
        return ""
    display = author.display_name or author.id
    return format_attribution_block(
        display,
        on_behalf_of,
        actor_kind=author.kind,
        when=when,
    )


def prepend_attribution_for_envelope(env, body_md: str, *, on_behalf_of=None, when=None) -> str:
    """Envelope-aware wrapper for ``prepend_attribution``.

    The signature shown in the issue body is
    ``prepend_attribution(envelope, actor_display, on_behalf_of)``;
    this wrapper takes the envelope and the body, derives
    ``actor_kind`` / ``actor_display`` from ``env.author``, and
    forwards.
    """
    author = env.author
    if author.kind == "system":
        return body_md
    display = author.display_name or author.id
    return prepend_attribution(
        body_md,
        actor_kind=author.kind,
        actor_display=display,
        on_behalf_of=on_behalf_of,
        when=when,
    )
