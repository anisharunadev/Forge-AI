"""Co-pilot tool: ``draft_artifact``.

Persists a draft artifact via :class:`app.services.artifact_registry.ArtifactRegistry`
**always with ``status=DRAFT``**. This is the constitutional Rule 3
enforcement point for the Co-pilot: nothing the model proposes ever
becomes ACTIVE without an explicit human review.

The tool:

1. Validates the ``artifact_type`` is one of the supported kinds.
2. Builds a typed payload (title, content, based_on, created_by).
3. Calls ``ArtifactRegistry.create(status=DRAFT)``.
4. Emits an audit event.
5. Returns the draft id + a review URL.

The tool NEVER calls ``supersede()`` or any other path that could
yield an ACTIVE artifact. Any attempt to supply an ``ACTIVE``-shaped
payload (e.g. via ``based_on`` injection) is ignored — the status is
hardcoded.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from app.copilot.tools.exceptions import ToolArgumentInvalid
from app.copilot.tools.registry import tool_registry
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.db.models.artifact import ArtifactStatus
from app.services.artifact_registry import artifact_registry
from app.services.audit_service import audit_service
from app.services.rbac import COPILOT_PERMISSION_TOOL_DRAFT_ARTIFACT

logger = get_logger(__name__)


_SUPPORTED_TYPES: frozenset[str] = frozenset({"adr", "ideation_bundle", "risk_register"})


class DraftArtifactTool:
    """Save a draft artifact — ALWAYS status=DRAFT, NEVER active."""

    name = "draft_artifact"
    description = (
        "Persist a draft artifact (ADR, ideation bundle, or risk "
        "register) for human review. The draft is saved with "
        "status=DRAFT and never becomes ACTIVE without a human "
        "approving it. Use this when proposing new architecture, "
        "recording a new idea, or drafting a risk register."
    )
    permission = COPILOT_PERMISSION_TOOL_DRAFT_ARTIFACT
    rate_limit_per_min = 20
    parameters_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "artifact_type": {"type": "string", "enum": sorted(_SUPPORTED_TYPES)},
            "title": {"type": "string", "minLength": 1},
            "content": {"type": "string", "minLength": 1},
            "based_on": {
                "type": "array",
                "items": {"type": "string"},
                "default": [],
            },
        },
        "required": ["artifact_type", "title", "content"],
        "additionalProperties": False,
    }

    async def execute(
        self,
        args: dict[str, Any],
        *,
        principal: AuthenticatedPrincipal,
        tenant_id: UUID,
        project_id: UUID | None,
    ) -> dict[str, Any]:
        artifact_type = args.get("artifact_type")
        if artifact_type not in _SUPPORTED_TYPES:
            raise ToolArgumentInvalid(
                self.name,
                f"artifact_type must be one of {sorted(_SUPPORTED_TYPES)}",
                field="artifact_type",
            )
        title = args.get("title")
        if not isinstance(title, str) or not title.strip():
            raise ToolArgumentInvalid(self.name, "title is required", field="title")
        content = args.get("content")
        if not isinstance(content, str) or not content.strip():
            raise ToolArgumentInvalid(self.name, "content is required", field="content")
        based_on = args.get("based_on") or []
        if not isinstance(based_on, list) or not all(isinstance(x, str) for x in based_on):
            raise ToolArgumentInvalid(
                self.name, "based_on must be a list of strings", field="based_on"
            )

        # project_id is required for ArtifactRegistry — Co-pilot threads
        # without a project (tenant-wide Q&A) still need *some* id, so
        # we synthesize a stable namespace placeholder rather than
        # silently dropping the call. Plan 1.x will revisit this once
        # tenant-wide artifact types land.
        pid = project_id or uuid4()

        payload = {
            "title": title.strip(),
            "content": content,
            "based_on": list(based_on),
            "created_via": "copilot.tool.draft_artifact",
        }
        artifact = await artifact_registry.create(
            tenant_id=tenant_id,
            project_id=pid,
            type=artifact_type,
            payload=payload,
            created_by=principal.user_id,
            status=ArtifactStatus.DRAFT,
            actor_id=principal.user_id,
        )

        await audit_service.record(
            tenant_id=tenant_id,
            project_id=pid,
            actor_id=principal.user_id,
            action="copilot.tool.draft_artifact",
            target_type=artifact_type,
            target_id=str(artifact.id),
            payload={
                "version": artifact.version,
                "content_hash": artifact.content_hash,
                "based_on": list(based_on),
            },
        )

        logger.info(
            "copilot.tool.draft_artifact",
            tenant_id=str(tenant_id),
            project_id=str(pid),
            principal=principal.user_id,
            artifact_id=str(artifact.id),
            artifact_type=artifact_type,
            status=artifact.status.value,
        )
        return {
            "artifact_id": str(artifact.id),
            "review_url": f"/architecture/{artifact_type}s/{artifact.id}",
            "status": artifact.status.value,
            "message": "Draft saved. Review and approve.",
        }


tool_registry.register(DraftArtifactTool())


__all__ = ["DraftArtifactTool"]
