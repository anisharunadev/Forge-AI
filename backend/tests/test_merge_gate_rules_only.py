"""F-503 rules-only MergeGateEngine — pytest coverage (plan 01-06 Task 3).

The locked Phase 1 decision (STATE.md) is:

    "Merge Gate (F-503) is rules-only — LLM is excluded from the gate
     decision."

These tests enforce that invariant in two ways:

1. ``test_no_llm_call`` patches ``litellm_client.completion`` with a
   ``MagicMock`` and asserts the mock was never invoked. Any future
   change that re-introduces an LLM call into the gate fails fast.
2. The other five tests cover the rules themselves: pass on a clean
   validation + under budget, fail on validation failure, fail on
   cost-cap exceeded, warn on medium-severity security findings,
   and the Rule 2 multi-tenant identity fields land on the decision.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.schemas.merge_gate_decision import MergeGateBlocker, MergeGateDecision
from app.services import merge_gate as merge_gate_module
from app.services.merge_gate import MergeGateEngine

# ---------------------------------------------------------------------------
# Helpers — build ValidationReport-shaped stubs without depending on the
# F-501 sub-graph machinery (so tests stay hermetic).
# ---------------------------------------------------------------------------


def _validation_report(*, verdict: str, security_count: int = 0):
    """Build a minimal stub with the attributes MergeGateEngine reads."""
    return SimpleNamespace(
        verdict=verdict,
        decision={"pass": "PASS", "warn": "FAIL", "fail": "FAIL"}.get(verdict, "PASS"),
        report_id=uuid.uuid4(),
        security_findings=[object()] * security_count,
    )


async def _stub_validator(*_args, **_kwargs):
    return _validation_report(verdict="pass")


class _StubCostLedger:
    def __init__(self, spent: float) -> None:
        self._spent = spent
        self.calls = 0

    async def sum_spent_for_run(self, run_id):
        self.calls += 1
        return self._spent


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_llm_call(monkeypatch):
    """The Merge Gate NEVER calls litellm_client.completion."""
    fake_completion = MagicMock()
    monkeypatch.setattr(merge_gate_module, "LiteLLMClient", SimpleNamespace, raising=False)
    # Patch the literal import path that the production module would
    # hit. The engine does NOT import litellm_client directly, so the
    # patch is a guard rail — if anyone adds that import, the mock
    # catches the regression immediately.
    from app.services import litellm_client

    monkeypatch.setattr(litellm_client, "completion", fake_completion, raising=False)

    engine = MergeGateEngine(
        code_validator=_stub_validator,
        cost_ledger=_StubCostLedger(5.0),
        settings=SimpleNamespace(run_budget_cap_usd=50.0),
    )
    decision = await engine.evaluate(
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        run_id=uuid.uuid4(),
        files=[],
    )

    assert isinstance(decision, MergeGateDecision)
    assert decision.verdict == "pass"
    fake_completion.assert_not_called()


@pytest.mark.asyncio
async def test_pass_when_validation_passes_and_under_budget():
    """Clean validation + spent < cap → verdict pass, no blockers."""
    engine = MergeGateEngine(
        code_validator=_stub_validator,
        cost_ledger=_StubCostLedger(5.0),
        settings=SimpleNamespace(run_budget_cap_usd=50.0),
    )
    decision = await engine.evaluate(
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        run_id=uuid.uuid4(),
        files=["a.py", "b.py"],
    )
    assert decision.verdict == "pass"
    assert decision.blockers == []
    assert decision.is_blocking is False


@pytest.mark.asyncio
async def test_fail_when_validation_fails():
    """ValidationReport.verdict == 'fail' → verdict fail, validation blocker."""

    async def failing_validator(*_args, **_kwargs):
        return _validation_report(verdict="fail")

    engine = MergeGateEngine(
        code_validator=failing_validator,
        cost_ledger=_StubCostLedger(5.0),
        settings=SimpleNamespace(run_budget_cap_usd=50.0),
    )
    decision = await engine.evaluate(
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        run_id=uuid.uuid4(),
        files=["c.py"],
    )
    assert decision.verdict == "fail"
    assert decision.is_blocking is True
    assert len(decision.blockers) == 1
    assert decision.blockers[0].category == "validation"
    assert isinstance(decision.blockers[0], MergeGateBlocker)


@pytest.mark.asyncio
async def test_fail_when_cost_cap_exceeded():
    """Validation passes but spent > cap → verdict fail, cost_cap blocker."""
    engine = MergeGateEngine(
        code_validator=_stub_validator,
        cost_ledger=_StubCostLedger(60.0),
        settings=SimpleNamespace(run_budget_cap_usd=50.0),
    )
    decision = await engine.evaluate(
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        run_id=uuid.uuid4(),
        files=[],
    )
    assert decision.verdict == "fail"
    assert decision.is_blocking is True
    assert decision.blockers[0].category == "cost_cap"
    assert "60" in decision.blockers[0].message or "exceeds" in decision.blockers[0].message


@pytest.mark.asyncio
async def test_warn_on_medium_security_findings():
    """verdict == 'warn' (medium security findings) → verdict warn, no blockers."""

    async def warn_validator(*_args, **_kwargs):
        return _validation_report(verdict="warn", security_count=2)

    engine = MergeGateEngine(
        code_validator=warn_validator,
        cost_ledger=_StubCostLedger(5.0),
        settings=SimpleNamespace(run_budget_cap_usd=50.0),
    )
    decision = await engine.evaluate(
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        run_id=uuid.uuid4(),
        files=["d.py"],
    )
    assert decision.verdict == "warn"
    assert decision.blockers == []
    assert decision.is_blocking is False


@pytest.mark.asyncio
async def test_decision_carries_tenant_and_project_ids():
    """Rule 2 — tenant_id, project_id, run_id are required and round-trip."""
    tenant = uuid.uuid4()
    project = uuid.uuid4()
    run = uuid.uuid4()

    engine = MergeGateEngine(
        code_validator=_stub_validator,
        cost_ledger=_StubCostLedger(5.0),
        settings=SimpleNamespace(run_budget_cap_usd=50.0),
    )
    decision = await engine.evaluate(
        tenant_id=tenant,
        project_id=project,
        run_id=run,
        files=[],
    )
    assert decision.tenant_id == tenant
    assert decision.project_id == project
    assert decision.run_id == run
    # produced_at is set automatically.
    assert isinstance(decision.produced_at, datetime)
    assert decision.produced_at.tzinfo is not None
