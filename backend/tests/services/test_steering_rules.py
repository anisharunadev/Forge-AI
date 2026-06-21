"""Tests for F-504 — Steering Rules Engine."""

from __future__ import annotations

import sys
import types
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.db.models.steering_rule import SteeringRule
from app.db.session import get_session_factory
from app.schemas.steering_rules import SteeringRuleCreate
from app.services.steering_rules import (
    CatalogEntry,
    SteeringEngine,
    SteeringRuleCatalog,
    parse_front_matter,
    steering_engine,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    """Build a tiny workspace with one of every supported pattern."""
    root = tmp_path / "ws"
    root.mkdir()

    # 1) **/steering/*.md
    (root / "steering").mkdir()
    (root / "steering" / "code-style.md").write_text(
        "---\n"
        "rule_id: code-style\n"
        "scope: project\n"
        "applies_to_stages:\n"
        "  - pre_code\n"
        "  - pre_commit\n"
        "---\n"
        "Use type hints everywhere.\n",
        encoding="utf-8",
    )

    # 2) **/.forge/steering.md
    (root / ".forge").mkdir()
    (root / ".forge" / "steering.md").write_text(
        "---\n"
        "rule_id: org-wide-security\n"
        "scope: org\n"
        "applies_to_stages: [pre_code, pre_commit]\n"
        "---\n"
        "Never commit secrets.\n",
        encoding="utf-8",
    )

    # 3) **/AGENTS.md
    (root / "AGENTS.md").write_text(
        "---\n"
        "rule_id: agents-policy\n"
        "applies_to_stages:\n"
        "  - pre_plan\n"
        "---\n"
        "Read before you plan.\n",
        encoding="utf-8",
    )

    # 4) **/CLAUDE.md
    (root / "CLAUDE.md").write_text(
        "No front-matter here, should still be picked up.\n",
        encoding="utf-8",
    )

    # Skipped: inside .git
    (root / ".git").mkdir()
    (root / ".git" / "should_be_skipped.md").write_text("nope", encoding="utf-8")
    return root


@pytest.fixture
def engine() -> SteeringEngine:
    return SteeringEngine()


# ---------------------------------------------------------------------------
# 1. Auto-discovery finds files in test workspace
# ---------------------------------------------------------------------------


def test_discover_files_finds_supported_patterns(engine, workspace):
    paths = engine.discover_files(workspace)
    rel = sorted(p.relative_to(workspace).as_posix() for p in paths)
    assert "steering/code-style.md" in rel
    assert ".forge/steering.md" in rel
    assert "AGENTS.md" in rel
    assert "CLAUDE.md" in rel
    # .git/should_be_skipped.md must not appear
    assert all(not p.startswith(".git/") for p in rel)


def test_discover_files_skips_ignored_dirs(engine, tmp_path):
    root = tmp_path / "ws2"
    root.mkdir()
    (root / "node_modules").mkdir()
    (root / "node_modules" / "AGENTS.md").write_text("ignored", encoding="utf-8")
    (root / "AGENTS.md").write_text("ok", encoding="utf-8")
    rel = [p.relative_to(root).as_posix() for p in engine.discover_files(root)]
    assert "AGENTS.md" in rel
    assert not any(p.startswith("node_modules/") for p in rel)


def test_discover_files_resolves_custom_patterns(engine, workspace):
    only_agents = engine.discover_files(workspace, patterns=["AGENTS.md"])
    rel = [p.relative_to(workspace).as_posix() for p in only_agents]
    assert rel == ["AGENTS.md"]


# ---------------------------------------------------------------------------
# 2. YAML front-matter parsing
# ---------------------------------------------------------------------------


def test_parse_front_matter_block_list():
    text = (
        "---\n"
        "rule_id: my-rule\n"
        "scope: project\n"
        "applies_to_stages:\n"
        "  - pre_plan\n"
        "  - pre_code\n"
        "---\n"
        "Body text here.\n"
    )
    meta, body = parse_front_matter(text)
    assert meta["rule_id"] == "my-rule"
    assert meta["scope"] == "project"
    assert meta["applies_to_stages"] == ["pre_plan", "pre_code"]
    assert body.startswith("Body text")


def test_parse_front_matter_inline_list():
    text = (
        "---\n"
        "rule_id: x\n"
        "applies_to_stages: [pre_commit, pre_deploy]\n"
        "---\n"
        "body\n"
    )
    meta, _ = parse_front_matter(text)
    assert meta["applies_to_stages"] == ["pre_commit", "pre_deploy"]


def test_parse_front_matter_missing_returns_empty():
    text = "Just a body, no fence."
    meta, body = parse_front_matter(text)
    assert meta == {}
    assert body == text


# ---------------------------------------------------------------------------
# 3. File watcher triggers re-index (mock watchdog observer)
# ---------------------------------------------------------------------------


def test_watcher_handler_invokes_build_catalog(engine, workspace, monkeypatch):
    """Inject a fake watchdog module so we can drive the handler directly."""

    scheduled: list[tuple[str, object]] = []
    started: list[bool] = []

    class _FakeObserver:
        def __init__(self) -> None:
            self.daemon = False
            self.handlers: list[tuple[object, str, bool]] = []

        def schedule(self, handler, path, recursive=False):  # noqa: ANN001
            self.handlers.append((handler, path, recursive))
            scheduled.append((path, handler))

        def start(self) -> None:
            started.append(True)

        def is_alive(self) -> bool:
            return True

        def stop(self) -> None:
            return None

        def join(self, timeout=None):  # noqa: ANN001
            return None

    fake_root = types.ModuleType("watchdog")
    sys.modules["watchdog"] = fake_root

    wd_events = types.ModuleType("watchdog.events")

    class _Evt:
        pass

    wd_events.FileSystemEvent = _Evt  # type: ignore[attr-defined]
    wd_events.FileSystemEventHandler = type(  # type: ignore[attr-defined]
        "_StubHandler", (), {}
    )
    wd_observers = types.ModuleType("watchdog.observers")
    wd_observers.Observer = _FakeObserver  # type: ignore[attr-defined]
    sys.modules["watchdog.events"] = wd_events
    sys.modules["watchdog.observers"] = wd_observers

    # Disable persistence in the handler's re-index so this test runs
    # without a sqlite_db fixture.
    orig_build = engine.build_catalog
    calls: list[dict] = []

    async def _spy_build_catalog(**kwargs):  # type: ignore[no-untyped-def]
        calls.append(kwargs)
        return await orig_build(persist=False, **kwargs)

    monkeypatch.setattr(engine, "build_catalog", _spy_build_catalog)

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    started_ok = engine.start_watcher(
        workspace,
        tenant_id=tenant_id,
        project_id=project_id,
        patterns=["steering/*.md"],
    )
    assert started_ok is True
    assert started == [True]
    assert scheduled, "observer.schedule should have been called"

    # Directly fire the registered handler with a synthetic event.
    assert engine._observer is not None
    scheduled_handlers = [
        h[0] for h in engine._observer.handlers if hasattr(h[0], "on_any_event")
    ]
    assert scheduled_handlers, "no watchdog-style handler was registered"
    handler = scheduled_handlers[0]

    class _FakeEvent:
        is_directory = False
        event_type = "modified"
        src_path = str(workspace / "steering" / "code-style.md")

    # The handler kicks off a fresh event loop synchronously, so by
    # the time on_any_event returns the catalog should be populated.
    handler.on_any_event(_FakeEvent())  # type: ignore[attr-defined]

    catalog = engine.get_catalog(
        tenant_id=tenant_id, project_id=project_id
    )
    assert catalog is not None
    assert any(e.rule_id == "code-style" for e in catalog.entries)
    assert calls, "handler should have triggered build_catalog"

    engine.stop_watcher()
    # Restore real watchdog if it ever was there (no-op in tests).
    sys.modules.pop("watchdog", None)
    sys.modules.pop("watchdog.events", None)
    sys.modules.pop("watchdog.observers", None)


# ---------------------------------------------------------------------------
# 4. RLS isolation: tenant_a cannot see tenant_b rules
# ---------------------------------------------------------------------------


async def test_rls_isolation_between_tenants(sqlite_db):
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    # Both tenants share the same project_id; only tenant_id should
    # isolate them.
    shared_project = uuid.uuid4()

    factory = get_session_factory()
    # Insert directly without RLS context. The conftest's sqlite_db
    # uses SQLite, where `SET LOCAL app.tenant_id` is a syntax error;
    # we still get the row in place to verify application-layer
    # tenant scoping in `list_rules`.
    async with factory() as session:
        session.add(
            SteeringRule(
                tenant_id=str(tenant_a),
                project_id=str(shared_project),
                rule_id="rule-a",
                file_path="steering/a.md",
                content="a",
                content_hash="x" * 64,
                indexed_at=datetime.now(timezone.utc),
                scope="project",
                applies_to_stages=["pre_code"],
                metadata_={},
            )
        )
        await session.commit()

    # Tenant_b in the same project must not see tenant_a's rule.
    rules_b = await steering_engine.list_rules(
        tenant_id=tenant_b, project_id=shared_project
    )
    assert all(r.rule_id != "rule-a" for r in rules_b)

    # Tenant_a sees its own rule.
    rules_a = await steering_engine.list_rules(
        tenant_id=tenant_a, project_id=shared_project
    )
    assert any(r.rule_id == "rule-a" for r in rules_a)

    # Tenant_b with a *different* project also sees nothing relevant.
    other_project = uuid.uuid4()
    rules_other = await steering_engine.list_rules(
        tenant_id=tenant_b, project_id=other_project
    )
    assert rules_other == []


# ---------------------------------------------------------------------------
# 5. inject_into_context returns expected dict for each stage
# ---------------------------------------------------------------------------


async def test_inject_into_context_per_stage(engine):
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()

    # Wire a catalog directly (no DB persistence needed for injection).
    catalog = SteeringRuleCatalog(
        tenant_id=tenant_id,
        project_id=project_id,
        entries=[
            CatalogEntry(
                id=uuid.uuid4(),
                rule_id="rule-plan",
                file_path="rule-plan.md",
                content="Plan carefully.",
                scope="project",
                applies_to_stages=["pre_plan"],
                content_hash="x" * 64,
            ),
            CatalogEntry(
                id=uuid.uuid4(),
                rule_id="rule-code",
                file_path="rule-code.md",
                content="Write tests.",
                scope="project",
                applies_to_stages=["pre_code"],
                content_hash="y" * 64,
            ),
            CatalogEntry(
                id=uuid.uuid4(),
                rule_id="rule-commit",
                file_path="rule-commit.md",
                content="Run linters.",
                scope="project",
                applies_to_stages=["pre_commit"],
                content_hash="z" * 64,
            ),
        ],
    )
    engine._catalogs[(str(tenant_id), str(project_id))] = catalog  # type: ignore[attr-defined]

    # Single-stage injection
    plan = engine.inject_into_context(
        tenant_id=tenant_id,
        project_id=project_id,
        stage="pre_plan",
    )
    assert "pre_plan" in plan
    assert any("Plan carefully." in block for block in plan["pre_plan"])

    code = engine.inject_into_context(
        tenant_id=tenant_id,
        project_id=project_id,
        stage="pre_code",
    )
    assert any("Write tests." in block for block in code["pre_code"])

    commit = engine.inject_into_context(
        tenant_id=tenant_id,
        project_id=project_id,
        stage="pre_commit",
    )
    assert any("Run linters." in block for block in commit["pre_commit"])

    # Stage with no matching rules -> not in dict
    deploy = engine.inject_into_context(
        tenant_id=tenant_id,
        project_id=project_id,
        stage="pre_deploy",
    )
    assert deploy == {}

    # Fan-out: no stage arg => all stages present
    fanout = engine.inject_into_context(
        tenant_id=tenant_id, project_id=project_id
    )
    assert {"pre_plan", "pre_code", "pre_commit"} <= set(fanout.keys())


# ---------------------------------------------------------------------------
# 6. POST / DELETE round-trip via the engine service
# ---------------------------------------------------------------------------


async def test_add_and_delete_rule_roundtrip(sqlite_db):
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    created = await steering_engine.add_rule(
        tenant_id=tenant_id,
        project_id=project_id,
        body=SteeringRuleCreate(
            rule_id="my-rule",
            file_path="steering/my.md",
            content="hello",
            scope="project",
            applies_to_stages=["pre_code"],
        ),
    )
    assert created.rule_id == "my-rule"

    listed = await steering_engine.list_rules(
        tenant_id=tenant_id, project_id=project_id
    )
    assert any(r.rule_id == "my-rule" for r in listed)

    removed = await steering_engine.delete_rule(
        tenant_id=tenant_id,
        project_id=project_id,
        rule_id="my-rule",
    )
    assert removed is True

    listed_after = await steering_engine.list_rules(
        tenant_id=tenant_id, project_id=project_id
    )
    assert all(r.rule_id != "my-rule" for r in listed_after)