"""Tests for the Project Intelligence backend (F-101..F-115).

These tests run against an in-memory SQLite database (sqlite_db fixture
from conftest.py) and a stub event bus + freshness ledger so the
service surface is exercised end-to-end without Redis or Postgres.
"""

from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


TENANT_ID = "00000000-0000-0000-0000-000000000001"
PROJECT_ID = "00000000-0000-0000-0000-000000000002"
ACTOR_ID = "00000000-0000-0000-0000-000000000010"


# ---------------------------------------------------------------------------
# Stubs / patches
# ---------------------------------------------------------------------------


class _FakeBus:
    def __init__(self):
        self.published: list = []

    async def publish(self, *args, **kwargs):
        self.published.append((args, kwargs))


class _FakeFreshnessLedger:
    def __init__(self):
        self.records: dict[str, dict] = {}

    async def mark_fresh(self, *, node_id, source, at=None, tenant_id, metadata=None):
        at = at or datetime.now(timezone.utc)
        self.records[node_id] = {"source": source, "at": at}
        return SimpleNamespace(node_id=node_id, source=source, at=at, metadata=metadata or {})

    async def get_freshness(self, node_id, *, tenant_id):
        rec = self.records.get(node_id)
        if rec is None:
            return None
        return SimpleNamespace(node_id=node_id, metadata={}, **rec)


@pytest.fixture(autouse=True)
def _patch_internals(monkeypatch):
    """Stub event bus + freshness ledger so tests run without Redis."""
    from app.services import event_bus as event_bus_mod
    from app.services import freshness_ledger as freshness_mod
    from app.services import knowledge_graph as kg_mod

    fake_bus = _FakeBus()
    fake_freshness = _FakeFreshnessLedger()

    monkeypatch.setattr(kg_mod, "freshness_ledger", fake_freshness)
    monkeypatch.setattr(kg_mod, "default_bus", fake_bus)
    monkeypatch.setattr(event_bus_mod, "bus", fake_bus)
    monkeypatch.setattr(freshness_mod, "freshness_ledger", fake_freshness)
    yield


# ---------------------------------------------------------------------------
# Knowledge graph
# ---------------------------------------------------------------------------


async def test_knowledge_graph_add_node_with_freshness(sqlite_db):
    from app.services.knowledge_graph import knowledge_graph_service

    node = await knowledge_graph_service.add_node(
        "service",
        {"name": "billing", "language": "python"},
        tenant_id=TENANT_ID,
        project_id=PROJECT_ID,
        name="billing",
    )
    assert node.name == "billing"
    assert node.node_type == "service"
    assert node.freshness_source == "graphify"


async def test_knowledge_graph_cypher_query(sqlite_db):
    from app.services.knowledge_graph import knowledge_graph_service

    rows = await knowledge_graph_service.query_cypher(
        "MATCH (n:Service) RETURN n",
        {"n_label": "Service"},
    )
    assert isinstance(rows, list)


async def test_knowledge_graph_hybrid_query(sqlite_db):
    from app.services.knowledge_graph import knowledge_graph_service

    rows = await knowledge_graph_service.hybrid_query(
        cypher_part="MATCH (n:Service) RETURN n",
        sql_part="SELECT id, name FROM kg_nodes WHERE node_type = 'Service' LIMIT 5",
        params={"n_label": "Service"},
    )
    assert isinstance(rows, list)


async def test_knowledge_graph_vector_search(sqlite_db):
    from app.services.knowledge_graph import knowledge_graph_service

    await knowledge_graph_service.add_node(
        "document",
        {"title": "alpha"},
        tenant_id=TENANT_ID,
        project_id=PROJECT_ID,
        name="alpha-doc",
        embedding=[0.1, 0.2, 0.3, 0.4],
    )
    await knowledge_graph_service.add_node(
        "document",
        {"title": "beta"},
        tenant_id=TENANT_ID,
        project_id=PROJECT_ID,
        name="beta-doc",
        embedding=[0.4, 0.3, 0.2, 0.1],
    )
    nodes = await knowledge_graph_service.vector_search(
        embedding=[0.1, 0.2, 0.3, 0.4],
        top_k=2,
        tenant_id=TENANT_ID,
        project_id=PROJECT_ID,
    )
    assert len(nodes) >= 1
    assert nodes[0].properties["title"] in {"alpha", "beta"}


# ---------------------------------------------------------------------------
# Repo ingestion
# ---------------------------------------------------------------------------


async def test_repo_ingestion_full_flow(sqlite_db):
    from app.services.project_intelligence.repo_ingestion import repo_ingestion_service

    repo = await repo_ingestion_service.create_repo(
        tenant_id=TENANT_ID,
        project_id=PROJECT_ID,
        source_url="https://example.com/foo/bar.git",
        actor_id=ACTOR_ID,
        default_branch="main",
    )
    summary = await repo_ingestion_service.ingest_repo(
        tenant_id=TENANT_ID,
        project_id=PROJECT_ID,
        repo_id=repo.id,
        actor_id=ACTOR_ID,
    )
    assert summary.repo_id == repo.id
    assert summary.status.value in {
        "cloning", "extracting", "graphifying", "mapping", "persisting", "success", "failed"
    }
    runs = await repo_ingestion_service.list_ingestion_runs(
        repo.id, tenant_id=TENANT_ID
    )
    assert any(r.id == summary.run_id for r in runs)


async def test_repo_discovery_uses_mcp(sqlite_db):
    from app.services.project_intelligence.repo_ingestion import repo_ingestion_service

    candidates = await repo_ingestion_service.discover_repos(
        tenant_id=TENANT_ID,
        project_id=PROJECT_ID,
        source="github",
        org="acme",
    )
    assert isinstance(candidates, list)


# ---------------------------------------------------------------------------
# Architecture discovery
# ---------------------------------------------------------------------------


async def test_architecture_discovery_detects_services(sqlite_db):
    from app.services.project_intelligence.architecture_discovery import (
        architecture_discovery_service,
    )
    from app.services.project_intelligence.repo_ingestion import repo_ingestion_service

    repo = await repo_ingestion_service.create_repo(
        tenant_id=TENANT_ID,
        project_id=PROJECT_ID,
        source_url="https://example.com/services.git",
        actor_id=ACTOR_ID,
    )
    with patch.object(
        architecture_discovery_service,
        "_load_repo_tree",
        AsyncMock(return_value={
            "billing/package.json": '{"name": "billing"}',
            "billing/requirements.txt": "fastapi",
        }),
    ):
        arch = await architecture_discovery_service.discover_architecture(
            repo.id,
            tenant_id=TENANT_ID,
            project_id=PROJECT_ID,
        )
    assert any(s["name"] == "billing" for s in arch.services)
    assert arch.summary is not None


# ---------------------------------------------------------------------------
# Q&A
# ---------------------------------------------------------------------------


async def test_qa_answer_uses_rag(sqlite_db):
    from app.services.knowledge_graph import knowledge_graph_service
    from app.services.project_intelligence import qa as qa_mod
    from app.services.project_intelligence.qa import qa_service

    await knowledge_graph_service.add_node(
        "document",
        {"content": "billing is owned by finance"},
        tenant_id=TENANT_ID,
        project_id=PROJECT_ID,
        name="billing-doc",
        embedding=[0.1, 0.2, 0.3, 0.4],
    )

    async def _fake_chat(self, messages, **_kwargs):
        return {
            "choices": [{"message": {"content": "billing is owned by finance."}}],
            "model": "stub",
        }

    with patch.object(qa_mod.LiteLLMClient, "chat", _fake_chat), patch.object(
        qa_mod.LiteLLMClient, "embed", AsyncMock(return_value=[[0.1, 0.2, 0.3, 0.4]])
    ):
        answer = await qa_service.answer_question(
            tenant_id=TENANT_ID,
            project_id=PROJECT_ID,
            question="Who owns billing?",
        )
    assert "billing" in answer.answer.lower()
    assert answer.confidence > 0.0
    history = qa_service.get_conversation_history(answer.session_id)
    assert any(m.content == "Who owns billing?" for m in history)


# ---------------------------------------------------------------------------
# Impact analysis
# ---------------------------------------------------------------------------


async def test_impact_analysis_traces_dependencies(sqlite_db):
    from app.services.knowledge_graph import knowledge_graph_service
    from app.services.project_intelligence.impact import (
        ChangeSet,
        impact_analysis_service,
    )

    a = await knowledge_graph_service.add_node(
        "function",
        {"signature": "def a()"},
        tenant_id=TENANT_ID,
        project_id=PROJECT_ID,
        name="a",
    )
    b = await knowledge_graph_service.add_node(
        "function",
        {"signature": "def b()"},
        tenant_id=TENANT_ID,
        project_id=PROJECT_ID,
        name="b",
    )
    await knowledge_graph_service.add_edge(
        a.id, b.id, "calls", {},
        tenant_id=TENANT_ID,
        project_id=PROJECT_ID,
    )
    report = await impact_analysis_service.analyze_impact(
        ChangeSet(project_id=PROJECT_ID, changes=[{"kind": "function", "reference": "a"}]),
        tenant_id=TENANT_ID,
    )
    assert any(e.reference == str(b.id) for e in report.transitive_impact)
    assert report.risk_score > 0.0
    assert any("a" in t for t in report.recommended_tests)


# ---------------------------------------------------------------------------
# Incremental sync + conflict resolution
# ---------------------------------------------------------------------------


async def test_incremental_sync_detects_conflicts(sqlite_db):
    from app.services.project_intelligence.incremental_sync import (
        incremental_sync_service,
    )
    from app.services.project_intelligence.repo_ingestion import repo_ingestion_service

    repo = await repo_ingestion_service.create_repo(
        tenant_id=TENANT_ID,
        project_id=PROJECT_ID,
        source_url="https://example.com/sync-test.git",
        actor_id=ACTOR_ID,
    )
    with patch.object(
        incremental_sync_service, "_detect_changes",
        AsyncMock(return_value=["src/billing.py", "src/checkout.py"]),
    ):
        result = await incremental_sync_service.sync_changes(
            repo.id, "deadbeef",
            tenant_id=TENANT_ID,
            project_id=PROJECT_ID,
        )
    assert result.processed_files == 2

    with patch.object(
        incremental_sync_service, "_detect_changes",
        AsyncMock(return_value=["src/billing.py", "src/checkout.py", "src/billing.py"]),
    ):
        result = await incremental_sync_service.sync_changes(
            repo.id, "deadbeef",
            tenant_id=TENANT_ID,
            project_id=PROJECT_ID,
        )
    assert result is not None


async def test_conflict_resolution_steward_priority(sqlite_db):
    from app.services.project_intelligence.incremental_sync import (
        ConflictRecord,
        incremental_sync_service,
    )

    incremental_sync_service.assign_steward("file:src/billing.py", "github")
    conflict = ConflictRecord(
        id=uuid.uuid4(),
        project_id=PROJECT_ID,
        entity_ref="file:src/billing.py",
        sources=["github", "gitlab"],
        detected_at=datetime.now(timezone.utc),
        resolution=None,
        status="pending",
    )
    incremental_sync_service._conflicts.setdefault(PROJECT_ID, []).append(conflict)
    await incremental_sync_service.resolve_conflict(
        conflict.id, resolution={"winner": "manual"}
    )
    assert conflict.status == "resolved"
    assert conflict.resolution == {"winner": "manual"}


# ---------------------------------------------------------------------------
# Snapshots
# ---------------------------------------------------------------------------


async def test_snapshot_create_and_restore(sqlite_db):
    from app.services.knowledge_graph import knowledge_graph_service
    from app.services.project_intelligence.snapshots import snapshot_service

    await knowledge_graph_service.add_node(
        "service",
        {"name": "checkout"},
        tenant_id=TENANT_ID,
        project_id=PROJECT_ID,
        name="checkout",
    )
    snap = await snapshot_service.create_snapshot(
        PROJECT_ID, tenant_id=TENANT_ID, label="v1"
    )
    assert snap.node_count >= 1
    assert snap.content_hash
    result = await snapshot_service.restore_snapshot(
        snap.id, tenant_id=TENANT_ID
    )
    assert result.restored_node_count >= 1
    assert isinstance(result.conflicts, list)


# ---------------------------------------------------------------------------
# Doc / comm ingestion
# ---------------------------------------------------------------------------


async def test_doc_ingestion_confluence(sqlite_db):
    from app.services.project_intelligence.doc_ingestion import doc_ingestion_service

    docs = await doc_ingestion_service.ingest_confluence(
        tenant_id=TENANT_ID,
        project_id=PROJECT_ID,
        space_key="ENG",
    )
    assert docs
    assert docs[0].source == "confluence"
    assert docs[0].node_id


async def test_comm_ingestion_slack(sqlite_db):
    from app.services.project_intelligence.comm_ingestion import comm_ingestion_service

    ingested = await comm_ingestion_service.ingest_slack(
        tenant_id=TENANT_ID,
        project_id=PROJECT_ID,
        channel_id="C12345",
        since=datetime.now(timezone.utc),
    )
    assert ingested
    assert ingested[0].source == "slack"
    detections = comm_ingestion_service.detect(
        "We decided to ship @alice the API changes."
    )
    assert "decisions" in detections
    assert detections["actions"]


__all__ = [
    "test_knowledge_graph_add_node_with_freshness",
    "test_knowledge_graph_cypher_query",
    "test_knowledge_graph_hybrid_query",
    "test_knowledge_graph_vector_search",
    "test_repo_ingestion_full_flow",
    "test_repo_discovery_uses_mcp",
    "test_architecture_discovery_detects_services",
    "test_qa_answer_uses_rag",
    "test_impact_analysis_traces_dependencies",
    "test_incremental_sync_detects_conflicts",
    "test_conflict_resolution_steward_priority",
    "test_snapshot_create_and_restore",
    "test_doc_ingestion_confluence",
    "test_comm_ingestion_slack",
]