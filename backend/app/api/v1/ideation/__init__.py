"""Ideation Center REST routers (F-201..F-263).

Mounted under ``/api/v1`` by ``app/api/v1/router.py``.
"""

from __future__ import annotations

from app.api.v1.ideation import (
    approvals,
    arch_previews,
    customer_voice,
    destinations,
    enhance,
    ideas,
    impact,
    kg_graph,
    market_signals,
    output_bundles,
    prds,
    push,
    roadmaps,
    scoring,
    sources,
    workflows,
)

__all__ = [
    "approvals",
    "arch_previews",
    "customer_voice",
    "destinations",
    "enhance",
    "ideas",
    "impact",
    "kg_graph",
    "market_signals",
    "output_bundles",
    "prds",
    "push",
    "roadmaps",
    "scoring",
    "sources",
    "workflows",
]