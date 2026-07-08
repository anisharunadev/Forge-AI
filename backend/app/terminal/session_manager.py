"""Terminal session manager (F-401..F-410).

In-memory primary store, Redis-backed for distributed deployments so
session affinity isn't pinned to a single backend.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

import redis.asyncio as aioredis

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class AgentType(StrEnum):
    """Which CLI is running inside the PTY."""

    CLAUDE_CODE = "claude_code"
    CODEX = "codex"
    GEMINI = "gemini"
    CUSTOM = "custom"


class SessionStatus(StrEnum):
    ACTIVE = "active"
    IDLE = "idle"
    CLOSED = "closed"


@dataclass
class TerminalSession:
    """A live terminal session.

    `workspace_path` is enforced as the PTY cwd; the user cannot
    `cd` outside it (the launcher rewrites attempts).
    """

    id: str
    tenant_id: str
    project_id: str
    user_id: str
    agent_type: AgentType
    workspace_path: str
    created_at: datetime
    last_activity_at: datetime
    status: SessionStatus = SessionStatus.ACTIVE
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["agent_type"] = self.agent_type.value
        d["status"] = self.status.value
        d["created_at"] = self.created_at.isoformat()
        d["last_activity_at"] = self.last_activity_at.isoformat()
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TerminalSession:
        return cls(
            id=data["id"],
            tenant_id=data["tenant_id"],
            project_id=data["project_id"],
            user_id=data["user_id"],
            agent_type=AgentType(data["agent_type"]),
            workspace_path=data["workspace_path"],
            created_at=datetime.fromisoformat(data["created_at"]),
            last_activity_at=datetime.fromisoformat(data["last_activity_at"]),
            status=SessionStatus(data["status"]),
            metadata=data.get("metadata") or {},
        )


class TerminalSessionManager:
    """Process-wide singleton; Redis is the source of truth in distributed mode."""

    _KEY_PREFIX = "forge:terminal:session:"

    def __init__(self, redis_url: str | None = None) -> None:
        self._redis_url = redis_url or settings.redis_url
        self._redis: aioredis.Redis | None = None
        self._local: dict[str, TerminalSession] = {}

    async def _client(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(self._redis_url, decode_responses=True)
        return self._redis

    async def close(self) -> None:
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None

    @staticmethod
    def _key(session_id: str) -> str:
        return f"{TerminalSessionManager._KEY_PREFIX}{session_id}"

    async def create_session(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        user_id: UUID | str,
        agent_type: AgentType,
        workspace_path: str,
        metadata: dict[str, Any] | None = None,
    ) -> TerminalSession:
        """Register a new terminal session and return it."""
        if not workspace_path or ".." in workspace_path:
            raise ValueError("workspace_path must be a non-traversing absolute path")
        now = datetime.now(UTC)
        session = TerminalSession(
            id=str(uuid.uuid4()),
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            user_id=str(user_id),
            agent_type=agent_type,
            workspace_path=workspace_path,
            created_at=now,
            last_activity_at=now,
            metadata=metadata or {},
        )
        client = await self._client()
        await client.set(self._key(session.id), json.dumps(session.to_dict()))
        self._local[session.id] = session
        logger.info(
            "terminal.session.created",
            session_id=session.id,
            tenant_id=session.tenant_id,
            agent_type=agent_type.value,
        )
        return session

    async def get_session(self, session_id: str) -> TerminalSession | None:
        client = await self._client()
        raw = await client.get(self._key(session_id))
        if raw is None:
            return self._local.get(session_id)
        return TerminalSession.from_dict(json.loads(raw))

    async def list_sessions(
        self, *, tenant_id: UUID | str, user_id: UUID | str | None = None
    ) -> list[TerminalSession]:
        """List sessions visible to a tenant/user.

        We scan the keyspace; for Phase 2 this is fine — sessions are
        short-lived and the cardinality is bounded. Phase 3 will move
        the index into a Sorted Set keyed by tenant.
        """
        client = await self._client()
        out: list[TerminalSession] = []
        async for key in client.scan_iter(match=f"{self._KEY_PREFIX}*"):
            raw = await client.get(key)
            if raw is None:
                continue
            sess = TerminalSession.from_dict(json.loads(raw))
            if sess.tenant_id != str(tenant_id):
                continue
            if user_id is not None and sess.user_id != str(user_id):
                continue
            out.append(sess)
        return sorted(out, key=lambda s: s.created_at, reverse=True)

    async def close_session(self, session_id: str) -> None:
        client = await self._client()
        await client.delete(self._key(session_id))
        self._local.pop(session_id, None)
        logger.info("terminal.session.closed", session_id=session_id)

    async def touch(self, session_id: str) -> None:
        """Update last_activity_at — called on every PTY byte."""
        sess = await self.get_session(session_id)
        if sess is None:
            return
        sess.last_activity_at = datetime.now(UTC)
        client = await self._client()
        await client.set(self._key(session_id), json.dumps(sess.to_dict()))


# Process-wide singleton.
session_manager = TerminalSessionManager()


__all__ = [
    "AgentType",
    "SessionStatus",
    "TerminalSession",
    "TerminalSessionManager",
    "session_manager",
]
