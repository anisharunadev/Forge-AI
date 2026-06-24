"""Tests for the HYG-04 DEV_AUTH_BYPASS startup guard.

These tests exercise the Pydantic v2 ``model_validator(mode="after")`` on
the ``Settings`` class in ``app.core.config``. The guard refuses to
instantiate ``Settings`` when ``DEV_AUTH_BYPASS=1`` is combined with a
non-development environment, and because ``settings = get_settings()``
is evaluated at module import time, the misconfiguration surfaces as a
non-zero process exit before FastAPI boots.

Each test uses ``monkeypatch.setenv`` + ``get_settings.cache_clear()`` to
construct a fresh ``Settings`` instance with the desired env, rather than
mutating ``os.environ`` directly (which would leak across tests) or
patching ``Settings`` (which would defeat the point of the test).
"""

from __future__ import annotations

import pydantic

from app.core.config import Settings, get_settings


def test_dev_bypass_blocks_production(monkeypatch) -> None:
    """DEV_AUTH_BYPASS=1 + ENVIRONMENT=production must raise ValidationError."""
    monkeypatch.setenv("DEV_AUTH_BYPASS", "1")
    monkeypatch.setenv("ENVIRONMENT", "production")
    get_settings.cache_clear()

    try:
        get_settings()
    except pydantic.ValidationError as exc:
        # Pydantic wraps the ValueError raised inside the validator; the
        # underlying message must still be present in the error string so
        # the operator can diagnose the misconfiguration from logs alone.
        assert "DEV_AUTH_BYPASS=1 is only allowed when ENVIRONMENT=development" in str(exc)
        assert "ENVIRONMENT='production'" in str(exc)
    else:
        raise AssertionError(
            "Expected pydantic.ValidationError when DEV_AUTH_BYPASS=1 "
            "and ENVIRONMENT=production, but Settings() instantiated cleanly."
        )


def test_dev_bypass_allowed_in_development(monkeypatch) -> None:
    """DEV_AUTH_BYPASS=1 + ENVIRONMENT=development must succeed."""
    monkeypatch.setenv("DEV_AUTH_BYPASS", "1")
    monkeypatch.setenv("ENVIRONMENT", "development")
    get_settings.cache_clear()

    settings = get_settings()
    assert isinstance(settings, Settings)
    assert settings.dev_auth_bypass is True
    assert settings.environment == "development"


def test_no_bypass_no_op(monkeypatch) -> None:
    """DEV_AUTH_BYPASS unset + ENVIRONMENT=production must succeed (no-op)."""
    monkeypatch.delenv("DEV_AUTH_BYPASS", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "production")
    get_settings.cache_clear()

    settings = get_settings()
    assert isinstance(settings, Settings)
    assert settings.dev_auth_bypass is False
    assert settings.environment == "production"