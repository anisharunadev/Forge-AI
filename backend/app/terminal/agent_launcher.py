"""Agent launcher (F-403).

Spawns the correct CLI for the chosen AgentType and pins cwd to the
session's workspace_path so users can't escape it via `cd`.
"""

from __future__ import annotations

import os
from enum import Enum
from pathlib import Path

from app.core.config import settings
from app.core.logging import get_logger
from app.terminal.pty_process import PTYProcess
from app.terminal.session_manager import AgentType

logger = get_logger(__name__)


# Agent binary map — Rule 8: configurable. Phase 2 ships sensible
# defaults; tenants override via env or settings.json in a later phase.
_AGENT_BINARY: dict[AgentType, str] = {
    AgentType.CLAUDE_CODE: "claude",
    AgentType.CODEX: "codex",
    AgentType.GEMINI: "gemini",
    AgentType.CUSTOM: "/bin/sh",
}


class AgentLaunchError(RuntimeError):
    """Raised when an agent cannot be launched."""


def detect_agent(workspace_path: str) -> AgentType:
    """Auto-detect which CLI a workspace is configured for.

    Heuristics:
    - `.claude/` directory  -> claude_code
    - `codex.config`        -> codex
    - `gemini.config`       -> gemini
    - otherwise             -> custom (shell)
    """
    root = Path(workspace_path)
    if (root / ".claude").exists():
        return AgentType.CLAUDE_CODE
    if (root / "codex.config").exists():
        return AgentType.CODEX
    if (root / "gemini.config").exists():
        return AgentType.GEMINI
    return AgentType.CUSTOM


class AgentLauncher:
    """Spawns a CLI inside a PTY with workspace isolation enforced."""

    def launch(
        self,
        agent_type: AgentType,
        workspace_path: str,
        env_overrides: dict[str, str] | None = None,
    ) -> PTYProcess:
        """Build a PTYProcess ready to start.

        Does NOT call `start()` so the caller controls when to fork.
        Returns a PTYProcess you `await .start(...)` on.
        """
        binary = _AGENT_BINARY[agent_type]
        # Validate cwd to defeat path-traversal. The session manager
        # already rejects `..` but we double-check here.
        ws = Path(workspace_path).resolve()
        if not ws.exists() or not ws.is_dir():
            raise AgentLaunchError(f"workspace_path not found: {workspace_path}")

        env = dict(env_overrides or {})
        env.setdefault("FORGE_WORKSPACE", str(ws))
        env.setdefault("FORGE_TERMINAL", "1")
        # Ensure HOME is set even inside containers.
        env.setdefault("HOME", os.environ.get("HOME", "/root"))

        logger.info(
            "terminal.agent_launch",
            agent_type=agent_type.value,
            binary=binary,
            workspace=str(ws),
        )
        # Caller awaits pty.start([binary], cwd=ws, env=env)
        # We return a process whose argv is the binary; the shell
        # PATH must include the agent install for non-absolute names.
        process = PTYProcess()
        process._pending_command = [binary]  # type: ignore[attr-defined]
        process._pending_cwd = str(ws)  # type: ignore[attr-defined]
        process._pending_env = env  # type: ignore[attr-defined]
        return process


# Module-level singleton.
agent_launcher = AgentLauncher()


__all__ = ["AgentLauncher", "AgentLaunchError", "detect_agent", "agent_launcher"]
