"""Tests for GET /api/v1/runs/{id}/budget after the M6-G3 phase-guard fix.

AC-3: ``/runs/{id}/budget`` returns 200 (not 409) when the run is
in ARCHITECTURE phase. The test exercises the endpoint via FastAPI
``TestClient`` so the wire shape (including the new ``frozen_at``
field) is verified end-to-end.

We mount the runs router on a tiny FastAPI app with overrides for
the principal + DB session, then push a stubbed run into the
in-process ``SDLCRunManager`` registry so the route's lookup hits
the active phase without standing up LangGraph or SQLite.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helpers — small stub state shaped like ``SDLCState`` so the
# ``get_run`` path returns the right ``current_phase`` / ``tenant_id``.
# ---------------------------------------------------------------------------


class _StubState:
    """Bare-minimum SDLCState stand-in for the budget endpoint test.

    The endpoint reads ``state.tenant_id``, ``state.current_phase``,
    and ``state.updated_at`` only — every other attribute is ignored.
    Returning a typed stub keeps the test from standing up the full
    LangGraph supervisor + LangChain chat models that real SDLCState
    construction requires.
    """

    def __init__(
        self,
        *,
        run_id: uuid.UUID,
        tenant_id: str,
        phase: str,
    ) -> None:
        self.run_id = run_id
        # Route compares ``state.tenant_id != principal.tenant_id``
        # where principal.tenant_id is a JWT string claim.  Match the
        # string shape so the tenant-scope guard passes.
        self.tenant_id = tenant_id
        self.current_phase = _StubPhase(phase)
        self.updated_at = datetime.now(UTC)


class _StubPhase:
    """String-backed SDLCPhase stand-in."""

    def __init__(self, value: str) -> None:
        self.value = value


def _client_with_state(state: _StubState | None) -> TestClient:
    """Build a TestClient with the runs router mounted and deps
    overridden."""
    from app.api import deps as deps_mod
    from app.api.v1 import runs as runs_router
    from app.core.security import AuthenticatedPrincipal

    app = FastAPI()
    app.include_router(runs_router.router, prefix="/api/v1")

    tid = state.tenant_id if state is not None else uuid.uuid4()
    user_id = uuid.uuid4()
    project_id = uuid.uuid4()

    async def _override_principal() -> Any:
        return AuthenticatedPrincipal(
            user_id=str(user_id),
            email="tester@example.com",
            tenant_id=str(tid),
            project_id=str(project_id),
            roles=["developer"],
            raw_claims={"forge.permissions": ["runs:read"]},
        )

    async def _override_db() -> Any:
        yield MagicMock()

    app.dependency_overrides[deps_mod.get_current_principal] = _override_principal
    app.dependency_overrides[deps_mod.db_session] = _override_db

    return TestClient(app)


# ---------------------------------------------------------------------------
# AC-3 — budget endpoint supports any phase
# ---------------------------------------------------------------------------


def test_budget_endpoint_supports_any_phase() -> None:
    """A run in ARCHITECTURE phase returns 200 (not 409) and the
    response carries the new ``frozen_at`` field (null while the
    run is active)."""
    # ``tenant_id`` is a string here to match the JWT claim shape
    # the route compares against (``principal.tenant_id`` is str).
    tenant_id = str(uuid.uuid4())
    run_id = uuid.uuid4()
    state = _StubState(
        run_id=run_id,
        tenant_id=tenant_id,
        phase="architecture",
    )

    # Inject the stub state into the default manager so the route's
    # ``get_run`` returns our phase-shifted stub.
    from app.services import sdlc_run_manager as srm_mod

    default = srm_mod.get_default_manager()
    default._states[state.run_id] = state  # type: ignore[attr-defined]

    # The budget endpoint hits the cost ledger; stub it out so we
    # don't need a live DB session. spent_usd=0 keeps the math
    # trivial (remaining_usd == ceiling_usd).
    async def fake_sum_spent(run_id: Any, **_kw: Any) -> float:
        return 0.0

    with patch(
        "app.services.cost_ledger.cost_ledger.sum_spent_for_run",
        AsyncMock(side_effect=fake_sum_spent),
    ):
        client = _client_with_state(state)
        resp = client.get(f"/api/v1/runs/{run_id}/budget")

    assert resp.status_code == 200, resp.text
    body = resp.json()

    # AC-3 hard assertions:
    assert body["run_id"] == str(run_id)
    assert body["tenant_id"] == str(tenant_id)
    # Active-phase frozen_at must be null (the run is still moving).
    assert body["frozen_at"] is None
    # current_phase is echoed so the UI can render a muted badge
    # without a follow-up /runs/{id} call.
    assert body["current_phase"] == "architecture"
    # ceiling/spent/remaining shape is preserved.
    assert "ceiling_usd" in body
    assert "spent_usd" in body
    assert "remaining_usd" in body
    assert body["currency"] == "USD"


__all__ = ["test_budget_endpoint_supports_any_phase"]