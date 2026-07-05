"""Pydantic v2 schemas for the push-destination projection (M4-G4).

The Destinations tab surfaces the per-tenant set of configured push
targets — Jira projects, Confluence spaces, Slack channels, the
in-app Architecture preview, and Notion-style docs — that an Idea
can be pushed to. Destinations are projected from M3's
``connectors`` table; this module defines only the wire shape.

There is intentionally no ``PushDestinationCreate``/``Update``: the
underlying connectors are managed by the M3 connector-center surface,
not by the ideation routes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import TenantScopedModel

# Closed set of destination kinds the M4 push flow supports.
# ``arch_preview`` is the in-app architecture preview slot — it has no
# external connector and is always available once the ideation Center
# is enabled for the tenant.
PushDestinationKind = Literal["jira", "confluence", "slack", "notion", "arch_preview"]


class PushDestinationRead(TenantScopedModel):
    """One row on the Destinations tab.

    The ``config`` dict is type-specific (project_key for jira,
    space_key for confluence, channel_id for slack, page_id for
    notion). The frontend does not introspect it — it just displays
    a human-friendly summary.
    """

    id: UUID
    kind: PushDestinationKind
    config: dict[str, Any] = Field(default_factory=dict)
    last_pushed_at: datetime | None = None
    status: Literal["healthy", "degraded", "unavailable", "syncing"] = "healthy"


__all__ = [
    "PushDestinationKind",
    "PushDestinationRead",
]