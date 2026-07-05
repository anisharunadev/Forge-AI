"""M5 Architecture Center (T-A3) — SecurityReport Pydantic schemas.

Used by the POST/GET/PATCH endpoints under
``/api/v1/architecture/security-reports`` and by Track B's
``useArchitectureSecurity`` hook on the frontend.

Closed-set enums mirror :mod:`app.db.models.security_report` values.
The Pydantic ``Literal`` types provide 422 (not 500) validation when
the caller passes an unknown severity/category/status.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel

Severity = Literal["low", "medium", "high", "critical"]
Category = Literal[
    "auth",
    "data",
    "network",
    "dependency",
    "configuration",
    "cryptography",
    "logging",
]
SecurityReportStatus = Literal["open", "mitigating", "accepted", "closed"]


class SecurityReportCreateRequest(ForgeBaseModel):
    """Body for POST /security-reports — create a new finding."""

    project_id: UUID
    title: str = Field(..., min_length=1, max_length=500)
    severity: Severity
    category: Category
    description: str = Field(..., min_length=1)
    affected_service: str = Field(..., min_length=1, max_length=200)
    recommendation: str = Field(..., min_length=1)
    source_adr_id: UUID | None = None


class SecurityReportStatusUpdateRequest(ForgeBaseModel):
    """Body for PATCH /security-reports/{id}/status — lifecycle change."""

    status: SecurityReportStatus
    reason: str | None = Field(default=None, max_length=2000)


class SecurityReportRead(ForgeBaseModel):
    """Response body for a single Security Report row."""

    id: UUID
    tenant_id: UUID
    project_id: UUID
    title: str
    severity: Severity
    category: Category
    description: str
    affected_service: str
    recommendation: str
    status: SecurityReportStatus
    source_adr_id: UUID | None = None
    discovered_at: datetime
    mitigated_at: datetime | None = None
    generated_by: str | None = None
    created_at: datetime
    updated_at: datetime


class SecurityReportListResponse(ForgeBaseModel):
    items: list[SecurityReportRead]
    total: int = 0


class SecurityReportDeploymentPosture(ForgeBaseModel):
    """Aggregate roll-up returned by GET /security-reports/posture.

    ``score`` is the higher-is-better index (0-100) used by the
    SecurityPostureCard gauge; it's risk-weighted: critical_open = -25,
    high_open = -10, medium_open = -3, low_open = -1, closed = +5.
    The score is clamped to [0, 100].
    """

    tenant_id: UUID | None = None
    project_id: UUID | None = None
    total_open: int = 0
    total_closed: int = 0
    critical_open: int = 0
    high_open: int = 0
    medium_open: int = 0
    low_open: int = 0
    by_category: dict[str, int] = Field(default_factory=dict)
    top_affected_services: list[str] = Field(default_factory=list)
    score: int = 100
    computed_at: datetime


__all__ = [
    "Category",
    "SecurityReportCreateRequest",
    "SecurityReportDeploymentPosture",
    "SecurityReportListResponse",
    "SecurityReportRead",
    "SecurityReportStatus",
    "SecurityReportStatusUpdateRequest",
    "Severity",
]
