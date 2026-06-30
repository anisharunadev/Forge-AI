"""Symmetric encryption for secrets at rest (env vars, credentials).

Uses Fernet (AES-128-CBC + HMAC-SHA256) from the cryptography library.

Key resolution (in order):
  1. ``ENV_VAR_ENCRYPTION_KEY`` env var — must be a urlsafe-base64-encoded
     32-byte key. Recommended for production.
  2. Derived from ``JWT_SECRET`` (SHA-256 → urlsafe-base64) — used as a
     development fallback so the same secret rotates through the env.

Re-encrypting with a new key is a one-shot migration: load, decrypt with
old key, encrypt with new key. The ``rotate()`` helper exists for that
script but is intentionally not wired into the request path.
"""

from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet


def _resolve_key() -> bytes:
    raw = os.environ.get("ENV_VAR_ENCRYPTION_KEY")
    if raw:
        return raw.encode() if isinstance(raw, str) else raw
    fallback = os.environ.get(
        "JWT_SECRET", "dev-jwt-secret-change-in-prod"
    )
    derived = hashlib.sha256(fallback.encode()).digest()
    return base64.urlsafe_b64encode(derived)


_cipher: Fernet = Fernet(_resolve_key())


def encrypt(value: str) -> str:
    """Encrypt a string and return the urlsafe-base64 Fernet token."""
    if not isinstance(value, str):
        value = str(value)
    return _cipher.encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(encrypted: str) -> str:
    """Decrypt a Fernet token. Returns empty string on failure.

    Returning empty on failure prevents accidentally exposing cipher
    internals when a row was encrypted with a different key (e.g. before
    a key rotation). Callers that need to surface bad keys should check
    for empty and log.
    """
    try:
        return _cipher.decrypt(encrypted.encode("ascii")).decode("utf-8")
    except Exception:
        return ""


def rotate(ciphertext: str) -> str:
    """Re-encrypt ``ciphertext`` with the current key.

    Useful for a one-shot rotation script. Empty string is returned
    if the input cannot be decrypted with the current key.
    """
    plaintext = decrypt(ciphertext)
    if not plaintext:
        return ""
    return encrypt(plaintext)


__all__ = ["encrypt", "decrypt", "rotate"]
