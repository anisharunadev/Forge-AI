"""F-306: Traceability Matrix service."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.architecture import (
    ADR,
    APIContract,
    ArchitectureApproval,
    RiskRegister,
    TaskBreakdown,
)
from app.db.session import get_session_factory

logger = get_logger(__name__)


# Layer labels per artifact type — used for the y-axis of the graph view.
_LAYER_FOR_TYPE = {
    "adr": "decision",
    "contract": "contract",
    "task": "task",
    "risk": "risk",
}


class TraceabilityService:
    def __init__(self, artifact_registry=None, knowledge_graph=None, event_bus=None):
        self.artifact_registry = artifact_registry
        self.knowledge_graph = knowledge_graph
        self.event_bus = event_bus

    async def build_matrix(self, tenant_id: UUID, project_id: UUID) -> dict:  # noqa: PLR0912, PLR0915
        """Build traceability matrix: ADR → API Contract → Task → Risk.

        Day-1 mock-removal: walks the existing FK-shaped tables in
        ``architecture_adrs``, ``architecture_api_contracts``,
        ``architecture_task_breakdowns``, ``architecture_risk_registers``,
        and the ``architecture_approvals`` table that links ADRs and
        contracts together. No new schema required.
        """
        nodes: list[dict] = []
        edges: list[dict] = []
        # Stable, deterministic id counter so node ids never collide
        # across kinds even when UUIDs happen to share a prefix.
        anon_seq = 0

        def _next_id() -> str:
            nonlocal anon_seq
            anon_seq += 1
            return f"node-{anon_seq}"

        factory = get_session_factory()
        async with factory() as session:
            adrs = (
                (
                    await session.execute(
                        select(ADR).where(
                            ADR.tenant_id == tenant_id,
                            ADR.project_id == project_id,
                        )
                    )
                )
                .scalars()
                .all()
            )

            contracts = (
                (
                    await session.execute(
                        select(APIContract).where(
                            APIContract.tenant_id == tenant_id,
                            APIContract.project_id == project_id,
                        )
                    )
                )
                .scalars()
                .all()
            )

            tasks = (
                (
                    await session.execute(
                        select(TaskBreakdown).where(
                            TaskBreakdown.tenant_id == tenant_id,
                            TaskBreakdown.project_id == project_id,
                        )
                    )
                )
                .scalars()
                .all()
            )

            registers = (
                (
                    await session.execute(
                        select(RiskRegister).where(
                            RiskRegister.tenant_id == tenant_id,
                            RiskRegister.project_id == project_id,
                        )
                    )
                )
                .scalars()
                .all()
            )

            approvals = (
                (
                    await session.execute(
                        select(ArchitectureApproval).where(
                            ArchitectureApproval.tenant_id == tenant_id,
                            ArchitectureApproval.project_id == project_id,
                        )
                    )
                )
                .scalars()
                .all()
            )

        # ---- Nodes --------------------------------------------------------
        adr_ids: set[str] = set()
        for adr in adrs:
            node_id = str(adr.id)
            adr_ids.add(node_id)
            nodes.append(
                {
                    "id": node_id,
                    "artifact_type": "adr",
                    "artifact_id": node_id,
                    "label": f"ADR-{adr.number:03d}: {adr.title}",
                    "layer": _LAYER_FOR_TYPE["adr"],
                }
            )

        contract_ids: set[str] = set()
        for c in contracts:
            node_id = str(c.id)
            contract_ids.add(node_id)
            nodes.append(
                {
                    "id": node_id,
                    "artifact_type": "contract",
                    "artifact_id": node_id,
                    "label": f"{c.name} v{c.version}",
                    "layer": _LAYER_FOR_TYPE["contract"],
                }
            )

        task_ids: set[str] = set()
        for t in tasks:
            node_id = str(t.id)
            task_ids.add(node_id)
            nodes.append(
                {
                    "id": node_id,
                    "artifact_type": "task",
                    "artifact_id": node_id,
                    "label": t.name,
                    "layer": _LAYER_FOR_TYPE["task"],
                }
            )

        for reg in registers:
            for risk in reg.risks or []:
                if not isinstance(risk, dict):
                    continue
                risk_id = risk.get("id")
                if not risk_id:
                    risk_id = _next_id()
                nodes.append(
                    {
                        "id": str(risk_id),
                        "artifact_type": "risk",
                        "artifact_id": None,
                        "label": risk.get("title") or "Risk",
                        "layer": _LAYER_FOR_TYPE["risk"],
                    }
                )

        # ---- Edges --------------------------------------------------------
        # ADR ↔ Contract: inferred from approvals on the same UTC day.
        by_day: dict[str, dict[str, set[str]]] = {}
        for ap in approvals:
            day = (
                ap.requested_at.date().isoformat()
                if getattr(ap, "requested_at", None)
                else "unknown"
            )
            bucket = by_day.setdefault(day, {"adr": set(), "contract": set()})
            artifact_id = str(ap.artifact_id)
            if ap.artifact_type == "adr" and artifact_id in adr_ids:
                bucket["adr"].add(artifact_id)
            elif ap.artifact_type in ("api_contract", "contract") and artifact_id in contract_ids:
                bucket["contract"].add(artifact_id)

        edge_seq = 0

        def _add_edge(source: str, target: str, relationship: str) -> None:
            nonlocal edge_seq
            edge_seq += 1
            edges.append(
                {
                    "source": source,
                    "target": target,
                    "relationship": relationship,
                }
            )

        for bucket in by_day.values():
            for adr_id in bucket["adr"]:
                for contract_id in bucket["contract"]:
                    _add_edge(adr_id, contract_id, "approved_together")

        # ADR → Task / Contract → Task: derived from
        # task_breakdowns.parent_artifact_type + parent_artifact_id.
        for t in tasks:
            parent_id = str(getattr(t, "parent_artifact_id", "") or "")
            task_id = str(t.id)
            is_adr_child = t.parent_artifact_type == "adr" and parent_id in adr_ids
            is_contract_child = (
                t.parent_artifact_type in ("api_contract", "contract") and parent_id in contract_ids
            )
            if (is_adr_child or is_contract_child) and task_id in task_ids:
                _add_edge(parent_id, task_id, "decomposed")

        return {
            "tenant_id": str(tenant_id),
            "project_id": str(project_id),
            "nodes": nodes,
            "edges": edges,
            "stats": {
                "node_count": len(nodes),
                "edge_count": len(edges),
                "adr_count": len(adr_ids),
                "contract_count": len(contract_ids),
                "task_count": len(task_ids),
            },
        }

    async def get_lineage(
        self, artifact_type: str, artifact_id: UUID, direction: str = "both"
    ) -> dict:
        """Get forward and backward lineage."""
        return {
            "artifact_type": artifact_type,
            "artifact_id": str(artifact_id),
            "direction": direction,
            "nodes": [],
            "edges": [],
        }

    async def find_orphans(self, tenant_id: UUID, project_id: UUID) -> list:
        """Find artifacts with no links."""
        return []

    async def find_breaking_changes(self, contract_id: UUID) -> list:
        """Find breaking changes in a contract."""
        return []
