"""PersonaMemoryStore — Pillar 1 — Phase 3.

Two storage surfaces for persona memory (Org Knowledge shared across
users of the same persona in a tenant):

- **Stable file**: ``tenants/<slug>/workspace/memory/personas/<persona>/<key>.md``.
  Last-write-wins on the body. Read by the agent runtime when
  composing system prompts (the ``persona_memory_hook`` in
  ``idea_analysis.py`` consumes this).
- **Append-only log**: ``persona_memory_history`` table. Every edit
  is one row. The nightly ``memory_consolidate`` job rolls the past
  24h of rows into the stable file under ``## {ISO date}`` section
  headers so nothing is lost.

Persona memory is **tenant-scoped only** (no project_id). The
``Tenant.default_persona`` column (added in Phase 3 model layer)
falls back to ``'developer'`` when the cookie isn't set.

The persona cookie → tenant default → file path resolution uses
``tenant_directory.get_tenant_slug(...)``. The slug lookup is
async; ``read`` (which is sync) uses the process-local cache
populated by the request's earlier persona resolution call.

``TENANTS_ROOT`` env var defaults to
``/home/arunachalam.v@knackforge.com/forge-ai/tenants`` per the
repo convention.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from app.core.logging import get_logger
from app.db.models.persona_memory import (
    PERSONA_KEYS,
    PERSONA_NAMES,
    PersonaMemoryHistory,
)
from app.db.session import get_session_factory
from app.services.audit_service import audit_service
from app.services.tenant_directory import (
    get_tenant_slug,
    get_tenant_slug_sync,
)

logger = get_logger(__name__)


# Default on-disk root for the per-tenant memory stable files. Mirrors
# the existing layout under ``tenants/<slug>/workspace/memory/``.
DEFAULT_TENANTS_ROOT = "/home/arunachalam.v@knackforge.com/forge-ai/tenants"


def _tenants_root() -> Path:
    raw = os.environ.get("TENANTS_ROOT", DEFAULT_TENANTS_ROOT)
    return Path(raw).expanduser().resolve()


def _stable_path(tenant_slug: str, persona: str, key: str) -> Path:
    return (
        _tenants_root() / tenant_slug / "workspace" / "memory" / "personas" / persona / f"{key}.md"
    )


class PersonaMemoryStore:
    """Read / append / consolidate persona memory for a tenant."""

    def __init__(self, *, tenants_root: Path | None = None) -> None:
        self._root_override = tenants_root

    # ---- Read ------------------------------------------------------

    def read(self, tenant_id: UUID | str, persona: str, key: str) -> str:
        """Return the current stable file body, or ``""`` when absent."""
        if persona not in PERSONA_NAMES or key not in PERSONA_KEYS:
            return ""
        slug = get_tenant_slug_sync(tenant_id)
        if not slug:
            return ""
        path = (
            (
                self._root_override
                / slug
                / "workspace"
                / "memory"
                / "personas"
                / persona
                / f"{key}.md"
            )
            if self._root_override
            else _stable_path(slug, persona, key)
        )
        try:
            return path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return ""
        except OSError as exc:  # noqa: BLE001
            logger.warning(
                "persona_memory.read_failed",
                path=str(path),
                error=str(exc),
            )
            return ""

    async def recent_entries(
        self,
        tenant_id: UUID | str,
        persona: str,
        key: str,
        *,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """Return the most-recent append-only rows for ``(tenant, persona, key)``."""
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(PersonaMemoryHistory)
                .where(PersonaMemoryHistory.tenant_id == str(tenant_id))
                .where(PersonaMemoryHistory.persona == persona)
                .where(PersonaMemoryHistory.key == key)
                .order_by(PersonaMemoryHistory.written_at.desc())
                .limit(max(1, min(limit, 200)))
            )
            rows = list((await session.execute(stmt)).scalars().all())
        return [
            {
                "id": str(r.id),
                "entry_md": r.entry_md,
                "written_at": r.written_at.isoformat(),
                "written_by": str(r.written_by),
                "consolidated": bool(r.consolidated),
            }
            for r in rows
        ]

    # ---- Append ----------------------------------------------------

    async def append(
        self,
        tenant_id: UUID | str,
        persona: str,
        key: str,
        entry_md: str,
        *,
        written_by: UUID | str,
    ) -> PersonaMemoryHistory:
        """Write one history row AND append the entry to the stable file.

        The file write is **last-write-wins** on the body. The history
        log preserves every edit so the nightly consolidate can roll
        recent entries into the stable file under ``## {ISO date}``
        sections — no entry is ever lost.

        Returns the persisted row (with assigned id).
        """
        if persona not in PERSONA_NAMES or key not in PERSONA_KEYS:
            raise ValueError(f"invalid persona/key: {persona}/{key}")

        slug = await get_tenant_slug(tenant_id)
        now = datetime.now(UTC)
        factory = get_session_factory()
        async with factory() as session:
            row = PersonaMemoryHistory(
                id=uuid.uuid4(),
                tenant_id=str(tenant_id),
                persona=persona,
                key=key,
                entry_md=entry_md,
                written_by=str(written_by),
                written_at=now,
                consolidated=False,
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)

        # Best-effort file write. The history row is the source of truth
        # for the audit chain; the stable file is the fast read path.
        if slug:
            path = (
                (
                    self._root_override
                    / slug
                    / "workspace"
                    / "memory"
                    / "personas"
                    / persona
                    / f"{key}.md"
                )
                if self._root_override
                else _stable_path(slug, persona, key)
            )
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                existing = path.read_text(encoding="utf-8") if path.exists() else ""
                header = f"## {now.date().isoformat()}\n"
                body = f"{existing.rstrip()}\n\n{header}\n{entry_md.strip()}\n"
                # Atomic write so two PMs editing at the same minute
                # can't corrupt the file (the table preserves both).
                fd, tmp_path = tempfile.mkstemp(prefix=".persona_memory.", dir=str(path.parent))
                try:
                    with os.fdopen(fd, "w", encoding="utf-8") as fh:
                        fh.write(body)
                    os.replace(tmp_path, path)
                except Exception:
                    with contextlib.suppress(OSError):
                        os.unlink(tmp_path)
                    raise
            except OSError as exc:  # noqa: BLE001
                logger.warning(
                    "persona_memory.append.file_failed",
                    path=str(path),
                    error=str(exc),
                )

        await audit_service.record(
            tenant_id=tenant_id,
            project_id=None,
            actor_id=written_by,
            action="persona.memory.append",
            target_type="persona_file",
            target_id=f"{slug}/{persona}/{key}" if slug else f"{tenant_id}/{persona}/{key}",
            payload={
                "persona": persona,
                "key": key,
                "history_id": str(row.id),
            },
        )
        return row

    # ---- Consolidate ----------------------------------------------

    async def consolidate(self, tenant_id: UUID | str) -> int:
        """Roll the past 24h of unconsolidated rows into the stable file.

        Returns the number of (persona, key) pairs touched. Marks the
        rolled rows as ``consolidated=True`` so the next pass skips
        them. The nightly job (``scheduler.jobs.memory_consolidate``)
        calls this for every tenant.
        """
        slug = await get_tenant_slug(tenant_id)
        if not slug:
            return 0
        cutoff = datetime.now(UTC) - timedelta(hours=24)
        factory = get_session_factory()
        async with factory() as session:
            stmt = (
                select(PersonaMemoryHistory)
                .where(PersonaMemoryHistory.tenant_id == str(tenant_id))
                .where(PersonaMemoryHistory.consolidated.is_(False))
                .where(PersonaMemoryHistory.written_at >= cutoff)
                .order_by(PersonaMemoryHistory.written_at.asc())
            )
            rows = list((await session.execute(stmt)).scalars().all())

        # Bucket by (persona, key) preserving insertion order.
        buckets: dict[tuple[str, str], list[PersonaMemoryHistory]] = {}
        for r in rows:
            buckets.setdefault((r.persona, r.key), []).append(r)

        touched = 0
        for (persona, key), bucket in buckets.items():
            path = (
                (
                    self._root_override
                    / slug
                    / "workspace"
                    / "memory"
                    / "personas"
                    / persona
                    / f"{key}.md"
                )
                if self._root_override
                else _stable_path(slug, persona, key)
            )
            try:
                existing = path.read_text(encoding="utf-8") if path.exists() else ""
            except OSError:
                existing = ""
            day_buckets: dict[str, list[str]] = {}
            for r in bucket:
                day_buckets.setdefault(r.written_at.date().isoformat(), []).append(
                    r.entry_md.strip()
                )
            additions: list[str] = []
            for day, entries in day_buckets.items():
                additions.append(f"## {day}")
                additions.extend(entries)
                additions.append("")
            body = f"{existing.rstrip()}\n\n" + "\n".join(additions).rstrip() + "\n"
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(body, encoding="utf-8")
            except OSError as exc:  # noqa: BLE001
                logger.warning(
                    "persona_memory.consolidate.write_failed",
                    path=str(path),
                    error=str(exc),
                )
                continue
            touched += 1

            # Mark rolled rows as consolidated so they don't merge again.
            ids = [str(r.id) for r in bucket]
            async with factory() as session:
                for rid in ids:
                    row = await session.get(PersonaMemoryHistory, rid)
                    if row is not None:
                        row.consolidated = True
                        flag_modified(row, "consolidated")
                await session.commit()

        return touched

    async def consolidate_all(self) -> dict[str, int]:
        """Iterate all tenants; returns ``{tenant_id: keys_merged}``."""
        from app.db.models.tenant import Tenant

        factory = get_session_factory()
        async with factory() as session:
            tenants = list((await session.execute(select(Tenant))).scalars().all())
        out: dict[str, int] = {}
        for t in tenants:
            try:
                out[str(t.id)] = await self.consolidate(str(t.id))
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "persona_memory.consolidate_all.failed",
                    tenant_id=str(t.id),
                    error=str(exc),
                )
                out[str(t.id)] = 0
        return out


__all__ = [
    "PersonaMemoryStore",
    "DEFAULT_TENANTS_ROOT",
    "PERSONA_KEYS",
    "PERSONA_NAMES",
]
