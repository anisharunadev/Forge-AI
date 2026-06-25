"""Zendesk source puller (Pillar 1 — Phase 3).

Mirrors ``confluence_pull`` but hits the ``zendesk`` MCP server's
``search_tickets`` tool. The UNIQUE constraint on
``(tenant_id, source, external_id)`` gives idempotent re-runs.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from app.agents.tools.mcp_client import MCPClient
from app.core.logging import get_logger

from app.services.ideation.sources.confluence_pull import (
    MAX_SIGNALS_PER_PULL,
    _persist_signals,
)

logger = get_logger(__name__)


async def pull(
    *,
    tenant_id: UUID | str,
    project_id: UUID | str,
    since: datetime,
    mcp: MCPClient | None = None,
    limit: int = 50,
) -> list[object]:
    """Pull Zendesk tickets updated since ``since`` and persist as signals."""
    client = mcp or MCPClient()
    since_str = since.date().isoformat()
    result = await client.call_server(
        "zendesk",
        "search_tickets",
        {"query": f"updated>={since_str}", "perPage": limit, "page": 1},
    )
    if not result.ok:
        logger.warning(
            "ideation.ingest.zendesk.failed",
            error=result.error,
        )
        return []
    tickets = list((result.output or {}).get("tickets") or [])
    if not tickets:
        return []
    return await _persist_signals(
        tenant_id=tenant_id,
        project_id=project_id,
        source="zendesk",
        rows=tickets[:MAX_SIGNALS_PER_PULL],
        extract_external_id=lambda t: str(t.get("id") or ""),
        extract_title=lambda t: str(t.get("subject") or "")[:512],
        extract_body=lambda t: str(t.get("description") or "")[:8000],
        extract_occurred_at=lambda t: _parse_iso(t.get("updated_at")),
    )


def _parse_iso(value: object) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        cleaned = value.replace("Z", "+00:00")
        return datetime.fromisoformat(cleaned)
    except (ValueError, TypeError):
        return None


__all__ = ["pull"]