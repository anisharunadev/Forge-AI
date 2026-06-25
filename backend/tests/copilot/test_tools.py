"""Tests for the 11 V1 Co-pilot tools (F-800 Plan 0.3).

These tests pin the contract every tool must hold:

- Permission-gated execution (denied principals raise ToolDenied).
- Argument validation (missing/invalid args raise ToolArgumentInvalid).
- Tenant isolation (queries are scoped by ``tenant_id``).
- For mutating tools, the *invariants* — ``draft_artifact`` writes
  status=DRAFT, ``run_command`` returns ``confirmation_required=True``
  without executing, ``audit_event`` records through the audit service.

The :class:`sqlite_db` fixture (in ``tests/conftest.py``) provides an
in-memory engine; every DB-touching tool exercises a real round trip
through SQLAlchemy to prove the SQL is correct.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest

# Importing the modules so their SQLAlchemy tables register on the
# global metadata BEFORE ``sqlite_db`` calls ``metadata.create_all``.
from app.db.models.artifact import Artifact as _Artifact  # noqa: F401
from app.db.models.architecture import ADR as _ADR  # noqa: F401
from app.db.models.architecture_services import Service as _Service  # noqa: F401
from app.db.models.audit import AuditEvent as _AuditEvent  # noqa: F401
from app.db.models.copilot import CopilotConversation as _Conv  # noqa: F401
from app.db.models.standard import Standard as _Standard  # noqa: F401
from app.db.models.template import Template as _Template  # noqa: F401
from app.services.knowledge_graph import KGNode as _KGNode  # noqa: F401


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _principal(*, roles=None, permissions=None, tenant_id=None, project_id=None):
    from app.core.security import AuthenticatedPrincipal

    return AuthenticatedPrincipal(
        user_id=str(uuid.uuid4()),
        email="test@example.com",
        tenant_id=str(tenant_id or uuid.uuid4()),
        project_id=str(project_id or uuid.uuid4()),
        roles=list(roles or []),
        raw_claims={"forge.permissions": list(permissions or [])},
    )


# ---------------------------------------------------------------------------
# search_knowledge
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_knowledge_tool_allowed(sqlite_db):
    """A principal with the permission can search the KG."""
    from app.copilot.tools.search_knowledge import SearchKnowledgeTool
    from app.db.models.standard import Standard  # noqa: F401  (model load)
    from app.services.knowledge_graph import KGNode

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    factory = sqlite_db
    async with factory() as session:
        session.add(
            KGNode(
                tenant_id=tenant_id,
                project_id=project_id,
                node_type="service",
                name="auth-svc",
                properties={"name": "auth-svc", "description": "Authentication service"},
            )
        )
        await session.commit()

    principal = _principal(
        permissions=["copilot:tool:search_knowledge"], tenant_id=tenant_id
    )
    tool = SearchKnowledgeTool()
    result = await tool.execute(
        {"query": "auth"},
        principal=principal,
        tenant_id=tenant_id,
        project_id=project_id,
    )
    assert result["total"] == 1
    assert result["nodes"][0]["label"] == "auth-svc"
    assert result["nodes"][0]["kind"] == "service"


@pytest.mark.asyncio
async def test_search_knowledge_tool_denied(sqlite_db):
    """A principal without the permission raises ToolDenied at dispatch."""
    from app.copilot.tools import tool_registry
    from app.copilot.tools.exceptions import ToolDenied

    tenant_id = uuid.uuid4()
    principal = _principal(tenant_id=tenant_id)
    with pytest.raises(ToolDenied) as excinfo:
        await tool_registry.dispatch(
            "search_knowledge",
            {"query": "auth"},
            principal=principal,
            tenant_id=tenant_id,
            project_id=None,
        )
    assert excinfo.value.required_permission == "copilot:tool:search_knowledge"


@pytest.mark.asyncio
async def test_search_knowledge_tool_invalid_args(sqlite_db):
    """Missing query raises ToolArgumentInvalid at the tool boundary."""
    from app.copilot.tools.exceptions import ToolArgumentInvalid
    from app.copilot.tools.search_knowledge import SearchKnowledgeTool

    tenant_id = uuid.uuid4()
    tool = SearchKnowledgeTool()
    with pytest.raises(ToolArgumentInvalid) as excinfo:
        await tool.execute(
            {}, principal=_principal(tenant_id=tenant_id), tenant_id=tenant_id, project_id=None
        )
    assert excinfo.value.field == "query"


# ---------------------------------------------------------------------------
# get_service
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_service_tool(sqlite_db):
    from app.copilot.tools.get_service import GetServiceTool
    from app.db.models.architecture_services import Service, ServiceLifecycle

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    async with sqlite_db() as session:
        svc = Service(
            tenant_id=tenant_id,
            project_id=project_id,
            service_key="svc-auth",
            name="Auth Service",
            description="Authenticates users",
            owner_team="platform",
            lifecycle=ServiceLifecycle.ACTIVE,
            tier="tier-1",
            tags=["auth"],
            properties={},
        )
        session.add(svc)
        await session.commit()
        await session.refresh(svc)
        svc_id = str(svc.id)

    tool = GetServiceTool()
    result = await tool.execute(
        {"service_id": svc_id},
        principal=_principal(tenant_id=tenant_id),
        tenant_id=tenant_id,
        project_id=project_id,
    )
    assert result["found"] is True
    assert result["name"] == "Auth Service"
    assert result["service_key"] == "svc-auth"
    assert result["owner_team"] == "platform"
    assert isinstance(result["dependencies"], list)


# ---------------------------------------------------------------------------
# get_adr
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_adr_tool(sqlite_db):
    from app.copilot.tools.get_adr import GetAdrTool
    from app.db.models.architecture import ADR

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    async with sqlite_db() as session:
        adr = ADR(
            tenant_id=tenant_id,
            project_id=project_id,
            number=1,
            title="Use Postgres for OLTP",
            status="accepted",
            context="We need ACID transactions.",
            decision="We will use PostgreSQL 17.",
            consequences={"positive": ["Strong consistency"], "negative": []},
            alternatives=[],
            related_adrs=[],
        )
        session.add(adr)
        await session.commit()
        await session.refresh(adr)
        adr_id = str(adr.id)

    tool = GetAdrTool()
    result = await tool.execute(
        {"adr_id": adr_id},
        principal=_principal(tenant_id=tenant_id),
        tenant_id=tenant_id,
        project_id=project_id,
    )
    assert result["found"] is True
    assert result["title"] == "Use Postgres for OLTP"
    assert "PostgreSQL 17" in result["content"]
    assert "## Decision" in result["content"]


# ---------------------------------------------------------------------------
# list_recent_adrs
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_recent_adrs_tool(sqlite_db):
    from app.copilot.tools.list_recent_adrs import ListRecentAdrsTool
    from app.db.models.architecture import ADR

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    async with sqlite_db() as session:
        for i in range(3):
            session.add(
                ADR(
                    tenant_id=tenant_id,
                    project_id=project_id,
                    number=i + 1,
                    title=f"ADR {i + 1}",
                    status="accepted",
                    context="x",
                    decision="y",
                    consequences={},
                    alternatives=[],
                    related_adrs=[],
                )
            )
        await session.commit()

    tool = ListRecentAdrsTool()
    result = await tool.execute(
        {"limit": 10},
        principal=_principal(tenant_id=tenant_id),
        tenant_id=tenant_id,
        project_id=project_id,
    )
    assert result["total"] == 3
    assert len(result["adrs"]) == 3


# ---------------------------------------------------------------------------
# get_standards
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_standards_tool(sqlite_db):
    from app.copilot.tools.get_standards import GetStandardsTool
    from app.db.models.standard import Standard

    tenant_id = uuid.uuid4()
    async with sqlite_db() as session:
        session.add(
            Standard(
                tenant_id=tenant_id,
                name="python-style",
                content="Use black + isort.",
                status="active",
                version=1,
                metadata_={},
            )
        )
        await session.commit()

    tool = GetStandardsTool()
    result = await tool.execute(
        {"keys": ["python-style"]},
        principal=_principal(tenant_id=tenant_id),
        tenant_id=tenant_id,
        project_id=None,
    )
    assert result["missing"] == []
    assert result["standards"][0]["key"] == "python-style"
    assert "black" in result["standards"][0]["content"]


# ---------------------------------------------------------------------------
# get_template
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_template_tool(sqlite_db):
    from app.copilot.tools.get_template import GetTemplateTool
    from app.db.models.template import Template

    tenant_id = uuid.uuid4()
    async with sqlite_db() as session:
        session.add(
            Template(
                tenant_id=tenant_id,
                type="adr-madr",
                name="MADR ADR",
                content={"body": "# {{title}}"},
                variables=[{"name": "title", "required": True}],
                version=1,
            )
        )
        await session.commit()

    tool = GetTemplateTool()
    result = await tool.execute(
        {"template_key": "adr-madr"},
        principal=_principal(tenant_id=tenant_id),
        tenant_id=tenant_id,
        project_id=None,
    )
    assert result["found"] is True
    assert result["key"] == "adr-madr"
    assert result["variables"][0]["name"] == "title"


# ---------------------------------------------------------------------------
# navigate_to
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_navigate_to_tool():
    from app.copilot.tools.navigate_to import NavigateToTool

    tool = NavigateToTool()
    principal = _principal()
    result = await tool.execute(
        {"target_type": "service", "target_id": "svc-billing"},
        principal=principal,
        tenant_id=uuid.uuid4(),
        project_id=None,
    )
    assert result["deep_link"] is True
    assert result["url"] == "/architecture/services/svc-billing"

    # Explicit path for page target_type.
    page_result = await tool.execute(
        {"target_type": "page", "path": "/dashboard"},
        principal=principal,
        tenant_id=uuid.uuid4(),
        project_id=None,
    )
    assert page_result["url"] == "/dashboard"


# ---------------------------------------------------------------------------
# draft_artifact — DRAFT-only invariant
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_draft_artifact_tool_saves_as_draft(sqlite_db):
    """CRITICAL: the artifact is written with status=DRAFT, NEVER ACTIVE."""
    from sqlalchemy import select

    from app.copilot.tools.draft_artifact import DraftArtifactTool
    from app.db.models.artifact import Artifact, ArtifactStatus

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    tool = DraftArtifactTool()
    principal = _principal(tenant_id=tenant_id, project_id=project_id)
    result = await tool.execute(
        {
            "artifact_type": "adr",
            "title": "Use Postgres",
            "content": "## Context\nWe need ACID.",
            "based_on": ["kg-node-1"],
        },
        principal=principal,
        tenant_id=tenant_id,
        project_id=project_id,
    )
    assert result["status"] == "draft"
    assert result["message"]
    assert result["artifact_id"]
    assert result["review_url"].endswith(result["artifact_id"])

    # Confirm the DB row is actually DRAFT.
    async with sqlite_db() as session:
        row = (
            await session.execute(
                select(Artifact).where(Artifact.id == result["artifact_id"])
            )
        ).scalar_one()
        assert row.status == ArtifactStatus.DRAFT
        assert row.type == "adr"
        assert row.payload["title"] == "Use Postgres"


@pytest.mark.asyncio
async def test_draft_artifact_tool_never_active(sqlite_db):
    """Even if the model tries to slip an ``active`` flag in, status=DRAFT."""
    from sqlalchemy import select

    from app.copilot.tools.draft_artifact import DraftArtifactTool
    from app.db.models.artifact import Artifact, ArtifactStatus

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    tool = DraftArtifactTool()
    principal = _principal(tenant_id=tenant_id, project_id=project_id)
    # Sneak in a ``status`` hint via based_on and a leading-ACTIVE title —
    # both should be ignored; only DRAFT is acceptable.
    result = await tool.execute(
        {
            "artifact_type": "risk_register",
            "title": "ACTIVE RISK",  # title itself looks active
            "content": "risk",
            "based_on": ["status:active", "force:active"],
        },
        principal=principal,
        tenant_id=tenant_id,
        project_id=project_id,
    )
    assert result["status"] == "draft"
    async with sqlite_db() as session:
        row = (
            await session.execute(
                select(Artifact).where(Artifact.id == result["artifact_id"])
            )
        ).scalar_one()
        assert row.status == ArtifactStatus.DRAFT


# ---------------------------------------------------------------------------
# run_command — confirmation-only invariant
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_command_tool_requires_confirmation(sqlite_db):
    """CRITICAL: returns confirmation_required=True and does NOT execute."""
    from app.copilot.tools.run_command import RunCommandTool

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    tool = RunCommandTool()
    principal = _principal(
        permissions=["forge:run:forge-arch-adr"],
        tenant_id=tenant_id,
        project_id=project_id,
    )

    # Spy on route_to_gsd to prove it is NEVER called from this tool.
    with patch(
        "app.services.forge_commands.route_to_gsd", new_callable=AsyncMock
    ) as route_mock:
        result = await tool.execute(
            {
                "command_id": "forge-arch-adr",
                "inputs": {"title": "Test ADR"},
            },
            principal=principal,
            tenant_id=tenant_id,
            project_id=project_id,
        )
        route_mock.assert_not_called()

    assert result["confirmation_required"] is True
    assert result["command_id"] == "forge-arch-adr"
    assert result["approval_required"] is True
    assert "estimated_cost_usd" in result
    assert "estimated_duration_seconds" in result
    assert isinstance(result["side_effects"], list)
    assert result["message"]


@pytest.mark.asyncio
async def test_run_command_tool_denied_for_user(sqlite_db):
    """Principal without ``forge:run:<cmd>`` raises ToolDenied."""
    from app.copilot.tools.exceptions import ToolDenied
    from app.copilot.tools.run_command import RunCommandTool

    tenant_id = uuid.uuid4()
    tool = RunCommandTool()
    principal = _principal(tenant_id=tenant_id)  # no permission
    with pytest.raises(ToolDenied) as excinfo:
        await tool.execute(
            {"command_id": "forge-arch-adr"},
            principal=principal,
            tenant_id=tenant_id,
            project_id=None,
        )
    assert excinfo.value.required_permission == "forge:run:forge-arch-adr"


@pytest.mark.asyncio
async def test_run_command_tool_validates_command_id(sqlite_db):
    """Unknown command_id raises ToolArgumentInvalid, not LookupError."""
    from app.copilot.tools.exceptions import ToolArgumentInvalid
    from app.copilot.tools.run_command import RunCommandTool

    tenant_id = uuid.uuid4()
    tool = RunCommandTool()
    principal = _principal(
        permissions=["forge:run:forge-not-real"], tenant_id=tenant_id
    )
    with pytest.raises(ToolArgumentInvalid) as excinfo:
        await tool.execute(
            {"command_id": "forge-not-real"},
            principal=principal,
            tenant_id=tenant_id,
            project_id=None,
        )
    assert excinfo.value.field == "command_id"


# ---------------------------------------------------------------------------
# check_budget
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_check_budget_tool(sqlite_db):
    from app.copilot.tools.check_budget import CheckBudgetTool

    tenant_id = uuid.uuid4()
    tool = CheckBudgetTool()
    principal = _principal(tenant_id=tenant_id)
    result = await tool.execute(
        {"scope": "tenant"},
        principal=principal,
        tenant_id=tenant_id,
        project_id=None,
    )
    # No workflow declared → status=no_budget in V1.
    assert result["scope"] == "tenant"
    assert result["status"] == "no_budget"
    assert result["ceiling_usd"] is None


# ---------------------------------------------------------------------------
# audit_event
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_audit_event_tool(sqlite_db):
    """The audit_event tool writes an AuditEvent row via audit_service."""
    from sqlalchemy import select

    from app.copilot.tools.audit_event import AuditEventTool
    from app.db.models.audit import AuditEvent

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    tool = AuditEventTool()
    principal = _principal(tenant_id=tenant_id, project_id=project_id)
    result = await tool.execute(
        {
            "action": "copilot.tool.search_knowledge",
            "target_type": "kg_node",
            "target_id": "node-123",
            "payload": {"query": "auth"},
        },
        principal=principal,
        tenant_id=tenant_id,
        project_id=project_id,
    )
    assert result["audit_event_id"]
    assert result["emitted_at"]

    # Verify the row landed.
    async with sqlite_db() as session:
        events = list(
            (
                await session.execute(
                    select(AuditEvent).where(AuditEvent.tenant_id == str(tenant_id))
                )
            ).scalars().all()
        )
    assert len(events) == 1
    assert events[0].action == "copilot.tool.search_knowledge"
    assert events[0].target_type == "kg_node"
    assert events[0].target_id == "node-123"
    assert events[0].payload == {"query": "auth"}
