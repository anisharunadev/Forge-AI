"""Connector-events HTTP bridge (Pillar 1 — Phase 1).

Thin FastAPI router that receives TS-side connector events and hands
them to ``bus_bridge.publish_connector_event``. The bus_bridge module
owns the event-shape contract; this router is the HTTP layer only.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.services.connector_ingestion.bus_bridge import (
    ConnectorEventEnvelope,
    publish_connector_event,
)

router = APIRouter(prefix="/connector-events", tags=["connector_events"])


@router.post("/observed", status_code=status.HTTP_202_ACCEPTED)
async def observe_connector_event(envelope: ConnectorEventEnvelope) -> dict[str, object]:
    """Receive one TS-side connector event and re-publish on the Python bus."""
    result = await publish_connector_event(envelope)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "rejected"))
    return result


__all__ = ["router"]
