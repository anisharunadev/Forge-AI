"""Slack source puller (Pillar 1 — Phase 3).

Multi-channel ingest: the connector ``config['channels']`` may be a
list (Phase 3) or a single string (Phase 1 backwards compat). For
each channel, calls ``list_threads`` (treats the response as messages
to feed the synthesizer — a thread parent is one signal). Idempotent
via the same ``(tenant_id, source, external_id)`` UNIQUE constraint
the other pullers use; the external_id is the message ``ts``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from app.agents.tools.mcp_client import MCPClient
from app.core.logging import get_logger
from app.services.ideation.sources.confluence_pull import (
    MAX_SIGNALS_PER_PULL,
    _persist_signals,
)

logger = get_logger(__name__)


# Default channel fallback when the connector config omits
# ``channels``. Keeps dev / first-run tests from being empty.
_DEFAULT_CHANNELS: tuple[str, ...] = ("C-GENERAL", "C-IDEAS")


def _resolve_channels(connector_config: dict[str, Any] | None) -> list[str]:
    """Return the list of channel ids to pull.

    Accepts either ``channels`` (list[str] — Phase 3 multi-channel)
    or ``channel`` (str — single channel, backwards compat).
    """
    if not connector_config:
        return list(_DEFAULT_CHANNELS)
    raw = connector_config.get("channels")
    if isinstance(raw, list) and raw:
        return [str(c) for c in raw]
    single = connector_config.get("channel")
    if isinstance(single, str) and single:
        return [single]
    return list(_DEFAULT_CHANNELS)


async def pull(
    *,
    tenant_id: UUID | str,
    project_id: UUID | str,
    since: datetime,
    mcp: MCPClient | None = None,
    connector_config: dict[str, Any] | None = None,
    limit_per_channel: int = 50,
) -> list[object]:
    """Pull Slack thread parents per channel and persist as signals."""
    client = mcp or MCPClient()
    channels = _resolve_channels(connector_config)
    out: list[object] = []
    for channel in channels:
        result = await client.call_server(
            "slack",
            "list_threads",
            {"channel": channel, "limit": limit_per_channel},
        )
        if not result.ok:
            logger.warning(
                "ideation.ingest.slack.failed",
                channel=channel,
                error=result.error,
            )
            continue
        messages = list((result.output or {}).get("messages") or [])
        if not messages:
            continue
        # Convert ts (str like "1719000000.000000") to a usable datetime.
        def _ts_to_dt(m: dict[str, object]) -> datetime | None:
            raw_ts = m.get("ts")
            if not isinstance(raw_ts, str):
                return None
            try:
                secs = float(raw_ts.split(".", 1)[0])
            except (ValueError, AttributeError):
                return None
            return datetime.utcfromtimestamp(secs)

        rows = await _persist_signals(
            tenant_id=tenant_id,
            project_id=project_id,
            source="slack",
            rows=messages[:MAX_SIGNALS_PER_PULL],
            extract_external_id=lambda m: str(m.get("ts") or ""),
            extract_title=lambda m: (
                f"[{m.get('channel')}] " + str(m.get("text") or "")[:480]
            ),
            extract_body=lambda m: str(m.get("text") or "")[:8000],
            extract_occurred_at=_ts_to_dt,
        )
        out.extend(rows)
    return out


__all__ = ["pull"]