"""Impact analysis service (F-110).

Given a proposed ChangeSet, trace direct and transitive impact across the
knowledge graph (functions → files → modules → services) and assign a
risk score.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from app.core.logging import get_logger
from app.services.knowledge_graph import knowledge_graph_service

logger = get_logger(__name__)


@dataclass
class ChangeSet:
    project_id: UUID
    changes: list[dict[str, Any]]


@dataclass
class ImpactEntry:
    kind: str
    reference: str
    relationship: str  # direct | transitive
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ImpactReport:
    project_id: UUID
    direct_impact: list[ImpactEntry]
    transitive_impact: list[ImpactEntry]
    risk_score: float
    recommended_tests: list[str]
    impacted_slas: list[str] = field(default_factory=list)


class ImpactAnalysisService:
    """Tenant-scoped change impact analysis over the KG."""

    def __init__(self) -> None:
        self._kg = knowledge_graph_service

    async def analyze_impact(
        self,
        change: ChangeSet,
        *,
        tenant_id: UUID | str,
    ) -> ImpactReport:
        direct: list[ImpactEntry] = []
        transitive: list[ImpactEntry] = []
        seen: set[str] = set()
        for item in change.changes:
            kind = str(item.get("kind") or "file")
            reference = str(item.get("reference") or "")
            if not reference:
                continue
            direct.append(
                ImpactEntry(
                    kind=kind,
                    reference=reference,
                    relationship="direct",
                    metadata=item.get("metadata", {}),
                )
            )
            seen.add(f"{kind}:{reference}")

            # Trace edges from this node forward by one hop.
            neighbors = await self._kg.list_edges(
                tenant_id=tenant_id,
                project_id=change.project_id,
                from_node_id=reference,
                limit=500,
            )
            for edge in neighbors:
                key = f"node:{edge.to_node_id}"
                if key in seen:
                    continue
                seen.add(key)
                transitive.append(
                    ImpactEntry(
                        kind="node",
                        reference=str(edge.to_node_id),
                        relationship="transitive",
                        metadata={"via_edge": edge.edge_type},
                    )
                )

            # Backward edges (things that depend on this).
            callers = await self._kg.list_edges(
                tenant_id=tenant_id,
                project_id=change.project_id,
                to_node_id=reference,
                limit=500,
            )
            for edge in callers:
                key = f"node:{edge.from_node_id}"
                if key in seen:
                    continue
                seen.add(key)
                transitive.append(
                    ImpactEntry(
                        kind="node",
                        reference=str(edge.from_node_id),
                        relationship="transitive",
                        metadata={"via_edge": edge.edge_type, "direction": "depends_on"},
                    )
                )

        # Heuristics
        recommended_tests = self._recommend_tests(change.changes)
        impacted_slas = self._impacted_slas(direct + transitive)
        risk = self._score(direct, transitive, change.changes)

        return ImpactReport(
            project_id=change.project_id,
            direct_impact=direct,
            transitive_impact=transitive,
            risk_score=risk,
            recommended_tests=recommended_tests,
            impacted_slas=impacted_slas,
        )

    def _recommend_tests(self, changes: list[dict[str, Any]]) -> list[str]:
        out: list[str] = []
        for item in changes:
            kind = str(item.get("kind") or "")
            ref = str(item.get("reference") or "")
            if kind == "function":
                out.append(f"unit::test_{ref.replace('.', '_')}")
            elif kind == "file":
                out.append(f"integration::test_{ref.rsplit('/', 1)[-1].replace('.', '_')}")
            elif kind == "api":
                out.append(
                    f"contract::test_{ref.replace('/', '_').replace('{', '').replace('}', '')}"
                )
            elif kind == "service":
                out.append(f"smoke::{ref}")
        return sorted(set(out))[:25]

    def _impacted_slas(self, entries: list[ImpactEntry]) -> list[str]:
        slas: set[str] = set()
        for entry in entries:
            meta = entry.metadata or {}
            sla = meta.get("sla") if isinstance(meta, dict) else None
            if sla:
                slas.add(str(sla))
        if not slas:
            slas.add("default-99.9")
        return sorted(slas)

    def _score(
        self,
        direct: list[ImpactEntry],
        transitive: list[ImpactEntry],
        changes: list[dict[str, Any]],
    ) -> float:
        base = 0.1 + 0.05 * len(direct)
        transitive_penalty = 0.02 * len(transitive)
        score = base + transitive_penalty
        # Boost if API/service changes are present.
        for c in changes:
            if c.get("kind") == "api":
                score += 0.1
            if c.get("kind") == "service":
                score += 0.15
        return round(min(1.0, max(0.0, score)), 2)


impact_analysis_service = ImpactAnalysisService()


__all__ = [
    "ImpactAnalysisService",
    "ChangeSet",
    "ImpactEntry",
    "ImpactReport",
    "impact_analysis_service",
]
