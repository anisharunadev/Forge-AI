"""WebSocket endpoint for the Ideation realtime workflow (F-210).

Wire format (client -> server):
    {"type": "auth", "token": "<jwt>"}
    {"type": "intervene", "action": "skip|retry|modify|cancel", "step": "<name>", "payload": {}}
    {"type": "ping"}

Wire format (server -> client):
    {"type": "ready", "session_id": "<uuid>"}
    {"type": "state", "state": <WorkflowState.to_dict()>}
    {"type": "step_started", "step": "<name>"}
    {"type": "step_completed", "step": "<name>", "result": {...}}
    {"type": "step_failed", "step": "<name>", "error": "<msg>"}
    {"type": "session_completed", "outputs": {...}}
    {"type": "error", "message": "<msg>"}
    {"type": "pong"}
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.core.config import settings
from app.core.logging import get_logger
from app.core.security import principal_from_token
from app.services.ideation.realtime_workflow import (
    realtime_workflow,
    serialize_event,
)

logger = get_logger(__name__)
router = APIRouter()


async def _send(ws: WebSocket, payload: dict[str, Any]) -> None:
    try:
        await ws.send_text(json.dumps(payload))
    except Exception:  # noqa: BLE001
        pass


@router.websocket("/ws/ideation/{session_id}")
async def ideation_workflow_websocket(
    websocket: WebSocket,
    session_id: str,
    token: str | None = Query(default=None),
) -> None:
    """Stream ideation workflow progress + accept interventions."""
    await websocket.accept()

    principal = None
    if token:
        try:
            principal = principal_from_token(token)
        except Exception as exc:  # noqa: BLE001
            await _send(websocket, {"type": "error", "message": f"auth_failed:{exc}"})
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    if principal is None:
        # Wait for the first frame to carry auth.
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
            await _send(websocket, {"type": "error", "message": f"auth_failed:{exc}"})
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    try:
        state = await realtime_workflow.get_workflow_state(
            session_id, tenant_id=principal.tenant_id
        )
    except LookupError:
        await _send(websocket, {"type": "error", "message": "session_not_found"})
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    except PermissionError:
        await _send(websocket, {"type": "error", "message": "tenant_mismatch"})
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await _send(websocket, {"type": "ready", "session_id": session_id})
    await _send(websocket, {"type": "state", "state": state.to_dict()})

    # Last-seen step pointer for diffing on subsequent polls.
    last_step_state: dict[str, str] = {
        s["name"]: s["status"] for s in state.steps
    }

    async def push_updates() -> None:
        nonlocal last_step_state
        while True:
            try:
                cur = await realtime_workflow.get_workflow_state(
                    session_id, tenant_id=principal.tenant_id
                )
            except Exception as exc:  # noqa: BLE001
                await _send(
                    websocket,
                    {"type": "error", "message": f"state_fetch_failed:{exc}"},
                )
                return
            cur_state = {s["name"]: s["status"] for s in cur.steps}
            for step_name, status_value in cur_state.items():
                if last_step_state.get(step_name) != status_value:
                    if status_value == "running":
                        await _send(
                            websocket,
                            {"type": "step_started", "step": step_name},
                        )
                    elif status_value == "completed":
                        # Find the matching result so the client gets it inline.
                        step_payload = next(
                            (s for s in cur.steps if s["name"] == step_name),
                            None,
                        )
                        await _send(
                            websocket,
                            {
                                "type": "step_completed",
                                "step": step_name,
                                "result": (step_payload or {}).get("result", {}),
                            },
                        )
                    elif status_value == "failed":
                        step_payload = next(
                            (s for s in cur.steps if s["name"] == step_name),
                            None,
                        )
                        await _send(
                            websocket,
                            {
                                "type": "step_failed",
                                "step": step_name,
                                "error": (step_payload or {}).get("error"),
                            },
                        )
            last_step_state = cur_state
            if cur.status in ("completed", "failed", "cancelled"):
                await _send(
                    websocket,
                    {
                        "type": "session_completed"
                        if cur.status == "completed"
                        else "session_terminated",
                        "status": cur.status,
                        "outputs": cur.outputs,
                    },
                )
                return
            await asyncio.sleep(0.5)

    async def read_client() -> None:
        while True:
            try:
                raw = await websocket.receive_text()
            except WebSocketDisconnect:
                return
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await _send(websocket, {"type": "error", "message": "invalid_frame"})
                continue
            kind = msg.get("type")
            if kind == "ping":
                await _send(websocket, {"type": "pong"})
            elif kind == "intervene":
                action = msg.get("action")
                if not action:
                    await _send(
                        websocket,
                        {"type": "error", "message": "missing_intervention_action"},
                    )
                    continue
                try:
                    new_state = await realtime_workflow.intervene(
                        session_id,
                        action,
                        tenant_id=principal.tenant_id,
                        step=msg.get("step"),
                        payload=msg.get("payload") or {},
                        actor_id=principal.user_id,
                    )
                except ValueError as exc:
                    await _send(
                        websocket,
                        {"type": "error", "message": f"intervention_failed:{exc}"},
                    )
                    continue
                await _send(
                    websocket, {"type": "state", "state": new_state.to_dict()}
                )
            else:
                await _send(
                    websocket, {"type": "error", "message": f"unknown_frame:{kind}"}
                )

    try:
        await asyncio.gather(push_updates(), read_client())
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass


__all__ = ["router", "serialize_event"]
