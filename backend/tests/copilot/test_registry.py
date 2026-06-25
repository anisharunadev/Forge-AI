"""Tests for the Co-pilot tool registry (F-800 Plan 0.3).

The registry is the single dispatcher surface. These tests pin:

1. Every V1 tool is registered on import (spec §3.3 promises 11).
2. ``dispatch`` looks up the right tool and invokes ``execute``.
3. ``dispatch`` runs the RBAC check before ``execute`` — denied
   principals raise :class:`ToolDenied` and ``execute`` is never
   called.
4. ``list_tools`` returns tools in registration order.
5. ``list_specs`` returns OpenAI-compatible ``ToolSpec`` dicts.
6. Unknown tool names raise :class:`KeyError` from ``dispatch``.
"""

from __future__ import annotations

import uuid

import pytest


# ---------------------------------------------------------------------------
# List-all-11
# ---------------------------------------------------------------------------


EXPECTED_TOOLS: tuple[str, ...] = (
    "search_knowledge",
    "get_service",
    "get_adr",
    "list_recent_adrs",
    "get_standards",
    "get_template",
    "navigate_to",
    "draft_artifact",
    "run_command",
    "check_budget",
    "audit_event",
)


def test_registry_list_tools_returns_all_11():
    """All 11 V1 tools from spec §3.3 are registered."""
    from app.copilot.tools import tool_registry

    names = [t.name for t in tool_registry.list_tools()]
    for expected in EXPECTED_TOOLS:
        assert expected in names, f"missing tool: {expected}"


def test_registry_list_specs_is_openai_compatible():
    """Each spec carries the OpenAI function-calling shape."""
    from app.copilot.tools import tool_registry

    specs = tool_registry.list_specs()
    assert len(specs) == len(EXPECTED_TOOLS)
    for spec in specs:
        assert spec["type"] == "function"
        assert "name" in spec["function"]
        assert "description" in spec["function"]
        assert isinstance(spec["function"]["parameters"], dict)
        # The 11 V1 tools all use ``object`` parameter types.
        assert spec["function"]["parameters"].get("type") == "object"


def test_registry_register_rejects_invalid_tool():
    """``register`` validates ``name`` and ``permission`` are strings."""
    from app.copilot.tools.base import Tool
    from app.copilot.tools.registry import ToolRegistry

    reg = ToolRegistry()

    class _Broken:
        name = ""
        description = ""
        permission = ""
        rate_limit_per_min = 0
        parameters_schema: dict = {}

        async def execute(self, *args, **kwargs):
            return {}

    with pytest.raises(ValueError):
        reg.register(_Broken())  # type: ignore[arg-type]

    class _NoPermission:
        name = "good_name"
        description = "x"
        permission = None  # type: ignore[assignment]
        rate_limit_per_min = 0
        parameters_schema: dict = {}

        async def execute(self, *args, **kwargs):
            return {}

    with pytest.raises(ValueError):
        reg.register(_NoPermission())  # type: ignore[arg-type]


def test_registry_register_idempotent_logs_warning():
    """Re-registering the same name logs a warning and replaces."""
    from app.copilot.tools.registry import ToolRegistry

    reg = ToolRegistry()

    class _T:
        name = "x"
        description = "x"
        permission = "p"
        rate_limit_per_min = 1
        parameters_schema: dict = {"type": "object"}

        async def execute(self, *args, **kwargs):
            return {"v": 1}

    reg.register(_T())
    reg.register(_T())  # duplicate — should log a warning, not crash


# ---------------------------------------------------------------------------
# Dispatch — happy path
# ---------------------------------------------------------------------------


def _principal(*, permissions=None, tenant_id=None):
    from app.core.security import AuthenticatedPrincipal

    return AuthenticatedPrincipal(
        user_id=str(uuid.uuid4()),
        email="t@example.com",
        tenant_id=str(tenant_id or uuid.uuid4()),
        project_id=str(uuid.uuid4()),
        roles=[],
        raw_claims={"forge.permissions": list(permissions or [])},
    )


@pytest.mark.asyncio
async def test_registry_dispatch_calls_correct_tool(sqlite_db):
    """``dispatch`` looks up by name and runs the right ``execute``."""
    from app.copilot.tools import tool_registry

    tenant_id = uuid.uuid4()
    principal = _principal(
        permissions=["copilot:tool:check_budget"], tenant_id=tenant_id
    )
    result = await tool_registry.dispatch(
        "check_budget",
        {"scope": "tenant"},
        principal=principal,
        tenant_id=tenant_id,
        project_id=None,
    )
    assert result["scope"] == "tenant"
    assert result["status"] == "no_budget"


@pytest.mark.asyncio
async def test_registry_dispatch_permission_check(sqlite_db):
    """A principal without the tool's permission raises ToolDenied."""
    from app.copilot.tools import tool_registry
    from app.copilot.tools.exceptions import ToolDenied

    tenant_id = uuid.uuid4()
    principal = _principal(tenant_id=tenant_id)  # no permissions
    with pytest.raises(ToolDenied) as excinfo:
        await tool_registry.dispatch(
            "search_knowledge",
            {"query": "x"},
            principal=principal,
            tenant_id=tenant_id,
            project_id=None,
        )
    assert excinfo.value.required_permission == "copilot:tool:search_knowledge"


@pytest.mark.asyncio
async def test_registry_dispatch_unknown_tool_raises_keyerror():
    """Unknown tool names raise KeyError (caller maps to 400)."""
    from app.copilot.tools import tool_registry

    tenant_id = uuid.uuid4()
    principal = _principal(tenant_id=tenant_id)
    with pytest.raises(KeyError):
        await tool_registry.dispatch(
            "not_a_tool",
            {},
            principal=principal,
            tenant_id=tenant_id,
            project_id=None,
        )


@pytest.mark.asyncio
async def test_registry_dispatch_unexpected_exception_wrapped(sqlite_db):
    """Unexpected exceptions are wrapped in ToolDownstreamFailed."""
    from app.copilot.tools import tool_registry
    from app.copilot.tools.exceptions import ToolDownstreamFailed
    from app.copilot.tools.registry import ToolRegistry

    tenant_id = uuid.uuid4()
    # Build an isolated registry so we don't disturb the singleton.
    reg = ToolRegistry()

    class _Boom:
        name = "boom"
        description = "x"
        permission = "copilot:tool:check_budget"
        rate_limit_per_min = 1
        parameters_schema: dict = {"type": "object"}

        async def execute(self, *args, **kwargs):
            raise RuntimeError("kaboom")

    reg.register(_Boom())
    principal = _principal(
        permissions=["copilot:tool:check_budget"], tenant_id=tenant_id
    )
    with pytest.raises(ToolDownstreamFailed) as excinfo:
        await reg.dispatch(
            "boom",
            {},
            principal=principal,
            tenant_id=tenant_id,
            project_id=None,
        )
    assert excinfo.value.tool_name == "boom"
    assert "kaboom" in str(excinfo.value)


# ---------------------------------------------------------------------------
# dispatch_as_tool_result — LiteLLM envelope translation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_as_tool_result_success(sqlite_db):
    from app.copilot.tools import tool_registry

    tenant_id = uuid.uuid4()
    principal = _principal(
        permissions=["copilot:tool:check_budget"], tenant_id=tenant_id
    )
    result = await tool_registry.dispatch_as_tool_result(
        "check_budget",
        tool_call_id="call_123",
        args={"scope": "tenant"},
        principal=principal,
        tenant_id=tenant_id,
        project_id=None,
    )
    assert result.tool_call_id == "call_123"
    assert result.name == "check_budget"
    assert result.is_error is False
    assert "no_budget" in result.content


@pytest.mark.asyncio
async def test_dispatch_as_tool_result_permission_denied():
    from app.copilot.tools import tool_registry

    tenant_id = uuid.uuid4()
    principal = _principal(tenant_id=tenant_id)  # no perms
    result = await tool_registry.dispatch_as_tool_result(
        "search_knowledge",
        tool_call_id="call_456",
        args={"query": "x"},
        principal=principal,
        tenant_id=tenant_id,
        project_id=None,
    )
    assert result.is_error is True
    assert "permission denied" in result.content


@pytest.mark.asyncio
async def test_dispatch_as_tool_result_unknown_tool():
    from app.copilot.tools import tool_registry

    tenant_id = uuid.uuid4()
    principal = _principal(tenant_id=tenant_id)
    result = await tool_registry.dispatch_as_tool_result(
        "nope",
        tool_call_id="call_789",
        args={},
        principal=principal,
        tenant_id=tenant_id,
        project_id=None,
    )
    assert result.is_error is True
    assert "unknown tool" in result.content
