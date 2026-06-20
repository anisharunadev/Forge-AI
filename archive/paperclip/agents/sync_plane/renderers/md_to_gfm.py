"""Markdown -> GitHub-Flavored Markdown (GFM) renderer (FORA-275).

GFM is a strict superset of CommonMark — every valid Markdown
document is a valid GFM document.  The "renderer" therefore is
an identity with a normalisation pass: the smoke test asserts
``render_to_gfm(body_md) == gfm_normalise(body_md)`` and
``gfm_normalise(render_to_gfm(body_md)) == gfm_normalise(body_md)``
(round-trip is identity after normalisation).

The normalisation is the same one the round-trip target uses
(``normalise_markdown`` in ``_normalize.py``).  R-SYNC-01
sanitisation — strip raw HTML — is applied at render time and
also re-applied on round-trip.

The renderer is a function, not a class, so the adapter layer
can pass it directly without instantiation.
"""

from __future__ import annotations

from ._normalize import gfm_normalise, normalise_markdown, strip_raw_html


def render_to_gfm(body_md: str) -> str:
    """Render ``body_md`` to a normalised GFM string.

    Identity after normalisation.  R-SYNC-01 sanitisation is
    applied: raw HTML is stripped.
    """
    return gfm_normalise(body_md or "")


def gfm_normalise(body_md: str) -> str:
    """Public alias for the round-trip target.

    Kept as a re-export so callers don't need to import from
    ``_normalize`` (which is a private module).  Mirrors
    ``clickup_normalise`` in ``md_to_clickup.py`` for symmetry.
    """
    return normalise_markdown(body_md or "")
