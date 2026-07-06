"""Tests for F-507 — Day-One Bootstrap with Reference Standards.

Five required tests:
1. Baseline loads
2. Customer overlay applied correctly
3. Idempotent (rerun produces same state)
4. Audit row created
5. Project not active until bootstrap completes (gated by status)

All tests use the in-memory ``sqlite_db`` fixture defined in
``conftest.py`` so they run without Postgres / Redis.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select

from app.db.models.audit import AuditEvent
from app.db.models.policy import Policy
from app.db.models.standard import Standard
from app.db.models.template import Template
from app.db.session import get_session_factory
from app.schemas.day_one_bootstrap import BootstrapStatus
from app.services.day_one_bootstrap import day_one_bootstrap
from app.services.project_onboarding.wizard import STEP_ORDER, onboarding_wizard


def _bootstrap_metadata(extra: dict | None = None) -> dict:
    """Helper to build a project metadata blob with an optional overlay."""
    md: dict = {"day_one_overlay": {}}
    if extra:
        md["day_one_overlay"].update(extra)
    return md


# ---------------------------------------------------------------------------
# 1. Baseline loads
# ---------------------------------------------------------------------------


async def test_baseline_loads(sqlite_db):
    """A fresh project's bootstrap loads the KnackForge reference standards."""
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())

    result = await day_one_bootstrap.load_baseline(
        project_id=project_id,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )

    assert result.status == BootstrapStatus.COMPLETED
    # Baseline ships 4 standards (F-001) — these are the KnackForge
    # reference standards; downstream services consume them as the
    # project's starting baseline.
    assert len(result.standards) == 4
    names = {s.name for s in result.standards}
    assert "KFG-STD-001: API Design" in names
    assert "KFG-STD-002: Test Coverage" in names
    assert "KFG-STD-003: Secrets Handling" in names
    assert "KFG-STD-004: ADR Required" in names
    for s in result.standards:
        assert s.source == "baseline"

    # Templates
    assert len(result.templates) >= 3
    tnames = {t.name for t in result.templates}
    assert "ADR Default Scaffold" in tnames
    assert "Task Breakdown Default Scaffold" in tnames
    assert "Risk Register Default Scaffold" in tnames

    # Policies
    assert len(result.governance_policies) >= 2
    pnames = {p.name for p in result.governance_policies}
    assert "KFG-POL-001: Block on missing ADR" in pnames
    assert "KFG-POL-002: Warn on coverage drop" in pnames

    # Steering rules (baseline ships at least one)
    assert len(result.steering_rules) >= 1
    assert any(r.name == "KFG-RULE-001: Prefer Postgres" for r in result.steering_rules)

    # Run id is set, project is COMPLETED.
    assert result.run_id is not None
    assert result.completed_at is not None


# ---------------------------------------------------------------------------
# 2. Customer overlay applied correctly
# ---------------------------------------------------------------------------


async def test_customer_overlay_applied(sqlite_db):
    """A project-level overlay replaces matching baseline entries by name."""
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())

    overlay = {
        "standards": [
            {
                # Overrides the baseline by name.
                "name": "KFG-STD-002: Test Coverage",
                "content": "Customer override: coverage must be >= 90% on changed files.",
                "version": 2,
                "metadata": {"domain": "quality", "severity": "block", "customer": True},
            },
            {
                # Brand-new overlay-only standard.
                "name": "CUST-STD-001: PHI Handling",
                "content": "All PHI must be encrypted at rest with AES-256.",
                "version": 1,
                "metadata": {"domain": "security", "severity": "block"},
            },
        ],
        "steering_rules": [
            {
                "name": "CUST-RULE-001: Use AWS only",
                "description": "All infra MUST target AWS us-east-1.",
                "applies_to": "deployment",
                "expression": {"==": [{"var": "artifact.cloud"}, "aws"]},
                "source": "overlay",
            }
        ],
    }

    result = await day_one_bootstrap.load_baseline(
        project_id=project_id,
        tenant_id=tenant_id,
        project_metadata=_bootstrap_metadata(overlay),
    )

    # Override is in place, source tagged 'overlay'.
    overridden = next(s for s in result.standards if s.name == "KFG-STD-002: Test Coverage")
    assert overridden.source == "overlay"
    assert "90%" in overridden.content
    assert overridden.version == 2
    assert overridden.metadata.get("customer") is True

    # Pure overlay entry also present, also tagged.
    brand_new = next(s for s in result.standards if s.name == "CUST-STD-001: PHI Handling")
    assert brand_new.source == "overlay"

    # Non-overridden standards still source='baseline'.
    api = next(s for s in result.standards if s.name == "KFG-STD-001: API Design")
    assert api.source == "baseline"

    # Customer steering rule surfaces.
    assert any(r.name == "CUST-RULE-001: Use AWS only" for r in result.steering_rules)


# ---------------------------------------------------------------------------
# 3. Idempotent (rerun produces same state)
# ---------------------------------------------------------------------------


async def test_rerun_is_idempotent(sqlite_db):
    """A rerun with the same overlay does not duplicate references."""
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())

    overlay = {
        "standards": [
            {
                "name": "KFG-STD-002: Test Coverage",
                "content": "Coverage >= 90%.",
                "version": 2,
            }
        ],
    }

    first = await day_one_bootstrap.load_baseline(
        project_id=project_id,
        tenant_id=tenant_id,
        project_metadata=_bootstrap_metadata(overlay),
    )
    second = await day_one_bootstrap.load_baseline(
        project_id=project_id,
        tenant_id=tenant_id,
        project_metadata=_bootstrap_metadata(overlay),
    )

    # Same number of items — no duplicates.
    assert len(first.standards) == len(second.standards)
    assert len(first.templates) == len(second.templates)
    assert len(first.governance_policies) == len(second.governance_policies)
    assert len(first.steering_rules) == len(second.steering_rules)

    # DB-level: only one row per (tenant, project, name) — verify the
    # standards table for the project.
    factory = get_session_factory()
    async with factory() as session:
        stmt = select(Standard).where(
            Standard.tenant_id == tenant_id,
            Standard.project_id == project_id,
            Standard.name.notlike("day_one_bootstrap:%"),
            Standard.name.notlike("steering:%"),
        )
        rows = list((await session.execute(stmt)).scalars().all())
        assert len(rows) == 4  # the 4 baseline standards, exactly once

        tpl_stmt = select(Template).where(
            Template.tenant_id == tenant_id,
            Template.project_id == project_id,
        )
        tpl_rows = list((await session.execute(tpl_stmt)).scalars().all())
        assert len(tpl_rows) == 3

        pol_stmt = select(Policy).where(Policy.tenant_id == tenant_id)
        pol_rows = list((await session.execute(pol_stmt)).scalars().all())
        assert len(pol_rows) == 2

    # The second run should report the same run_id (idempotent no-op).
    assert first.run_id == second.run_id


# ---------------------------------------------------------------------------
# 4. Audit row created
# ---------------------------------------------------------------------------


async def test_audit_row_created(sqlite_db):
    """Bootstrap writes an F-005 audit event (Rule 6)."""
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())

    await day_one_bootstrap.load_baseline(
        project_id=project_id,
        tenant_id=tenant_id,
        actor_id=actor_id,
    )

    factory = get_session_factory()
    async with factory() as session:
        stmt = select(AuditEvent).where(
            AuditEvent.tenant_id == tenant_id,
            AuditEvent.project_id == project_id,
            AuditEvent.action == "day_one_bootstrap.completed",
        )
        events = list((await session.execute(stmt)).scalars().all())
        assert len(events) == 1
        ev = events[0]
        assert ev.target_type == "project"
        assert str(ev.target_id) == project_id
        assert ev.actor_id == actor_id
        payload = dict(ev.payload or {})
        assert "run_id" in payload
        assert "fingerprint" in payload
        assert "counts" in payload
        # Counts should at minimum include all the bundle kinds.
        counts = payload["counts"]
        assert counts.get("standards", 0) >= 4
        assert counts.get("templates", 0) >= 3
        assert counts.get("policies", 0) >= 2
        assert counts.get("steering_rules", 0) >= 1

        # The wizard-gate audit row also exists.
        gate_stmt = select(AuditEvent).where(
            AuditEvent.tenant_id == tenant_id,
            AuditEvent.project_id == project_id,
            AuditEvent.action == "day_one_bootstrap.gate",
        )
        gates = list((await session.execute(gate_stmt)).scalars().all())
        assert len(gates) == 1
        assert dict(gates[0].payload or {}).get("ready") is True


# ---------------------------------------------------------------------------
# 5. Project not active until bootstrap completes
# ---------------------------------------------------------------------------


async def test_project_not_active_until_bootstrap_completes(sqlite_db):
    """The bootstrap status gate transitions ``not_started`` -> ``completed``."""
    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())

    # Before bootstrap: status = not_started, ready = False.
    pre_status = await day_one_bootstrap.status_read(project_id=project_id, tenant_id=tenant_id)
    assert pre_status.status == BootstrapStatus.NOT_STARTED
    assert pre_status.run_id is None
    assert pre_status.completed_at is None
    assert (
        await day_one_bootstrap.is_project_bootstrap_ready(
            project_id=project_id, tenant_id=tenant_id
        )
        is False
    )

    # Wizard needs the project to be bootstrapped before completion can
    # take effect: walk the wizard to the review step (the final one)
    # and verify the bootstrap is triggered at the end.
    state = await onboarding_wizard.start(
        tenant_id=tenant_id, project_id=project_id, user_id=user_id
    )
    sid = state.id
    for idx, step in enumerate(STEP_ORDER[:-1]):
        state = await onboarding_wizard.advance(
            sid,
            type(
                "_",
                (),
                {"step_input": {"answer": idx}, "mark_complete": True},
            )(),
        )
    # Final advance — the wizard final-step hook should trigger bootstrap.
    state = await onboarding_wizard.advance(
        sid,
        type("_", (), {"step_input": {"approved": True}, "mark_complete": True})(),
    )
    assert state.status.value == "completed"

    # After bootstrap: status = completed, ready = True.
    post_status = await day_one_bootstrap.status_read(project_id=project_id, tenant_id=tenant_id)
    assert post_status.status == BootstrapStatus.COMPLETED
    assert post_status.run_id is not None
    assert post_status.completed_at is not None
    assert post_status.counts.get("standards", 0) >= 4
    assert (
        await day_one_bootstrap.is_project_bootstrap_ready(
            project_id=project_id, tenant_id=tenant_id
        )
        is True
    )
