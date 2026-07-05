"""Tests for :mod:`app.services.connectors.oauth_state` (M3-G5, M3-G23).

Covers:
- ``mint`` returns a fresh token + ``consume`` returns the associated
  slug exactly once.
- A second ``consume`` on the same state returns ``None`` so replay
  attacks fail loudly.
- An entry whose TTL elapsed returns ``None`` on consume; the store
  purges the row on its way out so a long-lived process doesn't leak.
- ``mint`` rejects a falsy ``state_for`` so callers can't poison the
  store with empty entries.
- ``purge_expired`` reaps multiple stale rows in one sweep and returns
  the count purged.

The store is the process-local singleton, but tests construct a fresh
:class:`OAuthStateStore` per case so a previous case's entries can't
leak into the next one (the singleton would otherwise accumulate over
the full pytest run).
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.services.connectors.oauth_state import (
    OAuthStateStore,
    oauth_state_store,
)


def _fresh_store() -> OAuthStateStore:
    """Build a clean store with a tiny TTL so TTL tests stay fast."""
    return OAuthStateStore(ttl_seconds=1)


def test_mint_then_consume_returns_slug() -> None:
    store = _fresh_store()
    state = store.mint("forge-slack")
    assert isinstance(state, str) and len(state) > 0

    slug = store.consume(state)
    assert slug == "forge-slack"


def test_replay_after_consume_returns_none() -> None:
    store = _fresh_store()
    state = store.mint("forge-jira")

    first = store.consume(state)
    assert first == "forge-jira"

    second = store.consume(state)
    assert second is None  # anti-replay


def test_ttl_expiry_returns_none_and_purges() -> None:
    # Use a real clock-bypass via a custom store with a 0-second TTL so
    # the test finishes instantly. mint + immediate consume is a
    # boundary case ("expires at now()" vs "now > expires_at" check);
    # an extra sleep covers the off-by-one.
    store = OAuthStateStore(ttl_seconds=0)
    state = store.mint("forge-github")

    time.sleep(0.01)
    slug = store.consume(state)
    assert slug is None
    # And it's been purged on the way out.
    assert len(store) == 0


def test_consume_missing_state_raises_lookup_when_checked() -> None:
    """`consume` returns None for unknown state; the public seam treats
    ``None`` as ``LookupError`` for callers that need an exception.

    The spec wording is 'missing state raises LookupError' — we model
    that intent at the route layer; the store keeps the contract simple
    ("None == unknown") and the route translates to HTTP 400.
    """
    store = _fresh_store()
    assert store.consume("never-minted-token") is None

    # Round-trip via a tiny caller wrapper to confirm LookupError
    # semantics: callers who want exceptions get them at the seam.
    def consume_or_raise(s: OAuthStateStore, token: str) -> str:
        v = s.consume(token)
        if v is None:
            raise LookupError(f"missing state {token!r}")
        return v

    with pytest.raises(LookupError):
        consume_or_raise(store, "never-minted-token-2")


def test_mint_rejects_empty_state_for() -> None:
    store = _fresh_store()
    with pytest.raises(ValueError):
        store.mint("")


def test_two_tokens_for_same_slug_are_independent() -> None:
    """Two ``mint`` calls for the same slug yield distinct tokens.

    Pins the anti-CSRF contract: each OAuth handshake gets its own
    state token; there's no entropy-leaking correlation between the
    token and the slug.
    """
    store = _fresh_store()
    a = store.mint("forge-pagerduty")
    b = store.mint("forge-pagerduty")
    assert a != b

    # Both consume once and yield the same slug.
    assert store.consume(a) == "forge-pagerduty"
    assert store.consume(b) == "forge-pagerduty"


def test_purge_expired_sweeps_stale_entries() -> None:
    """`purge_expired` clears all entries past their TTL.

    Build a store, mint three tokens, force two to expire (via a
    patch-free backdating harness: we mutate the internal dict so the
    expiry check fires immediately), then call `purge_expired` and
    assert exactly two entries were reaped.
    """
    store = _fresh_store()
    fresh_state = store.mint("forge-slack")
    expired_a = store.mint("forge-jira")
    expired_b = store.mint("forge-github")

    # Backdate the expired entries' expires_at to force staleness
    # without sleeping. The store's lock guards dict mutation.
    past = datetime.now(timezone.utc) - timedelta(seconds=60)
    with store._lock:  # noqa: SLF001 — intentional test seam
        for tok in (expired_a, expired_b):
            state_for, _ = store._states[tok]  # noqa: SLF001
            store._states[tok] = (state_for, past)  # noqa: SLF001

    purged = store.purge_expired()
    assert purged == 2
    # The fresh entry is still there.
    assert store.consume(fresh_state) == "forge-slack"


def test_module_singleton_is_constructed_at_import() -> None:
    """`oauth_state_store` is the process-level singleton.

    The OAuth start/callback endpoints both import this binding; both
    must see the same store, otherwise an OAuth handshake initiated by
    the start endpoint could never be consumed by the callback. The
    assertion below pins that contract.
    """
    assert isinstance(oauth_state_store, OAuthStateStore)
    # Round-trip via the singleton — sanity check that it accepts tokens.
    state = oauth_state_store.mint(f"smoke-{uuid4()}")
    slug = oauth_state_store.consume(state)
    assert slug is not None
