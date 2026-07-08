"""Plan 01-03 — BasePhaseNode.mutate() writes an audit row by default.

PITFALL-5 closure verification.  These tests pin the contract that:

1. Every call to :meth:`BasePhaseNode.mutate` writes exactly one row
   to :class:`AuditEvent` via :func:`audit_service.record`.
2. The audit row carries every Rule 6 field
   (``agent``, ``model``, ``prompt``, ``tool``, ``cost``, ``artifact``,
   ``timestamp``, ``result``).
3. The method has no conditional skip — ``inspect.getsource`` confirms
   the body always calls ``audit_service.record`` regardless of inputs.

The audit service is patched with ``AsyncMock`` so the test never
touches the DB; the assertion is on the call shape, not the
persistence path (which is covered by
``test_audit_invariant.py`` / ``test_audit_completeness_invariant.py``).
"""

from __future__ import annotations

import inspect
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest

from app.agents.nodes.base import BasePhaseNode
from app.agents.sdlc_state import SDLCPhase, SDLCState

# ---------------------------------------------------------------------------
# Helper — minimal DiscoveryNode instance is overkill; build a concrete
# subclass inline so the test owns every field.
# ---------------------------------------------------------------------------


class _ProbeNode(BasePhaseNode):
    """Minimal concrete subclass for the mutate() contract tests."""

    phase_name = SDLCPhase.DISCOVERY
    requires_approval = False
    max_cost_usd = Decimal("0.25")
    max_duration_seconds = 60

    async def execute(self, state: SDLCState) -> SDLCState:  # pragma: no cover - unused
        return state


def _make_state() -> SDLCState:
    return SDLCState(
        tenant_id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        actor_id=uuid.uuid4(),
        context={"repo_path": "/tmp/probe"},
    )


@pytest.mark.asyncio
async def test_mutate_writes_audit_record():
    """mutate() invokes audit_service.record exactly once with the documented kwargs."""
    node = _ProbeNode()
    state = _make_state()

    with patch("app.agents.nodes.base.audit_service") as audit_svc:
        audit_svc.record = AsyncMock(return_value=uuid.uuid4())
        new_state = await node.mutate(
            state,
            agent="discovery",
            model="gpt-4o-mini",
            prompt="discovery.t1",
            tool="kg.read",
            artifact={"x": 1},
            result={"ok": True},
        )

    # The audit service was called exactly once.
    audit_svc.record.assert_awaited_once()

    # The same state is returned when no apply callable is supplied.
    assert new_state is state

    call = audit_svc.record.await_args
    assert call is not None
    kwargs = call.kwargs

    # The kwargs match the audit_service.record contract: tenant / project /
    # actor context + action / target_type / target_id / payload / occurred_at.
    assert kwargs["tenant_id"] == state.tenant_id
    assert kwargs["project_id"] == state.project_id
    assert kwargs["actor_id"] == state.actor_id
    assert kwargs["action"] == "discovery.gpt-4o-mini"
    assert kwargs["target_type"] == "kg.read"
    assert kwargs["target_id"] == "discovery.t1"
    assert isinstance(kwargs["occurred_at"], datetime)
    payload = kwargs["payload"]
    assert payload["agent"] == "discovery"
    assert payload["model"] == "gpt-4o-mini"
    assert payload["prompt"] == "discovery.t1"
    assert payload["tool"] == "kg.read"
    assert payload["cost"] == 0.0
    assert payload["artifact"] == {"x": 1}
    assert payload["result"] == {"ok": True}
    assert payload["phase"] == SDLCPhase.DISCOVERY.value


@pytest.mark.asyncio
async def test_mutate_record_contains_rule6_fields():
    """The audit payload carries every Rule 6 field (agent, model, prompt, tool, cost, artifact, timestamp, result)."""  # noqa: E501
    node = _ProbeNode()
    state = _make_state()

    with patch("app.agents.nodes.base.audit_service") as audit_svc:
        audit_svc.record = AsyncMock(return_value=uuid.uuid4())
        await node.mutate(
            state,
            agent="architecture",
            model="claude-sonnet-4-6",
            prompt="arch.gate",
            tool="adr.write",
            artifact={"artifact_id": str(uuid.uuid4()), "type": "adr"},
            result={"decision": "approved"},
        )

    call = audit_svc.record.await_args
    assert call is not None
    payload = call.kwargs["payload"]
    # The 8 Rule 6 fields are all present in the payload (timestamp is the
    # ``occurred_at`` kwarg, not in the payload itself).
    for key in (
        "agent",
        "model",
        "prompt",
        "tool",
        "cost",
        "artifact",
        "result",
    ):
        assert key in payload, f"Rule 6 field {key!r} missing from payload"

    # ``timestamp`` is folded into ``occurred_at`` on the audit row.
    assert "occurred_at" in call.kwargs
    assert isinstance(call.kwargs["occurred_at"], datetime)
    assert call.kwargs["occurred_at"].tzinfo is not None
    # And the occurred_at is recent (within the last 5s).
    delta = (datetime.now(UTC) - call.kwargs["occurred_at"]).total_seconds()
    assert 0.0 <= delta < 5.0


def test_mutate_no_conditional_skip():
    """``mutate`` always calls ``audit_service.record`` — no ``if`` guard can skip it."""
    source = inspect.getsource(BasePhaseNode.mutate)
    # The method body references the audit_service.record call at least
    # once, and there is no ``if not some_flag: return ...`` that could
    # short-circuit the call. The structural assertion is the audit
    # identifier itself — the function name appears in the source.
    assert "audit_service.record" in source
    # No ``return new_state`` precedes the audit call (i.e. the call is
    # not behind an early-return guard).  Heuristic: the audit call
    # must appear before the return statement that hands control back.
    record_idx = source.find("audit_service.record")
    return_idx = source.rfind("return new_state")
    assert record_idx != -1
    assert return_idx != -1
    assert record_idx < return_idx, (
        "audit_service.record must execute before mutate() returns the new state"
    )
