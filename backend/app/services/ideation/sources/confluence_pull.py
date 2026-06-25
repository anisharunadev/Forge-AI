"""Confluence source puller (Pillar 1 — Phase 3).

Calls the ``confluence`` MCP ``search`` tool and persists results as
``IdeaSourceSignal`` rows. Idempotency: rows are keyed on
``(tenant_id, source='confluence', external_id=page_id)``; duplicate
ingests are silently skipped via the UNIQUE constraint.

Single project per call — the scheduler iterates tenants, and each
tenant's ingest run sweeps across its connector pool. The puller
honours a hard cap (``MAX_SIGNALS_PER_PULL``) so a runaway source
cannot blow up the day's budget.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.agents.tools.mcp_client import MCPClient
from app.core.logging import get_logger
from app.db.models.ideation_signal import IdeaSourceSignal
from app.db.session import get_session_factory

logger = get_logger(__name__)


# Cap per pull — keeps a single run bounded. The next daily run picks
# up the rest if the source has more pages.
MAX_SIGNALS_PER_PULL = 500


async def pull(
    *,
    tenant_id: UUID | str,
    project_id: UUID | str,
    since: datetime,
    mcp: MCPClient | None = None,
    limit: int = 50,
) -> list[IdeaSourceSignal]:
    """Pull Confluence pages updated since ``since`` and persist as signals.

    Returns the list of newly-inserted signals (empty when every page
    is already known). The list excludes duplicates so callers can
    drive downstream budgets off ``len(returned)``.
    """
    client = mcp or MCPClient()
    result = await client.call_server(
        "confluence",
        "search",
        {"cql": f"lastModified >= '{since.date().isoformat()}'", "limit": limit},
    )
    if not result.ok:
        logger.warning(
            "ideation.ingest.confluence.failed",
            error=result.error,
        )
        return []
    pages = list((result.output or {}).get("pages") or [])
    if not pages:
        return []
    return await _persist_signals(
        tenant_id=tenant_id,
        project_id=project_id,
        source="confluence",
        rows=pages[:MAX_SIGNALS_PER_PULL],
        extract_external_id=lambda p: str(p.get("id") or ""),
        extract_title=lambda p: str(p.get("title") or "")[:512],
        extract_body=lambda p: str(p.get("body") or "")[:8000],
        extract_occurred_at=lambda p: _parse_iso(p.get("updatedAt")),
    )


async def _persist_signals(
    *,
    tenant_id: UUID | str,
    project_id: UUID | str,
    source: str,
    rows: list[dict[str, object]],
    extract_external_id,
    extract_title,
    extract_body,
    extract_occurred_at,
) -> list[IdeaSourceSignal]:
    """Bulk-insert with ``ON CONFLICT DO NOTHING`` and re-read inserted rows.

    Two-step: the bulk insert returns the rows PostgreSQL actually
    added (conflicts are silently dropped); we re-read the canonical
    rows by ``(tenant_id, source, external_id)`` to materialise the
    SQLAlchemy objects for the caller. Idempotent across re-runs.
    """
    if not rows:
        return []

    now = datetime.now(timezone.utc)
    payload: list[dict[str, object]] = []
    ext_ids: list[str] = []
    for r in rows:
        ext_id = extract_external_id(r)
        if not ext_id:
            continue
        ext_ids.append(ext_id)
        payload.append(
            {
                "id": uuid4(),
                "tenant_id": str(tenant_id),
                "project_id": str(project_id),
                "source": source,
                "external_id": ext_id,
                "title": extract_title(r),
                "body": extract_body(r),
                "occurred_at": extract_occurred_at(r) or now,
                "ingested_at": now,
            }
        )
    if not payload:
        return []

    factory = get_session_factory()
    async with factory() as session:
        stmt = pg_insert(IdeaSourceSignal).values(payload)
        stmt = stmt.on_conflict_do_nothing(
            index_elements=["tenant_id", "source", "external_id"],
        )
        await session.execute(stmt)
        await session.commit()

        # Read back only the rows that were actually written THIS
        # batch. Filtering by ``ingested_at`` is the closest portable
        # signal we have on SQLite + Postgres (the bulk-insert
        # RETURNING clause is Postgres-only).
        read_stmt = select(IdeaSourceSignal).where(
            IdeaSourceSignal.tenant_id == str(tenant_id),
            IdeaSourceSignal.source == source,
            IdeaSourceSignal.external_id.in_(ext_ids),
            IdeaSourceSignal.ingested_at == now,
        )
        rows_db = list((await session.execute(read_stmt)).scalars().all())

    logger.info(
        "ideation.ingest.pulled",
        source=source,
        tenant_id=str(tenant_id),
        seen=len(payload),
        new=len(rows_db),
    )
    return rows_db


def _parse_iso(value: object) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        # ``fromisoformat`` doesn't accept the trailing Z on 3.10.
        cleaned = value.replace("Z", "+00:00")
        return datetime.fromisoformat(cleaned)
    except (ValueError, TypeError):
        return None


__all__ = ["pull", "MAX_SIGNALS_PER_PULL"]