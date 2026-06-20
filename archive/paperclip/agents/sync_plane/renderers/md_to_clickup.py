"""Markdown -> ClickUp-flavored Markdown renderer (FORA-275).

ClickUp's comment Markdown is the closest of the three platforms
to GFM, with two notable extensions:

  1. **Mention syntax** — ClickUp uses ``@[Name](user_id)`` for
     @-mentions, not GitHub's bare ``@name``.  The renderer's
     job is to rewrite Markdown's ``@name`` (when a known
     ``user_id`` is available via the envelope's
     ``author_mapping``) into ClickUp's form.  When no mapping
     is present, the ``@`` is preserved as a bare mention
     (ClickUp falls back to a notification search).

  2. **Custom checkboxes** — ClickUp uses ``[ ]`` and ``[x]``
     identically to GFM; no transformation needed.

Round-trip: identity with the same normalisation pass used by
``md_to_gfm`` (one normaliser, two front-doors — keeps the
assertion shape simple: ``render_to_clickup(body_md) ==
clickup_normalise(body_md)``).

Like ``md_to_gfm``, the renderer is a function and a
normalisation pass — ClickUp's flavor is small enough that the
"render" step is the rewrite + sanitise + normalise.
"""

from __future__ import annotations

import re
from typing import Optional

from ._normalize import normalise_markdown, strip_raw_html

# A pre-compiled pattern for the rewritten mention so callers can
# audit / strip mentions if needed (the threading module does
# this when reconstructing Paperclip threads).
CLICKUP_MENTION_PATTERN = re.compile(
    r"@\[(?P<label>[A-Za-z0-9_\-\. ]{1,64})\]\(user:(?P<user_id>[A-Za-z0-9_\-]{1,64})\)"
)


def render_to_clickup(
    body_md: str,
    *,
    mention_resolver: Optional["MentionResolver"] = None,
) -> str:
    """Render ``body_md`` to a normalised ClickUp-flavored Markdown
    string.

    ``mention_resolver`` is the optional callback the adapter
    uses to map ``@name`` -> ``(label, user_id)``.  When ``None``
    (the default), mentions are preserved as bare ``@name``;
    the adapter is expected to do a second pass with the
    resolver to look up ClickUp user ids.  Keeping the
    mention lookup in the adapter (and out of the renderer)
    preserves the renderer's purity — no I/O.
    """
    s = strip_raw_html(body_md or "")
    if mention_resolver is not None:
        s = _rewrite_mentions(s, mention_resolver)
    return clickup_normalise(s)


def clickup_normalise(body_md: str) -> str:
    """ClickUp-flavored round-trip normaliser.

    Same as the GFM normaliser; kept as a named function so the
    public surface mirrors ``gfm_normalise`` and the smoke test
    can assert on the platform-specific function name.
    """
    return normalise_markdown(body_md or "")


# ---------------------------------------------------------------------------
# Mention rewriting
# ---------------------------------------------------------------------------

# Bare-mention pattern: @name where name is alphanumeric/underscore/dot/dash.
# Anchored to a word boundary on the left to avoid matching email addresses
# (`foo@example.com` -> only the "example" part is the "name" in some
# parsers, but ClickUp's parser treats the full "foo@example.com" as a
# mention candidate — we don't want to rewrite that).
_BARE_MENTION_RE = re.compile(
    r"(?<![\w@])@(?P<name>[A-Za-z][A-Za-z0-9_\-\.]{0,63})\b"
)


class MentionResolver:
    """Adapter-supplied callback contract for @-mention resolution.

    A concrete implementation is provided by the adapter layer
    (it has access to the ``author_mapping`` table).  The
    renderer only ever calls ``resolve(name)``; it never does
    I/O itself.

    The contract is intentionally tiny: ``name -> Optional[(label, user_id)]``.
    ``None`` means "no mapping; preserve as bare @name".
    """

    def resolve(self, name: str) -> Optional[tuple]:
        raise NotImplementedError("MentionResolver is a port; the adapter provides the impl")


def _rewrite_mentions(body_md: str, resolver: MentionResolver) -> str:
    def _sub(m: re.Match) -> str:
        name = m.group("name")
        hit = resolver.resolve(name)
        if hit is None:
            return m.group(0)  # leave bare @name in place
        label, user_id = hit
        return f"@[{label}](user:{user_id})"

    return _BARE_MENTION_RE.sub(_sub, body_md)
