"""Tests for app.services.forge_config.get_forge_config()."""

from __future__ import annotations

import pytest

from app.services import forge_config
from app.services.forge_config import ForgeConfig, get_forge_config


@pytest.fixture(autouse=True)
def _clear_cache():
    """Each test gets a fresh lru_cache slot."""
    get_forge_config.cache_clear()
    yield
    get_forge_config.cache_clear()


def test_master_key_uses_master_field(monkeypatch):
    monkeypatch.setattr(forge_config.settings, "litellm_master_key", "sk-master-123", raising=False)
    monkeypatch.setattr(forge_config.settings, "litellm_admin_key", "", raising=False)
    monkeypatch.setattr(forge_config.settings, "environment", "test", raising=False)

    cfg = get_forge_config()

    assert isinstance(cfg, ForgeConfig)
    assert cfg.master_key == "sk-master-123"


def test_master_key_falls_back_to_admin_key(monkeypatch):
    monkeypatch.setattr(forge_config.settings, "litellm_master_key", "", raising=False)
    monkeypatch.setattr(forge_config.settings, "litellm_admin_key", "sk-admin-456", raising=False)
    monkeypatch.setattr(forge_config.settings, "environment", "test", raising=False)

    cfg = get_forge_config()

    assert cfg.master_key == "sk-admin-456"


def test_master_key_takes_precedence_over_admin_key(monkeypatch):
    monkeypatch.setattr(forge_config.settings, "litellm_master_key", "sk-master-WINS", raising=False)
    monkeypatch.setattr(forge_config.settings, "litellm_admin_key", "sk-admin-LOSES", raising=False)
    monkeypatch.setattr(forge_config.settings, "environment", "test", raising=False)

    cfg = get_forge_config()

    assert cfg.master_key == "sk-master-WINS"


def test_empty_keys_in_production_raises(monkeypatch):
    monkeypatch.setattr(forge_config.settings, "litellm_master_key", "", raising=False)
    monkeypatch.setattr(forge_config.settings, "litellm_admin_key", "", raising=False)
    monkeypatch.setattr(forge_config.settings, "environment", "production", raising=False)

    with pytest.raises(RuntimeError):
        get_forge_config()


def test_empty_keys_in_test_returns_empty_master_key(monkeypatch):
    monkeypatch.setattr(forge_config.settings, "litellm_master_key", "", raising=False)
    monkeypatch.setattr(forge_config.settings, "litellm_admin_key", "", raising=False)
    monkeypatch.setattr(forge_config.settings, "environment", "test", raising=False)

    cfg = get_forge_config()

    assert isinstance(cfg, ForgeConfig)
    assert cfg.master_key == ""