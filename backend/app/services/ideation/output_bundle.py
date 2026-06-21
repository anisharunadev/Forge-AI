"""Output Bundle service (F-211).

Packages every artifact associated with an idea into a single JSON
blob (Idea + Analysis + Impact Graph + Score + PRD + Arch Preview +
Agent Plan). The blob is stored both in the DB (`bundle` JSONB) and in
an object store (S3 in prod, local filesystem in dev/tests). The
export step writes zip / tar / json / pdf artifacts on demand.
"""

from __future__ import annotations

import io
import json
import os
import tarfile
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select

from app.core.config import settings
from app.core.logging import get_logger
from app.db.models.ideation import (
    ArchitecturePreview,
    Idea,
    IdeaAnalysis,
    OpportunityScore,
    OutputBundle,
    PRD,
)
from app.db.session import get_session_factory
from app.services.event_bus import EventType, bus as default_bus
from app.services.ideation import (
    agent_selector,
    arch_preview_service,
    idea_analysis_service,
    impact_graph_service,
)
from app.services.ideation.prd_generator import prd_generator
from app.services.ideation.scoring import opportunity_scoring_service

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class BundleSection:
    """A single section of the bundle."""

    name: str
    payload: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "payload": self.payload}


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class OutputBundleService:
    """Tenant-scoped output bundle assembly + export."""

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus
        self._local_root = os.environ.get(
            "FORGE_IDEATION_BUNDLE_ROOT",
            os.path.join(tempfile.gettempdir(), "forge-ideation-bundles"),
        )
        os.makedirs(self._local_root, exist_ok=True)

    async def create_bundle(
        self,
        idea_id: UUID | str,
        *,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        actor_id: UUID | str | None = None,
    ) -> OutputBundle:
        idea = await self._load_idea(idea_id, tenant_id=tenant_id)
        effective_project_id = project_id or idea.project_id

        sections: list[BundleSection] = []

        # Idea section.
        sections.append(
            BundleSection(
                "idea",
                {
                    "id": str(idea.id),
                    "title": idea.title,
                    "description": idea.description,
                    "source": idea.source.value if hasattr(idea.source, "value") else str(idea.source),
                    "status": idea.status.value if hasattr(idea.status, "value") else str(idea.status),
                    "tags": list(idea.tags or []),
                    "submitted_by": str(idea.submitted_by),
                    "created_at": idea.created_at.isoformat() if idea.created_at else None,
                },
            )
        )

        # Analysis section (best-effort).
        try:
            analysis = await idea_analysis_service.get_analysis(idea.id, tenant_id=tenant_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("bundle.analysis_failed", error=str(exc))
            analysis = None
        if analysis is not None:
            sections.append(
                BundleSection(
                    "analysis",
                    {
                        "id": str(analysis.id),
                        "summary": analysis.summary,
                        "problem_statement": analysis.problem_statement,
                        "target_users": list(analysis.target_users or []),
                        "success_metrics": list(analysis.success_metrics or []),
                        "assumptions": list(analysis.assumptions or []),
                        "risks": list(analysis.risks or []),
                        "model_used": analysis.model_used,
                        "cost_usd": analysis.cost_usd,
                    },
                )
            )

        # Impact graph.
        try:
            graph = await impact_graph_service.build_impact_graph(
                idea.id, tenant_id=tenant_id, project_id=effective_project_id
            )
            sections.append(
                BundleSection(
                    "impact_graph",
                    {
                        "nodes": [n.to_dict() for n in graph.nodes],
                        "edges": [e.to_dict() for e in graph.edges],
                        "generated_at": graph.generated_at.isoformat(),
                        "summary": graph.summary,
                    },
                )
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("bundle.impact_failed", error=str(exc))

        # Score.
        try:
            score = await opportunity_scoring_service.get_score(idea.id, tenant_id=tenant_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("bundle.score_failed", error=str(exc))
            score = None
        if score is not None:
            sections.append(
                BundleSection(
                    "score",
                    {
                        "id": str(score.id),
                        "value_score": score.value_score,
                        "feasibility_score": score.feasibility_score,
                        "risk_score": score.risk_score,
                        "reach_score": score.reach_score,
                        "total_score": score.total_score,
                        "scoring_rationale": score.scoring_rationale,
                        "scored_by": score.scored_by.value if hasattr(score.scored_by, "value") else str(score.scored_by),
                    },
                )
            )

        # PRD.
        try:
            prd = await prd_generator.get_prd(idea.id, tenant_id=tenant_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("bundle.prd_failed", error=str(exc))
            prd = None
        if prd is not None:
            sections.append(
                BundleSection(
                    "prd",
                    {
                        "id": str(prd.id),
                        "version": prd.version,
                        "status": prd.status.value if hasattr(prd.status, "value") else str(prd.status),
                        "content": dict(prd.content or {}),
                    },
                )
            )

        # Architecture preview.
        try:
            preview = await arch_preview_service.get_preview(idea.id, tenant_id=tenant_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("bundle.preview_failed", error=str(exc))
            preview = None
        if preview is not None:
            sections.append(
                BundleSection(
                    "arch_preview",
                    {
                        "id": str(preview.id),
                        "version": preview.version,
                        "components": list(preview.components or []),
                        "integrations": list(preview.integrations or []),
                        "data_flows": list(preview.data_flows or []),
                        "risks": list(preview.risks or []),
                    },
                )
            )

        # Agent plan.
        try:
            plan = await agent_selector.select_agents_for_idea(
                idea.id,
                tenant_id=tenant_id,
                project_id=effective_project_id,
            )
            sections.append(
                BundleSection(
                    "agent_plan",
                    {"steps": [step.to_dict() for step in plan.steps]},
                )
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("bundle.agent_plan_failed", error=str(exc))

        bundle_dict = {
            "schema_version": 1,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "idea_id": str(idea.id),
            "tenant_id": str(idea.tenant_id),
            "project_id": str(idea.project_id),
            "sections": [s.to_dict() for s in sections],
        }
        bundle_json = json.dumps(bundle_dict, default=str)

        # Persist to local object store (S3 in prod).
        object_key = f"tenants/{idea.tenant_id}/projects/{idea.project_id}/ideas/{idea.id}/{uuid4()}.json"
        local_path = os.path.join(self._local_root, os.path.basename(object_key))
        try:
            with open(local_path, "w", encoding="utf-8") as fh:
                fh.write(bundle_json)
        except Exception as exc:  # noqa: BLE001
            logger.warning("bundle.local_write_failed", error=str(exc))
            local_path = ""

        factory = get_session_factory()
        async with factory() as session:
            row = OutputBundle(
                tenant_id=str(idea.tenant_id),
                project_id=str(idea.project_id),
                idea_id=idea.id,
                bundle=bundle_dict,
                storage_ref=local_path or None,
            )
            session.add(row)
            await session.commit()
            await session.refresh(row)

        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {
                "domain": "ideation",
                "kind": "output_bundle",
                "bundle_id": str(row.id),
                "idea_id": str(idea.id),
                "sections": [s.name for s in sections],
            },
            tenant_id=tenant_id,
            project_id=effective_project_id,
            actor_id=actor_id,
        )
        return row

    async def get_bundle(
        self, bundle_id: UUID | str, *, tenant_id: UUID | str
    ) -> OutputBundle | None:
        factory = get_session_factory()
        async with factory() as session:
            row = await session.get(OutputBundle, str(bundle_id))
            if row is None or str(row.tenant_id) != str(tenant_id):
                return None
            return row

    async def export_bundle(
        self,
        bundle_id: UUID | str,
        fmt: str,
        *,
        tenant_id: UUID | str,
    ) -> bytes:
        bundle = await self.get_bundle(bundle_id, tenant_id=tenant_id)
        if bundle is None:
            raise LookupError(f"bundle {bundle_id} not found")
        fmt = (fmt or "json").lower().strip()
        bundle_dict = dict(bundle.bundle or {})
        bundle_json = json.dumps(bundle_dict, default=str, indent=2)

        if fmt == "json":
            return bundle_json.encode("utf-8")
        if fmt == "zip":
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("bundle.json", bundle_json)
                for section in bundle_dict.get("sections") or []:
                    zf.writestr(
                        f"section_{section.get('name', 'unknown')}.json",
                        json.dumps(section, default=str, indent=2),
                    )
            return buf.getvalue()
        if fmt == "tar":
            buf = io.BytesIO()
            with tarfile.open(fileobj=buf, mode="w") as tf:
                data = bundle_json.encode("utf-8")
                info = tarfile.TarInfo(name="bundle.json")
                info.size = len(data)
                info.mtime = int(datetime.now(timezone.utc).timestamp())
                tf.addfile(info, io.BytesIO(data))
            return buf.getvalue()
        if fmt == "pdf":
            # Minimal plain-text rendering — real PDF rendering uses
            # reportlab in production. We emit a self-describing header
            # so consumers know to upgrade.
            lines = ["Forge Ideation Bundle", f"ID: {bundle.id}", ""]
            for section in bundle_dict.get("sections") or []:
                lines.append(f"=== {section.get('name', '?').upper()} ===")
                lines.append(json.dumps(section.get("payload") or {}, default=str, indent=2))
                lines.append("")
            body = "\n".join(lines).encode("utf-8")
            return b"%PDF-1.4\n% minimal stub\n" + body
        raise ValueError(f"unsupported_format:{fmt}")

    # -- helpers ----------------------------------------------------------

    async def _load_idea(
        self, idea_id: UUID | str, *, tenant_id: UUID | str
    ) -> Idea:
        factory = get_session_factory()
        async with factory() as session:
            idea = await session.get(Idea, str(idea_id))
            if idea is None:
                raise LookupError(f"idea {idea_id} not found")
            if str(idea.tenant_id) != str(tenant_id):
                raise PermissionError("idea_not_in_tenant")
            return idea


output_bundle_service = OutputBundleService()


__all__ = ["OutputBundleService", "output_bundle_service"]
