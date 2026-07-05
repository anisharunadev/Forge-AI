"""Tests for ``app.core.security`` JWT decode (Phase 7 SC-7.2).

Covers the rotation overlap window: when ``settings.jwt_secret_previous``
is set, ``decode_token`` must accept tokens minted under either the
primary or the previous key.
"""

from __future__ import annotations

import time

import pytest
from fastapi import HTTPException
from jose import jwt

from app.core.config import settings
from app.core.security import decode_token


def _mint(secret: str, *, algorithm: str = "HS256", **claims) -> str:
    payload = {"sub": "test-user", "forge.tenant": "acme", **claims}
    return jwt.encode(payload, secret, algorithm=algorithm)


def test_decode_token_accepts_primary_key(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "primary-secret-32-bytes-aaaaaaaaaaa")
    monkeypatch.setattr(settings, "jwt_secret_previous", None)
    monkeypatch.setattr(settings, "jwt_algorithm", "HS256")
    token = _mint(settings.jwt_secret)
    claims = decode_token(token)
    assert claims["sub"] == "test-user"
    assert claims["forge.tenant"] == "acme"


def test_decode_token_falls_back_to_previous(monkeypatch):
    """Token minted under PREVIOUS key still validates after rotation."""
    monkeypatch.setattr(settings, "jwt_secret", "primary-secret-32-bytes-aaaaaaaaaaa")
    monkeypatch.setattr(settings, "jwt_secret_previous", "previous-secret-32-bytes-bbbbbbbbb")
    monkeypatch.setattr(settings, "jwt_algorithm", "HS256")
    token = _mint(settings.jwt_secret_previous)
    claims = decode_token(token)
    assert claims["sub"] == "test-user"


def test_decode_token_accepts_primary_even_with_previous_set(monkeypatch):
    """Primary key wins when both are set; previous is just a fallback."""
    monkeypatch.setattr(settings, "jwt_secret", "primary-secret-32-bytes-aaaaaaaaaaa")
    monkeypatch.setattr(settings, "jwt_secret_previous", "previous-secret-32-bytes-bbbbbbbbb")
    monkeypatch.setattr(settings, "jwt_algorithm", "HS256")
    token = _mint(settings.jwt_secret)
    claims = decode_token(token)
    assert claims["sub"] == "test-user"


def test_decode_token_rejects_garbage_key(monkeypatch):
    monkeypatch.setattr(settings, "jwt_secret", "primary-secret-32-bytes-aaaaaaaaaaa")
    monkeypatch.setattr(settings, "jwt_secret_previous", "previous-secret-32-bytes-bbbbbbbbb")
    monkeypatch.setattr(settings, "jwt_algorithm", "HS256")
    bad = _mint("third-party-secret-32-bytes-cccccccccccc")
    with pytest.raises(HTTPException) as exc_info:
        decode_token(bad)
    assert exc_info.value.status_code == 401


def test_decode_token_previous_only_for_symmetric(monkeypatch):
    """RS256 path ignores jwt_secret_previous (no symmetric fallback)."""
    # Algorithm pinned to RS256 — we won't actually decode, just confirm
    # the previous-key branch is skipped when the algorithm is asymmetric.
    monkeypatch.setattr(settings, "jwt_secret", "primary-secret-32-bytes-aaaaaaaaaaa")
    monkeypatch.setattr(settings, "jwt_secret_previous", "previous-secret-32-bytes-bbbbbbbbb")
    monkeypatch.setattr(settings, "jwt_algorithm", "RS256")
    bad = jwt.encode(
        {"sub": "x", "forge.tenant": "acme", "exp": int(time.time()) + 60},
        "previous-secret-32-bytes-bbbbbbbbb",
        algorithm="HS256",  # signed HS256, but verify path expects RS256
    )
    with pytest.raises(HTTPException) as exc_info:
        decode_token(bad)
    assert exc_info.value.status_code == 401
