"""Phase 5 -- live audit WebSocket.

Streams new audit events to the Admin Audit Center using a Redis
Stream consumer group so multiple tabs can share one XREADGROUP
cursor. Auth uses the same JWT mechanism as the REST audit
endpoints; the token is read from the ``?token=`` query parameter
because browsers cannot set headers on the WebSocket handshake.

Wire contract:
  - On connect: client sends nothing; server emits ``{type: \"ready\"}``.
  - On new audit event: server emits ``{type: \"event\", id, action, ts}``.
  - On disconnect: consumer name is dropped on reconnect (each tab
    gets a fresh consumer name; no shared ACK state across tabs).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.core.logging import get_logger, tenant_id_ctx
from app.core.security import principal_from_token

logger = get_logger(__name__)
router = APIRouter()

GROUP = "audit-ui"
BLOCK_MS = 5000
_REDIS_URL = os.environ.get("REDIS_URL", "")


def _redis() -> aioredis.Redis | None:
    """Lazily build a Redis client; return None if REDIS_URL unset."""
    if not _REDIS_URL:
        return None
    return aioredis.from_url(_REDIS_URL, decode_responses=True)


@router.websocket("/ws/audit")
async def audit_stream(websocket: WebSocket) -> None:
    """Stream new audit events for the caller's tenant."""
    token = websocket.query_params.get("token", "")
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    try:
        principal = principal_from_token(token)
    except Exception as exc:  # noqa: BLE001
        logger.warning("ws.audit.auth_failed", error=str(exc))
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    tenant_id = str(principal.tenant_id) if getattr(principal, "tenant_id", None) else "global"
    tenant_id_ctx.set(tenant_id)

    stream_key = f"audit:{tenant_id}"
    consumer = f"audit-ui-{getattr(principal, 'actor_id', 'anon')}-{id(websocket)}"

    redis_client = _redis()
    if redis_client is None:
        # ponytail: without Redis the stream is unreachable. Accept the
        # connection, send a one-shot empty frame, and let the client
        # reconnect later when REDIS_URL is configured.
        await websocket.accept()
        await websocket.send_json({"type": "ready", "backlog_empty": True, "reason": "redis_unconfigured"})
        await websocket.close()
        return

    try:
        await redis_client.xgroup_create(stream_key, GROUP, id="0", mkstream=True)
    except aioredis.ResponseError:
        pass  # BUSYGROUP -- already exists
    except Exception as exc:  # noqa: BLE001
        logger.warning("ws.audit.xgroup_create_failed", error=str(exc))

    await websocket.accept()
    await websocket.send_json({"type": "ready"})

    try:
        while True:
            try:
                resp = await redis_client.xreadgroup(
                    GROUP,
                    consumer,
                    {stream_key: ">"},
                    count=50,
                    block=BLOCK_MS,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("ws.audit.xreadgroup_failed", error=str(exc))
                await asyncio.sleep(1.0)
                continue
            if not resp:
                continue
            for _stream, entries in resp:
                for entry_id, fields in entries:
                    try:
                        await websocket.send_json(
                            {"type": "event", "id": entry_id, **fields}
                        )
                    except Exception:
                        return
    except WebSocketDisconnect:
        return
    finally:
        try:
            await redis_client.close()
        except Exception:  # noqa: BLE001
            pass


__all__ = ["router"]
