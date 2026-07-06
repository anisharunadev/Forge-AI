"""Tests for PersonaMemoryStore (Phase 3).

Verifies:
- ``append`` writes both the history row and the stable file.
- Concurrent appends don't clobber (atomic file writes).
- ``consolidate`` merges past 24h into the stable file.
- File path resolution uses the tenant slug.
"""

from __future__ import annotations

import asyncio
import uuid

import pytest

from app.db.models.persona_memory import PersonaMemoryHistory
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory
from app.services.memory.persona_store import (
    PersonaMemoryStore,
)
from app.services.tenant_directory import _reset_cache

pytestmark = pytest.mark.asyncio


@pytest.fixture
def tenants_root(monkeypatch, tmp_path):
    root = tmp_path / "tenants"
    root.mkdir()
    monkeypatch.setenv("TENANTS_ROOT", str(root))
    yield root


async def _seed_tenant(slug: str = "acme") -> str:
    tenant_id = str(uuid.uuid4())
    factory = get_session_factory()
    async with factory() as session:
        session.add(
            Tenant(
                id=tenant_id,
                name=slug,
                slug=slug,
                status="active",
                settings={},
            )
        )
        await session.commit()
    _reset_cache()
    # Resolve slug into the in-process cache so the sync ``read`` works.
    from app.services.tenant_directory import get_tenant_slug

    assert await get_tenant_slug(tenant_id) == slug
    return tenant_id


async def test_append_writes_history_and_file(sqlite_db, tenants_root):
    tenant_id = await _seed_tenant("acme")
    store = PersonaMemoryStore()
    row = await store.append(
        tenant_id=tenant_id,
        persona="developer",
        key="ideation",
        entry_md="remember to flag billing changes",
        written_by=uuid.uuid4(),
    )
    assert row.id is not None
    file_path = (
        tenants_root / "acme" / "workspace" / "memory" / "personas" / "developer" / "ideation.md"
    )
    body = file_path.read_text(encoding="utf-8")
    assert "remember to flag billing changes" in body

    # The history row also exists.
    factory = get_session_factory()
    async with factory() as session:
        rows = list(
            (
                await session.execute(
                    __import__("sqlalchemy")
                    .select(PersonaMemoryHistory)
                    .where(PersonaMemoryHistory.tenant_id == tenant_id)
                )
            )
            .scalars()
            .all()
        )
    assert len(rows) == 1


async def test_concurrent_appends_dont_clobber(sqlite_db, tenants_root):
    tenant_id = await _seed_tenant("acme")
    store = PersonaMemoryStore()
    await asyncio.gather(
        store.append(
            tenant_id=tenant_id,
            persona="developer",
            key="ideation",
            entry_md="first dev note",
            written_by=uuid.uuid4(),
        ),
        store.append(
            tenant_id=tenant_id,
            persona="product_manager",
            key="ideation",
            entry_md="first pm note",
            written_by=uuid.uuid4(),
        ),
    )
    dev_file = (
        tenants_root / "acme" / "workspace" / "memory" / "personas" / "developer" / "ideation.md"
    )
    pm_file = (
        tenants_root
        / "acme"
        / "workspace"
        / "memory"
        / "personas"
        / "product_manager"
        / "ideation.md"
    )
    assert "first dev note" in dev_file.read_text(encoding="utf-8")
    assert "first pm note" in pm_file.read_text(encoding="utf-8")


async def test_consolidate_merges_recent_rows(sqlite_db, tenants_root):
    tenant_id = await _seed_tenant("acme")
    store = PersonaMemoryStore()
    await store.append(
        tenant_id=tenant_id,
        persona="developer",
        key="ideation",
        entry_md="recent dev note",
        written_by=uuid.uuid4(),
    )
    n = await store.consolidate(tenant_id=tenant_id)
    assert n == 1
    file_path = (
        tenants_root / "acme" / "workspace" / "memory" / "personas" / "developer" / "ideation.md"
    )
    body = file_path.read_text(encoding="utf-8")
    assert "recent dev note" in body
    assert "## " in body  # rolled under a date section


async def test_read_returns_empty_when_file_absent(sqlite_db, tenants_root):
    tenant_id = await _seed_tenant("acme")
    store = PersonaMemoryStore()
    assert store.read(tenant_id, "developer", "ideation") == ""


async def test_file_path_uses_tenant_slug(sqlite_db, tenants_root):
    tenant_id = await _seed_tenant("globex")
    store = PersonaMemoryStore()
    await store.append(
        tenant_id=tenant_id,
        persona="developer",
        key="coding",
        entry_md="globex note",
        written_by=uuid.uuid4(),
    )
    expected = (
        tenants_root / "globex" / "workspace" / "memory" / "personas" / "developer" / "coding.md"
    )
    assert expected.exists()
