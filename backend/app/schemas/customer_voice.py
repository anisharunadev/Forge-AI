"""Pydantic v2 schemas for the Customer Voice cluster projection (M4-G3).

The Customer Voice tab groups raw ``ideation_source_signals`` rows by
NLP topic and surfaces one cluster per topic with sentiment + frequency
aggregates. The clusters are computed lazily on read by the route; no
separate write API exists.

A representative_signal in this context is the ``id`` of one
``ideation_source_signals`` row chosen by the clusterer — the frontend
uses it as the cluster's "example quote".
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.common import TenantScopedModel


class CustomerClusterRead(TenantScopedModel):
    """One cluster on the Customer Voice tab.

    Sentiment is a single float in ``[-1.0, 1.0]`` — the mean
    sentiment score across the cluster's constituent signals
    (positive = happy customer, negative = pain). Frequency is the
    count of source signals folded into this cluster.
    """

    id: UUID
    topic: str = Field(..., min_length=3, max_length=256)
    sentiment: float = Field(..., ge=-1.0, le=1.0)
    frequency: int = Field(..., ge=1)
    representative_signals: list[UUID] = Field(default_factory=list, max_length=16)
    last_updated_at: datetime


__all__ = ["CustomerClusterRead"]