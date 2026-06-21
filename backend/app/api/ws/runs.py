"""WebSocket bridge for SDLC runs (``/ws/runs/{run_id}``).

Bidirectional protocol
----------------------
Server → client:
    {"type": "state", "payload": {<state dict>}}
    {"type": "approval", "payload": {<ApprovalSnapshot dict>}}
    {"type": "phase", "payload": {<PhaseTransition dict>}}
    {"type": "ping", "payload": {}}

Client → server:
    {"type": "approval_response", "payload": {"approval_id": "...", "granted": true}}
    {"type": "ping", "payload": {}}

Authentication
--------------
The first frame from the client MUST be ``{"type": "auth", "token": "<jwt>"}``
(matching the Terminal WS handshake). For tests, an ``X-Test-Bypass`` header
or a permissive ``FORGE_TEST_MODE=1`` env var allows skipping the JWT check.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.agents.sdlc_state import ApprovalResponse, SDLCPhase
from app.core.security import principal_from_token
from app.schemas.sdlc import WSEnvelope, WSMessageType
from app.services.event_bus import bus as default_bus
from app.services.sdlc_run_manager import SDLCRunManager, get_default_manager

logger = logging.getLogger(__name__)

router = APIRouter()


def _is_test_mode() -> bool:
    return os.environ.get("FORGE_TEST_MODE") == "1" or os.environ.get("ENVIRONMENT") == "test"


async def _authenticate(websocket: WebSocket) -> bool:
    """Validate the auth frame. In test mode we accept any token."""

    if _is_test_mode():
        return True
    try:
        first = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
    except (asyncio.TimeoutError, WebSocketDisconnect):
        return False
    try:
        msg = json.loads(first)
    except json.JSONDecodeError:
        return False
    if msg.get("type") != "auth" or not msg.get("token"):
        return False
    try:
        principal = principal_from_token(msg["token"])
    except Exception:  # noqa: BLE001
        return False
    return principal is not None


def _get_manager(websocket: WebSocket) -> SDLCRunManager:
    manager = getattr(websocket.app.state, "sdlc_manager", None)
    if manager is None:
        manager = get_default_manager()
        websocket.app.state.sdlc_manager = manager
    return manager


@router.websocket("/ws/runs/{run_id}")
async def run_socket(websocket: WebSocket, run_id: UUID) -> None:
    """Bidirectional stream for one SDLC run."""

    await websocket.accept()
    if not await _authenticate(websocket):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    manager = _get_manager(websocket)
    state = await manager.get_run(run_id)
    if state is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    sub = await manager.broker.subscribe(run_id)
    await websocket.send_json(
        _envelope("state", state.model_dump(mode="json")).model_dump(mode="json")
    )
    consumer_task = asyncio.create_task(_consumer(websocket, manager, run_id))
    try:
        while True:
            try:
                snapshot = await asyncio.wait_for(sub.queue.get(), timeout=15.0)
            except asyncio.TimeoutError:
                await websocket.send_json(
                    _envelope("ping", {}).model_dump(mode="json")
                )
                continue
            await websocket.send_json(
                _envelope("state", snapshot.model_dump(mode="json")).model_dump(mode="json")
            )
            if snapshot.current_phase in (SDLCPhase.DONE, SDLCPhase.FAILED):
                break
    except WebSocketDisconnect:
        pass
    finally:
        consumer_task.cancel()
        try:
            await consumer_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        await manager.broker.unsubscribe(run_id, sub)


async def _consumer(
    websocket: WebSocket,
    manager: SDLCRunManager,
    run_id: UUID,
) -> None:
    """Receive client messages and apply them to the run."""

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                envelope = WSEnvelope.model_validate_json(raw)
            except Exception:  # noqa: BLE001 — drop bad frames
                continue
            if envelope.type == "approval_response":
                payload = envelope.payload
                try:
                    response = ApprovalResponse(
                        approval_id=UUID(payload["approval_id"]),
                        granted=bool(payload.get("granted", False)),
                        decided_by=UUID(payload["decided_by"]),
                        decided_at=datetime.now(timezone.utc),
                        reason=str(payload.get("reason", "")),
                    )
                    await manager.resume_run(run_id, approval_response=response)
                except (KeyError, ValueError) as exc:
                    logger.warning("ws.bad_approval_response", error=str(exc))
            elif envelope.type == "ping":
                await websocket.send_json(
                    _envelope("ping", {}).model_dump(mode="json")
                )
    except WebSocketDisconnect:
        return


def _envelope(msg_type: WSMessageType, payload: dict[str, Any]) -> WSEnvelope:
    return WSEnvelope(type=msg_type, payload=payload, sent_at=datetime.now(timezone.utc))


__all__ = ["router"]
