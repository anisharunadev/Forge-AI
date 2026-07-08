"""Tests for the forge-core subprocess bridge in ``gsd_wrapper._dispatch``.

These tests pin the migration from ``@opengsd/gsd-core`` (stub) to the
real ``@forge-ai/forge-core`` engine. They guard four properties:

1. The wrapper no longer imports the dead ``opengsd_gsd_core`` symbol.
2. The dispatch path invokes the engine's launcher
   (``packages/forge-core/forge-core/bin/forge_run``) with the
   ``capability invoke`` subcommand and the opaque ``gsd:*`` identifier
   preserved verbatim (DL-024 white-labeling).
3. JSON stdout from the engine is parsed into ``output``; non-zero exit
   codes surface stderr in ``error`` without a silent stub-echo fallback.
4. The cwd of the subprocess is rooted inside ``packages/forge-core``
   so the engine can resolve its own ``.gsd/`` config.
"""

from __future__ import annotations

import inspect
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _fake_proc(*, returncode: int, stdout: bytes, stderr: bytes = b""):
    """Return an async-context-manager-compatible fake subprocess."""

    proc = MagicMock()
    proc.returncode = returncode
    proc.communicate = AsyncMock(return_value=(stdout, stderr))
    proc.wait = AsyncMock(return_value=returncode)
    return proc


# ---------------------------------------------------------------------------
# Source-level regression guard
# ---------------------------------------------------------------------------


def test_dispatch_does_not_import_opengsd_gsd_core():
    """The dead ``opengsd_gsd_core`` import must never return."""
    from backend.app.agents.tools import gsd_wrapper

    src = inspect.getsource(gsd_wrapper)
    assert "opengsd_gsd_core" not in src, (
        "gsd_wrapper.py must not reference the removed opengsd_gsd_core "
        "stub-import path. Subprocess-bridge to forge-core only."
    )
    # The new dispatch path must be present.
    assert "_FORGE_RUN_BIN" in src
    assert "capability" in src
    assert "invoke" in src


# ---------------------------------------------------------------------------
# Subprocess invocation shape
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_invokes_forge_run_capability_invoke():
    """Dispatch must call forge_run with the capability subcommand and
    pass the opaque ``gsd:*`` identifier verbatim through ``--capability``.
    """
    from backend.app.agents.tools.gsd_wrapper import _FORGE_CORE_ROOT, _dispatch

    fake = _fake_proc(returncode=0, stdout=b'{"ok":true}')

    with patch(
        "backend.app.agents.tools.gsd_wrapper.asyncio.create_subprocess_exec",
        new=AsyncMock(return_value=fake),
    ) as exec_mock:
        result = await _dispatch(
            tenant_id="t-1",
            project_id="p-1",
            user_id="u-1",
            internal_cmd="gsd:phase:discovery",
            args={"foo": "bar"},
        )

    # Subprocess was called exactly once.
    assert exec_mock.await_count == 1
    args, kwargs = exec_mock.call_args

    # Positional args: forge_run, capability, invoke, --capability, <id>, --args, <json>, --json-errors  # noqa: E501
    pos = list(args)
    assert pos[0].endswith("forge_run"), pos
    assert tuple(pos[1:5]) == ("capability", "invoke", "--capability", "gsd:phase:discovery")

    # The opaque identifier is preserved verbatim — no translation.
    assert "gsd:phase:discovery" in pos

    # --args carries tenant / project / user / args as JSON.
    args_idx = pos.index("--args")
    payload = json.loads(pos[args_idx + 1])
    assert payload == {
        "tenantId": "t-1",
        "projectId": "p-1",
        "userId": "u-1",
        "args": {"foo": "bar"},
    }

    # --json-errors is set.
    assert "--json-errors" in pos

    # cwd is rooted inside packages/forge-core so the engine resolves config.
    assert kwargs["cwd"] == str(_FORGE_CORE_ROOT)
    assert Path(kwargs["cwd"]).name == "forge-core"

    # Result reflects the subprocess exit.
    assert result["ok"] is True
    assert result["command"] == "gsd:phase:discovery"


# ---------------------------------------------------------------------------
# Subprocess success / failure handling
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_returns_ok_on_subprocess_success():
    """When forge-run exits 0 with JSON stdout, dispatch returns ok=True
    and parses ``output``."""
    from backend.app.agents.tools.gsd_wrapper import _dispatch

    payload = {"discovery": {"found": True, "items": ["a", "b"]}}
    fake = _fake_proc(returncode=0, stdout=json.dumps(payload).encode())

    with patch(
        "backend.app.agents.tools.gsd_wrapper.asyncio.create_subprocess_exec",
        new=AsyncMock(return_value=fake),
    ):
        result = await _dispatch(
            tenant_id="t-1",
            project_id="p-1",
            user_id="u-1",
            internal_cmd="gsd:intel:scan-repo",
            args={},
        )

    assert result["ok"] is True
    assert result["command"] == "gsd:intel:scan-repo"
    assert result["output"] == payload
    assert result["error"] is None


@pytest.mark.asyncio
async def test_dispatch_returns_error_on_subprocess_failure():
    """Non-zero exit surfaces stderr in ``error`` and ok=False."""
    from backend.app.agents.tools.gsd_wrapper import _dispatch

    fake = _fake_proc(
        returncode=2,
        stdout=b"",
        stderr=b'{"ok":false,"reason":"unknown_capability","message":"gsd:ideate:brainstorm not registered"}',  # noqa: E501
    )

    with patch(
        "backend.app.agents.tools.gsd_wrapper.asyncio.create_subprocess_exec",
        new=AsyncMock(return_value=fake),
    ):
        result = await _dispatch(
            tenant_id="t-1",
            project_id="p-1",
            user_id="u-1",
            internal_cmd="gsd:ideate:brainstorm",
            args={"topic": "rate limiting"},
        )

    assert result["ok"] is False
    assert result["command"] == "gsd:ideate:brainstorm"
    assert "unknown_capability" in (result["error"] or "")
    assert result["output"] is None


@pytest.mark.asyncio
async def test_dispatch_handles_non_json_stdout_gracefully():
    """If the engine returns non-JSON stdout on a successful exit, dispatch
    wraps the raw text under ``output.raw`` rather than raising."""
    from backend.app.agents.tools.gsd_wrapper import _dispatch

    fake = _fake_proc(returncode=0, stdout=b"phase complete\n")

    with patch(
        "backend.app.agents.tools.gsd_wrapper.asyncio.create_subprocess_exec",
        new=AsyncMock(return_value=fake),
    ):
        result = await _dispatch(
            tenant_id="t-1",
            project_id="p-1",
            user_id="u-1",
            internal_cmd="gsd:phase:complete",
            args={"phase": 3},
        )

    assert result["ok"] is True
    assert result["output"] == {"raw": "phase complete"}


# ---------------------------------------------------------------------------
# DL-024 regression
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_preserves_opaque_internal_names():
    """DL-024: the opaque ``gsd:*`` internal command must flow into the
    subprocess untouched — no translation to ``forge-*`` or any product
    name.
    """
    from backend.app.agents.tools.gsd_wrapper import _dispatch

    fake = _fake_proc(returncode=0, stdout=b"{}")
    with patch(
        "backend.app.agents.tools.gsd_wrapper.asyncio.create_subprocess_exec",
        new=AsyncMock(return_value=fake),
    ) as exec_mock:
        await _dispatch(
            tenant_id="t-1",
            project_id="p-1",
            user_id="u-1",
            internal_cmd="gsd:sec:incident",
            args={},
        )

    args = exec_mock.call_args[0]
    cap_idx = list(args).index("--capability")
    # The very next positional argument is the opaque identifier.
    assert args[cap_idx + 1] == "gsd:sec:incident"
    # It must NOT have been rewritten to a forge-* name or product string.
    assert not str(args[cap_idx + 1]).startswith("forge-")


# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------


def test_forge_run_bin_points_into_packages_forge_core():
    """_FORGE_RUN_BIN must resolve to ``packages/forge-core/forge-core/bin/forge_run``."""
    from backend.app.agents.tools.gsd_wrapper import _FORGE_CORE_ROOT, _FORGE_RUN_BIN

    assert _FORGE_CORE_ROOT.name == "forge-core"
    assert _FORGE_RUN_BIN.name == "forge_run"
    assert _FORGE_RUN_BIN.parent.name == "bin"
    assert _FORGE_RUN_BIN.parent.parent.name == "forge-core"
    assert _FORGE_RUN_BIN.parent.parent.parent == _FORGE_CORE_ROOT
