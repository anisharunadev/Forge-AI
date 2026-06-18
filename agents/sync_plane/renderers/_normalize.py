"""Shared helpers for the Sync Plane Markdown renderers (FORA-275).

  * ``normalise_markdown`` — canonical form that the round-trip
    assertions compare against.  Identity-safe: re-normalising a
    normalised string returns the same bytes.
  * ``strip_raw_html`` — R-SYNC-01 sanitisation helper.  Strips
    raw HTML tags before render; the renderers never emit raw
    HTML themselves.
  * ``KNOWN_INLINE_MARKS`` — the set of inline marks the renderers
    preserve.  Anything else is treated as plain text.

The normaliser is intentionally a focused regex/whitespace pass
(not a full Markdown parser) because its job is to collapse
syntactic noise (trailing whitespace, mixed line endings,
inconsistent blank-line counts) without re-parsing semantics.

The smoke test asserts on byte equality, so this module is
covered by the renderer tests too.
"""

from __future__ import annotations

import re
from typing import Final

# ---- inline mark set -----------------------------------------------------
#
# These are the marks the renderers preserve (forwarded into the
# platform's native representation).  Anything else is plain text.
# Keep this set in lock-step with the renderers' own mark tables
# in md_to_adf.py / md_to_gfm.py / md_to_clickup.py.
KNOWN_INLINE_MARKS: Final[frozenset[str]] = frozenset(
    {"strong", "em", "code", "link", "mention", "strikethrough"}
)


# ---- raw-HTML strip (R-SYNC-01) ------------------------------------------

_HTML_TAG_RE = re.compile(
    r"</?[a-zA-Z][^>]*?>", re.MULTILINE
)
_HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)


def strip_raw_html(body_md: str) -> str:
    """Strip raw HTML tags + comments from a Markdown body.

    R-SYNC-01: "Strip ``<script>``, raw HTML, and platform-specific
    macros on ingest; render via a vetted Markdown->ADF/GFM
    pipeline (no third-party HTML pass-through)."

    The strip is best-effort: it's not a full HTML parser (we
    don't have one in this env), it just removes anything that
    looks like a tag/comment.  The renderers also enforce a
    no-raw-HTML rule on output.
    """
    if not body_md:
        return body_md
    s = _HTML_COMMENT_RE.sub("", body_md)
    s = _HTML_TAG_RE.sub("", s)
    return s


# ---- Markdown normaliser -------------------------------------------------

# Collapse 3+ blank lines down to 2 (one paragraph break).
_MULTI_BLANK_RE = re.compile(r"\n{3,}")
# Strip trailing whitespace on every line.
_TRAILING_WS_RE = re.compile(r"[ \t]+\n", re.MULTILINE)
# Normalise CRLF -> LF.
_CRLF_RE = re.compile(r"\r\n?")
# Strip leading/trailing blank lines.
_LEAD_BLANK_RE = re.compile(r"^\n+")
_TRAIL_BLANK_RE = re.compile(r"\n+$")
# Blank line (a line containing only whitespace) is, per CommonMark,
# equivalent to an empty line.  Normalise it to a truly empty line
# so the round-trip target matches markdown-it's parse output.
_BLANK_LINE_RE = re.compile(r"^[ \t]*\n", re.MULTILINE)


def normalise_markdown(body_md: str) -> str:
    """Canonical Markdown form used by the round-trip assertions.

    Rules (in order):

      1. Strip raw HTML (R-SYNC-01).
      2. CRLF / CR -> LF.
      3. Strip trailing whitespace on every line.
      4. Collapse whitespace-only lines to truly blank lines
         (CommonMark §blank line behavior; the round-trip target
         matches the parser's notion of "empty").
      5. Collapse 3+ blank lines -> 2 (one paragraph break).
      6. Strip leading/trailing blank lines on the whole doc.
      7. If the document is *only* whitespace (after steps 1-6),
         collapse to empty.  CommonMark treats whitespace-only
         content as empty; the round-trip target mirrors that.
      8. Ensure exactly one trailing newline.

    Identity-safe: ``normalise_markdown(normalise_markdown(x)) ==
    normalise_markdown(x)``.
    """
    if body_md is None:
        return ""
    s = strip_raw_html(body_md)
    s = _CRLF_RE.sub("\n", s)
    s = _TRAILING_WS_RE.sub("\n", s)
    s = _BLANK_LINE_RE.sub("\n", s)
    s = _MULTI_BLANK_RE.sub("\n\n", s)
    s = _LEAD_BLANK_RE.sub("", s)
    s = _TRAIL_BLANK_RE.sub("", s)
    if s.strip() == "":
        # Whitespace-only body -> empty document.  Mirrors
        # markdown-it's parse output for the round-trip target.
        return ""
    if s and not s.endswith("\n"):
        s += "\n"
    return s


def normalise_inline(s: str) -> str:
    """Inline-level normaliser (used inside a single line of text).

    Same as ``normalise_markdown`` but without the leading /
    trailing blank-line rules (those are block-level).  Used by
    the round-trip re-parsers when they reconstruct Markdown
    from a platform-native form.
    """
    if not s:
        return s
    s = strip_raw_html(s)
    s = _CRLF_RE.sub("\n", s)
    s = _TRAILING_WS_RE.sub("\n", s)
    return s


# ---- Platform-specific aliases -------------------------------------------
#
# GFM and ClickUp share the same canonical Markdown normaliser
# (one normaliser, two front-doors).  These aliases exist so the
# renderer files can re-export ``gfm_normalise`` /
# ``clickup_normalise`` without each module defining its own
# implementation.  Keeping one normaliser also keeps the
# round-trip assertion shape identical across the three
# renderers: ``render_to_x(body_md) == <x>_normalise(body_md)``.

def gfm_normalise(body_md: str) -> str:
    """GFM normaliser (alias of ``normalise_markdown``)."""
    return normalise_markdown(body_md)


def clickup_normalise(body_md: str) -> str:
    """ClickUp normaliser (alias of ``normalise_markdown``)."""
    return normalise_markdown(body_md)
