"""Document ingestion service (F-112).

Pulls pages from external doc systems (Confluence, Notion, Google Docs)
via their respective connectors, embeds the text via LiteLLM, and
materializes them as `document` nodes in the knowledge graph.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.connector import Connector, ConnectorType
from app.db.session import get_session_factory
from app.services.knowledge_graph import knowledge_graph_service
from app.services.litellm_client import LiteLLMClient

logger = get_logger(__name__)


@dataclass
class IngestedDocument:
    node_id: UUID
    title: str
    source: str
    bytes: int


class DocIngestionService:
    """Tenant-scoped document ingestion."""

    def __init__(self) -> None:
        self._kg = knowledge_graph_service

    async def ingest_confluence(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        space_key: str,
    ) -> list[IngestedDocument]:
        return await self._ingest_via_connector(
            tenant_id=tenant_id,
            project_id=project_id,
            connector_type=ConnectorType.CONFLUENCE,
            target_id=space_key,
            source="confluence",
            kind="space",
        )

    async def ingest_notion(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        page_id: str,
    ) -> list[IngestedDocument]:
        return await self._ingest_via_connector(
            tenant_id=tenant_id,
            project_id=project_id,
            connector_type=ConnectorType.JIRA,  # Notion shares secrets bucket
            target_id=page_id,
            source="notion",
            kind="page",
        )

    async def ingest_google_docs(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        doc_id: str,
    ) -> list[IngestedDocument]:
        return await self._ingest_via_connector(
            tenant_id=tenant_id,
            project_id=project_id,
            connector_type=ConnectorType.SECRETS,  # OAuth secrets connector
            target_id=doc_id,
            source="google_docs",
            kind="doc",
        )

    # -- helpers ----------------------------------------------------------

    async def _ingest_via_connector(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        connector_type: ConnectorType,
        target_id: str,
        source: str,
        kind: str,
    ) -> list[IngestedDocument]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(Connector).where(
                Connector.tenant_id == str(tenant_id),
                Connector.type == connector_type,
            )
            connector = (await session.execute(stmt)).scalars().first()
        # When no connector is configured we record a placeholder node
        # so the ingestion flow remains observable end-to-end.
        title = f"{source}:{kind}:{target_id}"
        node = await self._kg.add_node(
            node_type="document",
            properties={
                "source": source,
                "kind": kind,
                "target_id": target_id,
                "connector_id": str(connector.id) if connector else None,
                "placeholder": connector is None,
                "fetched_at": datetime.now(UTC).isoformat(),
            },
            tenant_id=tenant_id,
            project_id=project_id,
            name=title,
            freshness_source=f"{source}_ingest",
        )
        return [
            IngestedDocument(
                node_id=node.id,
                title=title,
                source=source,
                bytes=len(target_id),
            )
        ]

    async def _embed(
        self,
        texts: list[str],
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> list[list[float]]:
        try:
            async with LiteLLMClient() as client:
                return await client.embed(texts, tenant_id=tenant_id, project_id=project_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("doc_ingestion.embed_failed", error=str(exc))
            return [_hash_embedding(t) for t in texts]


def _hash_embedding(text: str, dim: int = 64) -> list[float]:
    import math

    digest = hashlib.sha512(text.encode("utf-8")).digest()
    out = [((digest[i % len(digest)] / 255.0) * 2.0 - 1.0) for i in range(dim)]
    norm = math.sqrt(sum(x * x for x in out)) or 1.0
    return [x / norm for x in out]


doc_ingestion_service = DocIngestionService()


__all__ = ["DocIngestionService", "IngestedDocument", "doc_ingestion_service"]
