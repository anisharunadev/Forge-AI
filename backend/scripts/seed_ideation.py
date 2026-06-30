#!/usr/bin/env python3
"""Seed ideation data for the acme-corp tenant (Step-57-v2 Zone 4).

Inserts a realistic ideation pipeline so the Ideation Center tabs render
against real data instead of static mocks:

  - 6 Ideas covering every workflow status:
        NEW, ANALYZING, SCORED, APPROVED, IN_ROADMAP, REJECTED
  - 4 IdeaAnalysis rows (one per idea that has progressed past intake)
  - 4 OpportunityScore rows (RICE + custom dimensions)
  - 1 Roadmap with 3 items spread across NOW / NEXT / LATER horizons
  - 2 PRDs (one DRAFT, one REVIEW)
  - 3 ApprovalItems (2 PENDING, 1 APPROVED)
  - 2 PushRecords (Jira pushes with mixed status)

Idempotent — re-running the script on an already-seeded tenant is a no-op.

Run with:
    docker compose exec backend python -m scripts.seed_ideation
"""
from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import select

from app.db.models.ideation import (
    ApprovalItem,
    ApprovalItemStatus,
    ApprovalItemType,
    Idea,
    IdeaAnalysis,
    IdeaSource,
    IdeaStatus,
    OpportunityScore,
    PRD,
    PRDStatus,
    PushRecord,
    PushStatus,
    PushTarget,
    Roadmap,
    RoadmapHorizon,
    RoadmapStatus,
    ScoreSource,
)
from app.db.models.project import Project
from app.db.models.tenant import Tenant
from app.db.models.user import User
from app.db.session import get_session_factory

logger = logging.getLogger("seed_ideation")
logging.basicConfig(level=logging.INFO, format="%(message)s")


# acme-corp is the dev tenant seeded by `day_one_bootstrap`. Its UUID is
# stable across re-seeds because the bootstrap uses an idempotent insert.
ACME_TENANT_ID = UUID("a6500631-1930-5afa-9d38-24de9bedcb37")
ACME_USER_EMAIL = "arun@acme-corp.com"


# ---------------------------------------------------------------------------
# Seed specs
# ---------------------------------------------------------------------------

# Six ideas, each mapped to the status the spec calls out. The first four
# also carry downstream artifacts (analysis + score); the last two are
# intentionally in-flight (NEW) or terminal (REJECTED) without analyses.
SEED_IDEAS: list[dict] = [
    {
        "title": "AI-assisted code review for every PR",
        "description": (
            "Use Claude to review every PR for style, correctness, and "
            "security before a human reviewer is assigned. Block merging "
            "on critical issues."
        ),
        "source": IdeaSource.USER,
        "status": IdeaStatus.IN_ROADMAP,
        "tags": ["ai", "code-quality", "developer-experience"],
    },
    {
        "title": "Auto-generate architecture diagrams from service graph",
        "description": (
            "Use the live knowledge graph (services + dependencies) to "
            "render C4 architecture diagrams on demand. Export to "
            "PNG / SVG / PlantUML."
        ),
        "source": IdeaSource.USER,
        "status": IdeaStatus.APPROVED,
        "tags": ["documentation", "knowledge-graph", "diagrams"],
    },
    {
        "title": "Slack-native ideation capture",
        "description": (
            "Let users submit ideas directly from Slack via /forge-idea "
            "slash command. Auto-transcribe voice notes."
        ),
        "source": IdeaSource.COMMUNITY,
        "status": IdeaStatus.SCORED,
        "tags": ["integrations", "slack", "intake"],
    },
    {
        "title": "Cost anomaly detection for LLM spend",
        "description": (
            "Alert when a tenant's daily spend exceeds 2x their 7-day "
            "rolling average. Show breakdown by agent + provider."
        ),
        "source": IdeaSource.SIGNAL,
        "status": IdeaStatus.ANALYZING,
        "tags": ["cost", "monitoring", "llm"],
    },
    {
        "title": "Personalized on-call dashboard",
        "description": (
            "Per-user dashboard showing their active incidents, paged "
            "services, recent deploys, and team capacity."
        ),
        "source": IdeaSource.USER,
        "status": IdeaStatus.NEW,
        "tags": ["operations", "dashboard"],
    },
    {
        "title": "Voice-driven PR creation",
        "description": (
            "Speak a PR description, AI generates the title / body / "
            "diff. Review and commit."
        ),
        "source": IdeaSource.COMMUNITY,
        "status": IdeaStatus.REJECTED,
        "tags": ["ai", "voice"],
    },
]


# IdeaAnalysis rows — one per idea that has progressed past intake. The
# IdeaAnalysis model captures problem / users / metrics / risks + cost.
SEED_ANALYSES: list[dict] = [
    {
        "summary": (
            "AI-assisted code review eliminates the first round of "
            "back-and-forth with human reviewers for style + tests."
        ),
        "problem_statement": (
            "PR review queues back up because humans spend time on "
            "lint/test failures the AI could catch instantly."
        ),
        "target_users": ["backend-engineers", "frontend-engineers", "tech-leads"],
        "success_metrics": [
            "Reduce PR cycle time by 35%",
            "Catch > 80% of style + test failures before human review",
        ],
        "assumptions": [
            "Claude can be tuned to ignore stylistic preference debates",
            "Teams accept an automated gate before the human reviewer",
        ],
        "risks": [
            "LLM cost per PR may erode the time savings",
            "False positives could erode trust faster than false negatives",
        ],
        "model_used": "claude-sonnet-4.5",
        "cost_usd": 0.12,
    },
    {
        "summary": (
            "Auto-generated C4 diagrams keep architecture docs in lockstep "
            "with the live service graph."
        ),
        "problem_statement": (
            "Architecture diagrams drift from reality within a sprint "
            "because nobody maintains them."
        ),
        "target_users": ["architects", "tech-leads", "platform-engineers"],
        "success_metrics": [
            "Diagrams refresh within 5 minutes of a service change",
            "Zero hand-maintained architecture diagrams in the repo",
        ],
        "assumptions": [
            "The KG already represents services + dependencies faithfully",
            "PlantUML + SVG exporters are acceptable to all consumers",
        ],
        "risks": [
            "Visual clutter for very large service graphs",
            "Edge cases in C4 level mapping need human curation",
        ],
        "model_used": "claude-sonnet-4.5",
        "cost_usd": 0.08,
    },
    {
        "summary": (
            "Slack intake meets users where they already are, removing "
            "the friction of opening the Forge web app."
        ),
        "problem_statement": (
            "People talk about ideas in Slack but the Forge intake form "
            "is a separate destination."
        ),
        "target_users": ["product-managers", "engineers", "support-team"],
        "success_metrics": [
            "> 50% of new ideas arrive via Slack",
            "Time from idea-spoken to idea-recorded < 60 seconds",
        ],
        "assumptions": [
            "Slack workspace admins will approve the bot install",
            "Voice transcription accuracy is acceptable for short briefs",
        ],
        "risks": [
            "Spam / off-topic ideas need quick triage",
            "Transcription errors propagate into Idea records",
        ],
        "model_used": "claude-sonnet-4.5",
        "cost_usd": 0.09,
    },
    {
        "summary": (
            "Anomaly detection catches cost spikes before they show up "
            "on the monthly invoice."
        ),
        "problem_statement": (
            "Tenants only notice LLM overspend when finance flags the "
            "invoice at month end."
        ),
        "target_users": ["platform-owners", "finance", "engineering-managers"],
        "success_metrics": [
            "Detect > 90% of cost spikes within 1 hour",
            "Reduce monthly LLM overspend by > 40% on opted-in tenants",
        ],
        "assumptions": [
            "LiteLLM call records stream into the audit log reliably",
            "Tenants will accept a 2x daily threshold as the trigger",
        ],
        "risks": [
            "Threshold tuning per tenant is a maintenance burden",
            "False alarms erode trust in the alerting channel",
        ],
        "model_used": "claude-sonnet-4.5",
        "cost_usd": 0.07,
    },
]


# OpportunityScore rows — RICE-style with the four custom dimensions the
# ORM exposes (value / feasibility / risk / reach). total_score is the
# weighted aggregate so the UI can rank ideas without recomputing.
SEED_SCORES: list[dict] = [
    {
        "value_score": 9.0,
        "feasibility_score": 7.0,
        "risk_score": 3.0,
        "reach_score": 8.0,
        "total_score": 8.2,
        "scoring_rationale": (
            "High value across every engineering team; feasibility proven "
            "by GitHub Copilot Reviews. Risk concentrated in LLM cost."
        ),
        "scored_by": ScoreSource.AI,
    },
    {
        "value_score": 7.5,
        "feasibility_score": 8.0,
        "risk_score": 4.0,
        "reach_score": 6.0,
        "total_score": 7.1,
        "scoring_rationale": (
            "Diagram export is mostly UI + React Flow work; very feasible "
            "now that the KG is wired. Reach is engineering-only."
        ),
        "scored_by": ScoreSource.AI,
    },
    {
        "value_score": 6.5,
        "feasibility_score": 9.0,
        "risk_score": 2.0,
        "reach_score": 9.0,
        "total_score": 7.4,
        "scoring_rationale": (
            "Slack intake is mostly glue code + a slash command. Very low "
            "risk. Reach is everyone who already lives in Slack."
        ),
        "scored_by": ScoreSource.AI,
    },
    {
        "value_score": 8.0,
        "feasibility_score": 5.0,
        "risk_score": 6.0,
        "reach_score": 7.0,
        "total_score": 6.1,
        "scoring_rationale": (
            "High value (real money saved) but feasibility depends on "
            "stream quality from LiteLLM. Risk of alert fatigue is real."
        ),
        "scored_by": ScoreSource.AI,
    },
]


# Roadmap items live inside the Roadmap.items JSONB column (the ORM does
# not expose a separate RoadmapItem table). Each entry links to a seeded
# idea by its deterministic UUID below.
SEED_ROADMAP_ITEMS: list[dict] = [
    {
        "slot": "now",
        "horizon": RoadmapHorizon.NOW,
        "idea_index": 0,  # AI code review
        "title": "AI PR review (MVP)",
        "effort": "S",
        "quarter": "Q3",
        "rank": 1,
    },
    {
        "slot": "next",
        "horizon": RoadmapHorizon.NEXT,
        "idea_index": 1,  # Architecture diagrams
        "title": "Architecture diagrams auto-gen",
        "effort": "M",
        "quarter": "Q3",
        "rank": 2,
    },
    {
        "slot": "later",
        "horizon": RoadmapHorizon.LATER,
        "idea_index": 3,  # Cost anomaly
        "title": "Cost anomaly alerts",
        "effort": "M",
        "quarter": "Q4",
        "rank": 5,
    },
]


# Two PRDs — one DRAFT (Architecture diagrams) and one REVIEW (AI PR review).
SEED_PRDS: list[dict] = [
    {
        "idea_index": 0,  # AI code review
        "version": 2,
        "content": {
            "title": "AI-Assisted Code Review PRD",
            "overview": (
                "Adds a Claude-powered first-pass review to every PR "
                "before a human reviewer is assigned. Blocks merges on "
                "critical findings."
            ),
            "goals": [
                "Cut PR cycle time by 35%",
                "Catch > 80% of style + test failures pre-human",
            ],
            "non_goals": [
                "Replace human reviewers",
                "Auto-approve PRs",
            ],
            "user_stories": [
                "As a developer I want lint failures flagged before "
                "I request review so I do not waste reviewer time.",
            ],
            "open_questions": [
                "How do we suppress stylistic-debate findings?",
            ],
        },
        "status": PRDStatus.REVIEW,
    },
    {
        "idea_index": 1,  # Architecture diagrams
        "version": 1,
        "content": {
            "title": "Architecture Diagram Generator PRD",
            "overview": (
                "Generates C4 architecture diagrams on demand from the "
                "live knowledge graph. Exportable to PNG / SVG / PlantUML."
            ),
            "goals": [
                "Diagrams refresh within 5 minutes of a service change",
                "Zero hand-maintained architecture diagrams",
            ],
            "non_goals": [
                "Sequence / runtime diagrams (Phase 2)",
                "Drift detection across diagram versions",
            ],
            "user_stories": [
                "As an architect I want a current C4 container view "
                "without maintaining it by hand.",
            ],
            "open_questions": [
                "Which C4 levels are required at MVP?",
            ],
        },
        "status": PRDStatus.DRAFT,
    },
]


# Three ApprovalItems — two PENDING, one APPROVED. We deliberately
# reference PRD + roadmap + arch-preview request types so every enum
# value used by the UI is exercised.
SEED_APPROVALS: list[dict] = [
    {
        "request_type": ApprovalItemType.PRD,
        "idea_index": 0,
        "subject_kind": "prd",
        "payload": {
            "summary": "Approve AI PR Review PRD v2 for the roadmap",
            "prd_version": 2,
        },
        "status": ApprovalItemStatus.PENDING,
    },
    {
        "request_type": ApprovalItemType.PUSH_TO_DELIVERY,
        "idea_index": 1,
        "subject_kind": "roadmap_item",
        "payload": {
            "summary": (
                "Promote 'Architecture diagrams' to delivery when the "
                "Q3 NOW bucket opens."
            ),
            "horizon": "next",
        },
        "status": ApprovalItemStatus.PENDING,
    },
    {
        "request_type": ApprovalItemType.ARCH_PREVIEW,
        "idea_index": 3,
        "subject_kind": "arch_preview",
        "payload": {
            "summary": (
                "Approve cost-anomaly architecture preview before "
                "implementation begins."
            ),
            "preview_version": 1,
        },
        "status": ApprovalItemStatus.APPROVED,
    },
]


# Two PushRecords — one successful Jira push for an approved idea, one
# pending push that has not been picked up yet.
SEED_PUSH_RECORDS: list[dict] = [
    {
        "idea_index": 0,
        "target": PushTarget.JIRA,
        "external_ref": "FORA-1042",
        "config": {
            "project_key": "FORA",
            "issue_type": "Story",
        },
        "status": PushStatus.SUCCESS,
    },
    {
        "idea_index": 3,
        "target": PushTarget.CONFLUENCE,
        "external_ref": None,
        "config": {
            "space_key": "ACME",
            "page_title": "Cost Anomaly Detection — RFC",
        },
        "status": PushStatus.PENDING,
    },
]


# ---------------------------------------------------------------------------
# Seed routine
# ---------------------------------------------------------------------------


def _staggered_created_at() -> datetime:
    """Return a created_at staggered across the last 30 days."""
    return datetime.now(timezone.utc) - timedelta(days=random.randint(1, 30))


async def _existing_idea_ids(session, tenant_id: UUID) -> list[UUID]:
    """Return the existing idea IDs for the tenant, in insertion order."""
    rows = (
        await session.execute(
            select(Idea).where(Idea.tenant_id == tenant_id).order_by(Idea.created_at)
        )
    ).scalars().all()
    return [row.id for row in rows]


async def _ensure_tenant_user_project(session, tenant: Tenant) -> tuple[UUID, UUID]:
    """Resolve (user_id, project_id) for the tenant.

    Falls back to tenant.id for both if the preferred record is missing
    so the seed still produces a valid (tenant-scoped) row.
    """
    user = (
        await session.execute(
            select(User).where(
                User.tenant_id == tenant.id, User.email == ACME_USER_EMAIL
            )
        )
    ).scalar_one_or_none()
    user_id = user.id if user else tenant.id

    project = (
        await session.execute(
            select(Project).where(Project.tenant_id == tenant.id).order_by(Project.created_at)
        )
    ).scalars().first()
    project_id = project.id if project else tenant.id

    return user_id, project_id


async def seed() -> None:
    """Insert ideation seed rows for the acme-corp tenant. Idempotent."""
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

        # Idempotency guard: if any idea already exists for this tenant,
        # treat the dataset as seeded and exit.
        existing_ids = await _existing_idea_ids(session, tenant.id)
        if existing_ids:
            logger.info(
                "  ↻ ideation already seeded (%d ideas) — skipping", len(existing_ids)
            )
            return

        user_id, project_id = await _ensure_tenant_user_project(session, tenant)
        logger.info(
            "actor: user_id=%s project_id=%s", user_id, project_id
        )

        # ----- Ideas -----
        idea_ids: list[UUID] = []
        for spec in SEED_IDEAS:
            idea_id = uuid4()
            session.add(
                Idea(
                    id=idea_id,
                    tenant_id=tenant.id,
                    project_id=project_id,
                    title=spec["title"],
                    description=spec["description"],
                    source=spec["source"],
                    submitted_by=user_id,
                    status=spec["status"],
                    tags=list(spec["tags"]),
                    attachments=[],
                    created_at=_staggered_created_at(),
                    updated_at=datetime.now(timezone.utc),
                )
            )
            idea_ids.append(idea_id)
            logger.info("  ✓ idea: %s [%s]", spec["title"], spec["status"].value)

        # ----- Analyses (4) -----
        for idea_id, spec in zip(idea_ids[:4], SEED_ANALYSES):
            analyzed_at = datetime.now(timezone.utc) - timedelta(days=1)
            session.add(
                IdeaAnalysis(
                    id=uuid4(),
                    tenant_id=tenant.id,
                    project_id=project_id,
                    idea_id=idea_id,
                    summary=spec["summary"],
                    problem_statement=spec["problem_statement"],
                    target_users=list(spec["target_users"]),
                    success_metrics=list(spec["success_metrics"]),
                    assumptions=list(spec["assumptions"]),
                    risks=list(spec["risks"]),
                    related_artifacts=[],
                    model_used=spec["model_used"],
                    cost_usd=spec["cost_usd"],
                    analyzed_at=analyzed_at,
                    created_at=analyzed_at,
                    updated_at=analyzed_at,
                )
            )
        logger.info("  ✓ analyses: 4")

        # ----- Scores (4) -----
        for idea_id, spec in zip(idea_ids[:4], SEED_SCORES):
            scored_at = datetime.now(timezone.utc) - timedelta(days=1)
            session.add(
                OpportunityScore(
                    id=uuid4(),
                    tenant_id=tenant.id,
                    project_id=project_id,
                    idea_id=idea_id,
                    value_score=spec["value_score"],
                    feasibility_score=spec["feasibility_score"],
                    risk_score=spec["risk_score"],
                    reach_score=spec["reach_score"],
                    total_score=spec["total_score"],
                    scoring_rationale=spec["scoring_rationale"],
                    scored_by=spec["scored_by"],
                    scored_at=scored_at,
                    created_at=scored_at,
                    updated_at=scored_at,
                )
            )
        logger.info("  ✓ scores: 4")

        # ----- Roadmap (1) + 3 items across NOW / NEXT / LATER -----
        items_json: list[dict] = []
        for spec in SEED_ROADMAP_ITEMS:
            idea_id = idea_ids[spec["idea_index"]]
            items_json.append(
                {
                    "idea_id": str(idea_id),
                    "title": spec["title"],
                    "horizon": spec["horizon"].value,
                    "effort": spec["effort"],
                    "quarter": spec["quarter"],
                    "rank": spec["rank"],
                }
            )
        roadmap = Roadmap(
            id=uuid4(),
            tenant_id=tenant.id,
            project_id=project_id,
            name="Q3 2026 — Platform Velocity",
            horizon=RoadmapHorizon.NOW,
            theme="platform-velocity",
            status=RoadmapStatus.PROPOSED,
            items=items_json,
            generated_by=user_id,
            approved_by=None,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        session.add(roadmap)
        logger.info(
            "  ✓ roadmap: %s (items: %d)", roadmap.name, len(items_json)
        )

        # ----- PRDs (2: 1 DRAFT, 1 REVIEW) -----
        for spec in SEED_PRDS:
            idea_id = idea_ids[spec["idea_index"]]
            session.add(
                PRD(
                    id=uuid4(),
                    tenant_id=tenant.id,
                    project_id=project_id,
                    idea_id=idea_id,
                    version=spec["version"],
                    content=dict(spec["content"]),
                    status=spec["status"],
                    generated_by=user_id,
                    reviewed_by=None,
                    superseded_by_id=None,
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                )
            )
        logger.info("  ✓ prds: 2")

        # ----- Approvals (3: 2 PENDING, 1 APPROVED) -----
        for spec in SEED_APPROVALS:
            idea_id = idea_ids[spec["idea_index"]]
            is_approved = spec["status"] == ApprovalItemStatus.APPROVED
            decided_at = (
                datetime.now(timezone.utc) - timedelta(hours=2)
                if is_approved
                else None
            )
            session.add(
                ApprovalItem(
                    id=uuid4(),
                    tenant_id=tenant.id,
                    project_id=project_id,
                    idea_id=idea_id,
                    request_type=spec["request_type"],
                    subject_id=None,
                    payload=dict(spec["payload"]),
                    status=spec["status"],
                    requested_by=user_id,
                    reviewer_id=None,
                    decided_by=user_id if is_approved else None,
                    decided_at=decided_at,
                    reason=(
                        "Architecture preview looks sound; approve to unblock Q4 work."
                        if is_approved
                        else None
                    ),
                    created_at=_staggered_created_at(),
                    updated_at=datetime.now(timezone.utc),
                )
            )
        logger.info("  ✓ approvals: 3")

        # ----- Push records (2) -----
        for spec in SEED_PUSH_RECORDS:
            idea_id = idea_ids[spec["idea_index"]]
            session.add(
                PushRecord(
                    id=uuid4(),
                    tenant_id=tenant.id,
                    project_id=project_id,
                    idea_id=idea_id,
                    target=spec["target"],
                    external_ref=spec["external_ref"],
                    config=dict(spec["config"]),
                    status=spec["status"],
                    actor_id=user_id,
                    error=None,
                    created_at=datetime.now(timezone.utc) - timedelta(days=2),
                    updated_at=datetime.now(timezone.utc) - timedelta(days=2),
                )
            )
        logger.info("  ✓ push records: 2")

        await session.commit()

        logger.info("")
        logger.info("✅ Seed complete!")
        logger.info("   - 6 ideas (mixed statuses)")
        logger.info("   - 4 analyses + 4 opportunity scores")
        logger.info("   - 1 roadmap with 3 items (NOW / NEXT / LATER)")
        logger.info("   - 2 PRDs (1 DRAFT, 1 REVIEW)")
        logger.info("   - 3 approvals (2 PENDING, 1 APPROVED)")
        logger.info("   - 2 push records")


if __name__ == "__main__":
    asyncio.run(seed())
