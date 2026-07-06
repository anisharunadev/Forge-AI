"""Shared fixtures for ``tests/integrations/litellm/``.

The source package ``backend/app/integrations/litellm/`` is being built
in parallel by other agents. Tests must collect (and, where possible,
run) without those modules being finalized.

This conftest:
  * Provides AsyncMock / MagicMock stand-ins for every external
    dependency the new modules touch (httpx admin client, boto3
    secretsmanager client, redis event bus).
  * Provides deterministic tenant / project / actor IDs.
  * Patches the F-829 settings fields used by the new modules so
    tests run with ``environment='test'`` and the integration flag on.

The fixtures intentionally avoid importing from
``app.integrations.litellm.*`` — they hand plain mocks to the code
under test via constructor injection (kwarg names mirror the public
``Boto3ClientFactory`` protocol used by ``aws_transform_client.py``).
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

# ---------------------------------------------------------------------------
# ID fixtures — uuid4 strings so they format cleanly into trace payloads
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_tenant_id() -> str:
    """A fresh tenant UUID4 string for a single test."""
    return str(uuid.uuid4())


@pytest.fixture
def fake_project_id() -> str:
    """A fresh project UUID4 string for a single test."""
    return str(uuid.uuid4())


@pytest.fixture
def fake_actor_id() -> str:
    """A fresh actor UUID4 string for a single test."""
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# External-dependency mocks
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_litellm_admin() -> AsyncMock:
    """AsyncMock mirroring the admin-side httpx async client.

    The new ``litellm_base_client.LiteLLMAdminClient`` exposes methods
    like ``post``, ``get``, ``delete`` (all async). Tests configure
    ``return_value`` / ``side_effect`` per call site.
    """
    client = AsyncMock(name="litellm_admin_client")
    client.post = AsyncMock(name="litellm_admin_client.post")
    client.get = AsyncMock(name="litellm_admin_client.get")
    client.delete = AsyncMock(name="litellm_admin_client.delete")
    client.aclose = AsyncMock(name="litellm_admin_client.aclose")
    return client


@pytest.fixture
def mock_litellm_chat_client() -> AsyncMock:
    """AsyncMock mirroring the chat-side httpx async client.

    Mirrors the surface used by ``LiteLLMChatClient`` / ``ForgeLLMClient``
    (``post``, ``stream``, ``aclose``). Tests set ``post.return_value`` /
    ``side_effect`` to drive success and failure paths.
    """
    client = AsyncMock(name="litellm_chat_client")
    client.post = AsyncMock(name="litellm_chat_client.post")
    client.stream = AsyncMock(name="litellm_chat_client.stream")
    client.aclose = AsyncMock(name="litellm_chat_client.aclose")
    return client


@pytest.fixture
def mock_boto3_secrets() -> MagicMock:
    """MagicMock mirroring the boto3 secretsmanager client.

    ``put_secret_value``, ``get_secret_value``, and ``delete_secret``
    return ``{"VersionId": ..., "ARN": ...}`` by default. Tests
    override the return values per scenario.
    """
    client = MagicMock(name="boto3_secretsmanager_client")
    client.put_secret_value = MagicMock(
        name="boto3_secretsmanager_client.put_secret_value",
        return_value={"VersionId": "v1", "ARN": "arn:aws:secretsmanager:us-east-1:0:secret:test"},
    )
    client.get_secret_value = MagicMock(
        name="boto3_secretsmanager_client.get_secret_value",
        return_value={"SecretString": "sk-litellm-fake-value"},
    )
    client.delete_secret = MagicMock(
        name="boto3_secretsmanager_client.delete_secret",
        return_value={"DeletionDate": None, "VersionId": "deleted"},
    )
    return client


@pytest.fixture
def mock_boto3_factory(mock_boto3_secrets: MagicMock) -> MagicMock:
    """Factory function returning the secretsmanager mock.

    Mirrors the ``Boto3ClientFactory`` protocol from
    ``aws_transform_client.py:46-54`` — the new ``key_manager.py``
    accepts a factory via constructor injection so tests don't need
    to patch module-level globals.
    """
    factory = MagicMock(name="boto3_client_factory", return_value=mock_boto3_secrets)
    return factory


@pytest.fixture
def mock_redis() -> AsyncMock:
    """AsyncMock for the redis event bus / cache client.

    The new ``key_manager.py`` and ``budget_sync.py`` use redis as a
    short-TTL cache layer (``forge:litellm:key:<tenant>`` etc.).
    """
    client = AsyncMock(name="redis_async_client")
    client.get = AsyncMock(name="redis_async_client.get", return_value=None)
    client.set = AsyncMock(name="redis_async_client.set", return_value=True)
    client.delete = AsyncMock(name="redis_async_client.delete", return_value=1)
    client.publish = AsyncMock(name="redis_async_client.publish", return_value=1)
    return client


# ---------------------------------------------------------------------------
# Settings overrides
# ---------------------------------------------------------------------------


@pytest.fixture
def settings_override(monkeypatch: pytest.MonkeyPatch):
    """Patch F-829 settings fields required by the integration layer.

    The settings object is constructed at module import time, so we
    patch attributes in-place rather than re-instantiating ``Settings``
    (which would invalidate the ``@lru_cache`` on ``get_settings()``).

    Each ``setattr`` is wrapped in a ``try / except ValueError`` because
    pydantic v2's ``BaseSettings`` raises ``ValueError`` when the field
    doesn't exist on the model — ``monkeypatch.setattr(..., raising=False)``
    only suppresses ``AttributeError``, not pydantic's validation error.
    This makes the fixture safe to use before the F-829 settings fields
    are landed in ``app/core/config.py``.
    """
    from app.core import config as config_mod

    _safe_setattr(monkeypatch, config_mod.settings, "litellm_integration_enabled", True)
    _safe_setattr(monkeypatch, config_mod.settings, "litellm_auto_provision_keys", True)
    _safe_setattr(monkeypatch, config_mod.settings, "litellm_budget_hard_limit", True)
    _safe_setattr(monkeypatch, config_mod.settings, "litellm_admin_key", "test-admin-key")
    _safe_setattr(monkeypatch, config_mod.settings, "litellm_admin_url", "http://litellm:4000")
    _safe_setattr(monkeypatch, config_mod.settings, "litellm_budget_default_usd", 500.0)
    _safe_setattr(monkeypatch, config_mod.settings, "aws_secrets_manager_prefix", "forge/tenants/")

    return config_mod.settings


def _safe_setattr(monkeypatch: pytest.MonkeyPatch, target, name: str, value) -> None:
    """Set an attribute on ``target``, tolerating a missing field.

    Pydantic v2 raises ``ValueError`` when the named field isn't a
    declared model field. We catch that so this fixture works whether
    or not the source-side F-829 settings fields have landed.
    """
    try:
        monkeypatch.setattr(target, name, value)
    except (ValueError, AttributeError):
        # Field doesn't exist yet — the source module hasn't landed.
        pass
