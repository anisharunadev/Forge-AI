"""Pydantic v2 schemas for ideation ingest sources (M4-G1).

The Sources tab in the Ideation Center reads the per-tenant set of
configured puller targets from this schema. A source in this context
is the bridge between an external system (Confluence, Slack, Zendesk,
...) and the daily ``ideation_source_signals`` table — i.e. a row in
``connectors`` whose ``type`` is one of the M3-supported ingest kinds.

Three models:

* :class:`IngestSourceRead` — projection returned by ``GET /api/v1/ideation/sources``.
* :class:`IngestSourceSyncRequest` — request body for ``POST /sources/{id}/sync``.
* :class:`IngestSourceUpdateRequest` — request body for ``PATCH /sources/{id}``.

The ``scopes`` field on :class:`IngestSourceRead` lists the channel /
page / queue identifiers the puller will scrape (derived from the
underlying connector's ``config`` JSON).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel, TenantScopedModel

# Closed set of source kinds the M3 ingest stack wires up. Anything
# outside this set is rejected by the route at validation time so the
# frontend never sees a half-configured source.
INGEST_SOURCE_TYPES: tuple[str, ...] = (
    "confluence",
    "slack",
    "zendesk",
    "github",
    "jira",
    "notion",
)


class IngestSourceRead(TenantScopedModel):
    """One configured ingest source for a tenant.

    Mirrors a row in ``connectors`` (M3) but flattened for the
    Sources tab — the UI never sees the raw ``config`` blob, only
    the typed projection.
    """

    id: UUID
    slug: str = Field(..., min_length=1, max_length=200)
    type: Literal["confluence", "slack", "zendesk", "github", "jira", "notion"]
    config: dict[str, Any] = Field(default_factory=dict)
    last_sync_at: datetime | None = None
    status: Literal[
        "pending", "syncing", "healthy", "stale", "quarantined", "failed"
    ] = "pending"
    scopes: list[str] = Field(default_factory=list, max_length=64)


class IngestSourceSyncRequest(ForgeBaseModel):
    """Body for ``POST /api/v1/ideation/sources/{id}/sync``.

    ``since`` lets callers restrict the pull to "things updated after
    this point". When omitted, the route uses the configured default
    (the last successful sync time, or 14d ago if first sync).
    """

    since: datetime | None = None
    limit: int = Field(default=50, ge=1, le=500)


class IngestSourceUpdateRequest(ForgeBaseModel):
    """Body for ``PATCH /api/v1/ideation/sources/{id}``.

    Only the merge-able fields are exposed — id, type, and tenant are
    immutable (delete + recreate to change those).
    """

    config: dict[str, Any] | None = Field(default=None, max_length=64)
    scopes: list[str] | None = Field(default=None, max_length=64)


__all__ = [
    "INGEST_SOURCE_TYPES",
    "IngestSourceRead",
    "IngestSourceSyncRequest",
    "IngestSourceUpdateRequest",
]