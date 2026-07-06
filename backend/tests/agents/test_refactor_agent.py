"""Tests for the F-601 Refactor Agent sub-graph.

Coverage
--------
1. ``build_refactor_graph`` compiles and exposes the expected nodes.
2. ``inventory_source`` produces a typed :class:`SourceInventory`
   with AWS Transform integration mocked.
3. ``AWSTransformClient`` round-trips a job through start -> poll
   with a mocked boto3 client factory.
4. ``MigrationPlan`` schema validates well-formed inputs and rejects
   malformed ones.
5. ``push_to_jira_node`` invokes F-213's ``push_to_delivery_service``
   with the correct arguments.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _initial_state(**overrides: Any) -> dict[str, Any]:
    """Build a minimal RefactorAgentState payload."""
    state: dict[str, Any] = {
        "run_id": str(uuid.uuid4()),
        "tenant_id": str(uuid.uuid4()),
        "project_id": str(uuid.uuid4()),
        "actor_id": str(uuid.uuid4()),
        "source_repo_url": "https://github.com/acme/legacy",
        "source_language": "java",
        "source_framework": "spring-boot",
        "target_language": "java",
        "target_framework": "quarkus",
        "target_cloud": "aws",
        "constraints": {"budget_usd": 100_000, "deadline_weeks": 26},
    }
    state.update(overrides)
    return state


# ---------------------------------------------------------------------------
# 1. Sub-graph compiles
# ---------------------------------------------------------------------------


def test_refactor_graph_compiles():
    """build_refactor_graph returns a compiled graph with the expected nodes."""
    from app.agents.refactor_agent import build_refactor_graph
    from app.agents.refactor_agent_state import REFACTOR_PHASES

    graph = build_refactor_graph()
    assert graph is not None
    # LangGraph exposes nodes via .nodes (CompiledStateGraph attribute).
    node_names = set()
    for attr in ("nodes", "_nodes", "builder"):
        if hasattr(graph, attr):
            obj = getattr(graph, attr)
            try:
                node_names = set(obj.keys())
                break
            except AttributeError:
                continue
    # Every declared phase should be present.
    for phase in REFACTOR_PHASES:
        # ``nodes`` dict key is the node name itself.
        assert phase in node_names or any(phase in str(k) for k in node_names), (
            f"phase {phase!r} not found in compiled graph nodes {node_names!r}"
        )


# ---------------------------------------------------------------------------
# 2. inventory_source produces a typed inventory
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_inventory_source_node_emits_typed_inventory(event_bus):
    """inventory_source_node writes a SourceInventory-shaped dict onto state."""
    from app.agents.refactor_agent import (
        ARTIFACT_TYPE_SOURCE_INVENTORY,
        inventory_source_node,
    )
    from app.services.aws_transform_client import AWSTransformClient

    # Mock the AWS Transform client.
    mock_client = MagicMock(spec=AWSTransformClient)
    mock_client.start_job.return_value = "tx-job-123"
    mock_job = MagicMock()
    mock_job.status = "SUCCEEDED"
    mock_job.results = {"translated_files": []}
    mock_client.poll_job.return_value = mock_job

    persisted: list[dict[str, Any]] = []

    async def persist(state: Any, artifact_type: str, payload: dict[str, Any]) -> None:
        persisted.append({"type": artifact_type, "payload": payload})

    state = _initial_state()
    out = await inventory_source_node(state, transform_client=mock_client, persist_artifact=persist)

    # Source inventory on state.
    assert "source_inventory" in out
    inv = out["source_inventory"]
    assert inv["language"] == "java"
    assert inv["framework"] == "spring-boot"
    assert inv["repository_url"] == "https://github.com/acme/legacy"
    assert inv["aws_transform_job_id"] == "tx-job-123"
    assert "components" in inv and "apis" in inv and "data_stores" in inv

    # AWS Transform bookkeeping.
    assert out["aws_transform_job_id"] == "tx-job-123"
    assert out["aws_transform_status"] == "SUCCEEDED"

    # Phase history advanced.
    assert out["phase_history"][0]["node"] == "inventory_source"

    # Persist was called with the typed inventory.
    assert any(p["type"] == ARTIFACT_TYPE_SOURCE_INVENTORY for p in persisted)


# ---------------------------------------------------------------------------
# 3. AWS Transform client round-trip (mocked boto3)
# ---------------------------------------------------------------------------


def test_aws_transform_client_round_trip(monkeypatch):
    """start_job -> poll_job -> get_results via a mocked boto3 factory."""
    import sys
    import types

    from app.services.aws_transform_client import AWSTransformClient, TransformJob

    # Inject a fake boto3 module so the lazy import in
    # ``AWSTransformClient._try_init`` succeeds without the real SDK.
    fake_boto3 = types.ModuleType("boto3")

    def _fake_client_factory(service_name: str, **kwargs: Any) -> Any:
        client = MagicMock()
        client.start_transform_job.return_value = {"jobId": "tx-abc"}
        client.describe_transform_job.return_value = {
            "status": "SUCCEEDED",
            "results": {"translated_files": ["a.java", "b.java"]},
            "failureReason": None,
        }
        return client

    fake_boto3.client = _fake_client_factory  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "boto3", fake_boto3)

    factory = MagicMock(side_effect=_fake_client_factory)
    client = AWSTransformClient(boto3_client_factory=factory)

    # start_job returns the AWS Transform jobId.
    job_id = client.start_job({"language": "java", "repository_url": "r"})
    assert job_id == "tx-abc"

    # poll_job returns the SUCCEEDED status with results.
    job = client.poll_job(job_id)
    assert isinstance(job, TransformJob)
    assert job.status == "SUCCEEDED"
    assert job.results == {"translated_files": ["a.java", "b.java"]}

    # get_results returns the cached dict.
    results = client.get_results(job_id)
    assert results["translated_files"] == ["a.java", "b.java"]

    # The injected boto3 factory was called with the transform service name.
    factory.assert_called_once()
    call_args = factory.call_args
    assert call_args.args[0] == "transform"


def test_aws_transform_client_placeholder_when_boto3_missing():
    """When boto3 is missing, the client returns a placeholder job_id."""
    from app.services.aws_transform_client import AWSTransformClient

    # Force-disable the client by providing a factory that raises ImportError.
    def failing_factory(*args: Any, **kwargs: Any) -> Any:
        raise ImportError("boto3 not available")

    client = AWSTransformClient(boto3_client_factory=failing_factory)
    assert client.available is False

    job_id = client.start_job({"language": "java"})
    assert job_id.startswith("placeholder-")

    job = client.poll_job(job_id)
    assert job.status == "PLACEHOLDER"
    assert "source_inventory" in job.results


# ---------------------------------------------------------------------------
# 4. MigrationPlan schema validation
# ---------------------------------------------------------------------------


def test_migration_plan_schema_validates_well_formed_input():
    """MigrationPlan accepts a complete, valid payload."""
    from app.schemas.migration_plan import (
        EffortEstimate,
        MigrationPhase,
        MigrationPlan,
        RiskItem,
        SourceInventory,
        TargetArchitecture,
    )

    plan = MigrationPlan(
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        source_inventory=SourceInventory(language="java", framework="spring-boot"),
        target_architecture=TargetArchitecture(
            target_language="java", target_framework="quarkus", target_cloud="aws"
        ),
        phased_plan=[
            MigrationPhase(
                order=0,
                name="Phase 1",
                description="Stand up parallel target deployment.",
                estimated_effort_days=10.0,
            )
        ],
        risk_register=[
            RiskItem(
                title="Data loss",
                description="In-flight writes may be lost.",
                likelihood=0.3,
                impact=0.9,
            )
        ],
        effort_estimate=EffortEstimate(total_effort_days=10.0, confidence=0.5),
        dependencies=["lambda"],
    )
    assert plan.tenant_id is not None
    assert plan.project_id is not None
    assert len(plan.phased_plan) == 1
    assert len(plan.risk_register) == 1
    # Severity is auto-computed from likelihood * impact when missing.
    assert plan.risk_register[0].severity == pytest.approx(0.27)
    # Sorted-risks helper works.
    sorted_risks = plan.severity_sorted_risks()
    assert sorted_risks[0].title == "Data loss"
    # Phase ids helper returns the order-preserved list.
    assert len(plan.phase_ids()) == 1


def test_migration_plan_schema_rejects_malformed_input():
    """MigrationPlan rejects negative effort and missing required fields."""
    from pydantic import ValidationError

    from app.schemas.migration_plan import (
        EffortEstimate,
        MigrationPhase,
        MigrationPlan,
        SourceInventory,
        TargetArchitecture,
    )

    base = dict(
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        source_inventory=SourceInventory(language="java"),
        target_architecture=TargetArchitecture(target_language="java"),
        effort_estimate=EffortEstimate(total_effort_days=10.0),
    )

    # Missing phased_plan -> ValidationError.
    with pytest.raises(ValidationError):
        MigrationPlan(**base)

    # Negative effort on a phase -> ValidationError.
    with pytest.raises(ValidationError):
        MigrationPlan(
            **base,
            phased_plan=[
                MigrationPhase(
                    order=0,
                    name="Bad",
                    description="Negative effort phase.",
                    estimated_effort_days=-1.0,
                )
            ],
        )


# ---------------------------------------------------------------------------
# 5. push_to_jira calls F-213 (mocked)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_push_to_jira_invokes_f213(event_bus):
    """push_to_jira_node calls PushToDeliveryService.push_to_jira with the right args."""
    from app.agents.refactor_agent import push_to_jira_node
    from app.services.ideation.push_to_delivery import PushResult, PushTarget

    # Construct a fully-populated state by running the heuristic node outputs.
    state = _initial_state()
    state["source_inventory"] = {
        "language": "java",
        "framework": "spring-boot",
        "total_files": 0,
        "total_lines_of_code": 0,
        "components": [],
        "external_dependencies": [],
        "data_stores": [],
        "apis": [],
        "repository_url": state["source_repo_url"],
    }
    state["target_architecture"] = {
        "target_language": "java",
        "target_framework": "quarkus",
        "target_cloud": "aws",
        "components": [],
        "integrations": [],
        "data_stores": [],
        "diagrams": [],
    }
    state["phased_plan"] = [
        {
            "id": "phase-1",
            "order": 0,
            "name": "Phase 1",
            "description": "Stand up parallel target deployment.",
            "strategy": "strangler",
            "scope_files": [],
            "scope_services": [],
            "estimated_effort_days": 10.0,
            "estimated_cost_usd": 0.0,
            "prerequisites": [],
            "acceptance_criteria": [],
        }
    ]
    state["risk_register"] = []

    # Mock the F-213 push service.
    expected_record_id = uuid.uuid4()
    push_mock = AsyncMock(
        return_value=PushResult(
            target=PushTarget.JIRA,
            success=True,
            external_ref="JIRA/AWS/EPIC-ABC12345",
            error=None,
            record_id=expected_record_id,
        )
    )

    out = await push_to_jira_node(state, push_to_jira_fn=push_mock)

    # F-213 was called with the migration plan's id and the tenant/project IDs.
    assert push_mock.await_count == 1
    call_kwargs = push_mock.await_args.kwargs
    assert call_kwargs["tenant_id"] == state["tenant_id"]
    assert call_kwargs["project_id"] == state["project_id"]
    assert call_kwargs["actor_id"] == state["actor_id"]
    # project_key is derived from the target cloud.
    assert call_kwargs["project_key"].startswith("AWS")
    # idea_id was passed (as the migration plan uuid); it lives in kwargs
    # because the service signature uses keyword-only arguments.
    assert call_kwargs["idea_id"] is not None
    assert isinstance(call_kwargs["idea_id"], uuid.UUID)

    # Node result carries the F-213 outcome.
    assert out["jira_push_result"]["success"] is True
    assert out["jira_push_result"]["external_ref"] == "JIRA/AWS/EPIC-ABC12345"
    assert out["artifact_id"] is not None
    assert out["phase_history"][0]["node"] == "push_to_jira"


# ---------------------------------------------------------------------------
# End-to-end: full sub-graph executes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refactor_graph_runs_end_to_end_with_mocks(event_bus):
    """All five nodes execute in order and the graph produces a migration plan."""
    from app.agents.refactor_agent import build_refactor_graph
    from app.services.aws_transform_client import AWSTransformClient

    mock_client = MagicMock(spec=AWSTransformClient)
    mock_client.start_job.return_value = "tx-e2e"
    mock_job = MagicMock()
    mock_job.status = "SUCCEEDED"
    mock_job.results = {}
    mock_client.poll_job.return_value = mock_job

    push_mock = AsyncMock()

    graph = build_refactor_graph(
        transform_client=mock_client,
        llm_call=None,
        push_to_jira_fn=push_mock,
        persist_artifact=None,
        persist_migration_plan=None,
    )

    initial = _initial_state()
    final = await graph.ainvoke(initial)
    assert final["aws_transform_job_id"] == "tx-e2e"
    assert final["aws_transform_status"] == "SUCCEEDED"
    assert len(final["phased_plan"]) >= 1
    assert len(final["risk_register"]) >= 1
    # push_to_jira was invoked.
    assert push_mock.await_count == 1
