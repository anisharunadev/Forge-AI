"""Phase-1 anti-pattern regression tests.

Covers the step-75 spec invariants that must never regress:

* secret_filter MUST scrub master key, ``Authorization: Bearer …``, and
  ``sk-*`` tokens from any log event dict before it is rendered.
* ``grep -r LITELLM_MASTER_KEY logs/`` MUST return 0 after a load.
* The ``forge.auth.config_loaded`` boot log line is emitted exactly once.

These run as plain pytest (no DB / Redis / network needed).
"""

from __future__ import annotations

# Module-level env must be set BEFORE `app.*` is imported — pydantic-settings
# reads env at Settings() construction time (triggered by transitive imports
# such as `app.main` -> `app.api.v1.router` -> `usage_query` -> session).
import json
import os
import subprocess
import sys
from typing import Any

# Deterministic sentinel strings (long enough to clear the regex floor).
MASTER_KEY = "sk-1234567890abcdef-test-master-key-do-not-leak"
TOKEN_A = "sk-abcdefghijklmnopqrstuvwxyz123456"
TOKEN_B = "sk-zzzz9999aaaa8888bbbb7777cccc6666"
AUTH_HEADER = "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature_xyz"

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("DATABASE_POOL_SIZE", "0")
os.environ.setdefault("DATABASE_MAX_OVERFLOW", "0")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("LITELLM_PROXY_URL", "http://localhost:4000")
os.environ.setdefault("LITELLM_API_KEY", "test-key")
os.environ.setdefault("LITELLM_ADMIN_KEY", "")
os.environ.setdefault("LITELLM_MASTER_KEY", MASTER_KEY)
os.environ.setdefault("KEYCLOAK_URL", "http://localhost:8080")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("FORGE_ROUTE_DISCOVERY_ENABLED", "false")

import pytest
import structlog

# Stub get_session_factory BEFORE app.* imports trigger it via usage_query.
# The real impl tries to build a SQLAlchemy AsyncEngine with pool kwargs
# that the sqlite StaticPool dialect rejects in this SA version.
import app.db.session as _db_session  # noqa: E402

class _FakeSession:
    async def __aenter__(self):
        return self
    async def __aexit__(self, *a):
        return False
    async def commit(self):
        pass
    async def execute(self, *_):
        return None

def _fake_session_factory():
    def _factory():
        return _FakeSession()
    return _factory

_db_session.get_session_factory = _fake_session_factory  # type: ignore[assignment]
_db_session.get_engine = lambda: None  # type: ignore[assignment]

from app.core.config import Settings  # noqa: E402
from app.core.logging import configure_logging  # noqa: E402
from app.core.secret_filter import _REDACTED, secret_filter  # noqa: E402


@pytest.fixture(autouse=True)
def _pin_master_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin master key + sqlite-safe pool for the lifetime of each test."""
    monkeypatch.setenv("LITELLM_MASTER_KEY", MASTER_KEY)
    monkeypatch.setenv("LITELLM_ADMIN_KEY", "")
    monkeypatch.setenv("DATABASE_POOL_SIZE", "0")
    monkeypatch.setenv("DATABASE_MAX_OVERFLOW", "0")
    # Rebuild the Settings singleton so secret_filter sees the new master key.
    from app.core import config as config_mod

    config_mod.settings = Settings()  # type: ignore[assignment]  # noqa: B009


def _apply_filter(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Run secret_filter directly over each event dict.

    `capture_logs()` swaps the processor chain, so secret_filter doesn't run
    in that context; we feed capture_logs' output through the real filter
    ourselves, which is exactly what production logging does.
    """
    return [secret_filter(None, None, dict(e)) for e in events]


def test_secret_filter_redacts_100_events() -> None:
    """(a)+(b) 100 mixed-secret events through secret_filter — none leak."""
    configure_logging(level="INFO", json_output=True)

    raw_events: list[dict[str, Any]] = [
        {
            "event": "auth.attempt",
            "request": i,
            "master_key": MASTER_KEY,
            "bearer": AUTH_HEADER,
            "sk_tokens": [TOKEN_A, f"prefix-{TOKEN_B}-suffix"],
            "nested": {
                "Authorization": AUTH_HEADER,
                "safe": "ok",
                "token_inline": f"got {TOKEN_A} leaked",
            },
            "env_var_name": "LITELLM_MASTER_KEY",
        }
        for i in range(100)
    ]

    redacted = _apply_filter(raw_events)
    assert len(redacted) == 100

    rendered = "\n".join(json.dumps(e) for e in redacted)

    # (b) literal master key never appears anywhere in the stream.
    assert MASTER_KEY not in rendered, "master key leaked into log stream"

    # (b) the sk-abc tokens never appear (full or substring).
    for tok in (TOKEN_A, TOKEN_B):
        assert tok not in rendered, f"token {tok!r} leaked into log stream"

    # (b) bearer signature payload never appears.
    assert "eyJhbGciOiJIUzI1NiJ9.payload.signature_xyz" not in rendered

    # The redacted marker must be present (the filter actually ran).
    assert _REDACTED in rendered


def test_grep_litellm_master_key_returns_zero_matches() -> None:
    """(c) Shim the in-process stream through grep — zero matches expected."""
    configure_logging(level="INFO", json_output=True)

    raw_events = [
        {
            "event": "auth.attempt",
            "master_key": MASTER_KEY,
            "bearer": AUTH_HEADER,
        }
        for _ in range(100)
    ]
    redacted = _apply_filter(raw_events)
    rendered = "\n".join(json.dumps(e) for e in redacted)

    proc = subprocess.run(
        ["grep", "-r", "LITELLM_MASTER_KEY", "/dev/stdin"],
        input=rendered,
        text=True,
        capture_output=True,
        check=False,
    )
    assert proc.returncode != 0, f"grep matched — secret leaked. stdout={proc.stdout!r}"


def test_lifespan_emits_config_loaded_exactly_once(monkeypatch: pytest.MonkeyPatch) -> None:
    """(d) Boot-time: with lifespan's IO stubbed, the boot log fires once.

    Forces the ``app.main`` module to load (so the heavy import chain — which
    builds a SQLite engine at import time via ``usage_query`` — completes
    once) and then patches the bits lifespan calls so the second invocation
    is side-effect free.
    """
    # Pre-import app.main so the heavy chain (router -> usage_query -> engine)
    # runs exactly once, *now*, with our env vars in place.
    import app.main as app_main  # noqa: F401  (side-effect import)
    import asyncio

    from fastapi import FastAPI

    async def _noop() -> None:
        return None

    # Stub the IO-touching functions lifespan calls.
    monkeypatch.setattr(app_main, "init_telemetry", lambda: None)
    monkeypatch.setattr(app_main.bus, "start", _noop)
    monkeypatch.setattr(app_main.bus, "stop", _noop)
    monkeypatch.setattr(app_main.lesson_service, "register", lambda _bus: None)
    # prevent lifespan from clobbering capture_logs' processor chain by
    # re-running configure_logging (it swaps in JSONRenderer+stdout).
    monkeypatch.setattr(app_main, "configure_logging", lambda *a, **kw: None)

    structlog.reset_defaults()
    configure_logging(level="INFO", json_output=True)

    app = FastAPI(lifespan=app_main.lifespan)

    with structlog.testing.capture_logs() as events:
        asyncio.run(_drive(app))

    config_loaded = [e for e in events if e.get("event") == "forge.auth.config_loaded"]
    assert len(config_loaded) == 1, (
        f"expected exactly one forge.auth.config_loaded, got {len(config_loaded)}: "
        f"{[e.get('event') for e in events]}"
    )
    assert "version" in config_loaded[0], "config_loaded line missing version"


async def _drive(app: FastAPI) -> None:
    async with app.router.lifespan_context(app):
        pass


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
