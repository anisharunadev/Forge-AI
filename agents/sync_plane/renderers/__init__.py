"""Markdown renderers for the Sync Plane (ADR-0010 §6.1, §6.2, §6.3; FORA-275).

Three pure renderers, one per remote platform, with the FORA-120
I/O-wrapper split (pure renderer + thin I/O shim lives elsewhere
once the adapters wire up).  Each renderer is:

  * Pure (no I/O, no LLM, no network; parseable in <2 ms warm)
  * Deterministic (same input bytes -> same output bytes, sorted
    keys, stable field order)
  * Round-trippable through a normalised Markdown form so the
    smoke test can assert ``render(render_to_x(body_md)) == normalised_md``

Public surface (mirrored in ``sync_plane.__init__``):

  from sync_plane.renderers import (
      render_to_adf,        adf_to_markdown,
      render_to_gfm,        gfm_normalise,
      render_to_clickup,    clickup_normalise,
      RENDERERS,            KNOWN_FORMATS,
  )

The parser backbone is ``markdown-it-py`` (pure-Python, already
vendored into the test env).  No third-party HTML/JSON libs are
required for the renderers themselves.

Reference: ADR-0010 §6.1 (canonical envelope), §6.2 (attribution),
§6.3 (threading).  R-SYNC-01 sanitisation is enforced here: raw
HTML is dropped, ``@mentions`` are normalised to a known-actor
set (the envelope's ``author``), and links are rendered with
explicit text + href (no implicit HTML pass-through).
"""

from __future__ import annotations

from typing import Callable, Dict

from .md_to_adf import (
    ADF_VERSION,
    adf_to_markdown,
    render_to_adf,
)
from .md_to_clickup import (
    CLICKUP_MENTION_PATTERN,
    clickup_normalise,
    render_to_clickup,
)
from .md_to_gfm import (
    render_to_gfm,
    gfm_normalise,
)
from ._normalize import normalise_markdown, strip_raw_html, KNOWN_INLINE_MARKS

# Map: platform name -> renderer callable (body_md -> str / dict)
# The adapter layer looks up by platform when populating
# ``envelope.body_remote_rendered[platform].value``.
RENDERERS: Dict[str, Callable[[str], object]] = {
    "jira": render_to_adf,         # value is an ADF dict; json-dumped by adapter
    "github": render_to_gfm,        # value is a normalised GFM string
    "clickup": render_to_clickup,   # value is a normalised ClickUp string
}

# Map: platform name -> (format key, normalise callable).  Mirrors
# ``REMOTE_FORMATS`` in ``envelope.py`` so the schema validates
# both directions.
KNOWN_FORMATS: Dict[str, str] = {
    "jira": "adf",
    "github": "gfm",
    "clickup": "md",
}


__all__ = [
    # ADF
    "ADF_VERSION",
    "render_to_adf",
    "adf_to_markdown",
    # GFM
    "render_to_gfm",
    "gfm_normalise",
    # ClickUp
    "CLICKUP_MENTION_PATTERN",
    "render_to_clickup",
    "clickup_normalise",
    # shared
    "normalise_markdown",
    "strip_raw_html",
    "KNOWN_INLINE_MARKS",
    "RENDERERS",
    "KNOWN_FORMATS",
]
