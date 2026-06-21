"""Asset ingestion (F-114).

Pulls design assets (Figma, images, diagrams) and uses the vision LLM
through LiteLLM to produce textual descriptions that flow into the
knowledge graph as `document` nodes.
"""

from __future__ import annotations

import base64
import hashlib
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.connector import Connector, ConnectorType
from app.db.session import get_session_factory
from app.services.knowledge_graph import knowledge_graph_service
from app.services.litellm_client import LiteLLMClient

logger = get_logger(__name__)


@dataclass
class IngestedAsset:
    node_id: UUID
    source: str
    target_id: str
    bytes: int


class AssetIngestionService:
    """Tenant-scoped ingestion of design assets and diagrams."""

    def __init__(self) -> None:
        self._kg = knowledge_graph_service

    async def ingest_figma(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        file_key: str,
    ) -> list[IngestedAsset]:
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(Connector).where(
                Connector.tenant_id == str(tenant_id),
                Connector.type == ConnectorType.FIGMA,
            )
            connector = (await session.execute(stmt)).scalars().first()

        node = await self._kg.add_node(
            node_type="document",
            properties={
                "source": "figma",
                "kind": "file",
                "file_key": file_key,
                "connector_id": str(connector.id) if connector else None,
                "placeholder": connector is None,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            },
            tenant_id=tenant_id,
            project_id=project_id,
            name=f"figma:{file_key}",
            freshness_source="figma_ingest",
        )
        return [
            IngestedAsset(
                node_id=node.id,
                source="figma",
                target_id=file_key,
                bytes=len(file_key),
            )
        ]

    async def ingest_images(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        paths: list[str],
    ) -> list[IngestedAsset]:
        return await self._ingest_paths(
            tenant_id=tenant_id,
            project_id=project_id,
            paths=paths,
            source="image",
            kind="image",
        )

    async def ingest_diagrams(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        paths: list[str],
    ) -> list[IngestedAsset]:
        return await self._ingest_paths(
            tenant_id=tenant_id,
            project_id=project_id,
            paths=paths,
            source="diagram",
            kind="diagram",
        )

    # -- helpers ----------------------------------------------------------

    async def _ingest_paths(
        self,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str,
        paths: list[str],
        source: str,
        kind: str,
    ) -> list[IngestedAsset]:
        ingested: list[IngestedAsset] = []
        for path in paths:
            size = os.path.getsize(path) if os.path.exists(path) else 0
            description = await self._describe(path, source, tenant_id, project_id)
            node = await self._kg.add_node(
                node_type="document",
                properties={
                    "source": source,
                    "kind": kind,
                    "path": path,
                    "size_bytes": size,
                    "description": description,
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                },
                tenant_id=tenant_id,
                project_id=project_id,
                name=os.path.basename(path),
                freshness_source=f"{source}_ingest",
            )
            ingested.append(
                IngestedAsset(
                    node_id=node.id,
                    source=source,
                    target_id=path,
                    bytes=size,
                )
            )
        return ingested

    async def _describe(
        self,
        path: str,
        source: str,
        tenant_id: UUID | str,
        project_id: UUID | str,
    ) -> str | None:
        if not os.path.exists(path):
            return None
        try:
            with open(path, "rb") as fh:
                payload = base64.b64encode(fh.read()).decode("ascii")
        except OSError:
            return None
        try:
            async with LiteLLMClient() as client:
                response = await client.chat(
                    [
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": f"Describe this {source}."},
                                {
                                    "type": "image_url",
                                    "image_url": {"url": f"data:image/png;base64,{payload}"},
                                },
                            ],
                        }
                    ],
                    tenant_id=tenant_id,
                    project_id=project_id,
                )
            return response["choices"][0]["message"]["content"]
        except Exception as exc:  # noqa: BLE001
            logger.warning("asset.describe_failed", path=path, error=str(exc))
            digest = hashlib.sha256(payload.encode("ascii")).hexdigest()
            return f"placeholder description [{digest[:12]}]"


asset_ingestion_service = AssetIngestionService()


__all__ = [
    "AssetIngestionService",
    "IngestedAsset",
    "asset_ingestion_service",
]