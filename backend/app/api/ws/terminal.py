"""Terminal WebSocket endpoint (F-405).

Bidirectional proxy between the browser and the PTY. Auth is enforced
on the first frame; subsequent frames are raw bytes (input / output).

Wire format (client -> server):
    {"type": "auth", "token": "<jwt>"}                  # first frame
    {"type": "input", "data": "<base64>"}              # stdin
    {"type": "resize", "rows": 24, "cols": 80}

Wire format (server -> client):
    {"type": "ready"}                                   # post-auth
    {"type": "output", "data": "<base64>"}              # PTY stdout
    {"type": "exit", "code": 0}
    {"type": "error", "message": "..."}
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
from typing import Any

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.core.config import settings
from app.core.logging import get_logger
from app.core.security import principal_from_token
from app.services.rbac import rbac
from app.terminal.agent_launcher import agent_launcher, detect_agent
from app.terminal.audit import terminal_audit
from app.terminal.pty_process import PTYProcess
from app.terminal.session_manager import (
    AgentType,
    session_manager,
)

logger = get_logger(__name__)
router = APIRouter()


async def _send(ws: WebSocket, payload: dict[str, Any]) -> None:
    await ws.send_text(json.dumps(payload))


@router.websocket("/ws/terminal/{session_id}")
async def terminal_websocket(
    websocket: WebSocket,
    session_id: str,
    token: str | None = Query(default=None),
) -> None:
    """Long-lived PTY proxy.

    The JWT may arrive via `?token=` (browser-friendly) or as the
    first frame after upgrade.
    """
    await websocket.accept()

    # Resolve principal from token (query param first, first frame second).
    principal = None
    if token:
        try:
            principal = principal_from_token(token)
        except Exception as exc:  # noqa: BLE001
            await _send(websocket, {"type": "error", "message": f"auth_failed: {exc}"})
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    if principal is None:
        # Wait for first frame to carry auth.
        try:
            first_raw = await asyncio.wait_for(
                websocket.receive_text(),
                timeout=settings.ws_idle_timeout_seconds,
            )
        except (TimeoutError, WebSocketDisconnect):
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

    # RBAC: require terminal:connect
    decision = rbac.check(principal, "terminal:connect")
    if not decision.allowed:
        await _send(websocket, {"type": "error", "message": decision.reason})
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    session = await session_manager.get_session(session_id)
    if session is None:
        await _send(websocket, {"type": "error", "message": "session_not_found"})
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    if session.tenant_id != principal.tenant_id:
        await _send(websocket, {"type": "error", "message": "tenant_mismatch"})
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Auto-detect agent from workspace unless the session pinned one.
    agent_type = session.agent_type
    if agent_type == AgentType.CUSTOM:
        agent_type = detect_agent(session.workspace_path)
    process: PTYProcess = agent_launcher.launch(
        agent_type=agent_type,
        workspace_path=session.workspace_path,
        env_overrides={
            "FORCE_COLOR": "1",
            "FORGE_TENANT": principal.tenant_id,
            "FORGE_PROJECT": session.project_id,
            "FORGE_USER": principal.user_id,
        },
    )
    try:
        await process.start(
            process._pending_command,  # type: ignore[attr-defined]
            cwd=process._pending_cwd,  # type: ignore[attr-defined]
            env=process._pending_env,  # type: ignore[attr-defined]
        )
    except Exception as exc:  # noqa: BLE001
        await _send(websocket, {"type": "error", "message": f"launch_failed: {exc}"})
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        return

    await terminal_audit.record_session_lifecycle(
        session_id=session.id,
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        actor_id=principal.user_id,
        event="started",
    )
    await _send(websocket, {"type": "ready", "agent_type": agent_type.value})

    # Two concurrent loops: client->pty and pty->client.
    async def pty_to_ws() -> None:
        try:
            while not process.closed:
                chunk = await process.read()
                if chunk:
                    await session_manager.touch(session.id)
                    await _send(
                        websocket,
                        {"type": "output", "data": base64.b64encode(chunk).decode("ascii")},
                    )
                else:
                    await asyncio.sleep(0.01)
        except WebSocketDisconnect:
            pass
        except Exception as exc:  # noqa: BLE001
            logger.warning("ws.pty_to_ws_error", error=str(exc))

    async def ws_to_pty() -> None:
        try:
            while not process.closed:
                raw = await websocket.receive_text()
                msg = json.loads(raw)
                kind = msg.get("type")
                if kind == "input":
                    await process.write(base64.b64decode(msg.get("data", "")))
                    await session_manager.touch(session.id)
                elif kind == "resize":
                    await process.resize(int(msg.get("rows", 24)), int(msg.get("cols", 80)))
                elif kind == "ping":
                    await _send(websocket, {"type": "pong"})
                else:
                    await _send(websocket, {"type": "error", "message": f"unknown_frame:{kind}"})
        except WebSocketDisconnect:
            pass
        except Exception as exc:  # noqa: BLE001
            logger.warning("ws.ws_to_pty_error", error=str(exc))

    start = time.monotonic()
    try:
        await asyncio.gather(pty_to_ws(), ws_to_pty())
    finally:
        duration_ms = int((time.monotonic() - start) * 1000)
        await process.kill()
        await terminal_audit.record_session_lifecycle(
            session_id=session.id,
            tenant_id=principal.tenant_id,
            project_id=principal.project_id,
            actor_id=principal.user_id,
            event="closed",
            payload={"duration_ms": duration_ms},
        )
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass


__all__ = ["router"]
