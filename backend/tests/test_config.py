"""Tests for the HYG-04 DEV_AUTH_BYPASS startup guard and the
M1 G2 placeholder LLM-key guard.

These tests exercise the Pydantic v2 ``model_validator(mode="after")`` on
the ``Settings`` class in ``app.core.config``. The HYG-04 guard refuses to
instantiate ``Settings`` when ``DEV_AUTH_BYPASS=1`` is combined with a
non-development environment, and because ``settings = get_settings()``
is evaluated at module import time, the misconfiguration surfaces as a
non-zero process exit before FastAPI boots.

The M1 G2 guard refuses to boot when ``ANTHROPIC_API_KEY`` /
``OPENAI_API_KEY`` / ``LITELLM_MASTER_KEY`` carry the .env.example
placeholder strings or empty values, unless the env is ``test`` or
``ALLOW_PLACEHOLDER_LLM_KEYS=true`` is set.

Each test uses ``monkeypatch.setenv`` + ``get_settings.cache_clear()`` to
construct a fresh ``Settings`` instance with the desired env, rather than
mutating ``os.environ`` directly (which would leak across tests) or
patching ``Settings`` (which would defeat the point of the test).
"""

from __future__ import annotations

import pydantic

from app.core.config import Settings, get_settings

# Real-looking keys so the M1 G2 placeholder validator (which exempts
# env=='test' and ALLOW_PLACEHOLDER_LLM_KEYS=true) doesn't false-positive
# on tests that intentionally switch env to development / production.
_REAL_LOOKING_ANTHROPIC = "sk-ant-api03-real-looking-key-for-tests-only"
_REAL_LOOKING_OPENAI = "sk-openai-real-looking-key-for-tests-only"
_REAL_LOOKING_LITELLM = "sk-litellm-real-looking-key-for-tests-only"


def _set_real_llm_keys(monkeypatch) -> None:
    """Provide non-placeholder LLM keys so the M1 G2 guard is silent.

    The three ``monkeypatch.setenv`` calls below cover any test that
    flips ``ENVIRONMENT`` away from ``test``. The placeholder guard's
    check pattern (empty / ``sk-*-replace-me``) accepts these
    real-looking-but-fake values, so the test still exercises the
    guard-under-test (HYG-04 dev-bypass) without a side trip through
    G2's raise path.
    """
    monkeypatch.setenv("ANTHROPIC_API_KEY", _REAL_LOOKING_ANTHROPIC)
    monkeypatch.setenv("OPENAI_API_KEY", _REAL_LOOKING_OPENAI)
    monkeypatch.setenv("LITELLM_MASTER_KEY", _REAL_LOOKING_LITELLM)


def test_dev_bypass_blocks_production(monkeypatch) -> None:
    """DEV_AUTH_BYPASS=1 + ENVIRONMENT=production must raise ValidationError."""
    monkeypatch.setenv("DEV_AUTH_BYPASS", "1")
    monkeypatch.setenv("ENVIRONMENT", "production")
    _set_real_llm_keys(monkeypatch)
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
    _set_real_llm_keys(monkeypatch)
    get_settings.cache_clear()

    settings = get_settings()
    assert isinstance(settings, Settings)
    assert settings.dev_auth_bypass is True
    assert settings.environment == "development"


def test_no_bypass_no_op(monkeypatch) -> None:
    """DEV_AUTH_BYPASS unset + ENVIRONMENT=production must succeed (no-op)."""
    monkeypatch.delenv("DEV_AUTH_BYPASS", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "production")
    _set_real_llm_keys(monkeypatch)
    get_settings.cache_clear()

    settings = get_settings()
    assert isinstance(settings, Settings)
    assert settings.dev_auth_bypass is False
    assert settings.environment == "production"


# ---------------------------------------------------------------------------
# M1 G2 — placeholder LLM key guard
# ---------------------------------------------------------------------------


def test_placeholder_keys_block_development(monkeypatch) -> None:
    """Placeholder keys in development (no bypass) must raise ValidationError."""
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("ALLOW_PLACEHOLDER_LLM_KEYS", "false")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-replace-me")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-replace-me")
    monkeypatch.setenv("LITELLM_MASTER_KEY", "sk-litellm-dev-replace-me")
    get_settings.cache_clear()

    try:
        get_settings()
    except pydantic.ValidationError as exc:
        msg = str(exc)
        assert "Refusing to boot with placeholder LLM keys" in msg
        # All three offenders should be named.
        for offender in ("anthropic_api_key", "openai_api_key", "litellm_master_key"):
            assert offender in msg, f"missing offender {offender} in error: {msg[:300]}"
    else:
        raise AssertionError(
            "Expected ValidationError when ANTHROPIC_API_KEY / OPENAI_API_KEY / "
            "LITELLM_MASTER_KEY are placeholders in development, but Settings instantiated."
        )


def test_empty_keys_block_development(monkeypatch) -> None:
    """Empty-string LLM keys in development (no bypass) must raise."""
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("ALLOW_PLACEHOLDER_LLM_KEYS", "false")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("LITELLM_MASTER_KEY", raising=False)
    get_settings.cache_clear()

    try:
        get_settings()
    except pydantic.ValidationError as exc:
        assert "Refusing to boot with placeholder LLM keys" in str(exc)
    else:
        raise AssertionError(
            "Expected ValidationError when LLM keys are empty in development, but "
            "Settings instantiated."
        )


def test_placeholder_keys_allowed_with_override(monkeypatch) -> None:
    """ALLOW_PLACEHOLDER_LLM_KEYS=true bypasses the placeholder check."""
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("ALLOW_PLACEHOLDER_LLM_KEYS", "true")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-replace-me")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-replace-me")
    monkeypatch.setenv("LITELLM_MASTER_KEY", "sk-litellm-dev-replace-me")
    get_settings.cache_clear()

    settings = get_settings()
    assert settings.allow_placeholder_llm_keys is True
    assert settings.anthropic_api_key == "sk-ant-replace-me"


def test_real_keys_pass_in_development(monkeypatch) -> None:
    """Real-looking LLM keys in development must succeed."""
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("ALLOW_PLACEHOLDER_LLM_KEYS", "false")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-real-key")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-openai-real-key")
    monkeypatch.setenv("LITELLM_MASTER_KEY", "sk-litellm-real-key")
    get_settings.cache_clear()

    settings = get_settings()
    assert settings.anthropic_api_key == "sk-ant-api03-real-key"
    assert settings.allow_placeholder_llm_keys is False


def test_placeholder_keys_exempt_in_test_env(monkeypatch) -> None:
    """The conftest.py default (env=test) is exempt so the test suite passes."""
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.delenv("ALLOW_PLACEHOLDER_LLM_KEYS", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("LITELLM_MASTER_KEY", raising=False)
    get_settings.cache_clear()

    # Must NOT raise — test env is the implicit exemption that lets
    # the existing pytest suite boot without per-test env wiring.
    settings = get_settings()
    assert settings.environment == "test"
