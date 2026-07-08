"""Regression tests for the two AMBER fixes in app/services/forge_models.py.

(a) _descriptor populates the nested `cost: ModelCost` field
    (input/output scaled to per-1k tokens) from per-token values.
(b) _descriptor leaves `cost` as None when input is missing.
(c) _provider returns '' (not 'openai') when the model id has no '/'.
(d) refresh_cache() without a principal does NOT call audit_service.record.
(e) refresh_cache(principal={...}) passes the real UUIDs to audit_service.record,
    not the nil UUID.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

# Stub ``app.db.session`` BEFORE importing the integration package so
# eager module-load-time DB usage does not open a real async engine
# (in-memory SQLite rejects pool_size/max_overflow). Pattern lifted from
# tests/services/test_forge_models.py.
import app.db.session as _session_mod


class _StubSession:
    async def __aenter__(self) -> _StubSession:
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def commit(self) -> None:
        return None


class _StubSessionFactory:
    def __call__(self, *args: Any, **kwargs: Any) -> _StubSession:
        return _StubSession()


_session_mod.get_session_factory = _StubSessionFactory  # type: ignore[assignment]

from app.services.forge_models import ModelsService  # noqa: E402

# ---------------------------------------------------------------------------
# (a) nested cost populated from per-token values, scaled to per-1k
# ---------------------------------------------------------------------------


def test_descriptor_populates_nested_cost():
    """Per-token costs in -> per-1k cost out, USD."""
    desc = ModelsService._descriptor(
        "openai/gpt-4o",
        allowed=True,
        cost_in=0.000003,
        cost_out=0.000015,
    )
    assert desc.cost is not None
    assert desc.cost.input_per_1k == pytest.approx(0.003)
    assert desc.cost.output_per_1k == pytest.approx(0.015)
    assert desc.cost.currency == "USD"


# ---------------------------------------------------------------------------
# (b) cost stays None when input is missing
# ---------------------------------------------------------------------------


def test_descriptor_cost_none_when_input_missing():
    desc = ModelsService._descriptor(
        "openai/gpt-4o",
        allowed=True,
        cost_in=None,
        cost_out=0.000015,
    )
    assert desc.cost is None


# ---------------------------------------------------------------------------
# (c) provider defaults to '' (not 'openai') for slashless ids
# ---------------------------------------------------------------------------


def test_provider_no_openai_default():
    assert ModelsService._provider("claude-3-5-sonnet") == ""


def test_provider_keeps_prefix_when_slash_present():
    """Sanity check: the prefix-before-slash path still works."""
    assert ModelsService._provider("bedrock/claude-3-5-sonnet") == "bedrock"


# ---------------------------------------------------------------------------
# (d) refresh_cache without principal -> audit_service.record NOT called
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refresh_cache_skips_audit_without_principal():
    svc = ModelsService()
    with patch(
        "app.services.forge_models.audit_service.record",
        new=AsyncMock(),
    ) as mock_record:
        await svc.refresh_cache()
    mock_record.assert_not_called()


# ---------------------------------------------------------------------------
# (e) refresh_cache with principal -> audit_service.record called with real UUIDs
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refresh_cache_passes_real_principal():
    svc = ModelsService()
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    user_id = uuid.uuid4()

    with patch(
        "app.services.forge_models.audit_service.record",
        new=AsyncMock(),
    ) as mock_record:
        await svc.refresh_cache(
            principal={
                "tenant_id": str(tenant_id),
                "project_id": str(project_id),
                "user_id": str(user_id),
            }
        )

    mock_record.assert_awaited_once()
    kwargs = mock_record.await_args.kwargs
    assert kwargs["tenant_id"] == tenant_id
    assert kwargs["project_id"] == project_id
    assert kwargs["actor_id"] == user_id

    nil = uuid.UUID("00000000-0000-0000-0000-000000000000")
    assert kwargs["tenant_id"] != nil
    assert kwargs["project_id"] != nil
    assert kwargs["actor_id"] != nil
