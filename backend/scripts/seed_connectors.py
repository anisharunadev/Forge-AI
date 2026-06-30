#!/usr/bin/env python3
"""Seed real connectors + sync history for the acme-corp tenant.

Step-55-v2 Zone 1 — Wire the Connector Center to the real backend.

Inserts a small but realistic set of installed connectors (github, jira,
slack, confluence, figma, aws) plus a handful of ``ConnectorSyncHistory``
rows so the Activity tab has something to show immediately after the
user logs in. The script is idempotent — re-running skips rows that
already exist on (tenant_id, type).

Run with::

    docker compose exec backend python -m scripts.seed_connectors

Verify with::

    docker compose exec postgres psql -U forge -d forge \
        -c "SELECT name, type, status FROM connectors;"
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select

from app.db.models.connector import (
    Connector,
    ConnectorStatus,
    ConnectorSyncHistory,
    ConnectorType,
    SyncStatus,
)
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory

logger = logging.getLogger("seed_connectors")
logging.basicConfig(level=logging.INFO, format="%(message)s")

# Stable IDs — mirror the seed convention from ``seed_agents.py`` so the
# acme-corp tenant row, project row, and the seed user UUID line up with
# the rest of the demo dataset.
ACME_TENANT_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
ACME_PROJECT_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
ACME_SEED_USER_ID = uuid.UUID("33333333-3333-3333-3333-333333330001")  # sarah.chen


# ---------------------------------------------------------------------------
# Connectors — six canonical "real" connectors for the Connected tab.
# ---------------------------------------------------------------------------

SEED_CONNECTORS: list[dict[str, Any]] = [
    {
        "id": uuid.UUID("cccc1111-1111-4111-8111-111111111101"),
        "name": "GitHub · acme-corp",
        "type": ConnectorType.GITHUB,
        "config": {
            "api_base": "https://api.github.com",
            "api_key": "ghp_demo_replace_me",
            "org": "acme-corp",
        },
        "status": ConnectorStatus.HEALTHY,
        "last_sync_at": datetime.now(timezone.utc) - timedelta(minutes=2),
        "last_error": None,
    },
    {
        "id": uuid.UUID("cccc1111-1111-4111-8111-111111111102"),
        "name": "Jira · acme.atlassian.net",
        "type": ConnectorType.JIRA,
        "config": {
            "api_base": "https://acme.atlassian.net",
            "api_key": "demo_replace_me",
        },
        "status": ConnectorStatus.HEALTHY,
        "last_sync_at": datetime.now(timezone.utc) - timedelta(minutes=4),
        "last_error": None,
    },
    {
        "id": uuid.UUID("cccc1111-1111-4111-8111-111111111103"),
        "name": "Slack · acme-corp",
        "type": ConnectorType.SLACK,
        "config": {
            "workspace": "acme-corp",
            "bot_token": "xoxb_demo_replace_me",
        },
        "status": ConnectorStatus.HEALTHY,
        "last_sync_at": datetime.now(timezone.utc) - timedelta(seconds=45),
        "last_error": None,
    },
    {
        "id": uuid.UUID("cccc1111-1111-4111-8111-111111111104"),
        "name": "Confluence · ENG",
        "type": ConnectorType.CONFLUENCE,
        "config": {"space": "ENG"},
        "status": ConnectorStatus.PENDING,
        "last_sync_at": None,
        "last_error": None,
    },
    {
        "id": uuid.UUID("cccc1111-1111-4111-8111-111111111105"),
        "name": "Figma · acme-corp",
        "type": ConnectorType.FIGMA,
        "config": {},
        "status": ConnectorStatus.PENDING,
        "last_sync_at": None,
        "last_error": None,
    },
    {
        "id": uuid.UUID("cccc1111-1111-4111-8111-111111111106"),
        "name": "AWS · us-east-1",
        "type": ConnectorType.AWS,
        "config": {"region": "us-east-1"},
        "status": ConnectorStatus.PENDING,
        "last_sync_at": None,
        "last_error": None,
    },
]


# ---------------------------------------------------------------------------
# Sync history — recent events so the Activity tab has rows.
# One ConnectorSyncHistory row per (connector, offset) pair.
# ---------------------------------------------------------------------------

_SYNC_OFFSETS_MINUTES = [2, 11, 38, 95, 240]  # most-recent first


def _build_sync_history(
    connector_id: uuid.UUID,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
) -> list[ConnectorSyncHistory]:
    """Build a small activity feed for one connector."""
    rows: list[ConnectorSyncHistory] = []
    for idx, mins in enumerate(_SYNC_OFFSETS_MINUTES):
        started = datetime.now(timezone.utc) - timedelta(minutes=mins)
        # Most recent event is success; older ones alternate success / partial.
        if idx == 0:
            status = SyncStatus.SUCCESS
            items = 47 if idx == 0 else 12
            err = None
        else:
            status = SyncStatus.SUCCESS if idx % 2 == 0 else SyncStatus.FAILURE
            items = 12 + idx * 5
            err = "rate-limited (429)" if status == SyncStatus.FAILURE else None
        rows.append(
            ConnectorSyncHistory(
                id=uuid.uuid4(),
                tenant_id=tenant_id,
                project_id=project_id,
                connector_id=connector_id,
                started_at=started,
                finished_at=started + timedelta(milliseconds=240 + idx * 90),
                status=status,
                items_synced=items if status != SyncStatus.FAILURE else 0,
                error_message=err,
            )
        )
    return rows


async def seed() -> None:
    """Insert seed rows for the acme-corp tenant. Idempotent."""
    sf = get_session_factory()

    async with sf() as session:
        tenant = (
            await session.execute(select(Tenant).where(Tenant.id == ACME_TENANT_ID))
        ).scalar_one_or_none()
        if tenant is None:
            raise RuntimeError(
                f"acme-corp tenant {ACME_TENANT_ID} not found. "
                "Run `python -m seeds` first to install the acme-corp seed package."
            )
        logger.info("tenant: %s (%s)", tenant.slug, tenant.name)

        connectors_created = 0
        for row in SEED_CONNECTORS:
            existing = (
                await session.execute(
                    select(Connector).where(
                        Connector.id == row["id"],
                        Connector.tenant_id == tenant.id,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                logger.info("  ↻ connector exists: %s (%s)", row["name"], row["type"].value)
                continue
            session.add(
                Connector(
                    tenant_id=tenant.id,
                    project_id=ACME_PROJECT_ID,
                    name=row["name"],
                    type=row["type"],
                    config=row["config"],
                    status=row["status"],
                    last_sync_at=row["last_sync_at"],
                    last_error=row["last_error"],
                    created_by=ACME_SEED_USER_ID,
                    id=row["id"],
                )
            )
            connectors_created += 1
            logger.info("  ✓ connector created: %s (%s)", row["name"], row["type"].value)

        await session.commit()

        # Second pass: attach sync-history rows to each connector so the
        # Activity tab has a real feed. Done in a second commit so a
        # failure here doesn't undo the connector inserts above.
        history_created = 0
        for row in SEED_CONNECTORS:
            existing_count = (
                await session.execute(
                    select(ConnectorSyncHistory).where(
                        ConnectorSyncHistory.connector_id == row["id"]
                    )
                )
            ).scalars().all()
            if existing_count:
                logger.info("  ↻ sync history exists for %s", row["name"])
                continue
            history = _build_sync_history(
                connector_id=row["id"],
                tenant_id=tenant.id,
                project_id=ACME_PROJECT_ID,
            )
            for h in history:
                session.add(h)
            history_created += len(history)
            logger.info("  ✓ sync history added: %s (%d rows)", row["name"], len(history))

        await session.commit()

        logger.info("")
        logger.info("✅ Seed complete!")
        logger.info(
            "   - %d connectors created (%d total)",
            connectors_created,
            len(SEED_CONNECTORS),
        )
        logger.info("   - %d sync-history rows created", history_created)


if __name__ == "__main__":
    asyncio.run(seed())
