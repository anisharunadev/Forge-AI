"""Tests for M2 T-C3 / T-C4 — backend/app/services/refactor_agent.py.

Coverage matrix (M2 Plan 01-07 verification spec):

  1. RefactorAgent.plan() raises ApprovalRequiredError when the
     SDLCState has no granted IMPLEMENTATION-phase approval envelope.
  2. The same call succeeds once the envelope is granted and returns
     a typed (MigrationPlanDigest, MigrationPlan) pair.
  3. Protected paths (.env, *.pem, secrets/*) cause the plan to
     refuse before any audit row is written.
  4. The composed MigrationPlan is a valid Pydantic v2 instance with
     tenant_id / project_id stamped on every artifact (Rule 2).
  5. An F-005 audit row is emitted with action=refactor_agent.plan_emitted.
  6. The whitelist guard fails closed if forge-dev-refactor is missing
     from FORGE_COMMAND_MAP (defense-in-depth; registry drift).

Helpers are kept short and unit-style — they don't touch the DB or the
real artifact registry. The service is deliberately rules-only (no LLM
calls), so we don't need to mock LiteLLM in this suite.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.agents.approval_gate import ApprovalRequiredError
from app.agents.sdlc_state import (
    SDLCPhase,
    SDLCState,
)
from app.schemas.migration_plan import (
    EffortEstimate,
    MigrationPhase,
    MigrationPlan,
    SourceInventory,
    TargetArchitecture,
)
from app.services.forge_commands import FORGE_COMMAND_MAP
from app.services.refactor_agent import (
    ALLOWED_REFACTOR_FORGE_CMD,
    PROTECTED_FILE_GLOB_RE,
    BreakingChange,
    ChangeClassification,
    DiffChunk,
    ImplementationDiff,
    MigrationPlanDigest,
    RefactorAgent,
    _classify_chunk,
    _extract_chunks_from_unified,
    _validate_whitelist,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _granted_state(*, phase: SDLCPhase = SDLCPhase.IMPLEMENTATION) -> SDLCState:
    """Build an SDLCState with a granted approval envelope for ``phase``.

    ApprovalRequest is a Pydantic v2 model with a Literal ``type`` that
    does NOT yet include ``"implementation"`` (the broader envelope
    extension is handled by Track A).  We use ``model_construct`` to
    side-step the Literal check so the test fixture can stand on its
    own — the runtime call site will hold a properly-typed envelope
    by the time Track A lands (T-A1 widens the Literal).
    """
    from app.agents.sdlc_state import ApprovalRequest

    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    actor_id = uuid.uuid4()
    expires = datetime.now(UTC) + timedelta(hours=1)
    pending = ApprovalRequest.model_construct(
        approval_id=uuid.uuid4(),
        type=phase.value,
        required_role="developer",
        expires_at=expires,
    )
    state = SDLCState(
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
        current_phase=phase,
        pending_approval=pending,
        metadata={
            f"approval:{phase.value}:decision": {
                "granted": True,
                "decided_by": str(actor_id),
                "decided_at": datetime.now(UTC).isoformat(),
                "reason": "test envelope",
            }
        },
    )
    return state


@pytest.fixture
def stub_audit() -> MagicMock:
    """AsyncMock-shaped audit recorder.

    Replaces :func:`app.services.refactor_agent.audit_service` so we can
    assert the F-005 row was written without spinning up Postgres.
    """
    audit = MagicMock()
    audit.events: list[dict[str, Any]] = []

    async def _record(**kwargs: Any) -> None:
        audit.events.append(kwargs)

    audit.record = AsyncMock(side_effect=_record)
    return audit


@pytest.fixture
def stub_registry() -> MagicMock:
    """AsyncMock-shaped artifact registry."""
    registry = MagicMock()
    registry.persist = AsyncMock(return_value={"id": str(uuid.uuid4())})
    return registry


@pytest.fixture
def sample_diff() -> ImplementationDiff:
    """A tiny diff: one breaking-touching chunk."""
    unified = (
        "--- a/backend/app/services/example.py\n"
        "+++ b/backend/app/services/example.py\n"
        "@@ -1,3 +1,5 @@\n"
        "-def foo(x):\n"
        "+def foo(x: int) -> int:\n"
        "+\n"
        "+\n"
        "+def bar() -> None:\n"
        "+    foo(1)\n"
    )
    return ImplementationDiff(
        unified_diff=unified,
        chunks=[],
        source_files=["backend/app/services/example.py"],
    )


@pytest.fixture
def refactor_agent(stub_audit, stub_registry) -> RefactorAgent:
    return RefactorAgent(audit=stub_audit, artifact_registry=stub_registry)


# ---------------------------------------------------------------------------
# 1. ApprovalRequiredError when envelope is missing / not granted
# ---------------------------------------------------------------------------


async def test_plan_raises_without_approval_envelope(
    stub_audit,
    stub_registry,
    sample_diff,
):
    """A bare SDLCState (no pending_approval) must trip the decorator."""
    state = SDLCState(
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        actor_id=uuid.uuid4(),
    )
    agent = RefactorAgent(audit=stub_audit, artifact_registry=stub_registry)
    with pytest.raises(ApprovalRequiredError) as excinfo:
        await agent.plan(
            state,
            sample_diff,
            target_patterns=["use type hints"],
            rollback_steps=["git revert"],
        )
    assert excinfo.value.phase is SDLCPhase.IMPLEMENTATION
    # No audit row written on the denied path.
    assert stub_audit.record.await_count == 0


async def test_plan_raises_when_envelope_is_denied(
    stub_audit,
    stub_registry,
    sample_diff,
):
    """A pending approval with granted=False must also fail the gate."""
    state = _granted_state(phase=SDLCPhase.IMPLEMENTATION)
    # Override the recorded decision to denied.
    state = state.model_copy(
        update={
            "metadata": {
                "approval:implementation:decision": {
                    "granted": False,
                    "decided_by": str(state.actor_id),
                    "decided_at": datetime.now(UTC).isoformat(),
                    "reason": "reject",
                }
            }
        },
        deep=True,
    )
    agent = RefactorAgent(audit=stub_audit, artifact_registry=stub_registry)
    with pytest.raises(ApprovalRequiredError):
        await agent.plan(state, sample_diff)


async def test_plan_raises_when_phase_is_wrong(
    stub_audit,
    stub_registry,
    sample_diff,
):
    """A granted REVIEW-phase envelope is not the same as IMPLEMENTATION."""
    state = _granted_state(phase=SDLCPhase.REVIEW)
    agent = RefactorAgent(audit=stub_audit, artifact_registry=stub_registry)
    with pytest.raises(ApprovalRequiredError):
        await agent.plan(state, sample_diff)


# ---------------------------------------------------------------------------
# 2. Happy path: granted envelope returns typed (digest, plan)
# ---------------------------------------------------------------------------


async def test_plan_returns_typed_digest_and_plan(
    refactor_agent,
    stub_audit,
    stub_registry,
    sample_diff,
):
    state = _granted_state(phase=SDLCPhase.IMPLEMENTATION)
    digest, plan = await refactor_agent.plan(
        state,
        sample_diff,
        target_patterns=["use type hints"],
        rollback_steps=["revert commit", "rerun f-501"],
    )
    assert isinstance(digest, MigrationPlanDigest)
    assert isinstance(plan, MigrationPlan)

    # Digest carries the 4 M2-spec fields.
    assert digest.source_files == ["backend/app/services/example.py"]
    assert digest.target_patterns == ["use type hints"]
    assert digest.rollback_steps == ["revert commit", "rerun f-501"]
    assert isinstance(digest.breaking_changes, list)
    assert digest.metadata["forge_cmd"] == ALLOWED_REFACTOR_FORGE_CMD

    # Plan carries typed F-010 artifact + tenancy stamps.
    assert plan.tenant_id == state.tenant_id
    assert plan.project_id == state.project_id
    assert plan.generated_by.endswith("RefactorAgent")
    assert isinstance(plan.source_inventory, SourceInventory)
    assert isinstance(plan.target_architecture, TargetArchitecture)
    assert isinstance(plan.effort_estimate, EffortEstimate)
    assert all(isinstance(p, MigrationPhase) for p in plan.phased_plan)

    # Registry persistence called once.
    stub_registry.persist.assert_awaited_once()
    persist_kwargs = stub_registry.persist.await_args.kwargs
    assert persist_kwargs["artifact_type"] == "migration_plan"


async def test_plan_emits_audit_row(
    refactor_agent,
    stub_audit,
    sample_diff,
):
    state = _granted_state(phase=SDLCPhase.IMPLEMENTATION)
    digest, plan = await refactor_agent.plan(
        state, sample_diff, target_patterns=[], rollback_steps=[]
    )
    stub_audit.record.assert_awaited_once()
    kwargs = stub_audit.record.await_args.kwargs
    assert kwargs["tenant_id"] == state.tenant_id
    assert kwargs["project_id"] == state.project_id
    assert kwargs["action"] == "refactor_agent.plan_emitted"
    assert kwargs["target_type"] == "migration_plan"
    assert kwargs["target_id"] == str(plan.id)
    assert kwargs["payload"]["forge_cmd"] == ALLOWED_REFACTOR_FORGE_CMD
    assert (
        kwargs["payload"]["digest_source_files"]
        == len(digest.source_files)
    )


# ---------------------------------------------------------------------------
# 3. Protected paths short-circuit before audit
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "evil_path",
    [
        "backend/.env",
        ".env.production",
        "secrets/aws.pem",
        "ops/cert.key",
        "infrastructure/tls.PEM",
    ],
)
async def test_plan_refuses_protected_paths(
    refactor_agent,
    stub_audit,
    stub_registry,
    evil_path,
):
    state = _granted_state(phase=SDLCPhase.IMPLEMENTATION)
    diff = ImplementationDiff(
        unified_diff="",
        chunks=[DiffChunk(file_path=evil_path, added_lines=1, removed_lines=0)],
        source_files=[evil_path],
    )
    with pytest.raises(PermissionError):
        await refactor_agent.plan(state, diff)
    # No audit row, no registry call.
    assert stub_audit.record.await_count == 0
    stub_registry.persist.assert_not_called()


def test_protected_path_regex_is_defensive():
    """Negative sanity: ordinary files must NOT match."""
    assert not PROTECTED_FILE_GLOB_RE.match("backend/app/services/foo.py")
    assert not PROTECTED_FILE_GLOB_RE.match("src/index.ts")
    assert PROTECTED_FILE_GLOB_RE.match("backend/.env")
    assert PROTECTED_FILE_GLOB_RE.match("secrets/foo.pem")
    assert PROTECTED_FILE_GLOB_RE.match("a/b/c.PEM")


# ---------------------------------------------------------------------------
# 4. Pure helpers — chunk extraction + classification + draft coercion
# ---------------------------------------------------------------------------


def test_unified_diff_extraction_handles_multiple_files():
    unified = (
        "--- a/foo.py\n"
        "+++ b/foo.py\n"
        "@@ -1 +1 @@\n"
        "-old\n"
        "+new\n"
        "--- a/bar.py\n"
        "+++ b/bar.py\n"
        "@@ -10 +10 @@\n"
        "-old2\n"
        "+new2\n"
        "+also_new\n"
    )
    chunks = _extract_chunks_from_unified(unified)
    rels = [c.file_path for c in chunks]
    # We expect both files to appear, order unspecified but stable.
    assert "foo.py" in rels
    assert "bar.py" in rels
    by_path = {c.file_path: c for c in chunks}
    assert by_path["foo.py"].added_lines == 1
    assert by_path["foo.py"].removed_lines == 1
    assert by_path["bar.py"].added_lines == 2
    assert by_path["bar.py"].removed_lines == 1


def test_classify_chunk_uses_severity_ladder():
    additive = _classify_chunk(
        DiffChunk(file_path="a.py", added_lines=3, removed_lines=0)
    )
    breaking = _classify_chunk(
        DiffChunk(file_path="a.py", added_lines=10, removed_lines=10)
    )
    cosmetic = _classify_chunk(
        DiffChunk(file_path="a.py", added_lines=1, removed_lines=1)
    )
    assert additive is ChangeClassification.ADDITIVE
    assert breaking is ChangeClassification.BREAKING
    # 1 vs 1 is below the breaking threshold; cosmetic default applies.
    assert cosmetic is ChangeClassification.COSMETIC


async def test_refactor_agent_coerces_mapping_to_diff(
    refactor_agent, stub_audit, stub_registry, sample_diff
):
    """Pydantic-mapping diff input is supported for non-Pydantic callers."""
    state = _granted_state(phase=SDLCPhase.IMPLEMENTATION)
    digest, _ = await refactor_agent.plan(
        state,
        {
            "unified_diff": sample_diff.unified_diff,
            "chunks": [],
            "source_files": ["backend/app/services/example.py"],
        },
    )
    assert isinstance(digest, MigrationPlanDigest)
    assert "backend/app/services/example.py" in digest.source_files


# ---------------------------------------------------------------------------
# 5. Whitelist drift defense — registry must still contain refactor
# ---------------------------------------------------------------------------


def test_whitelist_guard_passes_with_current_registry():
    """The current FORGE_COMMAND_MAP exposes forge-dev-refactor; the
    service must accept it without raising."""
    cmd = _validate_whitelist()
    assert cmd.forge_cmd == "forge-dev-refactor"
    assert cmd.internal_cmd == "gsd:dev:refactor"


def test_whitelist_guard_fails_closed_when_command_missing(monkeypatch):
    """If the registry is intentionally corrupted, the guard refuses.

    The actual exception type is :class:`UnknownForgeCommand` from
    ``app.services.forge_commands`` (raised by ``get_forge_command``).
    We accept the broad ``Exception`` so the test stays robust against
    future guard refactors that re-wrap it.
    """
    monkeypatch.delitem(FORGE_COMMAND_MAP, "forge-dev-refactor")
    with pytest.raises(Exception) as excinfo:
        _validate_whitelist()
    # Sanity: the exception message names the missing command.
    assert "forge-dev-refactor" in str(excinfo.value)


# ---------------------------------------------------------------------------
# 6. MigrationPlanDigest carries the four M2-spec fields
# ---------------------------------------------------------------------------


def test_migration_plan_digest_carries_the_four_m2_fields():
    digest = MigrationPlanDigest(
        source_files=["a.py", "b.py"],
        target_patterns=["strict types"],
        breaking_changes=[
            BreakingChange(
                file_path="a.py",
                symbol="foo",
                description="renamed signature",
                severity=0.8,
            )
        ],
        rollback_steps=["git revert HEAD", "rerun CI"],
    )
    dump = digest.model_dump()
    assert set(dump.keys()) >= {
        "source_files",
        "target_patterns",
        "breaking_changes",
        "rollback_steps",
    }
    assert dump["source_files"] == ["a.py", "b.py"]
    assert dump["breaking_changes"][0]["symbol"] == "foo"


def test_decorator_wires_approval_required_phases_attribute():
    """Track A reads __approval_required_phases__ for CI hygiene grep."""
    phases = getattr(RefactorAgent.plan, "__approval_required_phases__", None)
    assert phases == (SDLCPhase.IMPLEMENTATION,)
