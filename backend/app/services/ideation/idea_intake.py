"""Idea Intake service (F-201).

Handles the validation, persistence, and lightweight enrichment of raw
ideas submitted through the Ideation Center. Calls into LiteLLM for
entity extraction when a model is reachable, and falls back to a
deterministic regex-based extractor in offline mode so tests and dev
servers without a LiteLLM proxy still work.

Multi-tenant by construction: every public method requires tenant_id
and project_id. Attachments are stored as JSON metadata (URL refs,
artifact ids) rather than binary blobs — binary ingestion belongs in
the artifact registry, not here.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.ideation import Idea, IdeaSource, IdeaStatus
from app.db.session import get_session_factory
from app.schemas.ideation import EntityExtraction, IdeaCreate, IdeaUpdate
from app.services.event_bus import EventType, bus as default_bus
from app.services.litellm_client import LiteLLMClient

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


@dataclass
class ValidationResult:
    """Outcome of `validate_idea`."""

    valid: bool
    errors: list[str] = field(default_factory=list)


_TITLE_MIN = 3
_TITLE_MAX = 256
_DESCRIPTION_MIN = 10
_DESCRIPTION_MAX = 20_000
_TAG_MAX = 32
_TAG_LEN_MAX = 64
_ATTACHMENT_MAX = 64


def validate_idea(payload: IdeaCreate | dict[str, Any]) -> ValidationResult:
    """Lightweight structural validation.

    Reuses the same limits enforced by the Pydantic schema; the second
    pass here is for programmatic callers that bypass the schema.
    """
    data: dict[str, Any]
    if isinstance(payload, IdeaCreate):
        data = payload.model_dump()
    else:
        data = dict(payload)

    errors: list[str] = []

    title = (data.get("title") or "").strip()
    if not title:
        errors.append("title_required")
    elif len(title) < _TITLE_MIN:
        errors.append(f"title_too_short:min={_TITLE_MIN}")
    elif len(title) > _TITLE_MAX:
        errors.append(f"title_too_long:max={_TITLE_MAX}")

    description = (data.get("description") or "").strip()
    if not description:
        errors.append("description_required")
    elif len(description) < _DESCRIPTION_MIN:
        errors.append(f"description_too_short:min={_DESCRIPTION_MIN}")
    elif len(description) > _DESCRIPTION_MAX:
        errors.append(f"description_too_long:max={_DESCRIPTION_MAX}")

    tags = data.get("tags") or []
    if not isinstance(tags, list):
        errors.append("tags_must_be_list")
    elif len(tags) > _TAG_MAX:
        errors.append(f"too_many_tags:max={_TAG_MAX}")
    else:
        for tag in tags:
            if not isinstance(tag, str) or len(tag) > _TAG_LEN_MAX:
                errors.append("invalid_tag")
                break

    attachments = data.get("attachments") or []
    if not isinstance(attachments, list):
        errors.append("attachments_must_be_list")
    elif len(attachments) > _ATTACHMENT_MAX:
        errors.append(f"too_many_attachments:max={_ATTACHMENT_MAX}")

    return ValidationResult(valid=not errors, errors=errors)


# ---------------------------------------------------------------------------
# NER — lightweight extractor (LiteLLM NER + deterministic fallback)
# ---------------------------------------------------------------------------


_NER_PROMPT = (
    "Extract named entities from the following text. Return JSON with "
    "keys: people (list[str]), products (list[str]), metrics (list[str]), "
    "dates (list[str]), technologies (list[str]). Return only the JSON, "
    "no commentary."
)


async def _ner_via_litellm(
    text: str,
    *,
    tenant_id: UUID | str,
    project_id: UUID | str | None,
    actor_id: UUID | str | None,
) -> EntityExtraction | None:
    try:
        async with LiteLLMClient() as client:
            response = await client.chat(
                [
                    {"role": "system", "content": _NER_PROMPT},
                    {"role": "user", "content": text},
                ],
                response_format={"type": "json_object"},
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=actor_id,
            )
    except Exception as exc:  # noqa: BLE001 — offline path
        logger.warning("ideation.ner_unavailable", error=str(exc))
        return None

    try:
        content = response["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return None
    try:
        import json as _json

        data = _json.loads(content)
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(data, dict):
        return None
    return EntityExtraction(
        people=[str(x) for x in data.get("people") or []],
        products=[str(x) for x in data.get("products") or []],
        metrics=[str(x) for x in data.get("metrics") or []],
        dates=[str(x) for x in data.get("dates") or []],
        technologies=[str(x) for x in data.get("technologies") or []],
    )


_TECH_KEYWORDS = {
    "python", "fastapi", "pydantic", "react", "typescript", "rust",
    "go", "kubernetes", "docker", "postgres", "redis", "kafka",
    "graphql", "grpc", "aws", "azure", "gcp", "terraform", "helm",
    "openai", "anthropic", "claude", "litellm", "nextjs", "node",
    "java", "kotlin", "swift", "spark", "airflow", "dbt",
}
_METRIC_RE = re.compile(
    r"\b\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?(?:ms|s|sec|seconds|minutes|hrs|hours|days|users|requests|rps|qps|MB|GB|KB)\b",
    flags=re.IGNORECASE,
)
_DATE_RE = re.compile(
    r"\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{2,4}|Q[1-4]\s?\d{4}|FY\d{2,4})\b"
)


def _deterministic_entities(text: str) -> EntityExtraction:
    """Regex-based fallback when LiteLLM is unreachable."""
    lower = text.lower()
    techs = sorted({kw for kw in _TECH_KEYWORDS if kw in lower})
    metrics = sorted(set(_METRIC_RE.findall(text)))
    dates = sorted(set(_DATE_RE.findall(text)))
    return EntityExtraction(
        people=[],
        products=[],
        metrics=metrics,
        dates=dates,
        technologies=techs,
    )


async def extract_entities(
    text: str,
    *,
    tenant_id: UUID | str | None = None,
    project_id: UUID | str | None = None,
    actor_id: UUID | str | None = None,
) -> EntityExtraction:
    """Return structured entities. Tries LiteLLM, falls back to regex."""
    if not text or not text.strip():
        return EntityExtraction()
    if tenant_id is not None:
        ner = await _ner_via_litellm(
            text,
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        if ner is not None:
            return ner
    return _deterministic_entities(text)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class IdeaIntakeService:
    """Tenant-scoped CRUD + entity extraction for ideas."""

    def __init__(self, bus: Any | None = None) -> None:
        self._bus = bus or default_bus

    async def submit_idea(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        payload: IdeaCreate | dict[str, Any],
        actor_id: UUID | str,
    ) -> Idea:
        """Validate, enrich with NER tags, persist, and publish event."""
        data = payload.model_dump() if isinstance(payload, IdeaCreate) else dict(payload)
        result = validate_idea(data)
        if not result.valid:
            raise ValueError(f"invalid_idea:{'|'.join(result.errors)}")

        title = (data.get("title") or "").strip()
        description = (data.get("description") or "").strip()
        source_raw = data.get("source") or IdeaSource.USER.value
        try:
            source = IdeaSource(source_raw)
        except ValueError:
            source = IdeaSource.USER

        tags = list(data.get("tags") or [])
        # Enrich with deterministic entity extraction at minimum.
        try:
            entities = await extract_entities(
                f"{title}\n\n{description}",
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=actor_id,
            )
            for tech in entities.technologies:
                if tech not in tags:
                    tags.append(tech)
        except Exception as exc:  # noqa: BLE001
            logger.warning("ideation.entity_enrich_failed", error=str(exc))

        attachments = list(data.get("attachments") or [])

        factory = get_session_factory()
        async with factory() as session:
            idea = Idea(
                tenant_id=str(tenant_id),
                project_id=str(project_id),
                title=title,
                description=description,
                source=source,
                submitted_by=str(actor_id),
                status=IdeaStatus.NEW,
                tags=tags,
                attachments=attachments,
            )
            session.add(idea)
            await session.commit()
            await session.refresh(idea)

        await self._bus.publish(
            EventType.ARTIFACT_CREATED,
            {
                "domain": "ideation",
                "kind": "idea",
                "idea_id": str(idea.id),
                "title": idea.title,
                "source": idea.source.value if hasattr(idea.source, "value") else str(idea.source),
            },
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=actor_id,
        )
        logger.info(
            "ideation.idea_submitted",
            idea_id=str(idea.id),
            tenant_id=str(tenant_id),
            project_id=str(project_id),
            tags_count=len(tags),
        )
        return idea

    async def list_ideas(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str | None = None,
        status: str | None = None,
        tag: str | None = None,
        limit: int = 100,
    ) -> list[Idea]:
        """Filterable list. Returns most recent first."""
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(Idea).where(Idea.tenant_id == str(tenant_id))
            if project_id is not None:
                stmt = stmt.where(Idea.project_id == str(project_id))
            if status is not None:
                try:
                    stmt = stmt.where(Idea.status == IdeaStatus(status))
                except ValueError:
                    stmt = stmt.where(Idea.status == IdeaStatus(status))
            stmt = stmt.order_by(Idea.created_at.desc()).limit(max(1, min(limit, 500)))
            rows = list((await session.execute(stmt)).scalars().all())

        if tag is not None:
            needle = tag.lower()
            rows = [r for r in rows if any(needle == t.lower() for t in (r.tags or []))]
        return rows

    async def get_idea(self, idea_id: UUID | str, *, tenant_id: UUID | str) -> Idea:
        factory = get_session_factory()
        async with factory() as session:
            idea = await session.get(Idea, str(idea_id))
            if idea is None:
                raise LookupError(f"idea {idea_id} not found")
            if str(idea.tenant_id) != str(tenant_id):
                raise PermissionError("idea_not_in_tenant")
            return idea

    async def update_idea(
        self,
        idea_id: UUID | str,
        body: IdeaUpdate,
        *,
        tenant_id: UUID | str,
        actor_id: UUID | str | None = None,
    ) -> Idea:
        factory = get_session_factory()
        async with factory() as session:
            idea = await session.get(Idea, str(idea_id))
            if idea is None:
                raise LookupError(f"idea {idea_id} not found")
            if str(idea.tenant_id) != str(tenant_id):
                raise PermissionError("idea_not_in_tenant")
            data = body.model_dump(exclude_unset=True)
            for field_name in ("title", "description", "tags", "attachments"):
                if field_name in data and data[field_name] is not None:
                    setattr(idea, field_name, data[field_name])
            if "status" in data and data["status"] is not None:
                try:
                    idea.status = IdeaStatus(data["status"])
                except ValueError:
                    pass
            await session.commit()
            await session.refresh(idea)

        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {"kind": "idea", "idea_id": str(idea.id), "fields": list(data.keys())},
            tenant_id=tenant_id,
            project_id=idea.project_id,
            actor_id=actor_id,
        )
        return idea

    async def archive_idea(
        self,
        idea_id: UUID | str,
        *,
        tenant_id: UUID | str,
        actor_id: UUID | str | None = None,
    ) -> Idea:
        factory = get_session_factory()
        async with factory() as session:
            idea = await session.get(Idea, str(idea_id))
            if idea is None:
                raise LookupError(f"idea {idea_id} not found")
            if str(idea.tenant_id) != str(tenant_id):
                raise PermissionError("idea_not_in_tenant")
            idea.status = IdeaStatus.ARCHIVED
            await session.commit()
            await session.refresh(idea)
        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {"kind": "idea", "idea_id": str(idea.id), "transition": "archived"},
            tenant_id=tenant_id,
            project_id=idea.project_id,
            actor_id=actor_id,
        )
        return idea

    async def attach_artifact(
        self,
        idea_id: UUID | str,
        artifact_id: UUID | str,
        *,
        tenant_id: UUID | str,
        actor_id: UUID | str | None = None,
    ) -> Idea:
        """Link an existing Artifact to an Idea (idempotent)."""
        factory = get_session_factory()
        async with factory() as session:
            idea = await session.get(Idea, str(idea_id))
            if idea is None:
                raise LookupError(f"idea {idea_id} not found")
            if str(idea.tenant_id) != str(tenant_id):
                raise PermissionError("idea_not_in_tenant")
            attachments = list(idea.attachments or [])
            if not any(a.get("artifact_id") == str(artifact_id) for a in attachments):
                attachments.append(
                    {
                        "artifact_id": str(artifact_id),
                        "attached_at": datetime.now(timezone.utc).isoformat(),
                        "attached_by": str(actor_id) if actor_id else None,
                    }
                )
                idea.attachments = attachments
            await session.commit()
            await session.refresh(idea)
        await self._bus.publish(
            EventType.ARTIFACT_UPDATED,
            {"kind": "idea", "idea_id": str(idea.id), "attached_artifact": str(artifact_id)},
            tenant_id=tenant_id,
            project_id=idea.project_id,
            actor_id=actor_id,
        )
        return idea


idea_intake_service = IdeaIntakeService()


__all__ = [
    "IdeaIntakeService",
    "ValidationResult",
    "extract_entities",
    "idea_intake_service",
    "validate_idea",
]
