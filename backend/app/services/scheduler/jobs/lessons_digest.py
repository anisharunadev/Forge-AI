"""Monthly Steward digest job (F-002-LESSON / Step-64 Sub-step B).

Runs once a month (1st, 08:00 UTC by default). Iterates every tenant
and builds a :class:`MonthlyDigest` for the steward's inbox. The
digest itself is just structured data — delivery (email / Slack)
lives in Sub-step C.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.tenant import Tenant
from app.db.session import get_session_factory
from app.services.lesson_service import LessonService

logger = get_logger(__name__)


async def monthly_lessons_digest() -> None:
    """Scheduler entry — iterates tenants, builds + persists the digest."""
    factory = get_session_factory()
    async with factory() as session:
        tenants = list((await session.execute(select(Tenant))).scalars().all())

    svc = LessonService(session_factory=factory)
    for tenant in tenants:
        try:
            async with factory() as session:
                digest = await svc.build_monthly_digest(
                    session, tenant_id=tenant.id
                )
            logger.info(
                "lessons.digest.built",
                tenant_id=str(tenant.id),
                pending=digest.pending_count if hasattr(digest, "pending_count") else len(digest.pending),
                approved=digest.approved_count if hasattr(digest, "approved_count") else len(digest.approved),
                rejected=digest.rejected_count if hasattr(digest, "rejected_count") else len(digest.rejected),
                auto_promote=digest.auto_promotable_skill,
                payload_preview=json.dumps(
                    digest.by_source, default=str
                )[:200],
                occurred_at=datetime.now(timezone.utc).isoformat(),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "lessons.digest.failed",
                tenant_id=str(tenant.id),
                error=str(exc),
            )


__all__ = ["monthly_lessons_digest"]
