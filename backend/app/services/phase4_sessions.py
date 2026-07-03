"""F17 — Realtime / A2A / Long-running sessions (Phase 4).

Session lifecycle is the heart of F17. Sessions have:
  - ``session_id`` (UUID v7 ideally — we use v4 here for simplicity)
  - type: realtime | a2a | background | eval | interaction | assistant | thread
  - status: active | disconnected | cancelled | expired
  - expires_at + last_heartbeat_at (DB-driven, survives restarts)

Realtime WebSocket proxy is intentionally minimal — production wiring
would add xterm-style chunked binary framing.

ponytail: one module, six public functions. A2A discovery is a
small static payload; real A2A handshake state lives in the DB.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.core.phase4_audit_events import Phase4AuditAction
from app.core.phase4_errors import (
    RealtimeAuthExpired,
    RealtimeSessionExpired,
    SessionResumeWindowExpired,
)
from app.db.models.phase4 import (
    Phase4A2ADelegation,
    Phase4RealtimeClientSecret,
    Phase4Session,
    Phase4SessionEvent,
)
from app.db.session import get_session_factory
from app.services.audit_service import audit_service

logger = get_logger(__name__)


# Max durations per session type (seconds). The spec table from F17.
MAX_DURATIONS = {
    "realtime": 4 * 3600,
    "a2a": 3600,
    "background": 24 * 3600,
    "eval": 48 * 3600,
    "interaction": 12 * 3600,
    "assistant": 24 * 3600,
    "thread": 24 * 3600,
}

# Reconnect grace window after disconnect.
RESUME_GRACE_SECONDS = 30


# ── Sessions ─────────────────────────────────────────────────────────


async def create_session(
    *,
    tenant_id: UUID | str,
    project_id: UUID | str,
    actor_id: UUID | str | None,
    session_type: str,
    agent_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if session_type not in MAX_DURATIONS:
        raise ValueError(f"unknown_session_type:{session_type}")
    now = datetime.now(UTC)
    factory = get_session_factory()
    async with factory() as session:
        row = Phase4Session(
            id=uuid.uuid4(),
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            session_type=session_type,
            owner_user_id=actor_id,
            agent_id=agent_id,
            status="active",
            started_at=now,
            last_heartbeat_at=now,
            expires_at=now + timedelta(seconds=MAX_DURATIONS[session_type]),
            max_duration_seconds=MAX_DURATIONS[session_type],
            session_metadata=metadata or {},
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.SESSION_STARTED.value,
        target_type="session", target_id=str(row.id),
        payload={"session_type": session_type, "agent_id": agent_id},
    )
    return _session_to_dict(row)


async def heartbeat(
    session_id: UUID | str,
    tenant_id: UUID | str,
    *,
    duration_ms: int | None = None,
) -> dict[str, Any]:
    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(Phase4Session, str(session_id))
        if row is None or row.tenant_id != str(tenant_id):
            raise RealtimeAuthExpired(str(session_id))
        now = datetime.now(UTC)
        if row.expires_at <= now:
            row.status = "expired"
            await session.commit()
            raise RealtimeSessionExpired(str(session_id), row.expires_at.isoformat())
        row.last_heartbeat_at = now
        await session.commit()
        session.add(
            Phase4SessionEvent(
                id=uuid.uuid4(),
                tenant_id=str(tenant_id),
                project_id=row.project_id,
                session_id=row.id,
                event_type="heartbeat",
                duration_ms=duration_ms,
                payload={},
                occurred_at=now,
            )
        )
        await session.commit()
        await session.refresh(row)
    return _session_to_dict(row)


async def extend_session(
    session_id: UUID | str, tenant_id: UUID | str, actor_id: UUID | str, *,
    project_id: UUID | str,
    additional_seconds: int = 0,
) -> dict[str, Any]:
    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(Phase4Session, str(session_id))
        if row is None or row.tenant_id != str(tenant_id):
            raise RealtimeAuthExpired(str(session_id))
        row.expires_at = row.expires_at + timedelta(seconds=additional_seconds)
        row.max_duration_seconds += additional_seconds
        await session.commit()
        await session.refresh(row)
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.SESSION_RESUMED.value,
        target_type="session", target_id=str(session_id),
        payload={"extended_by": additional_seconds},
    )
    return _session_to_dict(row)



async def cancel_session(
    session_id: UUID | str, tenant_id: UUID | str, actor_id: UUID | str, *,
    project_id: UUID | str,
) -> None:
    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(Phase4Session, str(session_id))
        if row is None or row.tenant_id != str(tenant_id):
            return
        row.status = "cancelled"
        await session.commit()
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.SESSION_CANCELLED.value,
        target_type="session", target_id=str(session_id),
        payload={},
    )


async def expire_session(session_id: UUID | str, tenant_id: UUID | str) -> None:
    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(Phase4Session, str(session_id))
        if row is None or row.tenant_id != str(tenant_id):
            return
        row.status = "expired"
        await session.commit()
    await audit_service.record(
        tenant_id=tenant_id, project_id=row.project_id if row else "00000000-0000-0000-0000-000000000000",
        actor_id=None,
        action=Phase4AuditAction.SESSION_EXPIRED.value,
        target_type="session", target_id=str(session_id),
        payload={},
    )


async def resume_session(
    session_id: UUID | str, tenant_id: UUID | str, actor_id: UUID | str, *,
    project_id: UUID | str,
) -> dict[str, Any]:
    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(Phase4Session, str(session_id))
        if row is None or row.tenant_id != str(tenant_id):
            raise RealtimeAuthExpired(str(session_id))
        if row.status == "cancelled":
            raise SessionResumeWindowExpired(
                str(session_id),
                (row.expires_at + timedelta(seconds=RESUME_GRACE_SECONDS)).isoformat(),
            )
        if row.status == "expired" or row.expires_at <= datetime.now(UTC):
            raise RealtimeSessionExpired(str(session_id), row.expires_at.isoformat())
        row.status = "active"
        row.last_heartbeat_at = datetime.now(UTC)
        await session.commit()
        await session.refresh(row)
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.SESSION_RESUMED.value,
        target_type="session", target_id=str(session_id),
        payload={"resumed": True},
    )
    return _session_to_dict(row)


async def list_sessions(
    tenant_id: UUID | str, *,
    active_only: bool = True,
    limit: int = 100,
) -> list[dict[str, Any]]:
    factory = get_session_factory()
    async with factory() as session:
        stmt = select(Phase4Session).where(Phase4Session.tenant_id == str(tenant_id))
        if active_only:
            stmt = stmt.where(Phase4Session.status == "active")
        rows = (await session.execute(stmt.limit(limit))).scalars().all()
    return [_session_to_dict(r) for r in rows]


async def get_session(session_id: UUID | str, tenant_id: UUID | str) -> dict[str, Any] | None:
    factory = get_session_factory()
    async with factory() as session:
        row = await session.get(Phase4Session, str(session_id))
    if row is None or row.tenant_id != str(tenant_id):
        return None
    return _session_to_dict(row)


# ── Realtime client secrets ──────────────────────────────────────────


async def issue_realtime_client_secret(
    *, tenant_id: UUID | str, project_id: UUID | str, actor_id: UUID | str,
    session_id: UUID | str,
) -> dict[str, Any]:
    """Issue a 1h-TTL bearer token for WS auth.

    Spec: client_secrets are short-lived (1h). Secret plaintext returned
    exactly once.
    """
    raw = secrets.token_urlsafe(32)
    digest = hashlib_sha256(raw)
    expires_at = datetime.now(UTC) + timedelta(hours=1)
    factory = get_session_factory()
    async with factory() as session:
        session.add(
            Phase4RealtimeClientSecret(
                id=uuid.uuid4(),
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                session_id=str(session_id),
                secret_hash=digest,
                expires_at=expires_at,
            )
        )
        await session.commit()
    return {"token": raw, "session_id": str(session_id), "expires_at": expires_at.isoformat()}


def hashlib_sha256(value: str) -> str:
    return hashlib.sha256(value.encode("ascii")).hexdigest()


# ── A2A discovery + delegation ──────────────────────────────────────


def a2a_agent_card(base_url: str, *, agent_id: str = "forge-default") -> dict[str, Any]:
    return {
        "name": agent_id,
        "description": "Forge agent — delegates work via A2A",
        "url": f"{base_url}/a2a/message",
        "version": "1.0",
        "capabilities": {"streaming": False, "pushNotifications": False},
        "authentication": {"schemes": ["bearer"]},
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain"],
    }


async def record_a2a_handshake(
    tenant_id: UUID | str, project_id: UUID | str, actor_id: UUID | str | None,
    from_agent_id: str, to_agent_id: str, direction: str, *,
    jwt_jti: str | None = None,
) -> str:
    jti = jwt_jti or f"a2a-{secrets.token_hex(8)}"
    factory = get_session_factory()
    async with factory() as session:
        session.add(
            Phase4A2ADelegation(
                id=uuid.uuid4(),
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                from_agent_id=from_agent_id,
                to_agent_id=to_agent_id,
                direction=direction,
                jwt_jti=jti,
                status="pending",
                started_at=datetime.now(UTC),
                payload={},
            )
        )
        await session.commit()
    await audit_service.record(
        tenant_id=tenant_id, project_id=project_id, actor_id=actor_id,
        action=Phase4AuditAction.A2A_HANDSHAKE.value,
        target_type="a2a_delegation", target_id=jti,
        payload={"from": from_agent_id, "to": to_agent_id, "direction": direction},
    )
    return jti


# ── Helpers ──────────────────────────────────────────────────────────


def _session_to_dict(row: Phase4Session) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "session_type": row.session_type,
        "status": row.status,
        "owner_user_id": row.owner_user_id,
        "agent_id": row.agent_id,
        "started_at": row.started_at.isoformat(),
        "last_heartbeat_at": row.last_heartbeat_at.isoformat() if row.last_heartbeat_at else None,
        "expires_at": row.expires_at.isoformat(),
        "max_duration_seconds": row.max_duration_seconds,
        "metadata": row.session_metadata,
    }


__all__ = [
    "MAX_DURATIONS", "RESUME_GRACE_SECONDS",
    "create_session", "heartbeat", "extend_session", "cancel_session",
    "expire_session", "resume_session", "list_sessions", "get_session",
    "issue_realtime_client_secret", "a2a_agent_card", "record_a2a_handshake",
]