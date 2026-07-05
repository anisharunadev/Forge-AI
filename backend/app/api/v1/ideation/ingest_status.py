"""GET /ideation/ingest/status — daily ingest heartbeat for the Ideation page header badge.

Tells the IdeationCenter UI whether today's daily ingest job has run, how
many ideas it produced, and when it last fired. Used by
``<IngestIndicator />`` in the ideation page header.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.deps import require_permission
from app.core.security import AuthenticatedPrincipal

router = APIRouter(prefix="/ingest", tags=["ideation-ingest"])

IngestStatus = Literal["success", "running", "failed", "partial", "never"]


class IngestStatusRead(BaseModel):
    status: IngestStatus
    ideas_created_today: int
    last_run_at: datetime | None


@router.get("/status", response_model=IngestStatusRead)
async def get_ingest_status(
    principal: AuthenticatedPrincipal = Depends(require_permission("ideation.read")),
) -> IngestStatusRead:
    # ponytail: read from the scheduler's last-run record. The actual
    # service call is added once the scheduler writes a record; until
    # then we return the safe 'never' status so the badge renders neutrally.
    return IngestStatusRead(
        status="never",
        ideas_created_today=0,
        last_run_at=None,
    )
