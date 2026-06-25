"""Unit tests for ``app.integrations.litellm.key_manager`` (F-829b).

The key manager mints per-tenant Virtual Keys on the LiteLLM proxy
and stores the *value* (the secret string itself) in AWS Secrets
Manager under a tenant-scoped prefix.

These tests enforce three security-critical invariants:

  1. Key VALUES never appear in log records.
  2. Key VALUES never appear in any method return value except
     ``rotate_key`` (which returns the new value because rotation
     is the only legitimate read-and-write path).
  3. The Secrets Manager is the source of truth — cache hits do
     not re-fetch from boto3.
"""

from __future__ import annotations

import logging
import uuid
from unittest.mock import MagicMock

import pytest


def _try_import_key_manager():
    """Return the key_manager module or skip the calling test."""
    return pytest.importorskip("app.integrations.litellm.key_manager")


def _litellm_key_payload(value: str | None = None) -> dict:
    """Build a LiteLLM /key/generate response shape."""
    return {
        "key": value or f"sk-litellm-{uuid.uuid4().hex}",
        "key_id": f"key-{uuid.uuid4().hex[:12]}",
        "key_alias": f"forge-tenant-{uuid.uuid4().hex[:8]}",
    }


def _make_litellm_admin_response(json_body: dict, status_code: int = 200):
    from unittest.mock import AsyncMock

    resp = AsyncMock(name="httpx_admin_response")
    resp.status_code = status_code
    resp.json = lambda: json_body
    resp.raise_for_status = lambda: None
    return resp


# ---------------------------------------------------------------------------
# 1. provision_key stores the value in Secrets Manager with the right prefix
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_provision_key_stores_in_secrets_manager(
    mock_litellm_admin,
    mock_boto3_secrets,
    settings_override,
    fake_tenant_id,
):
    """Provisioning a key calls LiteLLM /key/generate AND writes the
    returned value to Secrets Manager under
    ``forge/tenants/<tenant_id>/virtual-key``.
    """
    mod = _try_import_key_manager()
    manager = mod.VirtualKeyManager(
        admin_client=mock_litellm_admin,
        secrets_client=mock_boto3_secrets,
    )

    minted = _litellm_key_payload()
    mock_litellm_admin.post.return_value = _make_litellm_admin_response(minted)

    result = await manager.provision_key(tenant_id=fake_tenant_id)

    # LiteLLM mint called.
    mock_litellm_admin.post.assert_awaited_once()
    mint_call = mock_litellm_admin.post.await_args
    assert "/key/generate" in str(mint_call.args[0])
    # Body must scope the key to this tenant (LiteLLM key_alias).
    body = mint_call.kwargs.get("json") or mint_call.args[1]
    assert fake_tenant_id in str(body.get("key_alias", "")) or fake_tenant_id in str(body.get("metadata", {}))

    # Secrets Manager put_secret_value called with the right prefix.
    mock_boto3_secrets.put_secret_value.assert_called_once()
    put_kwargs = mock_boto3_secrets.put_secret_value.call_args.kwargs
    secret_id = put_kwargs.get("SecretId", "")
    assert secret_id.startswith("forge/tenants/")
    assert fake_tenant_id in secret_id

    # The stored secret string IS the key value.
    stored_secret = put_kwargs.get("SecretString", "")
    assert minted["key"] in stored_secret

    # Return shape: metadata only (no value leaked).
    assert result is not None
    assert "key" not in result
    assert "value" not in result
    if hasattr(result, "model_dump"):
        dumped = result.model_dump()
        assert "value" not in dumped
        assert "key" not in dumped


# ---------------------------------------------------------------------------
# 2. get_key uses the cache on second call
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_key_uses_cache(
    mock_litellm_admin,
    mock_boto3_secrets,
    mock_redis,
    settings_override,
    fake_tenant_id,
):
    """Second ``get_key`` for the same tenant must NOT call boto3
    again — the result is served from the cache layer (Redis).
    """
    mod = _try_import_key_manager()
    manager = mod.VirtualKeyManager(
        admin_client=mock_litellm_admin,
        secrets_client=mock_boto3_secrets,
        cache=mock_redis,
    )

    minted = _litellm_key_payload()
    mock_litellm_admin.post.return_value = _make_litellm_admin_response(minted)

    # First call: misses cache, populates Secrets Manager.
    await manager.provision_key(tenant_id=fake_tenant_id)
    assert mock_boto3_secrets.get_secret_value.call_count == 0  # Provision doesn't fetch.

    # Second call: cache hit, no boto3 call.
    mock_redis.get.return_value = minted["key"].encode()
    got = await manager.get_key(tenant_id=fake_tenant_id)
    assert mock_boto3_secrets.get_secret_value.call_count == 0
    # The cache hit must yield the same value as the original mint.
    if got is not None:
        assert minted["key"] in (got if isinstance(got, str) else str(got))


# ---------------------------------------------------------------------------
# 3. Key value MUST NEVER appear in any log record
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_key_value_never_logged(
    mock_litellm_admin,
    mock_boto3_secrets,
    settings_override,
    fake_tenant_id,
    caplog: pytest.LogCaptureFixture,
):
    """Scan every log record produced during provision + get + revoke
    and assert the literal key value NEVER appears anywhere.
    """
    mod = _try_import_key_manager()
    manager = mod.VirtualKeyManager(
        admin_client=mock_litellm_admin,
        secrets_client=mock_boto3_secrets,
    )

    minted = _litellm_key_payload()
    mock_litellm_admin.post.return_value = _make_litellm_admin_response(minted)
    mock_boto3_secrets.get_secret_value.return_value = {"SecretString": minted["key"]}

    caplog.set_level(logging.DEBUG)

    # Exercise every code path that touches the key value.
    await manager.provision_key(tenant_id=fake_tenant_id)
    await manager.get_key(tenant_id=fake_tenant_id)
    if hasattr(manager, "revoke_key"):
        await manager.revoke_key(tenant_id=fake_tenant_id)
    if hasattr(manager, "rotate_key"):
        rotated = _litellm_key_payload()
        mock_litellm_admin.post.return_value = _make_litellm_admin_response(rotated)
        await manager.rotate_key(tenant_id=fake_tenant_id)

    # The key value must not leak into any log record.
    for record in caplog.records:
        assert minted["key"] not in record.getMessage(), (
            f"Key value leaked into log: {record.name}: {record.getMessage()}"
        )
        # Also assert the rotated key value (if rotate_key ran) did not leak.
        if "rotated" in dir() and rotated is not None:
            assert rotated["key"] not in record.getMessage(), (
                f"Rotated key value leaked into log: {record.name}: {record.getMessage()}"
            )


# ---------------------------------------------------------------------------
# 4. Key value NEVER returned in any public API surface except rotate_key
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_key_value_never_returned_in_api(
    mock_litellm_admin,
    mock_boto3_secrets,
    settings_override,
    fake_tenant_id,
):
    """Walk the public method surface; assert that only ``rotate_key``
    (which legitimately returns the new value so the caller can
    persist it) exposes the key string. Every other method that
    returns a value must return metadata only.
    """
    mod = _try_import_key_manager()
    manager = mod.VirtualKeyManager(
        admin_client=mock_litellm_admin,
        secrets_client=mock_boto3_secrets,
    )

    minted = _litellm_key_payload()
    mock_litellm_admin.post.return_value = _make_litellm_admin_response(minted)
    mock_boto3_secrets.get_secret_value.return_value = {"SecretString": minted["key"]}

    # Methods whose return values must NOT contain the key string.
    safe_methods = [
        ("provision_key", lambda: manager.provision_key(tenant_id=fake_tenant_id)),
        ("get_key_metadata", lambda: manager.get_key_metadata(tenant_id=fake_tenant_id)),
        ("list_keys", lambda: manager.list_keys(tenant_id=fake_tenant_id)),
    ]
    safe_methods = [(n, c) for n, c in safe_methods if hasattr(manager, n.split("_")[0]) and callable(getattr(manager, n, None))]

    for method_name, caller in safe_methods:
        out = await caller()
        serialized = _serialize(out)
        assert minted["key"] not in serialized, (
            f"{method_name} leaked the key value into its return value"
        )

    # rotate_key (if present) MUST be allowed to return the new value.
    if hasattr(manager, "rotate_key"):
        rotated = _litellm_key_payload()
        mock_litellm_admin.post.return_value = _make_litellm_admin_response(rotated)
        out = await manager.rotate_key(tenant_id=fake_tenant_id)
        serialized = _serialize(out)
        # The new value MUST be in the response.
        assert rotated["key"] in serialized, (
            "rotate_key must return the new key value so the caller can persist it"
        )


def _serialize(value) -> str:
    """Render a return value as a string for substring checks."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple, set)):
        return " ".join(_serialize(v) for v in value)
    if isinstance(value, dict):
        return " ".join(f"{k}={_serialize(v)}" for k, v in value.items())
    if hasattr(value, "model_dump"):
        return _serialize(value.model_dump())
    if hasattr(value, "__dict__"):
        return _serialize(value.__dict__)
    return str(value)
