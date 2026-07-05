"""Knowledge graph backlinks + freshness tests (M8-G3).

These tests cover the new ``backlinks_for`` service method and its
endpoint contract: incoming-only source nodes, tenant isolation, and
the freshness-ledger mirror that every node write must trigger.

Tests run against an in-memory SQLite database (``sqlite_db`` from
``conftest.py``) with a stub event bus + freshness ledger so the
service surface is exercised end-to-end without Redis or Postgres.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


TENANT_A = "00000000-0000-0000-0000-000000000001"
TENANT_B = "00000000-0000-0000-0000-000000000002"
PROJECT_ID = "00000000-0000-0000-0000-000000000003"


# ---------------------------------------------------------------------------
# Stubs / patches
# ---------------------------------------------------------------------------


class _FakeBus:
    def __init__(self) -> None:
        self.published: list = []

    async def publish(self, *args, **kwargs) -> None:
        self.published.append((args, kwargs))


class _FakeFreshnessLedger:
    def __init__(self) -> None:
        self.records: dict[str, dict] = {}
        self.mark_fresh_calls: list[dict] = []

    async def mark_fresh(self, *, node_id, source, at=None, tenant_id, metadata=None):
        at = at or datetime.now(timezone.utc)
        self.records[node_id] = {"source": source, "at": at, "tenant_id": str(tenant_id)}
        self.mark_fresh_calls.append(
            {
                "node_id": node_id,
                "source": source,
                "tenant_id": str(tenant_id),
                "metadata": dict(metadata or {}),
            }
        )
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

    # Yield the fakes so individual tests can introspect them. The
    # autouse marker means every test gets the patches; tests that
    # don't need the introspection can simply ignore the fixture.
    yield {"bus": fake_bus, "freshness": fake_freshness}


# ---------------------------------------------------------------------------
# T-A3 — backlinks + freshness tests
# ---------------------------------------------------------------------------


async def test_backlinks_returns_incoming_only(sqlite_db, _patch_internals):
    """5 nodes + 6 edges; backlinks_for(A) must return only [C, E]."""
    from app.services.knowledge_graph import knowledge_graph_service

    nodes: dict[str, object] = {}
    for label in ("A", "B", "C", "D", "E"):
        nodes[label] = await knowledge_graph_service.add_node(
            "function",
            {"signature": f"def {label.lower()}()"},
            tenant_id=TENANT_A,
            project_id=PROJECT_ID,
            name=label,
        )

    edges = [
        (nodes["A"], nodes["B"]),  # outgoing from A
        (nodes["C"], nodes["A"]),  # incoming to A
        (nodes["A"], nodes["D"]),  # outgoing from A
        (nodes["E"], nodes["A"]),  # incoming to A
        (nodes["B"], nodes["D"]),  # unrelated
        (nodes["A"], nodes["E"]),  # outgoing from A
    ]
    for src, dst in edges:
        await knowledge_graph_service.add_edge(
            src.id,  # type: ignore[arg-type]
            dst.id,  # type: ignore[arg-type]
            "calls",
            {},
            tenant_id=TENANT_A,
            project_id=PROJECT_ID,
        )

    backlinks = await knowledge_graph_service.backlinks_for(
        nodes["A"].id,  # type: ignore[arg-type]
        tenant_id=TENANT_A,
    )

    # Order is implementation-defined (edge-recency); check membership +
    # exact count.
    backlink_names = sorted(n.name for n in backlinks)
    assert backlink_names == ["C", "E"]
    assert len(backlinks) == 2

    # A, B, D must never appear — they're sources of outgoing edges,
    # not incoming edges to A.
    returned_ids = {str(n.id) for n in backlinks}
    for label in ("A", "B", "D"):
        assert str(nodes[label].id) not in returned_ids


async def test_backlinks_tenant_isolation(sqlite_db, _patch_internals):
    """Cross-tenant edges must not leak into the caller's backlink list."""
    from app.services.knowledge_graph import knowledge_graph_service

    # Tenant A: node N with two incoming edges (from A1 and A2).
    n_a = await knowledge_graph_service.add_node(
        "document",
        {"title": "shared-doc"},
        tenant_id=TENANT_A,
        project_id=PROJECT_ID,
        name="N",
    )
    a1 = await knowledge_graph_service.add_node(
        "document",
        {"title": "a1"},
        tenant_id=TENANT_A,
        project_id=PROJECT_ID,
        name="A1",
    )
    a2 = await knowledge_graph_service.add_node(
        "document",
        {"title": "a2"},
        tenant_id=TENANT_A,
        project_id=PROJECT_ID,
        name="A2",
    )

    # Tenant B: node N_b + an incoming edge from B1 to N_b. Same name
    # "N" but different tenant — must not bleed into A's backlinks.
    n_b = await knowledge_graph_service.add_node(
        "document",
        {"title": "shared-doc-b"},
        tenant_id=TENANT_B,
        project_id=PROJECT_ID,
        name="N",
    )
    b1 = await knowledge_graph_service.add_node(
        "document",
        {"title": "b1"},
        tenant_id=TENANT_B,
        project_id=PROJECT_ID,
        name="B1",
    )

    await knowledge_graph_service.add_edge(
        a1.id, n_a.id, "references", {},
        tenant_id=TENANT_A, project_id=PROJECT_ID,
    )
    await knowledge_graph_service.add_edge(
        a2.id, n_a.id, "references", {},
        tenant_id=TENANT_A, project_id=PROJECT_ID,
    )
    await knowledge_graph_service.add_edge(
        b1.id, n_b.id, "references", {},
        tenant_id=TENANT_B, project_id=PROJECT_ID,
    )

    # Tenant A caller: sees only A1 + A2.
    backlinks_a = await knowledge_graph_service.backlinks_for(
        n_a.id, tenant_id=TENANT_A
    )
    names_a = sorted(n.name for n in backlinks_a)
    assert names_a == ["A1", "A2"]
    assert all(str(n.tenant_id) == TENANT_A for n in backlinks_a)

    # Tenant B caller: sees only B1.
    backlinks_b = await knowledge_graph_service.backlinks_for(
        n_b.id, tenant_id=TENANT_B
    )
    names_b = [n.name for n in backlinks_b]
    assert names_b == ["B1"]
    assert all(str(n.tenant_id) == TENANT_B for n in backlinks_b)

    # Cross-tenant sanity: A's backlinks must not contain B1 (tenant B).
    assert all(n.name != "B1" for n in backlinks_a)


async def test_kg_node_creation_mirrors_freshness(sqlite_db, _patch_internals):
    """Every node write must call freshness_ledger.mark_fresh."""
    from app.services.knowledge_graph import knowledge_graph_service

    _patch_internals["freshness"].mark_fresh_calls.clear()

    node = await knowledge_graph_service.add_node(
        "service",
        {"name": "checkout"},
        tenant_id=TENANT_A,
        project_id=PROJECT_ID,
        name="checkout-svc",
    )

    # The freshness ledger must record an entry for the new node id.
    fake = _patch_internals["freshness"]
    assert str(node.id) in fake.records
    assert fake.records[str(node.id)]["source"] == "graphify"

    # mark_fresh must have been called at least once with the node id,
    # the right tenant, and the right source.
    matching = [
        call for call in fake.mark_fresh_calls if call["node_id"] == str(node.id)
    ]
    assert len(matching) >= 1
    last = matching[-1]
    assert last["tenant_id"] == TENANT_A
    assert last["source"] == "graphify"
    assert last["metadata"].get("node_type") == "service"
    assert last["metadata"].get("project_id") == PROJECT_ID


__all__ = [
    "test_backlinks_returns_incoming_only",
    "test_backlinks_tenant_isolation",
    "test_kg_node_creation_mirrors_freshness",
]