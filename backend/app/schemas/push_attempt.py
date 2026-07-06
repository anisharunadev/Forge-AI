"""Pydantic v2 schema for the ``push_attempts`` idempotency cache (M4-G5, G20).

The push endpoints (``POST /api/v1/ideation/ideas/{idea_id}/push/{target}``)
honor the ``Idempotency-Key`` HTTP header. When a caller re-submits a
request with the same key for the same ``(tenant_id, idea_id)`` pair,
the previous push result is returned without re-executing the
underlying push.

Backed by the :class:`PushAttempt` ORM model (added alongside this
schema in the same M4 commit). The schema mirrors that table 1:1.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel, TenantScopedModel
from app.schemas.ideation import PushResult


class PushAttemptRead(TenantScopedModel):
    """One row of the ``push_attempts`` table — used as the idempotency cache."""

    id: UUID
    tenant_id: UUID
    idea_id: UUID
    idempotency_key: str = Field(..., min_length=1, max_length=128)
    result: PushResult
    created_at: datetime


class PushAttemptCreate(ForgeBaseModel):
    """Schema for inserting a row — used by the route layer, not exposed."""

    tenant_id: UUID
    idea_id: UUID
    idempotency_key: str = Field(..., min_length=1, max_length=128)
    result: PushResult


__all__ = ["PushAttemptRead", "PushAttemptCreate"]
