"""Phase 5 -- log enrichment test.

Asserts that ``_inject_context`` binds all four required keys
(tenant_id, project_id, actor_id, request_id) when the contextvars
are set.
"""
from __future__ import annotations

from app.core.logging import (
    _inject_context,
    actor_id_ctx,
    project_id_ctx,
    request_id_ctx,
    tenant_id_ctx,
)


def test_inject_context_emits_all_keys():
    request_id_ctx.set("req-1")
    tenant_id_ctx.set("t1")
    project_id_ctx.set("p1")
    actor_id_ctx.set("a1")
    out = _inject_context(None, "info", {"event": "x"})
    assert out["request_id"] == "req-1"
    assert out["tenant_id"] == "t1"
    assert out["project_id"] == "p1"
    assert out["actor_id"] == "a1"


def test_inject_context_omits_when_unset():
    # Reset all contextvars
    for ctx in (request_id_ctx, tenant_id_ctx, project_id_ctx, actor_id_ctx):
        ctx.set(None)
    out = _inject_context(None, "info", {"event": "x"})
    for key in ("request_id", "tenant_id", "project_id", "actor_id"):
        assert key not in out
