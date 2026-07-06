"""Communications ingestion (F-113).

Ingest messages from Slack / Teams / Email, detect decisions + action
items + references, and store them in the knowledge graph as `document`
nodes with `source_kind` metadata.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.connector import Connector, ConnectorType
from app.db.session import get_session_factory
from app.services.knowledge_graph import knowledge_graph_service

logger = get_logger(__name__)


_DECISION_RE = re.compile(r"\b(decided|decision|approved|agreed|concluded)\b", re.IGNORECASE)
_ACTION_RE = re.compile(r"\b(ACTION|TODO|FIXME|@[\w_-]+)\b")
_REFERENCE_RE = re.compile(r"\[([\w-]+)\]|@([\w._-]+)")


@dataclass
class DetectedDecision:
    text: str
    confidence: float = 0.7


@dataclass
class DetectedAction:
    text: str
    assignee: str | None = None


@dataclass
class IngestedCommunication:
    node_id: UUID
    source: str
    target_id: str
    decisions: list[DetectedDecision] = field(default_factory=list)
    actions: list[DetectedAction] = field(default_factory=list)
    references: list[str] = field(default_factory=list)


class CommIngestionService:
    """Tenant-scoped ingestion for Slack / Teams / Email."""

    def __init__(self) -> None:
        self._kg = knowledge_graph_service

    async def ingest_slack(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        channel_id: str,
        since: datetime | None,
    ) -> list[IngestedCommunication]:
        return await self._ingest(
            tenant_id=tenant_id,
            project_id=project_id,
            connector_type=ConnectorType.SLACK,
            source="slack",
            target_id=channel_id,
            since=since,
            kind="channel",
        )

    async def ingest_teams(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        team_id: str,
        since: datetime | None,
    ) -> list[IngestedCommunication]:
        return await self._ingest(
            tenant_id=tenant_id,
            project_id=project_id,
            connector_type=ConnectorType.SLACK,  # reuses secrets bucket for now
            source="teams",
            target_id=team_id,
            since=since,
            kind="team",
        )

    async def ingest_email(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        mailbox: str,
        since: datetime | None,
    ) -> list[IngestedCommunication]:
        return await self._ingest(
            tenant_id=tenant_id,
            project_id=project_id,
            connector_type=ConnectorType.SECRETS,
            source="email",
            target_id=mailbox,
            since=since,
            kind="mailbox",
        )

    # -- helpers ----------------------------------------------------------

    async def _ingest(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        connector_type: ConnectorType,
        source: str,
        target_id: str,
        since: datetime | None,
        kind: str,
    ) -> list[IngestedCommunication]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(Connector).where(
                Connector.tenant_id == str(tenant_id),
                Connector.type == connector_type,
            )
            connector = (await session.execute(stmt)).scalars().first()

        # Real implementations fetch messages via MCP / SDK. Here we
        # record a node summarizing the ingestion window so callers
        # see the contract end-to-end.
        node = await self._kg.add_node(
            node_type="document",
            properties={
                "source": source,
                "kind": kind,
                "target_id": target_id,
                "since": since.isoformat() if since else None,
                "connector_id": str(connector.id) if connector else None,
                "placeholder": connector is None,
                "fetched_at": datetime.now(UTC).isoformat(),
            },
            tenant_id=tenant_id,
            project_id=project_id,
            name=f"{source}:{kind}:{target_id}",
            freshness_source=f"{source}_ingest",
        )

        # Synthetic detections so the API contract is observable.
        decisions = [DetectedDecision(text=f"placeholder decision for {target_id}")]
        actions = [DetectedAction(text="follow-up", assignee=None)]
        references = [target_id]
        return [
            IngestedCommunication(
                node_id=node.id,
                source=source,
                target_id=target_id,
                decisions=decisions,
                actions=actions,
                references=references,
            )
        ]

    def detect(self, text: str) -> dict[str, Any]:
        """Public helper: scan a free-form message and return detections."""
        decisions = [DetectedDecision(text=m.group(0)) for m in _DECISION_RE.finditer(text)]
        actions = [
            DetectedAction(text=m.group(0), assignee=None) for m in _ACTION_RE.finditer(text)
        ]
        refs = []
        for m in _REFERENCE_RE.finditer(text):
            refs.append(m.group(1) or m.group(2))
        return {
            "decisions": [d.text for d in decisions],
            "actions": [a.text for a in actions],
            "references": [r for r in refs if r],
        }


comm_ingestion_service = CommIngestionService()


__all__ = [
    "CommIngestionService",
    "IngestedCommunication",
    "DetectedDecision",
    "DetectedAction",
    "comm_ingestion_service",
]
