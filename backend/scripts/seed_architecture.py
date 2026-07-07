#!/usr/bin/env python3
"""Seed real architecture artifacts for the acme-corp tenant.

Step-58-v2 Zone 4 — inserts a realistic architecture baseline so all
9 Architecture Center tabs (ADRs, API contracts, risk registers, task
breakdowns, approvals, standards attestations, versions) have data.

This script mirrors ``app.services.architecture.standards_attestation``
by persisting attestations as ``Artifact`` rows with
``type="architecture_attestation"`` (the system of record for
attestations is the artifact registry + the audit trail — see F-308).

NOTE: ``ArchitectureVersion`` is intentionally NOT seeded. The model
exists only as a Python dataclass in
``app.services.architecture.versioning``; there is no SQLAlchemy table
for it. The corresponding ``GET /architecture/versions`` endpoint
returns an empty list until that table lands.

Run with:
    docker compose exec backend python -m scripts.seed_architecture
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select

from app.db.models.architecture import (
    ADR,
    APIContract,
    ArchitectureApproval,
    ArchitectureVersionRow,
    RiskRegister,
    TaskBreakdown,
)
from app.db.models.artifact import Artifact, ArtifactStatus
from app.db.models.project import Project
from app.db.models.tenant import Tenant
from app.db.models.user import User
from app.db.session import get_session_factory
from scripts._seed_helpers import ACME_TENANT_ID

logger = logging.getLogger("seed_architecture")
logging.basicConfig(level=logging.INFO, format="%(message)s")

# acme-corp is the dev tenant seeded by `day_one_bootstrap`. Its UUID
# is stable across re-seeds because the bootstrap uses an idempotent
# insert.
# Default to the Acme Platform project from seed_projects.py.
ACME_PLATFORM_PROJECT_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")
DEFAULT_USER_ID = uuid.UUID("00000000-0000-0000-0000-000000000999")

# Mirror of the frontend mock-fixtures mapping so the ADRWithMeta
# projection renders the same component/impact values the UI used to
# display. ADR number → component bucket + impact score (1–10).
ADR_COMPONENT_BY_NUMBER: dict[int, str] = {
    1: "backend",
    2: "infra",
    3: "frontend",
    4: "data",
    5: "ai",
    6: "backend",
}
ADR_IMPACT_BY_NUMBER: dict[int, int] = {
    1: 9,
    2: 7,
    3: 5,
    4: 8,
    5: 10,
    6: 4,
}

# Stable IDs so re-runs are idempotent.
SEED_ADRS: list[dict[str, Any]] = [
    {
        "id": uuid.UUID("f0000001-0000-4000-8000-00000000ad01"),
        "number": 1,
        "title": "Use LangGraph for SDLC orchestration",
        "status": "accepted",
        "context": "We need a robust orchestration substrate for multi-agent SDLC runs. Options evaluated: LangGraph, custom state machine, Temporal, AWS Step Functions.",
        "decision": "Adopt LangGraph as the primary orchestration substrate. It gives us graph-based state, checkpointing, and a Python-native API that matches our backend stack.",
        "consequences": {
            "positive": ["Rich state primitives", "Built-in checkpointing", "Strong typing"],
            "negative": [
                "Vendor lock-in (mitigated by graph state isolation)",
                "Smaller community than Temporal",
            ],
        },
        "alternatives": [
            {"name": "Custom state machine", "rejected": "Too much yak-shaving"},
            {"name": "Temporal", "rejected": "Heavier ops footprint"},
            {"name": "AWS Step Functions", "rejected": "Cloud vendor lock-in"},
        ],
        "generated_by": "human",
    },
    {
        "id": uuid.UUID("f0000002-0000-4000-8000-00000000ad02"),
        "number": 2,
        "title": "Route all LLM traffic through LiteLLM proxy",
        "status": "accepted",
        "context": "We need provider-agnostic LLM access for cost control, fallback, and observability. Direct SDK calls fragment our observability.",
        "decision": "All LLM traffic MUST go through the LiteLLM proxy. Direct SDK imports are forbidden by Rule 1.",
        "consequences": {
            "positive": ["Single observability point", "Provider fallback", "Cost controls"],
            "negative": ["Extra hop (negligible latency)"],
        },
        "alternatives": [],
        "generated_by": "human",
    },
    {
        "id": uuid.UUID("f0000003-0000-4000-8000-00000000ad03"),
        "number": 3,
        "title": "Adopt TanStack Query for client state",
        "status": "accepted",
        "context": "Our React app needs a consistent data-fetching pattern. SWR and Apollo were alternatives.",
        "decision": "Adopt TanStack Query as the canonical client-side data layer. All fetches go through useQuery / useMutation hooks.",
        "consequences": {
            "positive": ["Cache invalidation rules", "Polling/refetch primitives", "Devtools"],
            "negative": ["Bundle size (small)"],
        },
        "alternatives": [],
        "generated_by": "human",
    },
    {
        "id": uuid.UUID("f0000004-0000-4000-8000-00000000ad04"),
        "number": 4,
        "title": "forge-core as canonical source for skills",
        "status": "accepted",
        "context": "Skills, agents, and commands were duplicated across packages. We needed a single source of truth.",
        "decision": "Fork forge-core from open-gsd and treat it as canonical. forge-pi and forge-browser may import from it but not duplicate.",
        "consequences": {
            "positive": ["No drift between packages", "Easier onboarding"],
            "negative": ["Upstream pull-rebases needed"],
        },
        "alternatives": [],
        "generated_by": "human",
    },
    {
        "id": uuid.UUID("f0000005-0000-4000-8000-00000000ad05"),
        "number": 5,
        "title": "Adopt D3-force for knowledge graph layout",
        "status": "proposed",
        "context": "The Knowledge Center needs a layout algorithm that handles 1000+ nodes gracefully.",
        "decision": "Adopt D3-force as the default layout. Cytoscape.js evaluated as alternative.",
        "consequences": {
            "positive": ["Excellent performance at scale", "Smooth transitions"],
            "negative": ["Less built-in UI than Cytoscape"],
        },
        "alternatives": [{"name": "Cytoscape.js", "rejected": "Heavier bundle"}],
        "generated_by": "human",
    },
    {
        "id": uuid.UUID("f0000006-0000-4000-8000-00000000ad06"),
        "number": 6,
        "title": "Replace hardcoded model providers with LiteLLM catalog",
        "status": "proposed",
        "context": "Current /providers list is hardcoded. Need dynamic catalog synced from LiteLLM.",
        "decision": "TBD — see forge-pi idea list.",
        "consequences": {},
        "alternatives": [],
        "generated_by": "human",
    },
]

# Inject component + impact from the mapping so the frontend
# ADRWithMeta projection renders the same values the mock-fixtures
# used to display. Done after the list literal so SEED_ADRS stays
# readable as data.
for _row in SEED_ADRS:
    _row["component"] = ADR_COMPONENT_BY_NUMBER.get(_row["number"], "backend")
    _row["impact"] = ADR_IMPACT_BY_NUMBER.get(_row["number"], 5)


SEED_CONTRACTS: list[dict[str, Any]] = [
    {
        "id": uuid.UUID("f0000010-0000-4000-8000-00000000c001"),
        "name": "Agent Registry API",
        "version": "1.0.0",
        "spec_type": "openapi",
        "status": "published",
        "spec_content": {
            "openapi": "3.0.3",
            "info": {"title": "Agent Registry", "version": "1.0.0"},
            "paths": {
                "/agents": {"get": {"summary": "List agents"}, "post": {"summary": "Create agent"}},
                "/agents/{id}": {
                    "get": {"summary": "Get agent"},
                    "patch": {"summary": "Update agent"},
                    "delete": {"summary": "Delete agent"},
                },
                "/agents/{id}/test": {"post": {"summary": "Test agent"}},
            },
        },
        "generated_by": "forge-core",
    },
    {
        "id": uuid.UUID("f0000010-0000-4000-8000-00000000c002"),
        "name": "Workflow Execution API",
        "version": "0.3.0",
        "spec_type": "openapi",
        "status": "published",
        "spec_content": {
            "openapi": "3.0.3",
            "info": {"title": "Workflow Execution", "version": "0.3.0"},
            "paths": {
                "/workflows": {"get": {}, "post": {}},
                "/workflows/{id}/runs": {"get": {}, "post": {}},
                "/workflows/runs/{run_id}/events": {"get": {"description": "SSE stream"}},
            },
        },
        "generated_by": "forge-core",
    },
    {
        "id": uuid.UUID("f0000010-0000-4000-8000-00000000c003"),
        "name": "Connector Events (Typed)",
        "version": "2.0.0",
        "spec_type": "graphql",
        "status": "draft",
        "spec_content": {
            "type": "graphql",
            "schema": """
                type ConnectorEvent {
                  id: ID!
                  connectorId: ID!
                  type: ConnectorEventType!
                  payload: JSON!
                  observedAt: DateTime!
                }
                type Query {
                  events(connectorId: ID): [ConnectorEvent!]!
                }
                type Subscription {
                  eventAdded(connectorId: ID): ConnectorEvent!
                }
            """,
        },
        "generated_by": "forge-pi",
    },
    {
        "id": uuid.UUID("f0000010-0000-4000-8000-00000000c004"),
        "name": "Knowledge Graph Query API",
        "version": "1.1.0",
        "spec_type": "openapi",
        "status": "published",
        "spec_content": {
            "openapi": "3.0.3",
            "info": {"title": "Knowledge Graph Query", "version": "1.1.0"},
            "paths": {
                "/knowledge-graph/nodes": {"get": {}},
                "/knowledge-graph/query/cypher": {"post": {}},
                "/knowledge-graph/query/hybrid": {"post": {}},
            },
        },
        "generated_by": "forge-core",
    },
    {
        "id": uuid.UUID("f0000010-0000-4000-8000-00000000c005"),
        "name": "Internal: RBAC Schema",
        "version": "0.2.0",
        "spec_type": "proto",
        "status": "draft",
        "spec_content": {
            "proto": """
                message Permission {
                  required string resource = 1;
                  required string action = 2;
                }
                message Role {
                  required string name = 1;
                  repeated Permission permissions = 2;
                }
            """,
        },
        "generated_by": "human",
    },
]


SEED_RISK_DATA: list[dict[str, Any]] = [
    {
        "title": "Multi-tenant data leakage",
        "level": "high",
        "category": "security",
        "mitigation": "Every query MUST filter by tenant_id. Add an integration test suite that exercises cross-tenant access.",
    },
    {
        "title": "LiteLLM proxy outage",
        "level": "high",
        "category": "availability",
        "mitigation": "Runbook: detect outage via /health, route to fallback provider, page on-call.",
    },
    {
        "title": "Runaway LLM cost",
        "level": "medium",
        "category": "cost",
        "mitigation": "Workflows must declare cost_ceiling_usd. Auto-pause run when exceeded.",
    },
    {
        "title": "Knowledge graph stale data",
        "level": "medium",
        "category": "data-quality",
        "mitigation": "Compute freshness_score per node. Highlight nodes > 30 days old.",
    },
    {
        "title": "Connector OAuth token rotation",
        "level": "low",
        "category": "operational",
        "mitigation": "Auto-rotation 7 days before expiry. Notify connector owner.",
    },
]


SEED_TASK_BREAKDOWNS: list[dict[str, Any]] = [
    {
        "id": uuid.UUID("f0000030-0000-4000-8000-00000000b001"),
        "name": "ADR-005 Implementation",
        "parent_artifact_type": "adr",
        "parent_artifact_id": uuid.UUID("f0000005-0000-4000-8000-00000000ad05"),
        "tasks": [
            {"title": "Install d3-force package", "estimate_hours": 0.5, "status": "pending"},
            {
                "title": "Replace static layout with d3-force simulation",
                "estimate_hours": 6,
                "status": "pending",
            },
            {
                "title": "Add keyboard navigation between nodes",
                "estimate_hours": 4,
                "status": "pending",
            },
            {"title": "Visual regression tests", "estimate_hours": 2, "status": "pending"},
            {"title": "Documentation", "estimate_hours": 1, "status": "pending"},
        ],
        "total_estimate_hours": 13.5,
        "status": "draft",
        "generated_by": "forge-pi",
    },
    {
        "id": uuid.UUID("f0000030-0000-4000-8000-00000000b002"),
        "name": "Workflow Versioning Implementation",
        "parent_artifact_type": "feature",
        "parent_artifact_id": uuid.UUID(
            "44444444-4444-4444-8444-444444444444"
        ),  # workflow-editor-v2 project
        "tasks": [
            {"title": "Design versioned workflow schema", "estimate_hours": 4, "status": "pending"},
            {"title": "Implement diff algorithm", "estimate_hours": 8, "status": "pending"},
            {"title": "Build diff UI in editor", "estimate_hours": 6, "status": "pending"},
            {"title": "Rollback workflow", "estimate_hours": 3, "status": "pending"},
            {"title": "Migration for existing workflows", "estimate_hours": 4, "status": "pending"},
        ],
        "total_estimate_hours": 25.0,
        "status": "draft",
        "generated_by": "forge-pi",
    },
]


# ArchitectureApproval fields per
# app/db/models/architecture.py:
#   artifact_type, artifact_id, requested_by, status, decided_by?, decided_at?, reason?
# The goal template referenced a "title"/"kind"/"approver_role" that
# don't exist on the model — we map the goal's "title" into `reason`
# (free text) and the "kind" into `artifact_type`.
SEED_APPROVALS: list[dict[str, Any]] = [
    {
        "id": uuid.UUID("f0000040-0000-4000-8000-00000000a001"),
        "artifact_type": "adr",
        "artifact_id": uuid.UUID("f0000005-0000-4000-8000-00000000ad05"),
        "status": "pending",
        "reason": "Approve ADR-005 (D3-force layout) — Architect review requested",
    },
    {
        "id": uuid.UUID("f0000040-0000-4000-8000-00000000a002"),
        "artifact_type": "contract",
        "artifact_id": uuid.UUID("f0000010-0000-4000-8000-00000000c002"),
        "status": "pending",
        "reason": "Approve Workflow API v1.0 — Tech lead review",
    },
    {
        "id": uuid.UUID("f0000040-0000-4000-8000-00000000a003"),
        "artifact_type": "risk_register",
        "artifact_id": uuid.UUID("f0000020-0000-4000-8000-00000000r001"),
        "status": "approved",
        "reason": "Approve Risk Register Q3 — Security sign-off",
        "decided_offset_days": -5,
    },
]


# Attestations are persisted as Artifact rows with
# `type="architecture_attestation"` (see F-308 in
# app/services/architecture/standards_attestation.py). The audit log
# remains the authoritative history.
SEED_ATTESTATIONS: list[dict[str, Any]] = [
    {
        "standard": "SOC 2 Type II",
        "attester_email": "arun@acme-corp.com",
        "status": "attested",
        "attested_offset_days": -30,
    },
    {
        "standard": "GDPR Data Processing",
        "attester_email": "arun@acme-corp.com",
        "status": "attested",
        "attested_offset_days": -25,
    },
    {
        "standard": "Internal: PII handling",
        "attester_email": "ravi@acme-corp.com",
        "status": "attested",
        "attested_offset_days": -20,
    },
    {
        "standard": "Internal: Tenant isolation",
        "attester_email": "ravi@acme-corp.com",
        "status": "pending",
        "attested_offset_days": None,
    },
]


def _content_hash(payload: dict[str, Any]) -> str:
    """Stable content hash used by the Artifact table."""
    import json

    encoded = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


async def seed() -> None:
    """Insert seed architecture rows for the acme-corp tenant. Idempotent."""
    sf = get_session_factory()

    async with sf() as session:
        tenant = (
            await session.execute(select(Tenant).where(Tenant.id == ACME_TENANT_ID))
        ).scalar_one_or_none()
        if tenant is None:
            raise RuntimeError(
                f"acme-corp tenant {ACME_TENANT_ID} not found. "
                "Run the day_one_bootstrap service first."
            )
        logger.info("tenant: %s (%s)", tenant.slug, tenant.name)

        # Lookup the canonical project + a real user (for FK-like fields).
        project = (
            await session.execute(
                select(Project).where(
                    Project.id == ACME_PLATFORM_PROJECT_ID,
                    Project.tenant_id == tenant.id,
                )
            )
        ).scalar_one_or_none()
        project_id = project.id if project else ACME_PLATFORM_PROJECT_ID

        user = (
            await session.execute(select(User).where(User.email == "arun@acme-corp.com"))
        ).scalar_one_or_none()
        user_id = user.id if user else DEFAULT_USER_ID

        # Short-circuit if any ADR already exists for this tenant.
        existing = (
            await session.execute(select(ADR.id).where(ADR.tenant_id == tenant.id).limit(1))
        ).first()
        if existing is not None:
            logger.info("  ↻ architecture already seeded; skipping")
            return

        # -----------------------------------------------------------------
        # ADRs
        # -----------------------------------------------------------------
        adr_by_number: dict[int, uuid.UUID] = {}
        for row in SEED_ADRS:
            session.add(
                ADR(
                    tenant_id=tenant.id,
                    project_id=project_id,
                    **row,
                )
            )
            adr_by_number[row["number"]] = row["id"]
            logger.info(
                "  ✓ ADR-%03d: %s (%s) component=%s impact=%s",
                row["number"],
                row["title"],
                row["status"],
                row.get("component"),
                row.get("impact"),
            )

        await session.flush()

        # -----------------------------------------------------------------
        # API Contracts
        # -----------------------------------------------------------------
        for row in SEED_CONTRACTS:
            approved_by = user_id if row["status"] == "published" else None
            session.add(
                APIContract(
                    tenant_id=tenant.id,
                    project_id=project_id,
                    **row,
                    approved_by=approved_by,
                )
            )
            logger.info(
                "  ✓ Contract: %s v%s (%s)",
                row["name"],
                row["version"],
                row["status"],
            )

        # -----------------------------------------------------------------
        # Risk Register (one register with N risks)
        # -----------------------------------------------------------------
        risk_register_id = uuid.UUID("f0000020-0000-4000-8000-00000000r001")
        risk_payload = [
            {
                "id": str(uuid.uuid4()),
                "title": spec["title"],
                "level": spec["level"],
                "category": spec["category"],
                "mitigation": spec["mitigation"],
                "status": "open",
            }
            for spec in SEED_RISK_DATA
        ]
        # RiskRegister has no `description` column; use `mitigation_strategy`
        # for the free-text overview.
        session.add(
            RiskRegister(
                id=risk_register_id,
                tenant_id=tenant.id,
                project_id=project_id,
                name="Q3 2026 — Acme Platform",
                risks=risk_payload,
                mitigation_strategy=(
                    "Active risks for the current quarter. Each risk is reviewed in the "
                    "weekly architecture sync; mitigation owners update status there."
                ),
                status="draft",
                generated_by="forge-pi",
            )
        )
        logger.info("  ✓ Risk register with %d risks", len(SEED_RISK_DATA))

        # -----------------------------------------------------------------
        # Task Breakdowns
        # -----------------------------------------------------------------
        for row in SEED_TASK_BREAKDOWNS:
            session.add(
                TaskBreakdown(
                    tenant_id=tenant.id,
                    project_id=project_id,
                    **row,
                )
            )
            logger.info("  ✓ Task breakdown: %s", row["name"])

        # -----------------------------------------------------------------
        # Approvals — patch the risk-register id into the seed that
        # referenced a placeholder.
        # -----------------------------------------------------------------
        for row in SEED_APPROVALS:
            artifact_id = row["artifact_id"]
            if artifact_id == uuid.UUID("f0000020-0000-4000-8000-00000000r001"):
                artifact_id = risk_register_id
            decided_offset = row.pop("decided_offset_days", None)
            decided_at = (
                datetime.now(UTC) + timedelta(days=decided_offset)
                if decided_offset is not None
                else None
            )
            session.add(
                ArchitectureApproval(
                    id=row["id"],
                    tenant_id=tenant.id,
                    project_id=project_id,
                    artifact_type=row["artifact_type"],
                    artifact_id=artifact_id,
                    requested_by=user_id,
                    status=row["status"],
                    decided_by=user_id if decided_at else None,
                    decided_at=decided_at,
                    reason=row["reason"],
                )
            )
            logger.info("  ✓ Approval: %s", row["reason"])

        # -----------------------------------------------------------------
        # Attestations (persisted as Artifact rows of type
        # `architecture_attestation`; audit log is the source of truth).
        # -----------------------------------------------------------------
        for spec in SEED_ATTESTATIONS:
            attestation_id = uuid.uuid4()
            attested_at = (
                datetime.now(UTC) + timedelta(days=spec["attested_offset_days"])
                if spec["attested_offset_days"] is not None
                else None
            )
            payload = {
                "id": str(attestation_id),
                "tenant_id": str(tenant.id),
                "project_id": str(project_id),
                "artifact_type": "adr",
                "artifact_id": str(adr_by_number[1]),
                "attestor_id": str(user_id),
                "status": spec["status"],
                "checks": [
                    {
                        "standard_name": spec["standard"],
                        "met": spec["status"] == "attested",
                        "notes": "Seeded by scripts.seed_architecture",
                    }
                ],
                "reason": None,
                "attested_at": attested_at.isoformat() if attested_at else None,
                "revoked_at": None,
                "revoker_id": None,
                "revocation_reason": None,
            }
            session.add(
                Artifact(
                    id=attestation_id,
                    tenant_id=tenant.id,
                    project_id=project_id,
                    type="architecture_attestation",
                    version=1,
                    status=ArtifactStatus.ACTIVE,
                    created_by=user_id,
                    content_hash=_content_hash(payload),
                    payload=payload,
                )
            )
            logger.info("  ✓ Attestation: %s (%s)", spec["standard"], spec["status"])

        # -----------------------------------------------------------------
        # Versions — 3 stub snapshots of the first ADR (ADR-001) so the
        # `GET /architecture/versions` endpoint has data after re-seed.
        # Idempotent: skipped if any versions already exist for this
        # tenant (covers re-runs that landed ADRs via a prior seed).
        # -----------------------------------------------------------------
        first_adr_id = adr_by_number[1]
        existing_versions = (
            await session.execute(
                select(ArchitectureVersionRow).where(
                    ArchitectureVersionRow.tenant_id == tenant.id
                )
            )
        ).scalars().first()
        if existing_versions is None:
            version_specs = [
                (1, "initial", -10),
                (2, "iter-1: added LiteLLM routing note", -5),
                (3, "iter-2: tightened acceptance criteria", 0),
            ]
            for version_number, reason, offset_days in version_specs:
                session.add(
                    ArchitectureVersionRow(
                        tenant_id=tenant.id,
                        project_id=project_id,
                        artifact_type="adr",
                        artifact_id=first_adr_id,
                        version_number=version_number,
                        content_hash="",
                        snapshot_reason=reason,
                        actor_id=user_id,
                    )
                )
                logger.info(
                    "  ✓ Version ADR-001 v%d (%s, offset=%+dd)",
                    version_number,
                    reason,
                    offset_days,
                )
        else:
            logger.info("  ↻ architecture versions already seeded; skipping")

        await session.commit()

        logger.info("")
        logger.info("✅ Architecture seeded!")
        logger.info("   - %d ADRs", len(SEED_ADRS))
        logger.info("   - %d API contracts", len(SEED_CONTRACTS))
        logger.info("   - 1 risk register (%d risks)", len(SEED_RISK_DATA))
        logger.info("   - %d task breakdowns", len(SEED_TASK_BREAKDOWNS))
        logger.info("   - %d approvals", len(SEED_APPROVALS))
        logger.info("   - %d attestations (as Artifact rows)", len(SEED_ATTESTATIONS))
        logger.info("   - 3 architecture versions (stub ADR-001 snapshots)")


if __name__ == "__main__":
    asyncio.run(seed())
