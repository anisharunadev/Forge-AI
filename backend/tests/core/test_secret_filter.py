"""Verify secret_filter redaction behavior across header / value / nested cases."""

from __future__ import annotations

import copy

from app.core.secret_filter import secret_filter


def _run(event):
    """Helper: feed an event dict through secret_filter and return the result."""
    return secret_filter(None, "test", copy.deepcopy(event))


def test_authorization_bearer_header_redacted():
    out = _run({"Authorization": "Bearer sk-fake12345678abcdef"})
    assert "[REDACTED]" in out["Authorization"]
    assert "sk-fake12345678abcdef" not in out["Authorization"]


def test_bearer_token_in_value_redacted():
    out = _run({"x": "Bearer eyJabc123"})
    assert out["x"] == "Bearer [REDACTED]"


def test_nested_authorization_header_redacted():
    out = _run({"payload": {"authorization": "Bearer sk-foo"}})
    assert out["payload"]["authorization"] == "[REDACTED]"


def test_plain_text_unchanged():
    out = _run({"ok": "plain text"})
    assert out["ok"] == "plain text"


def test_sk_prefix_key_redacted():
    out = _run({"key": "sk-abc1234567890abcdef"})
    assert out["key"] == "sk-[REDACTED]"
