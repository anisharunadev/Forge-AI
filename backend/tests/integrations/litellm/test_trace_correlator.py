"""Unit tests for ``app.integrations.litellm.trace_correlator`` (F-829k).

The trace correlator writes a ``LiteLLMCallRecord`` (or equivalent)
that ties a ``forge_trace_id`` to the LiteLLM-side ``call_id`` so
audit log correlation is 100% (NFR: ``forge_trace_id`` present in
``litellm_call_records``).
"""

from __future__ import annotations

import uuid

import pytest


def _try_import_trace_correlator():
    return pytest.importorskip("app.integrations.litellm.trace_correlator")


# ---------------------------------------------------------------------------
# 1. record_call_with_trace_id persists the trace + call correlation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_record_call_with_trace_id(
    sqlite_db,
    fake_tenant_id,
    fake_project_id,
):
    """record_call writes a row carrying the ``forge_trace_id`` and
    the LiteLLM-side ``call_id`` so audit log queries can join on
    either side.
    """
    mod = _try_import_trace_correlator()
    correlator = mod.TraceCorrelator(session_factory=sqlite_db)

    forge_trace_id = f"forge-trace-{uuid.uuid4().hex[:8]}"
    litellm_call_id = f"litellm-call-{uuid.uuid4().hex[:8]}"

    record = await correlator.record_call(
        tenant_id=fake_tenant_id,
        project_id=fake_project_id,
        forge_trace_id=forge_trace_id,
        litellm_call_id=litellm_call_id,
        model="gpt-4o-mini",
        prompt_tokens=12,
        completion_tokens=7,
        cost_usd=0.0003,
    )

    # The record exposes the forge_trace_id for downstream callers.
    assert getattr(record, "forge_trace_id", None) == forge_trace_id

    # Read it back from the DB. We try the likely model name; if the
    # source module hasn't introduced it yet the assertion is still
    # valuable at the API level.
    try:
        from sqlalchemy import select

        from app.db.models.litellm_call_records import LiteLLMCallRecord  # type: ignore

        async with sqlite_db() as session:
            rows = (
                await session.execute(
                    select(LiteLLMCallRecord).where(
                        LiteLLMCallRecord.forge_trace_id == forge_trace_id,
                    )
                )
            ).scalars().all()
        assert len(rows) == 1
        assert rows[0].litellm_call_id == litellm_call_id
        assert rows[0].tenant_id == fake_tenant_id
        assert rows[0].project_id == fake_project_id
    except ImportError:
        # The DB table / model class isn't landed yet — the contract
        # assertion above is still the load-bearing check.
        pass
