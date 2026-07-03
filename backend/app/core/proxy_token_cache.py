"""Redis-backed cache for the RS256 proxy_token (step-65 Zone 4).

We don't want every API request to re-sign a fresh RS256 token.  The
``/auth/oidc/callback`` and ``/auth/refresh`` endpoints mint a token
once per login/refresh and store it under the SHA-256 fingerprint of
the Forge access token for ~1 hour (the token's own TTL).

Routes that need to call LiteLLM on behalf of a user call
:func:`get_cached_proxy_token` — fast path returns the cached value,
miss falls through to :func:`issue_proxy_token` in
:mod:`app.core.oauth2_rsa`.  The cache key is the access-token
fingerprint, never the token itself.

When Redis is unavailable the cache is a no-op — :func:`lookup` and
:func:`store` both return ``None`` so the calling route can decide to
re-sign on every request (one extra RS256 sign per call is
acceptable, ~3ms).
"""

from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.core.oauth2_rsa import proxy_token_fingerprint

logger = get_logger(__name__)

_KEY_PREFIX = "forge:proxy_token:"


def _redis() -> Any:
    """Lazily import redis and open a connection from ``settings.redis_url``.

    Returns ``None`` when redis isn't importable (test envs that
    stubbed the import) so every helper degrades to a no-op.
    Settings is imported lazily too — module-load time shouldn't
    depend on a fully-bootstrapped Settings (conftest pytest
    fixtures set the env AFTER module-level imports).
    """
    try:
        from app.core.config import settings  # lazy: see docstring
    except Exception:  # pragma: no cover — settings validate on import
        return None
    try:
        import redis.asyncio as aioredis  # type: ignore[import-not-found]
    except ImportError:  # pragma: no cover
        return None
    try:
        return aioredis.from_url(settings.redis_url, decode_responses=True)
    except Exception:  # pragma: no cover
        return None


async def lookup(access_token: str) -> str | None:
    """Return the cached proxy_token for ``access_token``, or None on miss/error."""
    try:
        client = _redis()
    except Exception:  # pragma: no cover
        return None
    if client is None:
        return None
    try:
        value = await client.get(_KEY_PREFIX + proxy_token_fingerprint(access_token))
        if isinstance(value, bytes):
            return value.decode("utf-8")
        return value
    except Exception as exc:
        logger.warning("proxy_token_cache.lookup_failed", error=str(exc))
        return None
    finally:
        try:
            await client.aclose()
        except Exception:  # pragma: no cover
            pass


async def store(access_token: str, proxy_token: str, ttl_seconds: int) -> None:
    """Store ``proxy_token`` keyed on the fingerprint of ``access_token``."""
    try:
        client = _redis()
    except Exception:  # pragma: no cover
        return
    if client is None:
        return
    try:
        await client.set(
            _KEY_PREFIX + proxy_token_fingerprint(access_token),
            proxy_token,
            ex=max(60, int(ttl_seconds)),
        )
    except Exception as exc:
        logger.warning("proxy_token_cache.store_failed", error=str(exc))
    finally:
        try:
            await client.aclose()
        except Exception:  # pragma: no cover
            pass


async def invalidate(access_token: str) -> None:
    """Drop the cached proxy_token (called on ``/auth/logout``)."""
    try:
        client = _redis()
    except Exception:  # pragma: no cover
        return
    if client is None:
        return
    try:
        await client.delete(_KEY_PREFIX + proxy_token_fingerprint(access_token))
    except Exception as exc:
        logger.warning("proxy_token_cache.invalidate_failed", error=str(exc))
    finally:
        try:
            await client.aclose()
        except Exception:  # pragma: no cover
            pass


__all__ = ["lookup", "store", "invalidate"]
