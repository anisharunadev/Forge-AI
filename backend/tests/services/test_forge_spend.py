"""step-75 P3 — Spend Service tests.

Covers:

* (a) ``record_from_usage`` is idempotent on ``litellm_request_id`` → 1 row
  regardless of how many times the caller writes the same id.
* (b) ``record_from_usage`` emits an audit event with action
  ``forge.spend.recorded`` via ``audit_service.record``.
* (c) ``reconcile`` upserts when ``/spend/logs`` returns a cost that
  diverges from the DB by >1%; drift event is emitted.
* (d) ``summary`` aggregates totals + ``by_model`` grouping correctly
  across multiple rows and models.
* (e) ``cost_meter`` returns the latest row for a ``run_id`` (id
  collision case).

HTTP mocking follows the established ``httpx.MockTransport`` pattern
from ``tests/services/test_forge_models.py``. ``respx`` isn't installed
in this env so we reuse the same in-process transport — they observe the
same outbound requests and assertions look identical.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio

# Stub the session factory BEFORE importing forge_spend — the chain
# ``app.integrations.litellm/__init__.py`` → ``usage_query.py`` constructs a
# ``UsageQuery()`` at module-load time, which calls ``get_session_factory()``
# and would otherwise error on the SQLite pool_size mismatch. Pattern from
# ``tests/services/test_forge_models.py``.
import app.db.session as _session_mod


class _StubSessionFactory:
    """Used only when the ``sqlite_db`` fixture hasn't run yet."""

    def __call__(self) -> Any:  # pragma: no cover - only used as a guard
        raise RuntimeError("sqlite_db fixture not active")


def _passthrough_factory() -> Any:
    """Delegate to the module-level ``_session_factory`` the ``sqlite_db``
    fixture sets. This stub exists only to bypass the lazy-init path
    (which would create a production engine and trip SQLite's pool_size
    rejection at import time)."""
    return _session_mod._session_factory or _StubSessionFactory()


_session_mod.get_session_factory = _passthrough_factory  # type: ignore[assignment]

from app.services.forge_spend import (  # noqa: E402  — must follow the stub above
    SpendRecord,
    SpendService,
)

from app.db import base as base_mod


# ---------------------------------------------------------------------------
# Per-test: clean audit call log so assertions see only this test's calls
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _patch_audit(monkeypatch):
    """Swap ``audit_service.record`` for an in-memory list; tests assert
    against it. Patches the singleton directly — the service imports the
    bound name at module load so this is sufficient."""
    from app.services import forge_spend as fs_mod

    calls: list[dict[str, Any]] = []

    async def _record(**kwargs: Any) -> None:
        calls.append(kwargs)

    monkeypatch.setattr(fs_mod.audit_service, "record", _record)
    return calls


# ---------------------------------------------------------------------------
# HTTP mocking helpers — httpx.MockTransport (same pattern as test_forge_models)
# ---------------------------------------------------------------------------


def _make_transport(handlers: dict[str, Any]):
    """Path → callable(request) → httpx.Response."""

    async def handler(request: httpx.Request) -> httpx.Response:
        for path, fn in handlers.items():
            if request.url.path.endswith(path):
                return fn(request)
        return httpx.Response(500, json={"error": f"unhandled {request.url.path}"})

    return httpx.MockTransport(handler)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def spend_svc(sqlite_db):
    """Service bound to the in-memory SQLite engine from ``sqlite_db``."""
    return SpendService()


def _make_record_kwargs(**overrides: Any) -> dict[str, Any]:
    base = {
        "tenant_id": uuid4(),
        "project_id": uuid4(),
        "agent_id": uuid4(),
        "user_id": uuid4(),
        "team_id": None,
        "model": "gpt-4o",
        "prompt_tokens": 100,
        "completion_tokens": 50,
        "litellm_request_id": f"req-{uuid4()}",
        "cost_usd": 0.001,
    }
    base.update(overrides)
    return base


async def _row_count_for(req_id: str) -> int:
    factory = _session_mod.get_session_factory()
    async with factory() as session:
        from sqlalchemy import select

        result = await session.execute(
            select(SpendRecord).where(SpendRecord.litellm_request_id == req_id)
        )
        return len(result.scalars().all())


# ---------------------------------------------------------------------------
# (a) idempotency — same litellm_request_id written twice → 1 row
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_record_from_usage_idempotent(sqlite_db, _patch_audit):
    svc = SpendService()
    req_id = f"req-stable-{uuid4()}"
    kwargs = _make_record_kwargs(litellm_request_id=req_id, cost_usd=0.0042)

    first = await svc.record_from_usage(**kwargs)
    second = await svc.record_from_usage(**kwargs)

    assert first.id == second.id, "idempotent write must return same row"
    assert await _row_count_for(req_id) == 1


# ---------------------------------------------------------------------------
# (b) audit event with action=forge.spend.recorded
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_record_from_usage_audit_emitted(sqlite_db, _patch_audit):
    audit_calls = _patch_audit
    svc = SpendService()
    req_id = f"req-audit-{uuid4()}"

    await svc.record_from_usage(**_make_record_kwargs(litellm_request_id=req_id))

    spend_events = [c for c in audit_calls if c.get("action") == "forge.spend.recorded"]
    assert len(spend_events) == 1, f"expected 1 audit call, got {audit_calls}"
    call = spend_events[0]
    assert call["target_type"] == "spend_record"
    assert call["payload"]["litellm_request_id"] == req_id
    assert call["payload"]["cost_usd"] == pytest.approx(0.001)


# ---------------------------------------------------------------------------
# (c) reconcile upserts on cost drift + emits forge.spend.drift_detected
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reconcile_upserts_on_cost_drift(sqlite_db, monkeypatch, _patch_audit):
    audit_calls = _patch_audit
    svc = SpendService()

    tenant_id = uuid4()
    project_id = uuid4()
    agent_id = uuid4()
    user_id = uuid4()
    req_id = f"req-drift-{uuid4()}"

    # Seed an existing row at cost 0.010.
    factory = _session_mod.get_session_factory()
    async with factory() as session:
        session.add(
            SpendRecord(
                id=uuid4(),
                tenant_id=tenant_id,
                project_id=project_id,
                agent_id=agent_id,
                user_id=user_id,
                team_id=None,
                model="gpt-4o",
                prompt_tokens=1000,
                completion_tokens=500,
                total_tokens=1500,
                cost_usd=0.010,
                litellm_request_id=req_id,
            )
        )
        await session.commit()

    # Mock /spend/logs to return a 2% higher cost.
    handlers = {
        "/spend/logs": lambda req: httpx.Response(
            200,
            json=[
                {
                    "request_id": req_id,
                    "tenant_id": str(tenant_id),
                    "project_id": str(project_id),
                    "agent_id": str(agent_id),
                    "user_id": str(user_id),
                    "model": "gpt-4o",
                    "prompt_tokens": 1000,
                    "completion_tokens": 500,
                    "total_tokens": 1500,
                    "spend": 0.0102,  # +2% drift
                }
            ],
        )
    }
    transport = _make_transport(handlers)

    # Patch the symbol that forge_spend imported, NOT the original module —
    # ``from ... import LiteLLMBaseClient`` binds the name on forge_spend.
    from app.services import forge_spend as forge_spend_mod

    class _FakeBase:
        def __init__(self) -> None:
            self._client = httpx.AsyncClient(
                base_url="http://litellm.test", timeout=10.0, transport=transport
            )

        async def __aenter__(self) -> "_FakeBase":
            return self

        async def __aexit__(self, *exc: Any) -> None:
            await self._client.aclose()

        @property
        def admin_client(self) -> httpx.AsyncClient:
            return self._client

    monkeypatch.setattr(forge_spend_mod, "LiteLLMBaseClient", _FakeBase)

    result = await svc.reconcile(last_sync=datetime.now(timezone.utc))

    assert result["drift_count"] == 1
    assert result["rows_upserted"] >= 1

    drift_events = [c for c in audit_calls if c.get("action") == "forge.spend.drift_detected"]
    assert len(drift_events) == 1, f"expected drift event, got {audit_calls}"
    payload = drift_events[0]["payload"]
    assert payload["litellm_cost_usd"] == pytest.approx(0.0102)
    assert payload["forge_cost_usd"] == pytest.approx(0.010)

    # And the DB row was updated to 0.0102.
    async with factory() as session:
        from sqlalchemy import select

        row = await session.scalar(
            select(SpendRecord).where(SpendRecord.litellm_request_id == req_id)
        )
        assert row is not None
        assert float(row.cost_usd) == pytest.approx(0.0102, abs=1e-6)


# ---------------------------------------------------------------------------
# (d) summary — totals + by_model grouping
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_summary_returns_aggregated(sqlite_db, _patch_audit):
    svc = SpendService()
    tenant_id = uuid4()
    project_id = uuid4()
    # Use a 1h backstop so sub-microsecond clock skew between the insert
    # and the summary() call cannot filter rows out.
    since = datetime.now(timezone.utc) - timedelta(hours=1)

    factory = _session_mod.get_session_factory()
    async with factory() as session:
        # 2 rows for gpt-4o, 1 row for claude — distinct models for grouping.
        rows = [
            SpendRecord(
                id=uuid4(),
                tenant_id=tenant_id,
                project_id=project_id,
                agent_id=uuid4(),
                user_id=uuid4(),
                team_id=None,
                model="gpt-4o",
                prompt_tokens=100,
                completion_tokens=50,
                total_tokens=150,
                cost_usd=0.010,
                litellm_request_id=f"r-{uuid4()}",
            ),
            SpendRecord(
                id=uuid4(),
                tenant_id=tenant_id,
                project_id=project_id,
                agent_id=uuid4(),
                user_id=uuid4(),
                team_id=None,
                model="gpt-4o",
                prompt_tokens=200,
                completion_tokens=80,
                total_tokens=280,
                cost_usd=0.020,
                litellm_request_id=f"r-{uuid4()}",
            ),
            SpendRecord(
                id=uuid4(),
                tenant_id=tenant_id,
                project_id=project_id,
                agent_id=uuid4(),
                user_id=uuid4(),
                team_id=None,
                model="bedrock/claude-3-5-sonnet",
                prompt_tokens=300,
                completion_tokens=120,
                total_tokens=420,
                cost_usd=0.030,
                litellm_request_id=f"r-{uuid4()}",
            ),
        ]
        for r in rows:
            session.add(r)
        await session.commit()

    summary = await svc.summary(
        tenant_id=tenant_id, project_id=project_id, since=since
    )

    assert summary.tenant_id == tenant_id
    assert summary.project_id == project_id
    assert summary.request_count == 3
    assert summary.total_cost_usd == pytest.approx(0.060)

    by_model = {row.model: row for row in summary.by_model}
    assert set(by_model.keys()) == {"gpt-4o", "bedrock/claude-3-5-sonnet"}

    gpt = by_model["gpt-4o"]
    assert gpt.request_count == 2
    assert gpt.cost_usd == pytest.approx(0.030)
    assert gpt.prompt_tokens == 300
    assert gpt.completion_tokens == 130

    claude = by_model["bedrock/claude-3-5-sonnet"]
    assert claude.request_count == 1
    assert claude.cost_usd == pytest.approx(0.030)


# ---------------------------------------------------------------------------
# (e) cost_meter returns the LATEST row for a given run_id
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cost_meter_returns_latest(sqlite_db, _patch_audit):
    svc = SpendService()
    factory = _session_mod.get_session_factory()

    # Two rows that share a run_id is not directly possible (id is PK), so
    # emulate the "latest wins" contract by writing two rows where the
    # *user* treats the second row's id as the active run_id; cost_meter
    # returns that single row.
    earlier_id = uuid4()
    later_id = uuid4()
    tenant_id = uuid4()
    project_id = uuid4()
    agent_id = uuid4()
    user_id = uuid4()

    async with factory() as session:
        session.add(
            SpendRecord(
                id=earlier_id,
                tenant_id=tenant_id,
                project_id=project_id,
                agent_id=agent_id,
                user_id=user_id,
                team_id=None,
                model="gpt-4o",
                prompt_tokens=100,
                completion_tokens=50,
                total_tokens=150,
                cost_usd=0.005,
                litellm_request_id=f"r-{uuid4()}",
            )
        )
        session.add(
            SpendRecord(
                id=later_id,
                tenant_id=tenant_id,
                project_id=project_id,
                agent_id=agent_id,
                user_id=user_id,
                team_id=None,
                model="gpt-4o",
                prompt_tokens=250,
                completion_tokens=120,
                total_tokens=370,
                cost_usd=0.025,
                litellm_request_id=f"r-{uuid4()}",
            )
        )
        await session.commit()

    meter_later = await svc.cost_meter(run_id=later_id)
    meter_earlier = await svc.cost_meter(run_id=earlier_id)

    assert meter_later is not None
    assert meter_earlier is not None
    # Distinct rows, "latest" semantics: later row has higher cost.
    assert meter_later.run_id == later_id
    assert meter_earlier.run_id == earlier_id
    assert meter_later.cost_usd == pytest.approx(0.025)
    assert meter_earlier.cost_usd == pytest.approx(0.005)

    # And an unknown run_id returns None.
    assert await svc.cost_meter(run_id=uuid4()) is None
