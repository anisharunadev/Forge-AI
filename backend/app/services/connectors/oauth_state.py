"""OAuth state store — anti-CSRF token minting/consuming for Connectors.

The :class:`OAuthStateStore` is a process-local singleton that holds
the temporary ``state`` parameter passed between the OAuth start
endpoint (``POST /connectors/oauth/start``) and the OAuth callback
(``POST /connectors/oauth/callback``).

Why a process-local dict and not Redis?

M3 ships with a dev-mode shortcut (the callback accepts ``code=demo``)
so the entire Connector Center smoke flow is exercisable end-to-end
without a real upstream provider. Persisting state across processes
would add a Redis dependency to a tier-1 demo flow that should work
in CI sandboxes where Redis may be absent. The store is structured so
that swapping in a Redis-backed implementation is a one-class change
(``OAuthStateStore`` is exported as the seam; tests pin the same
external behaviour).

M13 (real OAuth providers) will replace the in-memory dict with the
Redis-backed store; the public method signatures stay stable so the
start/callback handlers need not change.

Lifecycle
---------

- :meth:`OAuthStateStore.mint` — generate a fresh 32-byte URL-safe
  token, store ``{state: (state_for, expires_at)}``, return the token.
- :meth:`OAuthStateStore.consume` — pop the entry by state; return the
  associated ``state_for`` (slug); delete it. A second ``consume`` on
  the same state returns ``None`` so replay attacks surface as 400.
- :meth:`OAuthStateStore.purge_expired` — sweep expired entries; called
  from the FastAPI lifespan hook at process startup so a long-running
  process doesn't leak state forever.

TTL is 600 seconds (10 min) by default. Long enough for a human to
click "Approve" on a real provider's consent screen; short enough
that a stolen state token expires before any practical replay window.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from threading import RLock

from app.core.logging import get_logger

logger = get_logger(__name__)


# Default TTL: 10 minutes. Short enough to bound replay risk, long
# enough that the slowest OAuth provider's consent screen still works.
DEFAULT_TTL_SECONDS = 600


class OAuthStateStore:
    """Process-local anti-CSRF state token store for connector OAuth.

    Public surface:

    - :meth:`mint` — generate a state token for a given ``state_for``
      value (typically the marketplace slug).
    - :meth:`consume` — pop the state token and return the slug, or
      ``None`` if the token is unknown / expired / already consumed.
    - :meth:`purge_expired` — sweep the dict of stale entries; cheap
      and intended to run once per process boot from the lifespan hook.

    Concurrency: ``self._lock`` protects the underlying dict against
    races. The store is intended to be used inside an async FastAPI
    handler so the critical sections are intentionally short (dict get
    / dict pop / datetime compare). All public methods are sync — the
    lock acquires instantly and the dict ops are O(1).
    """

    def __init__(self, *, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> None:
        # Map<state -> (state_for, expires_at)>. A tuple makes the
        # expiry invariant explicit at the call site.
        self._states: dict[str, tuple[str, datetime]] = {}
        self._ttl = timedelta(seconds=ttl_seconds)
        self._lock = RLock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def mint(self, state_for: str) -> str:
        """Mint a fresh state token, mapped to ``state_for``.

        The token is 32 bytes of URL-safe randomness
        (``secrets.token_urlsafe(32)`` → 43-char base64 string) which
        gives ~256 bits of entropy. Plenty for a one-shot anti-CSRF
        nonce.
        """
        if not state_for:
            raise ValueError("state_for must be a non-empty string")
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(UTC) + self._ttl
        with self._lock:
            self._states[token] = (state_for, expires_at)
        logger.info(
            "oauth.state.minted",
            state_for=state_for,
            expires_at=expires_at.isoformat(),
        )
        return token

    def consume(self, state: str) -> str | None:
        """Pop and return the slug associated with ``state``.

        Returns ``None`` if:
        - the state is unknown (never minted, already consumed);
        - the state has expired (TTL elapsed) — the entry is purged on
          the way out so subsequent calls also return ``None``.

        After a successful consume the state is deleted. Replay of the
        same state is therefore impossible (returns ``None``) which
        matches the spec's "replay rejected" requirement.
        """
        if not state:
            return None
        with self._lock:
            entry = self._states.pop(state, None)
        if entry is None:
            # Unknown state — either it was never minted, already
            # consumed, or has just been popped by a concurrent caller.
            # We return None silently so the caller can issue a 400.
            return None
        state_for, expires_at = entry
        if datetime.now(UTC) >= expires_at:
            # Expired — purge and treat as missing.
            logger.info(
                "oauth.state.expired",
                state_for=state_for,
                expired_at=expires_at.isoformat(),
            )
            return None
        return state_for

    def purge_expired(self) -> int:
        """Sweep expired entries from the dict.

        Returns the number of entries purged. Cheap (O(n)) and intended
        to run once at process boot from the lifespan hook so a
        long-running process doesn't accumulate stale tokens. Per-call
        reaping happens inside :meth:`consume` so a missed sweep is
        not a correctness bug, only a slow memory leak.
        """
        now = datetime.now(UTC)
        purged = 0
        with self._lock:
            stale = [tok for tok, (_, expires_at) in self._states.items() if expires_at <= now]
            for tok in stale:
                self._states.pop(tok, None)
                purged += 1
        if purged:
            logger.info("oauth.state.purged", count=purged)
        return purged

    # ------------------------------------------------------------------
    # Test/diagnostic helpers — not part of the OAuth flow itself.
    # ------------------------------------------------------------------

    def __len__(self) -> int:
        """Expose ``len(store)`` for tests + telemetry."""
        with self._lock:
            return len(self._states)


# ---------------------------------------------------------------------------
# Module-level singleton (imported by start/callback endpoints).
# ---------------------------------------------------------------------------

# The store is intentionally a process-level singleton so that
# ``from app.services.connectors.oauth_state import oauth_state_store``
# returns the same instance across the start and callback handlers.
# A future Redis-backed implementation can swap this binding without
# touching the call sites.
oauth_state_store = OAuthStateStore()


__all__ = [
    "DEFAULT_TTL_SECONDS",
    "OAuthStateStore",
    "oauth_state_store",
]
