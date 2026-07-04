"""F-413 — Terminal broadcast WebSocket.

Read-only observer stream. The ``?write=true`` query param upgrades
the connection to write-capable — but only if the JWT carries
``forge-admin`` or ``terminal:write`` (validated here, not just
trusted from the URL).
"""

from __future__ import annotations

import asyncio
import base64
import json
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.core.config import settings
from app.core.logging import get_logger
from app.core.security import principal_from_token
from app.services.rbac import rbac
from app.services.terminal.broadcast import session_broadcaster
from app.terminal.session_manager import session_manager

logger = get_logger(__name__)
router = APIRouter()


def _is_admin(roles: list[str]) -> bool:
    return any(r in {"forge:admin", "tenant:admin"} for r in roles) or any(
        r.startswith("forge:admin") for r in roles
    )


async def _send(ws: WebSocket, payload: dict[str, Any]) -> None:
    await ws.send_text(json.dumps(payload))


@router.websocket("/ws/terminal/{session_id}/watch")
async def terminal_broadcast_websocket(
    websocket: WebSocket,
    session_id: str,
    token: str | None = Query(default=None),
    write: bool = Query(default=False),
) -> None:
    """Read-only observer stream; ``?write=true`` for forge-admin."""
    await websocket.accept()

    principal = None
    if token:
        try:
            principal = principal_from_token(token)
        except Exception as exc:  # noqa: BLE001
            await _send(websocket, {"type": "error", "message": f"auth_failed: {exc}"})
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    if principal is None:
        try:
            first_raw = await asyncio.wait_for(
                websocket.receive_text(),
                timeout=settings.ws_idle_timeout_seconds,
            )
        except (asyncio.TimeoutError, WebSocketDisconnect):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        try:
            first = json.loads(first_raw)
        except json.JSONDecodeError:
            await _send(websocket, {"type": "error", "message": "invalid_first_frame"})
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        if first.get("type") != "auth" or not first.get("token"):
            await _send(websocket, {"type": "error", "message": "auth_required"})
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        try:
            principal = principal_from_token(first["token"])
        except Exception as exc:  # noqa: BLE001
            await _send(websocket, {"type": "error", "message": f"auth_failed: {exc}"})
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    decision = rbac.check(principal, "terminal:read")
    if not decision.allowed:
        await _send(websocket, {"type": "error", "message": decision.reason})
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    session = await session_manager.get_session(session_id)
    if session is None or session.tenant_id != principal.tenant_id:
        await _send(websocket, {"type": "error", "message": "session_not_found"})
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    write_granted = bool(write and _is_admin(principal.roles))
    subscription, send_fn = await session_broadcaster.subscribe(
        session_id,
        user_id=principal.user_id,
        tenant_id=principal.tenant_id,
        write=write_granted,
    )
    await _send(
        websocket,
        {
            "type": "ready",
            "session_id": session_id,
            "subscription_id": subscription.id,
            "write": write_granted,
        },
    )

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await _send(websocket, {"type": "error", "message": "invalid_frame"})
                continue
            kind = msg.get("type")
            if kind == "ping":
                await _send(websocket, {"type": "pong"})
            elif kind == "input" and write_granted:
                payload = base64.b64decode(msg.get("data", "") or b"")
                # Forward to the broadcaster — subscribed write streams
                # will receive it under msg_type='i'.
                await session_broadcaster.broadcast(
                    session_id, b"IN:" + payload
                )
            elif kind == "input":
                await _send(
                    websocket,
                    {"type": "error", "message": "read_only"},
                )
            else:
                await _send(websocket, {"type": "error", "message": f"unknown_frame:{kind}"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.warning("ws.broadcast_error", error=str(exc))
    finally:
        await session_broadcaster.unsubscribe(session_id, subscription)
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass


__all__ = ["router"]
