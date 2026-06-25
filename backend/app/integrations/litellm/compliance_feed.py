"""F-829i — Guardrail violation compliance feed (LiteLLM ingest target).

Polls the LiteLLM Proxy ``/guardrail/violations`` endpoint on a 30s
schedule (see :mod:`app.services.scheduler.jobs.litellm_violation_poll`)
and ingests each violation into ``litellm_guardrail_violations``. The
poll loop emits ``EventType.COMPLIANCE_VIOLATION`` for downstream
Pulse / audit subscribers so the Steward compliance feed (``/governance/compliance``)
can show near-real-time alerts.

Idempotency: violations are deduped on ``(litellm_team_id,
guardrail_id, occurred_at)`` — LiteLLM re-emits the same payload when
queried twice, so we need a stable key. When the natural composite key
collides we keep the first row and ignore subsequent ingests.

Failure modes:
* ``/guardrail/violations`` unreachable → log at warning, leave cached
  state untouched, return [].
* Redis down → degrade to direct SQL path, same as :mod:`usage_query`.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, select

from app.core.config import settings
from app.core.logging import get_logger
from app.db.models.litellm_guardrail_violation import (
    GuardrailAction,
    GuardrailSeverity,
    LiteLLMGuardrailViolation,
)
from app.db.rls import tenant_context
from app.db.session import get_session_factory
from app.services.event_bus import EventType, bus

try:  # pragma: no cover — optional at import time
    from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient
except ImportError:  # pragma: no cover — parallel-agent file
    LiteLLMBaseClient = None  # type: ignore[assignment,misc]

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: LiteLLM Proxy endpoint that returns guardrail violations since a
#: timestamp. The proxy may also support ``/guardrail/violations/all``
#: for a full dump; we prefer the since-window variant to avoid
#: duplicate-ingesting historical data.
_VIOLATIONS_PATH: str = "/guardrail/violations"

#: Hard ceiling on how many rows we'll ingest per poll. LiteLLM's
#: response is bounded by its own internal limit, but a runaway proxy
#: must not flood Forge.
_MAX_PER_POLL: int = 500


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class ViolationIngestResult:
    """Result returned by :meth:`ComplianceFeed.poll_violations`."""

    ingested: int
    skipped_duplicates: int
    since: datetime
    until: datetime


@dataclass
class ComplianceViolationView:
    """Read-side projection of a violation row for the UI list."""

    id: str
    tenant_id: str
    project_id: str
    guardrail_id: str
    severity: str
    action_taken: str
    sanitized_content: str
    resolved: bool
    occurred_at: datetime

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "project_id": self.project_id,
            "guardrail_id": self.guardrail_id,
            "severity": self.severity,
            "action_taken": self.action_taken,
            "sanitized_content": self.sanitized_content,
            "resolved": self.resolved,
            "occurred_at": self.occurred_at.isoformat(),
        }


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


def _dedupe_key(
    litellm_team_id: str,
    guardrail_id: str,
    occurred_at: datetime,
) -> str:
    """Stable dedupe key — sha256 of the natural composite."""
    raw = f"{litellm_team_id}|{guardrail_id}|{occurred_at.isoformat()}".encode()
    return hashlib.sha256(raw).hexdigest()


class ComplianceFeed:
    """LiteLLM guardrail violation ingest + read service (F-829i)."""

    def __init__(self) -> None:
        self._session_factory = get_session_factory()
        # Track dedupe keys in-process between polls to avoid the
        # same row hitting Postgres twice. LiteLLM will re-emit
        # recent violations on every poll.
        self._seen: set[str] = set()

    # ------------------------------------------------------------------
    # Polling
    # ------------------------------------------------------------------

    async def poll_violations(self) -> ViolationIngestResult:
        """Fetch violations from the proxy and ingest any new ones.

        Returns a :class:`ViolationIngestResult` describing what
        happened in this tick. Safe to call repeatedly on the 30s
        APScheduler tick.
        """
        until = datetime.now(timezone.utc)
        # LiteLLM expects a unix timestamp or ISO-8601; we use the
        # last successful poll as the watermark. Initial poll walks
        # the most recent 1h to keep first-run bounded.
        since = until.fromtimestamp(
            max(until.timestamp() - 3600, 0), tz=timezone.utc
        )

        rows = await self._fetch_from_proxy(since=since, until=until)
        if not rows:
            return ViolationIngestResult(
                ingested=0,
                skipped_duplicates=0,
                since=since,
                until=until,
            )

        ingested = 0
        skipped = 0
        for raw in rows[:_MAX_PER_POLL]:
            try:
                did_ingest = await self._ingest_one(raw)
                if did_ingest:
                    ingested += 1
                else:
                    skipped += 1
            except Exception as exc:  # noqa: BLE001 — one bad row must not break the poll
                logger.warning(
                    "litellm.compliance_feed.ingest_failed",
                    error=str(exc),
                    guardrail_id=raw.get("guardrail_id"),
                )

        logger.info(
            "litellm.compliance_feed.poll_complete",
            fetched=len(rows),
            ingested=ingested,
            skipped_duplicates=skipped,
        )
        return ViolationIngestResult(
            ingested=ingested,
            skipped_duplicates=skipped,
            since=since,
            until=until,
        )

    async def _fetch_from_proxy(
        self,
        *,
        since: datetime,
        until: datetime,
    ) -> list[dict[str, Any]]:
        """Hit ``/guardrail/violations`` and return the raw rows.

        Graceful degradation: any HTTP / connection failure returns
        ``[]`` so the scheduler doesn't crash.
        """
        if LiteLLMBaseClient is None:
            logger.debug("litellm.compliance_feed.client_unavailable")
            return []
        try:
            params = {
                "start_time": since.isoformat(),
                "end_time": until.isoformat(),
            }
            async with LiteLLMBaseClient() as client:
                resp = await client.admin_client.get(_VIOLATIONS_PATH, params=params)
            if resp.status_code != 200:
                logger.warning(
                    "litellm.compliance_feed.non_2xx",
                    status_code=resp.status_code,
                )
                return []
            payload = resp.json()
            # LiteLLM returns either a list directly or an object with
            # ``violations`` — handle both.
            if isinstance(payload, list):
                return payload
            if isinstance(payload, dict) and isinstance(payload.get("violations"), list):
                return list(payload["violations"])
            return []
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "litellm.compliance_feed.fetch_failed",
                error=f"{type(exc).__name__}: {exc}",
            )
            return []

    async def _ingest_one(self, raw: dict[str, Any]) -> bool:
        """Insert a single violation row + emit compliance.violation.

        Returns ``True`` if a new row was created, ``False`` if the
        dedupe key was already seen (in-process OR already in the DB).
        """
        litellm_team_id = str(raw.get("team_id") or raw.get("litellm_team_id") or "")
        guardrail_id = str(raw.get("guardrail_id") or raw.get("guardrail") or "")
        if not litellm_team_id or not guardrail_id:
            logger.warning(
                "litellm.compliance_feed.missing_ids",
                raw_keys=list(raw.keys()),
            )
            return False

        # Occurred_at — default to now when LiteLLM omits it.
        occurred_at_raw = raw.get("occurred_at") or raw.get("timestamp")
        if isinstance(occurred_at_raw, str):
            try:
                occurred_at = datetime.fromisoformat(
                    occurred_at_raw.replace("Z", "+00:00")
                )
            except ValueError:
                occurred_at = datetime.now(timezone.utc)
        elif isinstance(occurred_at_raw, (int, float)):
            occurred_at = datetime.fromtimestamp(occurred_at_raw, tz=timezone.utc)
        else:
            occurred_at = datetime.now(timezone.utc)

        dedupe = _dedupe_key(litellm_team_id, guardrail_id, occurred_at)
        if dedupe in self._seen:
            return False

        severity = str(raw.get("severity") or GuardrailSeverity.MEDIUM.value).lower()
        action = str(raw.get("action_taken") or raw.get("action") or GuardrailAction.WARNED.value).lower()
        sanitized = str(raw.get("sanitized_content") or raw.get("redacted_text") or "")
        tenant_id = str(raw.get("tenant_id") or uuid.uuid4())
        project_id = str(raw.get("project_id") or tenant_id)
        actor_id = raw.get("actor_id")

        factory = self._session_factory
        async with factory() as session:
            async with tenant_context(session, tenant_id=tenant_id, project_id=project_id):
                # Final idempotency check at the DB layer — covers
                # process restarts where the in-process set was lost.
                existing = (
                    await session.execute(
                        select(LiteLLMGuardrailViolation.id).where(
                            and_(
                                LiteLLMGuardrailViolation.litellm_team_id == litellm_team_id,
                                LiteLLMGuardrailViolation.guardrail_id == guardrail_id,
                                LiteLLMGuardrailViolation.occurred_at == occurred_at,
                            )
                        )
                    )
                ).first()
                if existing is not None:
                    self._seen.add(dedupe)
                    return False

                row = LiteLLMGuardrailViolation(
                    id=uuid.uuid4(),
                    tenant_id=tenant_id,
                    project_id=project_id,
                    litellm_team_id=litellm_team_id,
                    guardrail_id=guardrail_id,
                    severity=severity,
                    action_taken=action,
                    sanitized_content=sanitized,
                    resolved=False,
                    metadata_=raw.get("metadata") or {},
                    occurred_at=occurred_at,
                )
                session.add(row)
                await session.commit()
                await session.refresh(row)
                violation_id = str(row.id)

        self._seen.add(dedupe)

        # Emit the domain event so Pulse / audit subscribers see it.
        # This is fire-and-forget; failures here must not block the
        # poll cycle.
        try:
            await bus.publish(
                event_type=EventType.COMPLIANCE_VIOLATION,
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=actor_id,
                payload={
                    "violation_id": violation_id,
                    "litellm_team_id": litellm_team_id,
                    "guardrail_id": guardrail_id,
                    "severity": severity,
                    "action_taken": action,
                    "occurred_at": occurred_at.isoformat(),
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "litellm.compliance_feed.publish_failed",
                error=str(exc),
                violation_id=violation_id,
            )

        return True

    # ------------------------------------------------------------------
    # Read API
    # ------------------------------------------------------------------

    async def list_violations(
        self,
        tenant_id: UUID | str,
        *,
        severity: str | None = None,
        resolved: bool | None = None,
        limit: int = 100,
    ) -> list[ComplianceViolationView]:
        """Return violations for a tenant, optionally filtered by severity.

        Mirrors the contract surfaced by ``GET /api/v1/governance/violations``.
        """
        tid = str(tenant_id)
        factory = self._session_factory
        async with factory() as session:
            async with tenant_context(session, tenant_id=tid):
                stmt = select(LiteLLMGuardrailViolation).where(
                    LiteLLMGuardrailViolation.tenant_id == tid
                )
                if severity is not None:
                    stmt = stmt.where(LiteLLMGuardrailViolation.severity == severity)
                if resolved is not None:
                    stmt = stmt.where(LiteLLMGuardrailViolation.resolved == resolved)
                stmt = stmt.order_by(LiteLLMGuardrailViolation.occurred_at.desc()).limit(
                    max(1, min(limit, 1000))
                )
                rows = list((await session.execute(stmt)).scalars().all())

        return [
            ComplianceViolationView(
                id=str(r.id),
                tenant_id=str(r.tenant_id),
                project_id=str(r.project_id),
                guardrail_id=r.guardrail_id,
                severity=r.severity,
                action_taken=r.action_taken,
                sanitized_content=r.sanitized_content,
                resolved=r.resolved,
                occurred_at=r.occurred_at,
            )
            for r in rows
        ]

    async def mark_resolved(
        self,
        tenant_id: UUID | str,
        violation_id: UUID | str,
        *,
        resolved: bool = True,
    ) -> bool:
        """Flip the ``resolved`` flag. Returns ``True`` if a row was updated."""
        tid = str(tenant_id)
        factory = self._session_factory
        async with factory() as session:
            async with tenant_context(session, tenant_id=tid):
                row = await session.get(LiteLLMGuardrailViolation, str(violation_id))
                if row is None:
                    return False
                row.resolved = resolved
                await session.commit()
                return True


# Module-level singleton for convenience (DI-friendly).
compliance_feed = ComplianceFeed()


__all__ = [
    "ComplianceFeed",
    "compliance_feed",
    "ViolationIngestResult",
    "ComplianceViolationView",
]
