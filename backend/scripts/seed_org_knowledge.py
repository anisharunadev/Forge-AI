#!/usr/bin/env python3
"""Seed organization-knowledge KG nodes for the acme-corp tenant.

Step-57-v2 Zone 7 — inserts 13 ``KGNode`` rows of ``node_type='doc'``
representing the Organization Knowledge surface (Standards, Templates,
Policies, Best Practices). The client filters by ``properties.category``
to render each tab in ``apps/forge/app/organization-knowledge/page.tsx``.

Categories and counts (per spec):
  - standard (4): Python, TypeScript, API Design, DB Migration
  - template (4): PR Review, Postmortem, ADR, Workflow YAML
  - policy (2): Data Retention, Secret Handling
  - best-practice (3): Multi-tenant Query Patterns, Idempotency Keys,
                        Approval Gates

Run with:
    docker compose exec backend python -m scripts.seed_org_knowledge
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from app.db.models.tenant import Tenant
from app.db.session import get_session_factory

from scripts._seed_helpers import ACME_TENANT_ID
from app.services.knowledge_graph import KGNode

logger = logging.getLogger("seed_org_knowledge")
logging.basicConfig(level=logging.INFO, format="%(message)s")

# acme-corp is the dev tenant seeded by `day_one_bootstrap` (see
# app/services/day_one_bootstrap.py). Its UUID is stable across
# re-seeds because the bootstrap uses an idempotent insert.

# Organization Knowledge is org-scoped (Rule 5 — shared across projects),
# but KGNode still requires a non-null project_id. We anchor to the
# canonical "Acme Platform" project seeded by seed_projects.py so the
# rows survive tenant-scoped cleanup while remaining discoverable via
# the (tenant_id, project_id, node_type) composite index.
ACME_PLATFORM_PROJECT_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")

# Stable IDs make the seed idempotent — re-running the script will skip
# rows that already exist rather than duplicating them. Each row carries
# a `properties.category` value the Organization Knowledge UI filters on.
SEED_ORG_DOCS: list[dict[str, Any]] = [
    # ---- standards (4) ----
    {
        "id": uuid.UUID("0d000001-0000-4000-8000-000000000001"),
        "name": "Python Style Guide",
        "properties": {
            "category": "standard",
            "language": "python",
            "owner": "Platform Team",
            "version": "2.1",
            "summary": "Internal Python coding standard (PEP 8 + house rules).",
        },
    },
    {
        "id": uuid.UUID("0d000001-0000-4000-8000-000000000002"),
        "name": "TypeScript Style Guide",
        "properties": {
            "category": "standard",
            "language": "typescript",
            "owner": "Knowledge Team",
            "version": "1.4",
            "summary": "Frontend TypeScript coding standard (strict mode + patterns).",
        },
    },
    {
        "id": uuid.UUID("0d000001-0000-4000-8000-000000000003"),
        "name": "API Design Standard",
        "properties": {
            "category": "standard",
            "topic": "api",
            "owner": "Platform Team",
            "version": "3.0",
            "summary": "REST + GraphQL conventions, versioning, error envelopes.",
        },
    },
    {
        "id": uuid.UUID("0d000001-0000-4000-8000-000000000004"),
        "name": "Database Migration Standard",
        "properties": {
            "category": "standard",
            "topic": "db",
            "owner": "Platform Team",
            "version": "1.2",
            "summary": "How to write reversible, multi-tenant-safe Alembic migrations.",
        },
    },
    # ---- templates (4) ----
    {
        "id": uuid.UUID("0d000002-0000-4000-8000-000000000001"),
        "name": "PR Review Template",
        "properties": {
            "category": "template",
            "format": "markdown",
            "owner": "Workflows Team",
            "summary": "Markdown template for PR descriptions (context, changes, testing).",
        },
    },
    {
        "id": uuid.UUID("0d000002-0000-4000-8000-000000000002"),
        "name": "Incident Postmortem Template",
        "properties": {
            "category": "template",
            "format": "markdown",
            "owner": "Platform Team",
            "summary": "Blameless postmortem structure (timeline, root cause, action items).",
        },
    },
    {
        "id": uuid.UUID("0d000002-0000-4000-8000-000000000003"),
        "name": "Architecture Decision Record Template",
        "properties": {
            "category": "template",
            "format": "markdown",
            "owner": "Knowledge Team",
            "summary": "Lightweight ADR template (Context / Decision / Consequences).",
        },
    },
    {
        "id": uuid.UUID("0d000002-0000-4000-8000-000000000004"),
        "name": "Workflow YAML Template",
        "properties": {
            "category": "template",
            "format": "yaml",
            "owner": "Workflows Team",
            "summary": "Starter template for workflow definitions (steps + gates).",
        },
    },
    # ---- policies (2) ----
    {
        "id": uuid.UUID("0d000003-0000-4000-8000-000000000001"),
        "name": "Data Retention Policy",
        "properties": {
            "category": "policy",
            "enforced": True,
            "owner": "Security",
            "summary": "How long we keep user data, audit logs, and run artifacts.",
        },
    },
    {
        "id": uuid.UUID("0d000003-0000-4000-8000-000000000002"),
        "name": "Secret Handling Policy",
        "properties": {
            "category": "policy",
            "enforced": True,
            "owner": "Security",
            "summary": "How to store, rotate, and audit secrets across the platform.",
        },
    },
    # ---- best practices (3) ----
    {
        "id": uuid.UUID("0d000004-0000-4000-8000-000000000001"),
        "name": "Multi-tenant Query Patterns",
        "properties": {
            "category": "best-practice",
            "owner": "Platform Team",
            "adoption_score": 92,
            "summary": "Always carry tenant_id + project_id in queries (Rule 2).",
        },
    },
    {
        "id": uuid.UUID("0d000004-0000-4000-8000-000000000002"),
        "name": "Idempotency Keys for Mutations",
        "properties": {
            "category": "best-practice",
            "owner": "Platform Team",
            "adoption_score": 87,
            "summary": "All POST/PATCH/DELETE should accept an Idempotency-Key header.",
        },
    },
    {
        "id": uuid.UUID("0d000004-0000-4000-8000-000000000003"),
        "name": "Approval Gates at Critical Points",
        "properties": {
            "category": "best-practice",
            "owner": "Platform Team",
            "adoption_score": 78,
            "summary": "Human review required at architecture / security / deploy boundaries.",
        },
    },
]


def _expected_counts() -> dict[str, int]:
    """Compute expected counts per ``properties.category`` for the summary log."""
    counts: dict[str, int] = {}
    for row in SEED_ORG_DOCS:
        cat = row["properties"]["category"]
        counts[cat] = counts.get(cat, 0) + 1
    return counts


async def seed() -> None:
    """Insert organization-knowledge ``KGNode`` rows for acme-corp. Idempotent."""
    sf = get_session_factory()
    now = datetime.now(timezone.utc)

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

        docs_created = 0
        for row in SEED_ORG_DOCS:
            existing = (
                await session.execute(
                    select(KGNode).where(
                        KGNode.id == row["id"],
                        KGNode.tenant_id == tenant.id,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                logger.info("  ↻ doc exists: %s", row["name"])
                continue
            session.add(
                KGNode(
                    id=row["id"],
                    tenant_id=tenant.id,
                    project_id=ACME_PLATFORM_PROJECT_ID,
                    node_type="doc",
                    name=row["name"],
                    properties=row["properties"],
                    freshness_at=now,
                    freshness_source="seed",
                )
            )
            docs_created += 1
            logger.info(
                "  ✓ doc created: %s (%s)",
                row["name"],
                row["properties"]["category"],
            )

        await session.commit()

        logger.info("")
        logger.info("✅ Seed complete!")
        logger.info("   - 1 tenant (acme-corp)")
        logger.info("   - %d org-knowledge docs created (%d total)",
                    docs_created, len(SEED_ORG_DOCS))
        expected = _expected_counts()
        logger.info("   - by category: %s", expected)


if __name__ == "__main__":
    asyncio.run(seed())