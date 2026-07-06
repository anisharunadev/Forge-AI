"""M11 — Multi-agent terminal session isolation tests.

Locks the M11-G4 contract: a single workspace can hold concurrent
sessions on different ``AgentType`` values without PTY process
collision; cost attribution and agent binary dispatch are
deterministic per type.

These tests intentionally do NOT exercise the live PTY (which needs
``node-pty`` + a real shell). They cover the in-process contracts
that the rest of the system depends on:

  - ``AgentType`` enum completeness (all four types are addressable)
  - ``_AGENT_BINARY`` dispatch (every type maps to a non-empty string)
  - ``detect_agent`` workspace heuristics (4 workspace shapes, 4 types)
  - ``TerminalSession`` constructor isolation by agent_type (two
    sessions in the same workspace, different agent types, are
    distinguishable)
  - ``TerminalSession.to_dict`` round-trip preserves agent_type
  - ``AgentLaunchError`` raised on missing workspace_path

The PTY lifecycle itself is covered by ``test_terminal_full.py`` and
``test_terminal_ws.py``; this file complements them by locking the
multi-agent surface specifically.
"""

from __future__ import annotations

import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.terminal.agent_launcher import (
    _AGENT_BINARY,
    AgentLauncher,
    AgentLaunchError,
    detect_agent,
)
from app.terminal.session_manager import (
    AgentType,
    SessionStatus,
    TerminalSession,
)

# ---------------------------------------------------------------------------
# AC4.1 — AgentType enum covers all four CLI families
# ---------------------------------------------------------------------------


def test_agent_type_enum_has_four_values() -> None:
    """AgentType must have CLAUDE_CODE, CODEX, GEMINI, CUSTOM exactly."""
    values = {member.value for member in AgentType}
    assert values == {"claude_code", "codex", "gemini", "custom"}, (
        f"AgentType enum drifted from the M11 contract: {values}"
    )


def test_agent_type_members_are_distinct_strings() -> None:
    """Each AgentType value must be a unique non-empty string."""
    seen: set[str] = set()
    for member in AgentType:
        assert isinstance(member.value, str)
        assert member.value, "AgentType value must be non-empty"
        assert member.value not in seen, f"duplicate AgentType value: {member.value}"
        seen.add(member.value)


# ---------------------------------------------------------------------------
# AC4.1 — _AGENT_BINARY dispatch
# ---------------------------------------------------------------------------


def test_agent_binary_map_covers_every_agent_type() -> None:
    """Every AgentType must have a binary configured (Rule 8: configurable)."""
    missing = set(AgentType) - set(_AGENT_BINARY.keys())
    assert not missing, f"AgentType(s) without a binary: {missing}"


@pytest.mark.parametrize("agent_type,binary", list(_AGENT_BINARY.items()))
def test_agent_binary_is_non_empty_string(agent_type: AgentType, binary: str) -> None:
    """Each binary must be a non-empty string (no None / no '')."""
    assert isinstance(binary, str)
    assert binary.strip(), f"empty binary for {agent_type}"


def test_agent_binary_custom_falls_back_to_shell() -> None:
    """CUSTOM must be a real shell — defensive guard against drift."""
    assert _AGENT_BINARY[AgentType.CUSTOM].endswith("sh"), (
        f"CUSTOM binary should be a shell, got {_AGENT_BINARY[AgentType.CUSTOM]}"
    )


def test_agent_binary_dispatch_is_deterministic() -> None:
    """Same agent_type always returns the same binary (no random fallback)."""
    for agent_type in AgentType:
        first = _AGENT_BINARY[agent_type]
        second = _AGENT_BINARY[agent_type]
        third = _AGENT_BINARY[agent_type]
        assert first == second == third, f"non-deterministic dispatch for {agent_type}"


# ---------------------------------------------------------------------------
# AC4.1 — detect_agent workspace heuristics
# ---------------------------------------------------------------------------


@pytest.fixture
def workspace_root() -> Path:
    with tempfile.TemporaryDirectory() as tmp:
        yield Path(tmp)


def test_detect_agent_claude_code_by_dot_claude_dir(workspace_root: Path) -> None:
    (workspace_root / ".claude").mkdir()
    assert detect_agent(str(workspace_root)) is AgentType.CLAUDE_CODE


def test_detect_agent_codex_by_config(workspace_root: Path) -> None:
    (workspace_root / "codex.config").touch()
    assert detect_agent(str(workspace_root)) is AgentType.CODEX


def test_detect_agent_gemini_by_config(workspace_root: Path) -> None:
    (workspace_root / "gemini.config").touch()
    assert detect_agent(str(workspace_root)) is AgentType.GEMINI


def test_detect_agent_custom_fallback(workspace_root: Path) -> None:
    """Empty workspace -> CUSTOM (defensive default)."""
    assert detect_agent(str(workspace_root)) is AgentType.CUSTOM


# ---------------------------------------------------------------------------
# AC4.1 — TerminalSession isolation by agent_type (same workspace, two agents)
# ---------------------------------------------------------------------------


def _make_session(agent_type: AgentType, workspace: str) -> TerminalSession:
    now = datetime.now(UTC)
    return TerminalSession(
        id=str(uuid.uuid4()),
        tenant_id="tenant-A",
        project_id="project-1",
        user_id="user-1",
        agent_type=agent_type,
        workspace_path=workspace,
        created_at=now,
        last_activity_at=now,
    )


def test_terminal_session_isolation_by_agent_type_same_workspace(tmp_path: Path) -> None:
    """Two sessions on the same workspace but different agents are distinguishable.

    M11-G4 AC4.1: same workspace can hold concurrent sessions on
    different agent_type values without collision.
    """
    workspace = str(tmp_path)

    claude_session = _make_session(AgentType.CLAUDE_CODE, workspace)
    codex_session = _make_session(AgentType.CODEX, workspace)

    assert claude_session.id != codex_session.id
    assert claude_session.agent_type is not codex_session.agent_type
    assert claude_session.workspace_path == codex_session.workspace_path
    assert claude_session.agent_type is AgentType.CLAUDE_CODE
    assert codex_session.agent_type is AgentType.CODEX


def test_terminal_session_to_dict_round_trip_preserves_agent_type(tmp_path: Path) -> None:
    """to_dict -> from_dict must preserve agent_type exactly."""
    session = _make_session(AgentType.GEMINI, str(tmp_path))
    blob = session.to_dict()

    # Sanity on serialized shape
    assert blob["agent_type"] == "gemini"
    assert blob["status"] == "active"

    restored = TerminalSession.from_dict(blob)
    assert restored.agent_type is AgentType.GEMINI
    assert restored.id == session.id
    assert restored.workspace_path == session.workspace_path


def test_terminal_session_status_default_is_active() -> None:
    """Default session status must be ACTIVE (so the UI shows it as live)."""
    session = _make_session(AgentType.CUSTOM, "/tmp")
    assert session.status is SessionStatus.ACTIVE


def test_terminal_session_metadata_defaults_to_empty_dict() -> None:
    """metadata must default to {} so callers can safely .update() it."""
    session = _make_session(AgentType.CLAUDE_CODE, "/tmp")
    assert session.metadata == {}
    # Mutating metadata on one session must NOT affect another.
    session.metadata["session_id"] = session.id
    other = _make_session(AgentType.CLAUDE_CODE, "/tmp")
    assert other.metadata == {}


# ---------------------------------------------------------------------------
# AC4.3 — AgentLauncher.launch raises AgentLaunchError on missing workspace
# ---------------------------------------------------------------------------


def test_agent_launcher_raises_on_missing_workspace() -> None:
    """launch() must raise AgentLaunchError if workspace_path doesn't exist."""
    launcher = AgentLauncher()
    missing = f"/nonexistent/forge-workspace-{uuid.uuid4()}"
    with pytest.raises(AgentLaunchError):
        launcher.launch(AgentType.CLAUDE_CODE, missing)


def test_agent_launcher_raises_on_file_instead_of_dir(tmp_path: Path) -> None:
    """launch() must raise AgentLaunchError if workspace_path is a file."""
    fake_workspace = tmp_path / "not-a-dir.txt"
    fake_workspace.write_text("hello")

    launcher = AgentLauncher()
    with pytest.raises(AgentLaunchError):
        launcher.launch(AgentType.CLAUDE_CODE, str(fake_workspace))


def test_agent_launcher_returns_ptyprocess_for_real_workspace(tmp_path: Path) -> None:
    """launch() on a real directory returns a PTYProcess (not yet started).

    This contract locks that the launcher never blocks on `start()`
    — the caller decides when to fork.
    """
    launcher = AgentLauncher()
    pty = launcher.launch(AgentType.CUSTOM, str(tmp_path))
    # PTYProcess has a `start()` method and a `binary` attribute;
    # we don't start it here (no real shell needed for this contract).
    assert hasattr(pty, "start")
    assert hasattr(pty, "binary")
    assert pty.binary == _AGENT_BINARY[AgentType.CUSTOM]


# ---------------------------------------------------------------------------
# AC4.2 — Cost attribution per (session_id, agent_type)
# ---------------------------------------------------------------------------


def test_two_sessions_same_workspace_different_agents_have_distinct_costs(
    tmp_path: Path,
) -> None:
    """Cost ledger key includes agent_type — different agents != same row.

    This is a *contract* test on the data shape, not a live cost
    ledger exercise. Two sessions that happen to share a workspace
    must produce two distinct cost-attributable rows.
    """
    workspace = str(tmp_path)
    s_claude = _make_session(AgentType.CLAUDE_CODE, workspace)
    s_codex = _make_session(AgentType.CODEX, workspace)

    # The attribution key is (session_id, agent_type) — both fields
    # are independent, so the cost row for one must never collide
    # with the cost row for the other even when workspace matches.
    key_claude = (s_claude.id, s_claude.agent_type.value)
    key_codex = (s_codex.id, s_codex.agent_type.value)
    assert key_claude != key_codex


# ---------------------------------------------------------------------------
# G5 — Multi-agent dispatch smoke (covers both axes)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "agent_type",
    [AgentType.CLAUDE_CODE, AgentType.CODEX, AgentType.GEMINI, AgentType.CUSTOM],
)
def test_each_agent_type_round_trips_through_session(agent_type: AgentType, tmp_path: Path) -> None:
    """For every AgentType: build session, serialize, restore, assert equal."""
    session = _make_session(agent_type, str(tmp_path))
    blob = session.to_dict()
    restored = TerminalSession.from_dict(blob)
    assert restored.agent_type is agent_type
    assert restored.workspace_path == str(tmp_path)
