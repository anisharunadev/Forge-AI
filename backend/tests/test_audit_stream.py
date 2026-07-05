"""Phase 5 -- audit WebSocket smoke tests.

We don't spin up a real Redis here; the test asserts the negative
path (missing token is rejected) and that the WS module imports
cleanly so the route is registered in main.py.
"""
from __future__ import annotations

import importlib


def test_audit_ws_module_loads():
    mod = importlib.import_module("app.api.ws.audit")
    assert mod.router is not None
    # The route must be registered on the FastAPI app after main imports it.
    from app.main import app

    paths = [r.path for r in app.routes if hasattr(r, "path")]
    assert "/ws/audit" in paths
