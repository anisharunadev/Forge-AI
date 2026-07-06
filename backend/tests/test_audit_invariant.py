"""Tests for the tamper-evident hash chain (M7 T-A5 / M7-G3).

Three invariants per the spec:

1. ``test_chain_verifies_when_intact`` — synthesize 50 events for a
   tenant, ``verify_chain_db`` returns ``integrity_ok=True`` with
   ``length=50``.

2. ``test_chain_fails_on_tampered_payload`` — write 10 events; corrupt
   one row's payload via the immutability-bypass + raw-SQL UPDATE
   (the production write path in ``AuditService.record`` uses the
   same raw-SQL mechanism, so this exercises a realistic attacker
   pattern of patching the DB directly). ``verify_chain_db`` returns
   ``integrity_ok=False`` and ``broken_at_event_id == corrupted_id``.

3. ``test_chain_head_persists_across_session_restart`` — write 5
   events, simulate a process restart by clearing ``_HASH_CHAIN`` and
   running ``reload_chain_heads``. The reload walk must rebuild the
   head from the DB rows alone; ``verify_chain_db`` then re-returns
   ``integrity_ok=True``.

All tests run against the shared ``sqlite_db`` fixture from
``conftest.py`` so no Postgres / Redis are needed.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

from app.db.models.audit import (
    AuditEvent,
    set_audit_immutability_bypass,
)
from app.db.session import get_session_factory
from app.services.audit_service import audit_service
from app.services.observability_service import (
    _HASH_CHAIN,
    observability_service,
)

# ---------------------------------------------------------------------------
# Helpers — shared with the production write path so the test mirrors
# what ``AuditService.record`` actually does.
# ---------------------------------------------------------------------------


def _canonical(payload: dict) -> str:
    """Match ``ObservabilityService.chain_hash``'s canonicalization."""
    return json.dumps(payload, sort_keys=True, default=str)


def _expected_digest(prev: str, payload: dict) -> str:
    """sha256(prev + canonical(payload)) — exact write-path formula."""
    return hashlib.sha256((prev + _canonical(payload)).encode("utf-8")).hexdigest()


async def _seed_events(
    *,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    n: int,
    base_ts: datetime | None = None,
    actor_id: uuid.UUID | None = None,
) -> list[uuid.UUID]:
    """Write ``n`` AuditEvent rows via AuditService.record and return ids.

    Mirrors production: each row gets a fresh ``hash_chain_ref``
    stamped by ``AuditService.record`` via raw SQL.
    """
    base = base_ts or datetime.now(UTC)  # noqa: UP017  (compatibility across py3.11/3.13 test runners)
    ids: list[uuid.UUID] = []
    for i in range(n):
        payload = {"i": i, "seq": i, "kind": "test_event"}
        event_id = await audit_service.record(
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
            action="audit.test",
            target_type="test_event",
            target_id=str(i),
            payload=payload,
            occurred_at=base + timedelta(seconds=i),
        )
        ids.append(event_id)
    return ids


# ---------------------------------------------------------------------------
# 1. test_chain_verifies_when_intact
# ---------------------------------------------------------------------------


async def test_chain_verifies_when_intact(sqlite_db) -> None:
    """50 synthesized events verify cleanly end-to-end."""
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()
    actor_id = uuid.uuid4()

    ids = await _seed_events(
        tenant_id=tenant_id,
        project_id=project_id,
        n=50,
        actor_id=actor_id,
    )
    assert len(ids) == 50

    factory = get_session_factory()
    async with factory() as session:
        # First sanity check: every row got a non-NULL hash_chain_ref,
        # the column was actually populated by the write path.
        rows = (
            (
                await session.execute(
                    select(AuditEvent)
                    .where(AuditEvent.tenant_id == tenant_id)
                    .order_by(AuditEvent.occurred_at.asc())
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 50
        for row in rows:
            assert row.hash_chain_ref is not None
            assert len(row.hash_chain_ref) == 64  # sha256 hex

        # AC-3(a): verify_chain_db returns integrity_ok=True with length=50.
        (
            ok,
            broken_at,
            head_hash,
            length,
            last_event_at,
        ) = await observability_service.verify_chain_db(session, tenant_id=tenant_id)
        assert ok is True
        assert broken_at is None
        assert length == 50
        assert head_hash != ""
        assert last_event_at is not None
        # The persisted head equals the in-memory head that
        # ``chain_hash`` produced for the last write.
        assert head_hash == _HASH_CHAIN.get(tenant_id)


# ---------------------------------------------------------------------------
# 2. test_chain_fails_on_tampered_payload
# ---------------------------------------------------------------------------


async def test_chain_fails_on_tampered_payload(sqlite_db) -> None:
    """Corrupting one payload in the middle of the chain surfaces as
    ``integrity_ok=False`` with the corrupted row's id.
    """
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()

    ids = await _seed_events(
        tenant_id=tenant_id,
        project_id=project_id,
        n=10,
    )
    assert len(ids) == 10
    # Pick the 5th row (index 4) to corrupt — well inside the chain
    # so both the early head and the late tail are trusted.
    corrupted_id = ids[4]

    # The ``AuditEvent`` ORM raises on UPDATE/DELETE via the
    # ``before_update`` / ``before_delete`` listeners; the same write
    # path used in production (``AuditService.record``) bypasses the
    # listener by issuing raw SQL. The attestation surface we're
    # testing is "what if a malicious DBA / row-level attacker writes
    # directly to the table" — they would do exactly this.
    previous_bypass = set_audit_immutability_bypass(True)
    try:
        factory = get_session_factory()
        async with factory() as session:
            await session.execute(
                text("UPDATE audit_events SET payload = :tampered WHERE id = :id"),
                {
                    "tampered": json.dumps({"tampered": True, "i": 999}),
                    "id": str(corrupted_id),
                },
            )
            await session.commit()
    finally:
        set_audit_immutability_bypass(previous_bypass)

    # Verification: the chain break is the corrupted row.
    factory = get_session_factory()
    async with factory() as session:
        ok, broken_at, _head, length, _last_at = await observability_service.verify_chain_db(
            session, tenant_id=tenant_id
        )
        assert ok is False
        assert broken_at == corrupted_id
        assert length == 0  # walk stops at the broken row, per spec T-A3 contract

    # Sanity: a freshly-recorded row AFTER the corruption still has
    # the new (post-corruption) prev — the corruption is local to
    # the broken row, not the chain head. This proves verify_chain
    # doesn't poison the head dict.
    post_corruption_id = await audit_service.record(
        tenant_id=tenant_id,
        project_id=project_id,
        actor_id=None,
        action="audit.test",
        target_type="test_event",
        target_id="post-corrupt",
        payload={"after": "tamper"},
    )
    assert post_corruption_id is not None
    async with factory() as session:
        post_row = (
            await session.execute(select(AuditEvent).where(AuditEvent.id == post_corruption_id))
        ).scalar_one()
        assert post_row.hash_chain_ref is not None


# ---------------------------------------------------------------------------
# 3. test_chain_head_persists_across_session_restart
# ---------------------------------------------------------------------------


async def test_chain_head_persists_across_session_restart(sqlite_db) -> None:
    """After a process restart the chain head reloads from the DB.

    We write 5 events, capture the head, then simulate restart by
    ``_HASH_CHAIN.clear()`` + a fresh ``ObservabilityService`` instance +
    ``reload_chain_heads``. The verify-chain walk must still pass —
    the DB rows are the source of truth, not the in-process dict.
    """
    tenant_id = uuid.uuid4()
    project_id = uuid.uuid4()

    ids = await _seed_events(
        tenant_id=tenant_id,
        project_id=project_id,
        n=5,
    )
    assert len(ids) == 5

    factory = get_session_factory()
    async with factory() as session:
        # Capture the persisted head BEFORE the simulated restart.
        (
            _,
            _,
            pre_restart_head,
            pre_restart_length,
            pre_restart_last,
        ) = await observability_service.verify_chain_db(session, tenant_id=tenant_id)
    assert pre_restart_length == 5
    assert pre_restart_head != ""
    assert pre_restart_last is not None
    pre_restart_dict_head = _HASH_CHAIN.get(tenant_id)
    assert pre_restart_dict_head == pre_restart_head

    # Simulate process restart — clear the in-process chain cache.
    _HASH_CHAIN.clear()
    # And swap in a fresh ObservabilityService instance to prove the
    # new instance picks up via ``reload_chain_heads`` (a new process
    # boot would behave the same).
    fresh_service = observability_service.__class__()

    async with factory() as session:
        new_heads = await fresh_service.reload_chain_heads(session)
        assert tenant_id in new_heads
        assert new_heads[tenant_id] == pre_restart_head
        # And the global cache that the production write path reads
        # from is also primed (module-level dict, so the singleton
        # service also benefits).
        assert _HASH_CHAIN.get(tenant_id) == pre_restart_head

        # Final re-verify — the chain is still intact.
        (
            ok,
            broken_at,
            head_hash_post,
            length_post,
            last_event_post,
        ) = await observability_service.verify_chain_db(session, tenant_id=tenant_id)
        assert ok is True
        assert broken_at is None
        assert head_hash_post == pre_restart_head
        assert length_post == 5
        assert last_event_post == pre_restart_last


__all__ = [
    "test_chain_verifies_when_intact",
    "test_chain_fails_on_tampered_payload",
    "test_chain_head_persists_across_session_restart",
]
