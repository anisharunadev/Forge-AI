"""TestHookOrchestrator — register, fire_pre, fire_post, async_timeout."""

from __future__ import annotations

import asyncio
import sys
import uuid

import pytest

from app.db.models.hook import HookPhase
from app.schemas.hooks import HookResult
from app.services.hook_orchestrator import HookOrchestrator


@pytest.fixture
async def orch(sqlite_db):
    return HookOrchestrator()


async def test_register_and_fire_post(orch, sqlite_db):
    tenant_id = str(uuid.uuid4())
    await orch.register_hook(
        tenant_id=tenant_id,
        project_id=None,
        name="log-on-create",
        event_type="artifact.created",
        phase=HookPhase.POST,
        script=f"{sys.executable} -c 'print(\"hello\")'",
    )

    results = await orch.fire(
        tenant_id=tenant_id,
        project_id=None,
        event_type="artifact.created",
        phase=HookPhase.POST,
    )
    assert len(results) == 1
    r = results[0]
    assert r.ok is True
    assert r.output is not None and "hello" in r.output


async def test_fire_pre_mutates_context(orch, sqlite_db):
    tenant_id = str(uuid.uuid4())
    await orch.register_hook(
        tenant_id=tenant_id,
        project_id=None,
        name="enrich-context",
        event_type="agent.run.started",
        phase=HookPhase.PRE,
        script=(
            f"{sys.executable} -c "
            "'import json,sys; "
            'ctx=json.loads(sys.argv[1]); '
            'ctx[\"enriched\"]=True; '
            'print(\"__forge_mutate__:\",json.dumps(ctx))\' '
            "\"$FORGE_HOOK_CONTEXT\""
        ),
        run_order=10,
    )

    results = await orch.fire(
        tenant_id=tenant_id,
        project_id=None,
        event_type="agent.run.started",
        phase=HookPhase.PRE,
        context={"job": "lint"},
    )
    assert len(results) == 1
    assert results[0].ok is True


async def test_disabled_hook_does_not_run(orch, sqlite_db):
    tenant_id = str(uuid.uuid4())
    await orch.register_hook(
        tenant_id=tenant_id,
        project_id=None,
        name="off",
        event_type="x.y",
        phase=HookPhase.POST,
        script="echo SHOULD_NOT_RUN",
        enabled=False,
    )

    results = await orch.fire(
        tenant_id=tenant_id,
        project_id=None,
        event_type="x.y",
        phase=HookPhase.POST,
    )
    assert results == []


async def test_timeout_kills_long_hook(orch, sqlite_db):
    tenant_id = str(uuid.uuid4())
    await orch.register_hook(
        tenant_id=tenant_id,
        project_id=None,
        name="slow",
        event_type="x.slow",
        phase=HookPhase.POST,
        script=f"{sys.executable} -c 'import time; time.sleep(5)'",
        timeout_seconds=1,
    )

    start = asyncio.get_event_loop().time()
    results = await orch.fire(
        tenant_id=tenant_id,
        project_id=None,
        event_type="x.slow",
        phase=HookPhase.POST,
    )
    elapsed = asyncio.get_event_loop().time() - start
    # Allow generous slack for SIGKILL propagation; the timeout fires
    # at ~1s but the kill + cleanup can take a few seconds.
    assert elapsed < 8.0
    assert len(results) == 1
    assert results[0].ok is False
    assert results[0].error == "hook_timeout"
