"""Pydantic v2 schemas for the synthesizer's market-signal output (M4-G2).

The Market Signals tab surfaces the synthesizer's view of the world:
competitor launches, industry trends, and technology updates with a
``why_it_matters_for_us`` annotation per row. The synthesizer service
already exists in ``services/ideation/sources/synthesizer.py`` — this
module defines the wire shape the REST endpoint projects to.

There is intentionally no Pydantic ``MarketSignalCreate`` model:
synthesized signals are server-generated. The route exposes a
manual ``POST /synthesize`` trigger for ops scenarios, but the create
path goes through the synthesizer service, not through a user payload.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel, TenantScopedModel

# Closed set of market-signal kinds surfaced on the Market Signals tab.
# Mirrors the synthesizer's three buckets; new kinds require a schema
# bump so the frontend's filter chips stay in sync.
MarketSignalKind = Literal["competitor", "trend", "tech"]


class MarketSignalRead(TenantScopedModel):
    """One row on the Market Signals tab.

    ``why_it_matters`` is the synthesizer's annotation in plain text;
    the frontend renders it as the "what this means for us" callout.
    """

    id: UUID
    kind: MarketSignalKind
    title: str = Field(..., min_length=3, max_length=512)
    summary: str = Field(..., min_length=3, max_length=4000)
    source_url: str | None = Field(default=None, max_length=2048)
    why_it_matters: str = Field(..., min_length=3, max_length=2000)
    published_at: datetime
    ingested_at: datetime


class SynthesisResult(ForgeBaseModel):
    """Body for ``POST /api/v1/ideation/market-signals/synthesize``.

    Reports the work the manual synthesize pass did — how many signals
    it re-clustered, how many new ``MarketSignal`` rows emerged.
    """

    signals_seen: int = Field(default=0, ge=0)
    ideas_created: int = Field(default=0, ge=0)
    market_signals_emitted: int = Field(default=0, ge=0)
    degraded_budget: bool = False
    finished_at: datetime


__all__ = [
    "MarketSignalKind",
    "MarketSignalRead",
    "SynthesisResult",
]
