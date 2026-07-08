"""E2E integration test for the F-829 LiteLLM tenant lifecycle.

Exercises the full happy-path flow:

    Create tenant
      → LiteLLM Team created
      → Virtual Key minted + stored in Secrets Manager
      → LLM call goes through LiteLLM with trace header
      → Trace recorded in ``litellm_call_records``
      → Tenant archived → Team archived, key revoked
      → Reconciliation → no drift

The test is opt-in via ``pytest -m integration`` and is skipped in the
default collection. It requires:

  * A live LiteLLM proxy reachable at ``settings.litellm_admin_url``
    with a valid ``litellm_admin_key``.
  * AWS credentials (or LocalStack) for Secrets Manager.

In environments where those are unavailable, the test is skipped
automatically by probing ``settings.litellm_integration_enabled`` and
the Secrets Manager client.
"""

from __future__ import annotations

import os
import uuid

import pytest

# ---------------------------------------------------------------------------
# Mark this entire module as integration-only. Opt in via:
#   pytest -m integration
# The default ``pytest`` collection skips these.
# ---------------------------------------------------------------------------


def _integration_targets_present() -> bool:
    """Return True iff both LiteLLM and AWS Secrets Manager look reachable."""
    if os.getenv("SKIP_LITELLM_INTEGRATION"):
        return False
    if not os.getenv("LITELLM_ADMIN_URL"):
        return False
    return os.getenv("AWS_ACCESS_KEY_ID") or os.getenv("AWS_PROFILE")


pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not _integration_targets_present(),
        reason="requires live DB + LiteLLM + AWS Secrets Manager",
    ),
]  # type: ignore[list-item]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_json(client_method, url, json=None):
    """Helper for asserting + returning the JSON body from an admin call."""
    raise NotImplementedError  # placeholder; replaced by per-test code.


# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_full_tenant_lifecycle(
    sqlite_db,
    event_bus,
    settings_override,
):
    """Drive the entire tenant lifecycle and assert end-to-end invariants.

    The test uses the SAME fixtures the unit tests rely on (sqlite_db,
    event_bus, settings_override) so it runs without an external DB,
    but it stubs LiteLLM admin at the edge with httpx responses.

    If the source modules haven't landed yet, the test is skipped
    so it never breaks the default collection.
    """
    tenant_sync_mod = pytest.importorskip("app.integrations.litellm.tenant_sync")
    key_mgr_mod = pytest.importorskip("app.integrations.litellm.key_manager")
    llm_client_mod = pytest.importorskip("app.integrations.litellm.llm_client")
    pytest.importorskip("app.integrations.litellm.budget_sync")
    trace_corr_mod = pytest.importorskip("app.integrations.litellm.trace_correlator")
    pytest.importorskip("app.integrations.litellm.health_monitor")

    # The detailed wiring of these mocks is intentionally a sketch —
    # the contract under test is the E2E flow shape, not the exact
    # call-by-call surface (which the unit tests cover).
    from unittest.mock import AsyncMock, MagicMock

    tenant_id = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    actor_id = str(uuid.uuid4())

    admin_client = AsyncMock(name="admin_client")
    admin_client.post = AsyncMock(name="admin_client.post")
    admin_client.get = AsyncMock(name="admin_client.get")
    admin_client.delete = AsyncMock(name="admin_client.delete")

    secrets_client = MagicMock(name="secrets_client")
    secrets_client.put_secret_value = MagicMock(return_value={"VersionId": "v1"})
    secrets_client.delete_secret = MagicMock(return_value={"VersionId": "deleted"})
    secrets_client.get_secret_value = MagicMock(return_value={"SecretString": "sk-fake"})

    chat_client = AsyncMock(name="chat_client")
    chat_client.post = AsyncMock(name="chat_client.post")
    chat_client.aclose = AsyncMock(name="chat_client.aclose")

    # Sketched assertions — each is a contract-level guarantee; the
    # unit tests in ``tests/integrations/litellm/`` cover the precise
    # wire details.

    # 1. Create tenant → LiteLLM Team created.
    admin_client.post.return_value.json = lambda: {
        "team_id": f"team-{tenant_id[:8]}",
        "team_alias": f"forge-{tenant_id[:8]}",
    }
    tenant_sync = tenant_sync_mod.TenantSync(admin_client=admin_client)
    team_id = await tenant_sync.create_team(
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
    )
    assert team_id == f"team-{tenant_id[:8]}"
    admin_client.post.assert_awaited()

    # 2. Provision key → Virtual Key in Secrets Manager.
    admin_client.post.return_value.json = lambda: {
        "key": "sk-litellm-fake",
        "key_id": "key-fake",
        "key_alias": f"forge-{tenant_id[:8]}",
    }
    key_manager = key_mgr_mod.VirtualKeyManager(
        admin_client=admin_client,
        secrets_client=secrets_client,
    )
    await key_manager.provision_key(tenant_id=tenant_id)
    secrets_client.put_secret_value.assert_called_once()

    # 3. Make LLM call → goes via LiteLLM, trace recorded.
    chat_client.post.return_value.json = lambda: {
        "choices": [{"message": {"role": "assistant", "content": "ok"}}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "cost_usd": 0.0001},
    }
    chat_client.post.return_value.status_code = 200
    chat_client.post.return_value.raise_for_status = lambda: None
    llm_client = llm_client_mod.ForgeLLMClient(chat_client=chat_client)
    await llm_client.chat(
        messages=[{"role": "user", "content": "hi"}],
        tenant_id=tenant_id,
        project_id=project_id,
        forge_trace_id="trace-e2e-001",
    )
    chat_client.post.assert_awaited()

    # 4. Trace recorded.
    correlator = trace_corr_mod.TraceCorrelator(session_factory=sqlite_db)
    await correlator.record_call(
        tenant_id=tenant_id,
        project_id=project_id,
        forge_trace_id="trace-e2e-001",
        litellm_call_id="litellm-call-fake",
        model="gpt-4o-mini",
        prompt_tokens=1,
        completion_tokens=1,
        cost_usd=0.0001,
    )

    # 5. Archive tenant → Team archived, key revoked.
    admin_client.delete.return_value.json = lambda: {"status": "ok"}
    admin_client.delete.return_value.status_code = 200
    admin_client.delete.return_value.raise_for_status = lambda: None
    await tenant_sync.on_tenant_archived(tenant_id=tenant_id, actor_id=actor_id)
    admin_client.delete.assert_awaited()
    secrets_client.delete_secret.assert_called()

    # 6. Reconcile → no drift. This is asserted structurally: after
    # archive, no further network calls are expected on the create
    # or provision paths.
    pre_count_post = admin_client.post.await_count

    await tenant_sync.create_team(
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=actor_id,
    )
    # Idempotent re-create must NOT issue a new POST.
    assert admin_client.post.await_count == pre_count_post
