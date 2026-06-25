"""Pydantic DTOs for the seeds API (Plan C — F-821).

These schemas mirror the dataclasses returned by ``SeedRunner`` but
expose them as Pydantic v2 models so the FastAPI layer can produce
OpenAPI documentation and so callers get strict validation.

Schemas:

- :class:`SeedManifestSummary` — light-weight projection for list views.
- :class:`SeedManifestRead` — full manifest (data files + counts).
- :class:`SeedDataFileRead` — single ordered data file in a manifest.
- :class:`SeedRunRead` — apply/reset/rollback run record.
- :class:`SeedApplyRequest` / :class:`SeedResetRequest` — request bodies.
- :class:`SeedStatusRead` / :class:`SeedDiffRead` — inspection results.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import ForgeBaseModel


# ---------------------------------------------------------------------------
# Manifest DTOs
# ---------------------------------------------------------------------------


class SeedManifestSummary(ForgeBaseModel):
    """Light-weight manifest summary for ``GET /seeds``.

    Mirrors the fields the UI needs for the seed list view and the
    admin "Load Demo" picker — name, version, tenant classification,
    short description, and declared dependencies.
    """

    name: str = Field(..., min_length=1, max_length=200)
    version: int = Field(..., ge=1)
    tenant_type: Literal["demo", "reference", "production"] = "reference"
    description: str | None = None
    depends_on: list[str] = Field(default_factory=list)


class SeedDataFileRead(ForgeBaseModel):
    """A single ordered data file declared in a manifest."""

    file: str
    table: str
    order: int
    idempotency_key: list[str]
    description: str | None = None


class SeedManifestRead(SeedManifestSummary):
    """Full manifest payload for ``GET /seeds/{name}``."""

    data_files: list[SeedDataFileRead] = Field(default_factory=list)
    row_counts_expected: dict[str, int] = Field(default_factory=dict)
    production_safety: dict[str, bool] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Run + Inspection DTOs
# ---------------------------------------------------------------------------


class SeedRunRead(ForgeBaseModel):
    """Return value for apply/reset/rollback operations.

    Mirrors the dataclass :class:`SeedRunner.SeedRun` 1:1 but uses
    Pydantic so it can be returned directly from a route handler.
    """

    id: UUID
    seed_name: str
    manifest_version: int
    operation: Literal["apply", "reset", "rollback"]
    status: Literal["running", "completed", "failed", "rolled_back"]
    env: str
    triggered_by: str
    actor_id: UUID
    tenant_id: UUID | None = None
    row_counts: dict[str, int] = Field(default_factory=dict)
    dropped_rows: dict[str, int] = Field(default_factory=dict)
    checksum_after: str | None = None
    started_at: datetime
    completed_at: datetime | None = None
    duration_ms: int | None = None
    error: dict[str, str] = Field(default_factory=dict)


class SeedStatusRead(ForgeBaseModel):
    """Result of ``GET /seeds/{name}/status``.

    Tells the caller whether the seed is currently applied, what the
    last run produced, and whether the on-disk checksum matches the
    stored migration checksum (drift detection).
    """

    seed_name: str
    applied: bool
    applied_version: int | None = None
    last_run_at: datetime | None = None
    last_run_status: str | None = None
    checksum: str | None = None
    checksum_match: bool = False
    drift: Literal["none", "checksum", "row_count", "unknown"] = "unknown"
    row_counts: dict[str, int] = Field(default_factory=dict)
    production_safe: bool = False


class SeedDiffRead(ForgeBaseModel):
    """Result of ``GET /seeds/{name}/diff``.

    Compares the manifest's declared ``row_counts_expected`` to the
    live database, plus a checksum check against the stored migration
    checksum. ``summary`` is a human-readable roll-up suitable for
    display in the admin UI.
    """

    seed_name: str
    checksum_match: bool
    row_count_changes: dict[str, tuple[int, int]] = Field(default_factory=dict)
    missing_files: list[str] = Field(default_factory=list)
    extra_rows: dict[str, int] = Field(default_factory=dict)
    summary: str = ""


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class SeedApplyRequest(ForgeBaseModel):
    """Body for ``POST /seeds/{name}/apply``.

    ``allow_in_prod`` is the production-safety override knob — when
    True the runner will skip the demo-vs-production gate. The
    override is itself audited.
    """

    allow_in_prod: bool = False


class SeedResetRequest(ForgeBaseModel):
    """Body for ``POST /seeds/{name}/reset``.

    ``scope`` controls whether the reset deletes only demo rows
    (``demo_only``) or every row this seed owns (``all``). The latter
    requires the ``seeds:reset:all`` permission and is Steward-only.
    """

    scope: Literal["demo_only", "all"] = "demo_only"


__all__ = [
    "SeedManifestSummary",
    "SeedManifestRead",
    "SeedDataFileRead",
    "SeedRunRead",
    "SeedStatusRead",
    "SeedDiffRead",
    "SeedApplyRequest",
    "SeedResetRequest",
]