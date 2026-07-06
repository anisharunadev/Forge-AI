"""Command Center Integration (F-411).

Lets the Command Center launch terminal sessions bound to a forge-*
command and pipe subsequent commands into a running session. Output is
buffered per-session so polling clients don't need a WebSocket.

Output buffer
-------------
Each session owns an in-memory ring of :class:`OutputChunk` rows keyed
by a monotonically increasing cursor. ``get_command_output(since=N)``
returns everything after cursor N and the new high-water mark. The
buffer is bounded (default 16 MiB / 4 KiB chunks) so a runaway
session can't OOM the backend; overflow rotates.
"""

from __future__ import annotations

import asyncio
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.services.forge_commands import UnknownForgeCommand, get_forge_command
from app.terminal.audit import terminal_audit
from app.terminal.session_manager import (
    AgentType,
    SessionStatus,
    TerminalSession,
    session_manager,
)

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Output buffer model
# ---------------------------------------------------------------------------


@dataclass
class OutputChunk:
    """One buffered slice of session output."""

    cursor: int
    data: bytes
    occurred_at: datetime

    def to_dict(self) -> dict[str, Any]:
        return {
            "cursor": self.cursor,
            "data": self.data.decode("utf-8", errors="replace"),
            "occurred_at": self.occurred_at.isoformat(),
        }


@dataclass
class _SessionBuffer:
    """Per-session ring buffer of output chunks."""

    chunks: deque[OutputChunk] = field(default_factory=deque)
    max_bytes: int = 16 * 1024 * 1024  # 16 MiB
    max_chunks: int = 4096
    _bytes: int = 0
    _next_cursor: int = 1
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def next_cursor(self) -> int:
        cur = self._next_cursor
        self._next_cursor += 1
        return cur

    def append(self, chunk: OutputChunk) -> None:
        self.chunks.append(chunk)
        self._bytes += len(chunk.data)
        while (self._bytes > self.max_bytes or len(self.chunks) > self.max_chunks) and self.chunks:
            evicted = self.chunks.popleft()
            self._bytes -= len(evicted.data)

    def slice(self, since_cursor: int) -> list[OutputChunk]:
        return [c for c in self.chunks if c.cursor > since_cursor]


# ---------------------------------------------------------------------------
# Launcher
# ---------------------------------------------------------------------------


class CommandIntegration:
    """Bridge the Command Center to the Terminal Center.

    Provides the three primitives the Command Center needs:
    :meth:`launch_session_for_command`, :meth:`inject_command`,
    :meth:`get_command_output`.
    """

    def __init__(self) -> None:
        self._buffers: dict[str, _SessionBuffer] = {}
        self._lock = asyncio.Lock()

    # -- lifecycle --------------------------------------------------------

    async def _buffer_for(self, session_id: str) -> _SessionBuffer:
        async with self._lock:
            buf = self._buffers.get(session_id)
            if buf is None:
                buf = _SessionBuffer()
                self._buffers[session_id] = buf
            return buf

    def forget(self, session_id: str) -> None:
        """Drop the buffer for a closed session."""
        self._buffers.pop(session_id, None)

    # -- launch -----------------------------------------------------------

    async def launch_session_for_command(
        self,
        forge_cmd: str,
        args: dict[str, Any],
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        user_id: UUID | str,
        agent_type: AgentType | None = None,
    ) -> TerminalSession:
        """Create a session bound to a forge-* command and pre-seed it.

        Resolves the forge command (validating it exists), then maps
        it to an agent type: ``forge-dev-*`` -> Claude Code, anything
        in ``forge-test-e2e`` / ``forge-sec-*`` -> Claude Code as a
        sensible default, otherwise the session's ``agent_type`` arg
        wins (defaulting to custom / shell).
        """
        try:
            resolved = get_forge_command(forge_cmd)
        except UnknownForgeCommand as exc:
            raise ValueError(str(exc)) from exc

        chosen = agent_type or _default_agent_for(forge_cmd, resolved.category)
        workspace_path = _workspace_path_for(args, project_id)
        description = args.get("description") or args.get("feature") or resolved.description

        session = await session_manager.create_session(
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=user_id,
            agent_type=chosen,
            workspace_path=workspace_path,
            metadata={
                "forge_cmd": forge_cmd,
                "internal_cmd": resolved.internal_cmd,
                "category": resolved.category,
                "tier": resolved.tier,
                "requires_approval": resolved.requires_approval,
                "pre_seed": description,
                "args": dict(args or {}),
            },
        )
        await terminal_audit.record_session_lifecycle(
            session_id=session.id,
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=user_id,
            event="started",
            payload={"forge_cmd": forge_cmd, "agent_type": chosen.value},
        )
        if description:
            buf = await self._buffer_for(session.id)
            buf.append(
                OutputChunk(
                    cursor=buf.next_cursor(),
                    data=f"# forge: {forge_cmd}\n# {description}\n".encode(),
                    occurred_at=datetime.now(UTC),
                )
            )
        logger.info(
            "terminal.command_integration.launched",
            session_id=session.id,
            forge_cmd=forge_cmd,
            agent_type=chosen.value,
        )
        return session

    # -- inject -----------------------------------------------------------

    async def inject_command(self, session_id: str, command: str) -> None:
        """Pipe a command into a running session's buffer.

        The session itself is driven by the WebSocket PTY (F-405); this
        method appends the command to the polling buffer so command-
        center observers see what was injected, and records it as an
        audit event. We deliberately do NOT fork here — the PTY proxy
        is the source of truth for actual execution.
        """
        session = await session_manager.get_session(session_id)
        if session is None:
            raise LookupError(f"session_not_found:{session_id}")
        if session.status == SessionStatus.CLOSED:
            raise RuntimeError(f"session_closed:{session_id}")

        buf = await self._buffer_for(session_id)
        started = time.monotonic()
        buf.append(
            OutputChunk(
                cursor=buf.next_cursor(),
                data=f"$ {command}\n".encode(),
                occurred_at=datetime.now(UTC),
            )
        )
        await terminal_audit.record_command(
            session_id=session_id,
            tenant_id=session.tenant_id,
            project_id=session.project_id,
            actor_id=session.user_id,
            command=command,
            output=b"",
            cost_estimate=0.0,
            duration_ms=int((time.monotonic() - started) * 1000),
        )

    # -- output polling ---------------------------------------------------

    async def get_command_output(
        self, session_id: str, since_cursor: int
    ) -> tuple[list[OutputChunk], int]:
        """Return chunks after ``since_cursor`` and the new high-water mark."""
        buf = await self._buffer_for(session_id)
        return list(buf.slice(since_cursor)), buf._next_cursor - 1

    async def append_output(self, session_id: str, data: bytes) -> OutputChunk:
        """Helper for the WS layer to publish output into the polling buffer."""
        buf = await self._buffer_for(session_id)
        chunk = OutputChunk(
            cursor=buf.next_cursor(),
            data=data,
            occurred_at=datetime.now(UTC),
        )
        buf.append(chunk)
        return chunk


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _default_agent_for(forge_cmd: str, category: str) -> AgentType:
    """Pick the agent CLI for a forge command.

    The Command Center is opinionated: development, ideation, and
    review tasks go to Claude Code; security + deploy + production
    promotion default to the same agent. Specialized CLIs (Codex,
    Gemini) are wired through ``agent_type`` overrides.
    """
    if category in {"dev", "ideate", "review", "arch", "learn", "flow"}:
        return AgentType.CLAUDE_CODE
    if category in {"test", "sec", "deploy", "milestone"}:
        return AgentType.CLAUDE_CODE
    return AgentType.CUSTOM


def _workspace_path_for(args: dict[str, Any], project_id: UUID | str) -> str:
    """Resolve the workspace path for the new session.

    Allows caller to override via ``args["workspace_path"]``; otherwise
    pins to ``/var/forge/workspaces/<project_id>`` so the PTY cwd is
    always the project's worktree.
    """
    explicit = args.get("workspace_path")
    if isinstance(explicit, str) and explicit:
        return explicit
    return f"/var/forge/workspaces/{project_id}"


# ---------------------------------------------------------------------------
# Singleton + session metadata helpers (exposed for tests)
# ---------------------------------------------------------------------------

command_integration = CommandIntegration()


__all__ = [
    "CommandIntegration",
    "OutputChunk",
    "command_integration",
]
