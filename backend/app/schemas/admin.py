"""Schemas for F-008 — Admin (M2 portion)."""

from __future__ import annotations

from datetime import datetime

from app.schemas.common import ForgeBaseModel


class ComponentHealth(ForgeBaseModel):
    name: str
    status: str  # "healthy" | "degraded" | "down"
    detail: str | None = None
    checked_at: datetime


class AdminHealthReport(ForgeBaseModel):
    overall: str
    components: list[ComponentHealth]
    checked_at: datetime


class AdminStats(ForgeBaseModel):
    tenant_count: int
    project_count: int
    user_count: int
    run_count_24h: int
    cost_usd_24h: float
    connector_count: int
    artifact_count: int
    checked_at: datetime


class CachePurgeResult(ForgeBaseModel):
    purged_keys: int
    purged_at: datetime
    scope: str = "all"
