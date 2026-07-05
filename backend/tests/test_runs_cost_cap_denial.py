"""Tests for AC-4 — cost-cap denial E2E (M6-G4).

Verifies the per-RUN cumulative-cap rule (ADR-009) surfaces as an
HTTP 403 with a ``cost_cap_exceeded`` body when an LLM call would
breach the configured ceiling.

The test wires a tiny FastAPI app with a single ``POST /_admit``
endpoint that delegates to
:meth:`app.services.litellm_client.LiteLLMClient.pre_call_admission`
and converts :class:`CostCapExceeded` to ``HTTPException(403)``. This
matches the API-surface contract the spec asks for; the wire shape
assertion (``body contains "cost_cap_exceeded"``) ensures the
error-code vocabulary is stable for the run-dashboard consumers.
"""

from __future__ import annotations

import json
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Wire admission gate → HTTP 403 surface (mirrors the conversion the
# spec asks the API to perform).
# ---------------------------------------------------------------------------


def _build_admission_app() -> TestClient:
    """Build a TestClient with a single admission route.

    The route shape mirrors what M6 would ship as
    ``POST /api/v1/runs/{run_id}/admit`` once the spec graduates from
    test-only to wire-shape.  We hand-roll it here so the test stays
    independent of any specific endpoint location.
    """

    async def _admit(
        run_id: uuid.UUID,
        body: dict[str, Any],
    ) -> dict[str, Any]:
        from app.services.litellm_client import CostCapExceeded, LiteLLMClient

        tenant_id = body["tenant_id"]
        projected = float(body.get("projected_cost_usd", 0.0))
        model = body.get("model")
        client = LiteLLMClient(
            base_url="http://litellm.test",
            api_key="test-key",
            cost_ledger=None,
            budget_service=MagicMock(),
        )
        try:
            await client.pre_call_admission(
                run_id=run_id,
                tenant_id=tenant_id,
                model=model,
                projected_cost_usd=projected,
            )
        except CostCapExceeded as exc:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "cost_cap_exceeded",
                    "message": str(exc),
                    "run_id": str(exc.run_id),
                    "tenant_id": str(exc.tenant_id),
                    "spent_usd": exc.spent_usd,
                    "projected_usd": exc.projected_usd,
                    "ceiling_usd": exc.ceiling_usd,
                },
            ) from exc
        return {"allowed": True, "decision": "within_ceiling"}

    app = FastAPI()
    app.post("/_admit/{run_id}")(_admit)
    return TestClient(app)


# ---------------------------------------------------------------------------
# AC-4 — cost-cap denial path
# ---------------------------------------------------------------------------


def test_cost_cap_denial_returns_403_with_cost_cap_exceeded_body() -> None:
    """$5 ceiling + $7 projected → 403 + ``cost_cap_exceeded`` body.

    Wires a fresh Settings with a $5 per-tenant override for
    ``tenant-deny-1`` and patches the cached settings accessor so
    ``pre_call_admission`` picks it up. The cost ledger's
    ``sum_spent_for_run`` is stubbed to return $4.5 (within the cap
    on its own) so the gate's deny path is exclusively triggered by
    the projected $7 spend.
    """
    from app.core.config import Settings, get_settings
    from app.services.cost_ledger import cost_ledger

    overrides_map = {"tenant-deny-1": 5.0}
    fake_settings = Settings(
        run_budget_cap_usd=50.0,
        run_budget_cap_overrides=overrides_map,
    )
    get_settings.cache_clear()

    async def fake_sum_spent_for_run(*_args: Any, **_kwargs: Any) -> float:
        return 4.5

    with patch.object(
        cost_ledger, "sum_spent_for_run", AsyncMock(side_effect=fake_sum_spent_for_run)
    ), patch("app.core.config.get_settings", return_value=fake_settings):
        # Sanity: the patched accessor returns our $5 ceiling.
        ceiling_check = fake_settings.run_budget_cap_overrides.get(
            "tenant-deny-1", fake_settings.run_budget_cap_usd
        )
        assert ceiling_check == pytest.approx(5.0)

        try:
            client = _build_admission_app()
            resp = client.post(
                f"/_admit/{uuid.uuid4()}",
                json={
                    "tenant_id": "tenant-deny-1",
                    "projected_cost_usd": 7.0,
                    "model": "gpt-4o-mini",
                },
            )

            assert resp.status_code == 403, resp.text
            body = resp.json()
            detail = body.get("detail") or {}
            # AC-4 wire-shape contract: ``detail.code == cost_cap_exceeded``
            assert detail.get("code") == "cost_cap_exceeded"
            # The spec asks the body to literally contain the snake-case
            # token; cover both the structured code and the human-readable
            # message (which uses the same vocabulary upstream).
            assert "cost_cap_exceeded" in json.dumps(body).lower()
            # Quantitative fields round-trip through the HTTP surface so
            # the operator dashboard can render the spend-vs-cap badge.
            assert detail.get("spent_usd") == pytest.approx(4.5)
            assert detail.get("projected_usd") == pytest.approx(7.0)
            assert detail.get("ceiling_usd") == pytest.approx(5.0)
        finally:
            get_settings.cache_clear()


__all__ = ["test_cost_cap_denial_returns_403_with_cost_cap_exceeded_body"]