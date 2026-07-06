"""M14 — Tests for the Phase4 catch-all exception handler.

Locks the contract: unhandled exceptions don't return a stack trace.

Three invariants per the M14 spec:
  1. `register_phase4_exception_handlers` mounts a fallback `Exception` handler.
  2. The handler returns a stable JSON envelope (code, status_code) so the
     UI can render a typed error instead of swallowing a 500 with a
     traceback.
  3. The handler logs the exception (so we can still debug it server-side)
     but the response body NEVER contains the raw traceback.
"""

from __future__ import annotations

import json
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_phase4_fallback_handler_returns_stable_envelope() -> None:
    """Unhandled exceptions return a stable JSON envelope, not a stack trace."""
    from app.core.phase4_errors import register_phase4_exception_handlers

    app = FastAPI()
    register_phase4_exception_handlers(app)

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("kaboom")

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/boom")

    assert resp.status_code == 500
    body = resp.json()
    assert body["error"] == "internal_error"
    assert body["code"] == "INTERNAL_ERROR"
    assert body["details"]["type"] == "RuntimeError"
    assert "kaboom" in body["details"]["message"]
    assert "occurred_at" in body
    # Critical: no raw stack trace or python module paths in the body.
    raw_body = resp.text
    assert "Traceback" not in raw_body
    assert ".py" not in raw_body  # no Python file paths leaked


def test_phase4_fallback_handler_does_not_swallow_phase4_envelope() -> None:
    """The Phase4Error handler still wins for typed errors."""
    from app.core.phase4_errors import (
        PassThroughDisabled,
        Phase4Error,
        register_phase4_exception_handlers,
    )

    app = FastAPI()
    register_phase4_exception_handlers(app)

    @app.get("/phase4")
    async def phase4_route() -> None:
        raise PassThroughDisabled(provider="openai", reason="not configured")

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/phase4")

    assert resp.status_code == 500
    body = resp.json()
    # PassThroughDisabled returns its own code, not INTERNAL_ERROR
    assert body["code"] != "INTERNAL_ERROR"
    assert body["code"] == "PASS_THROUGH_DISABLED"


def test_phase4_fallback_handler_handles_validation_error() -> None:
    """Pydantic ValidationError also routes through the fallback."""
    from app.core.phase4_errors import register_phase4_exception_handlers

    app = FastAPI()
    register_phase4_exception_handlers(app)

    @app.get("/value-error")
    async def value_error() -> None:
        raise ValueError("bad input")

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/value-error")

    assert resp.status_code == 500
    body = resp.json()
    assert body["details"]["type"] == "ValueError"


def test_phase4_handler_registration_idempotent() -> None:
    """Calling register_phase4_exception_handlers twice replaces the handlers (no duplicate registration errors)."""
    from app.core.phase4_errors import register_phase4_exception_handlers

    app = FastAPI()
    register_phase4_exception_handlers(app)
    # Second call should not raise.
    register_phase4_exception_handlers(app)

    @app.get("/boom2")
    async def boom2() -> None:
        raise RuntimeError("kaboom2")

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/boom2")
    assert resp.status_code == 500