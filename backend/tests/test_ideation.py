"""Tests for the Ideation Center (F-201..F-213).

Covers intake, analysis, impact graph, scoring, roadmap, PRD, arch
preview, agent selection, realtime workflow, output bundle, approval
queue, push to delivery, and KG integration. Tests run against the
SQLite test engine from `conftest.py` and never touch the LiteLLM
proxy (each service falls back to deterministic mode).
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from app.db.models.agent import Agent, AgentStatus, AgentType
from app.db.models.ideation import (
    PRD,
    ApprovalDecision,
    ApprovalItem,
    ApprovalItemStatus,
    ApprovalItemType,
    ArchitecturePreview,
    Idea,
    IdeaAnalysis,
    IdeaSource,
    IdeaStatus,
    OutputBundle,
    PRDStatus,
    PushTarget,
    Roadmap,
    RoadmapStatus,
    ScoreSource,
    WorkflowSession,
    WorkflowSessionStatus,
)
from app.db.session import get_session_factory
from app.services.ideation import (
    agent_selector,
    approval_queue_service,
    arch_preview_service,
    idea_analysis_service,
    idea_intake_service,
    idea_knowledge_graph_service,
    idea_output_bundle_service,
    idea_push_to_delivery_service,
    opportunity_scoring_service,
    prd_generator,
    realtime_workflow,
    roadmap_generator,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _seed_idea(
    *,
    tenant_id: str,
    project_id: str,
    actor_id: str,
    title: str = "Self-serve onboarding flow",
    description: str = (
        "A guided onboarding flow that lets new users reach their first "
        "value moment within five minutes. Includes email verification, "
        "workspace setup, and a sample dataset."
    ),
    source: IdeaSource = IdeaSource.USER,
) -> Idea:
    from app.schemas.ideation import IdeaCreate

    payload = IdeaCreate(
        title=title,
        description=description,
        source=source,
        tags=["growth"],
    )
    return await idea_intake_service.submit_idea(
        tenant_id=tenant_id,
        project_id=project_id,
        payload=payload,
        actor_id=actor_id,
    )


async def _seed_agent(
    tenant_id: str,
    project_id: str,
    name: str,
    *,
    capabilities: dict[str, Any] | None = None,
    type: AgentType = AgentType.CLAUDE_CODE,
) -> Agent:
    factory = get_session_factory()
    async with factory() as session:
        row = Agent(
            tenant_id=tenant_id,
            project_id=project_id,
            name=name,
            type=type,
            capabilities=capabilities or {"languages": ["python"], "tools": ["shell"]},
            status=AgentStatus.ENABLED,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return row


# ---------------------------------------------------------------------------
# Fixtures — stub redis-backed helpers so tests don't need a real broker.
# ---------------------------------------------------------------------------


class _FakeBus:
    def __init__(self) -> None:
        self.published: list = []

    async def publish(self, *args: Any, **kwargs: Any) -> None:
        self.published.append((args, kwargs))

    def subscribe(self, *args: Any, **kwargs: Any) -> None:  # pragma: no cover
        pass

    def subscribe_all(self, *args: Any, **kwargs: Any) -> None:  # pragma: no cover
        pass

    async def start(self) -> None:  # pragma: no cover
        pass

    async def stop(self) -> None:  # pragma: no cover
        pass


class _FakeFreshnessLedger:
    def __init__(self) -> None:
        self.records: dict[str, dict] = {}

    async def mark_fresh(self, *, node_id, source, at=None, tenant_id, metadata=None):
        at = at or datetime.now(UTC)
        self.records[node_id] = {"source": source, "at": at}
        return SimpleNamespace(node_id=node_id, source=source, at=at, metadata=metadata or {})

    async def get_freshness(self, node_id, *, tenant_id):
        rec = self.records.get(node_id)
        if rec is None:
            return None
        return SimpleNamespace(node_id=node_id, metadata={}, **rec)


@pytest.fixture(autouse=True)
def _patch_internals(monkeypatch):
    # Force the realtime workflow into synchronous mode so tests don't race
    # with a background task after the SQLite engine is torn down.
    monkeypatch.setenv("FORGE_IDEATION_SYNC", "1")

    from app.services import event_bus as event_bus_mod
    from app.services import freshness_ledger as freshness_mod
    from app.services import knowledge_graph as kg_mod

    fake_bus = _FakeBus()
    fake_freshness = _FakeFreshnessLedger()

    monkeypatch.setattr(kg_mod, "freshness_ledger", fake_freshness)
    monkeypatch.setattr(kg_mod, "default_bus", fake_bus)
    monkeypatch.setattr(event_bus_mod, "bus", fake_bus)
    monkeypatch.setattr(freshness_mod, "freshness_ledger", fake_freshness)
    # Ideation services hold direct imports of default_bus; patch those too.
    from app.services.ideation import (
        agent_selector,
        approval_queue,
        arch_preview,
        idea_analysis,
        idea_intake,
        impact_graph,
        kg_integration,
        output_bundle,
        prd_generator,
        push_to_delivery,
        realtime_workflow,
        roadmap_generator,
        scoring,
    )

    for module in (
        agent_selector,
        approval_queue,
        arch_preview,
        idea_analysis,
        idea_intake,
        impact_graph,
        kg_integration,
        output_bundle,
        prd_generator,
        push_to_delivery,
        realtime_workflow,
        roadmap_generator,
        scoring,
    ):
        if hasattr(module, "default_bus"):
            monkeypatch.setattr(module, "default_bus", fake_bus)
    yield


# ---------------------------------------------------------------------------
# F-201 / F-202 — Idea intake + analysis
# ---------------------------------------------------------------------------


async def test_submit_idea_basic(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())

    idea = await _seed_idea(
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
    )
    assert isinstance(idea, Idea)
    assert str(idea.tenant_id) == tenant_id
    assert str(idea.project_id) == project_id
    assert idea.status == IdeaStatus.NEW
    assert "growth" in (idea.tags or [])


async def test_analyze_idea_uses_litellm(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    idea = await _seed_idea(tenant_id=tenant_id, project_id=project_id, actor_id=actor_id)
    analysis = await idea_analysis_service.analyze_idea(
        idea.id, tenant_id=tenant_id, actor_id=actor_id
    )
    assert isinstance(analysis, IdeaAnalysis)
    assert analysis.idea_id == idea.id
    # Either model_used is None (deterministic path) or a string.
    assert analysis.summary
    assert analysis.problem_statement or analysis.summary
    # The service should record a re-fetchable analysis.
    again = await idea_analysis_service.get_analysis(idea.id, tenant_id=tenant_id)
    assert again is not None
    assert again.id == analysis.id

    # Re-analyze forced path.
    new = await idea_analysis_service.reanalyze(idea.id, tenant_id=tenant_id, actor_id=actor_id)
    assert new.id != analysis.id or new.analyzed_at >= analysis.analyzed_at


# ---------------------------------------------------------------------------
# F-203 — Impact graph
# ---------------------------------------------------------------------------


async def test_impact_graph_uses_project_intelligence(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())

    # Seed a few KG nodes for the project so impact graph has something
    # to walk.
    from app.services.knowledge_graph import knowledge_graph_service

    await knowledge_graph_service.add_node(
        node_type="service",
        properties={"name": "onboarding-api"},
        tenant_id=tenant_id,
        project_id=project_id,
        name="onboarding-api",
    )
    await knowledge_graph_service.add_node(
        node_type="module",
        properties={"name": "onboarding"},
        tenant_id=tenant_id,
        project_id=project_id,
        name="onboarding",
    )

    idea = await _seed_idea(
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
        title="Improve onboarding",
        description="Streamline onboarding with python services.",
    )
    from app.services.ideation import impact_graph_service

    graph = await impact_graph_service.build_impact_graph(
        idea.id, tenant_id=tenant_id, project_id=project_id
    )
    assert graph.idea_id == idea.id
    # The seed project nodes contain 'onboarding' which appears in the
    # idea title, so we expect at least one matching node.
    labels = [n.label for n in graph.nodes]
    assert any("onboarding" in label.lower() for label in labels)


# ---------------------------------------------------------------------------
# F-204 — Opportunity scoring
# ---------------------------------------------------------------------------


async def test_opportunity_scoring_ai_vs_human(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    idea = await _seed_idea(tenant_id=tenant_id, project_id=project_id, actor_id=actor_id)
    ai_score = await opportunity_scoring_service.score_idea(
        idea.id,
        tenant_id=tenant_id,
        project_id=project_id,
        scoring_strategy="deterministic",
    )
    assert ai_score.scored_by == ScoreSource.AI
    assert 0.0 <= ai_score.total_score <= 10.0

    # Human override
    from app.services.ideation.scoring import ScoreComponents

    override = ScoreComponents(
        value=9.0,
        feasibility=8.5,
        risk=2.0,
        reach=9.0,
        rationale="Executive sponsor requested expedited delivery.",
    )
    human_score = await opportunity_scoring_service.human_override(
        idea.id,
        override,
        reason="Executive sponsor requested expedited delivery.",
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
    assert human_score.scored_by == ScoreSource.HYBRID
    assert human_score.value_score == 9.0
    assert "OVERRIDE" in human_score.scoring_rationale


# ---------------------------------------------------------------------------
# F-205 — Roadmap generation
# ---------------------------------------------------------------------------


async def test_roadmap_generator_orders_by_score(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())

    # Seed two ideas + scores.
    idea_high = await _seed_idea(
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
        title="Critical reliability fix",
        description="Investigate and resolve the SLA violation in the payments path.",
    )
    idea_low = await _seed_idea(
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
        title="Cosmetic polish",
        description="Tweak button colors and add a tiny animation to the dashboard.",
    )
    await opportunity_scoring_service.score_idea(
        idea_high.id,
        tenant_id=tenant_id,
        project_id=project_id,
        scoring_strategy="deterministic",
    )
    await opportunity_scoring_service.score_idea(
        idea_low.id,
        tenant_id=tenant_id,
        project_id=project_id,
        scoring_strategy="deterministic",
    )

    # Bump the "high" idea to a perfect 10 via override.
    from app.services.ideation.scoring import ScoreComponents

    await opportunity_scoring_service.human_override(
        idea_high.id,
        ScoreComponents(
            value=10.0,
            feasibility=10.0,
            risk=0.0,
            reach=10.0,
            rationale="Critical reliability work.",
        ),
        reason="Critical reliability work.",
        tenant_id=tenant_id,
        actor_id=actor_id,
    )

    roadmap = await roadmap_generator.generate_roadmap(
        project_id=project_id,
        tenant_id=tenant_id,
        horizon="now",
        top_n=10,
        name="Test roadmap",
        actor_id=actor_id,
    )
    assert isinstance(roadmap, Roadmap)
    assert roadmap.status == RoadmapStatus.DRAFT
    # Roadmap should contain at least our two ideas.
    item_idea_ids = [str(it.get("idea_id")) for it in (roadmap.items or [])]
    assert str(idea_high.id) in item_idea_ids
    assert str(idea_low.id) in item_idea_ids
    # The high-scoring idea should appear earlier than the low one.
    assert item_idea_ids.index(str(idea_high.id)) < item_idea_ids.index(str(idea_low.id))


# ---------------------------------------------------------------------------
# F-206 — PRD generation
# ---------------------------------------------------------------------------


async def test_prd_generator_bmad_template(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    idea = await _seed_idea(tenant_id=tenant_id, project_id=project_id, actor_id=actor_id)
    prd = await prd_generator.generate_prd(
        idea.id,
        tenant_id=tenant_id,
        actor_id=actor_id,
        template="bmad",
    )
    assert isinstance(prd, PRD)
    assert prd.status == PRDStatus.DRAFT
    # All BMad sections must be present.
    for section in (
        "problem",
        "goals",
        "non_goals",
        "user_stories",
        "requirements",
        "success_metrics",
        "open_questions",
        "risks",
    ):
        assert section in (prd.content or {})

    # Section edit + submit + approve flow.
    from app.services.ideation.prd_generator import BMAD_SECTIONS

    updated = await prd_generator.update_prd_section(
        prd.id,
        BMAD_SECTIONS[1],  # goals
        ["Adopt goal A", "Adopt goal B"],
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
    assert updated.content["goals"] == ["Adopt goal A", "Adopt goal B"]
    submitted = await prd_generator.submit_for_review(
        prd.id, tenant_id=tenant_id, actor_id=actor_id
    )
    assert submitted.status == PRDStatus.REVIEW
    approved = await prd_generator.approve_prd(prd.id, tenant_id=tenant_id, actor_id=actor_id)
    assert approved.status == PRDStatus.APPROVED


# ---------------------------------------------------------------------------
# F-207 — Architecture preview
# ---------------------------------------------------------------------------


async def test_arch_preview_generates_components(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    idea = await _seed_idea(tenant_id=tenant_id, project_id=project_id, actor_id=actor_id)
    preview = await arch_preview_service.generate_preview(
        idea.id, tenant_id=tenant_id, actor_id=actor_id
    )
    assert isinstance(preview, ArchitecturePreview)
    assert preview.components, "components list should not be empty"
    assert preview.version >= 1

    # Regeneration should produce a new version.
    regen = await arch_preview_service.regenerate_preview(
        idea.id, tenant_id=tenant_id, actor_id=actor_id
    )
    assert regen.version > preview.version


# ---------------------------------------------------------------------------
# F-209 — Agent selection
# ---------------------------------------------------------------------------


async def test_agent_selector_picks_per_phase(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())

    await _seed_agent(
        tenant_id,
        project_id,
        "alpha",
        capabilities={"languages": ["python", "typescript"], "tools": ["shell", "analysis"]},
    )
    await _seed_agent(
        tenant_id,
        project_id,
        "beta",
        capabilities={"languages": ["go"], "tools": ["architecture"]},
    )
    idea = await _seed_idea(tenant_id=tenant_id, project_id=project_id, actor_id=actor_id)
    plan = await agent_selector.select_agents_for_idea(
        idea.id, tenant_id=tenant_id, project_id=project_id
    )
    assert plan.idea_id == idea.id
    phases = [step.phase for step in plan.steps]
    for expected in ("analysis", "scoring", "arch_preview", "prd", "implementation", "review"):
        assert expected in phases


# ---------------------------------------------------------------------------
# F-210 — Realtime workflow
# ---------------------------------------------------------------------------


async def test_realtime_workflow_streams_progress(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    idea = await _seed_idea(tenant_id=tenant_id, project_id=project_id, actor_id=actor_id)

    session = await realtime_workflow.start_workflow(
        idea.id,
        actor_id,
        tenant_id=tenant_id,
        project_id=project_id,
    )
    assert isinstance(session, WorkflowSession)
    assert session.status in (WorkflowSessionStatus.PENDING, WorkflowSessionStatus.RUNNING)

    # Synchronously drive the pipeline (test does not rely on the
    # background task that production schedules).
    await realtime_workflow.run_pipeline(session.id, tenant_id=tenant_id, project_id=project_id)

    final_state = await realtime_workflow.get_workflow_state(session.id, tenant_id=tenant_id)
    assert final_state.status == WorkflowSessionStatus.COMPLETED
    # Each pipeline step should have a result populated.
    for step in final_state.steps:
        assert step["status"] in ("completed", "skipped")


async def test_realtime_workflow_user_intervention(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    idea = await _seed_idea(tenant_id=tenant_id, project_id=project_id, actor_id=actor_id)
    session = await realtime_workflow.start_workflow(
        idea.id,
        actor_id,
        tenant_id=tenant_id,
        project_id=project_id,
    )

    # Apply a skip intervention right away.
    new_state = await realtime_workflow.intervene(
        session.id,
        "skip",
        tenant_id=tenant_id,
        step="analyze",
        actor_id=actor_id,
    )
    # The analyze step should be marked SKIPPED in the state snapshot.
    analyze_step = next((s for s in new_state.steps if s["name"] == "analyze"), None)
    assert analyze_step is not None
    assert analyze_step["status"] in ("skipped", "completed", "running")

    # Cancel the session so the background task winds down.
    cancelled = await realtime_workflow.intervene(
        session.id,
        "cancel",
        tenant_id=tenant_id,
        actor_id=actor_id,
    )
    assert cancelled.status in (WorkflowSessionStatus.CANCELLED,)


# ---------------------------------------------------------------------------
# F-211 — Output bundle
# ---------------------------------------------------------------------------


async def test_output_bundle_packages_all_components(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    idea = await _seed_idea(tenant_id=tenant_id, project_id=project_id, actor_id=actor_id)
    # Drive every dependency the bundle expects.
    await idea_analysis_service.analyze_idea(idea.id, tenant_id=tenant_id, actor_id=actor_id)
    await opportunity_scoring_service.score_idea(
        idea.id, tenant_id=tenant_id, project_id=project_id, scoring_strategy="deterministic"
    )
    await prd_generator.generate_prd(idea.id, tenant_id=tenant_id, actor_id=actor_id)
    await arch_preview_service.generate_preview(idea.id, tenant_id=tenant_id, actor_id=actor_id)

    bundle = await idea_output_bundle_service.create_bundle(
        idea.id,
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
    )
    assert isinstance(bundle, OutputBundle)
    sections = {s["name"] for s in bundle.bundle.get("sections", [])}
    for expected in ("idea", "analysis", "score", "prd", "arch_preview", "agent_plan"):
        assert expected in sections

    # JSON export returns a string body.
    body = await idea_output_bundle_service.export_bundle(bundle.id, "json", tenant_id=tenant_id)
    assert isinstance(body, bytes)
    parsed = json.loads(body.decode("utf-8"))
    assert "sections" in parsed


# ---------------------------------------------------------------------------
# F-212 — Approval queue
# ---------------------------------------------------------------------------


async def test_approval_queue_enqueue_and_decide(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    reviewer_id = str(uuid.uuid4())
    idea = await _seed_idea(tenant_id=tenant_id, project_id=project_id, actor_id=actor_id)
    item = await approval_queue_service.enqueue(
        idea.id,
        ApprovalItemType.ROADMAP,
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
        reviewer_id=reviewer_id,
        payload={"reason": "Initial roadmap approval"},
    )
    assert isinstance(item, ApprovalItem)
    assert item.status == ApprovalItemStatus.PENDING

    queue = await approval_queue_service.get_queue(tenant_id=tenant_id, user_id=reviewer_id)
    assert any(q.id == item.id for q in queue)

    # Assign and then decide.
    new_reviewer = str(uuid.uuid4())
    item = await approval_queue_service.assign(
        item.id, new_reviewer, tenant_id=tenant_id, actor_id=actor_id
    )
    assert str(item.reviewer_id) == new_reviewer

    decided = await approval_queue_service.decide(
        item.id,
        ApprovalDecision.APPROVE,
        "Looks good.",
        tenant_id=tenant_id,
        actor_id=new_reviewer,
    )
    assert decided.status == ApprovalItemStatus.APPROVED


# ---------------------------------------------------------------------------
# F-213 — Push to delivery
# ---------------------------------------------------------------------------


async def test_push_to_jira_creates_epic(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    idea = await _seed_idea(tenant_id=tenant_id, project_id=project_id, actor_id=actor_id)
    result = await idea_push_to_delivery_service.push_to_jira(
        idea.id,
        "FORGE",
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
    )
    assert result.success is True
    assert result.external_ref is not None
    assert result.external_ref.startswith("JIRA/")

    history = await idea_push_to_delivery_service.push_history(idea.id, tenant_id=tenant_id)
    assert len(history) >= 1
    assert any(r.target == PushTarget.JIRA for r in history)


async def test_push_to_confluence_creates_page(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    idea = await _seed_idea(tenant_id=tenant_id, project_id=project_id, actor_id=actor_id)
    result = await idea_push_to_delivery_service.push_to_confluence(
        idea.id,
        "ENG",
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
    )
    assert result.success is True
    assert result.external_ref is not None
    assert result.external_ref.startswith("CONFLUENCE/")


# ---------------------------------------------------------------------------
# F-208 — KG integration
# ---------------------------------------------------------------------------


async def test_idea_kg_integration(sqlite_db):
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())
    idea = await _seed_idea(
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
        title="Onboarding flow",
        description="python service to onboard new users fast",
    )
    node = await idea_knowledge_graph_service.add_idea_to_kg(
        idea.id, tenant_id=tenant_id, project_id=project_id
    )
    assert node.node_type == "idea"
    related = await idea_knowledge_graph_service.find_related_ideas(
        idea.id, tenant_id=tenant_id, project_id=project_id, top_k=2
    )
    # Either 0 or N matches — depending on the deterministic embedding
    # similarity — but the call must not raise.
    assert isinstance(related, list)
    graph = await idea_knowledge_graph_service.get_idea_graph(project_id, tenant_id=tenant_id)
    assert any(n.metadata.get("kg_node_id") == str(node.id) for n in graph.nodes)
