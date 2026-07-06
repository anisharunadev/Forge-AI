"""Forge Command dispatch — canonical entry point for ``forge-*`` commands.

This module is the single on-demand dispatch surface for every
``forge-*`` command. It closes the gap the Command Center's
``useForgeCommands().run()`` hook has historically stubbed with
``"Backend unreachable — simulated success"``.

The workflow executor (``app/services/workflow_executor.py``) reuses
the same :func:`route_to_gsd` surface for ``command`` nodes so there is
one canonical dispatch path.

Rule 1 (provider-agnostic) — never imports a provider SDK.
Rule 2 (multi-tenancy) — passes ``tenant_id`` + ``project_id`` to
``route_to_gsd`` so audit / cost rows scope correctly.
Rule 6 (auditability) — every call emits a ``COMMAND_RUN`` event.
"""

from __future__ import annotations

import hashlib
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import DbSession, get_current_principal, require_permission
from app.core.audit import audit
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.services.event_bus import EventType, bus
from app.services.forge_commands import (
    UnknownForgeCommand,
    get_forge_command,
    route_to_gsd,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/commands", tags=["commands"])


class CommandRunRequest(BaseModel):
    """Body for ``POST /api/v1/commands/{name}/run``."""

    model_config = ConfigDict(extra="forbid")

    args: dict[str, Any] = Field(default_factory=dict)


class CommandRunResponse(BaseModel):
    """Typed envelope — Rule 4 (typed artifacts)."""

    name: str
    tenant_id: UUID
    project_id: UUID
    output: Any


@require_approval_phase(SDLCPhase.IMPLEMENTATION)
@router.post("/{name}/run", response_model=CommandRunResponse)
@audit(action="command.run", target_type="command")
async def run_command(
    name: str,
    body: CommandRunRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("commands:run")),
    db: DbSession = None,  # type: ignore[assignment]
) -> CommandRunResponse:
    """Dispatch a single ``forge-*`` command.

    Body is ``{"args": {...}}``. The dispatcher's output is returned
    verbatim (after JSON-serialization). Raises 404 if the command is
    not registered in :data:`FORGE_COMMAND_MAP`.
    """
    try:
        cmd = get_forge_command(name)
    except UnknownForgeCommand as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    enriched_args = {
        **body.args,
        "_tenant_id": str(principal.tenant_id),
        "_project_id": str(principal.project_id),
        "_actor_id": str(principal.user_id),
    }

    try:
        output = await __import__("asyncio").to_thread(
            route_to_gsd, cmd.internal_cmd, enriched_args
        )
    except Exception as exc:  # noqa: BLE001 — surface typed failure
        logger.error("command.run_failed", name=name, error=str(exc))
        raise HTTPException(
            status_code=500,
            detail={"error": "command_failed", "command": name, "message": str(exc)},
        ) from exc

    await bus.publish(
        EventType.COMMAND_RUN,
        {"command": name, "ok": True},
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        actor_id=principal.user_id,
    )

    return CommandRunResponse(
        name=name,
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        output=output,
    )


# ---------------------------------------------------------------------------
# SKILL.md artifact read/write — Command Center "View" + inline edit.
#
# Path is locked to packages/forge-core/skills/forge-<name>/SKILL.md inside
# the repo to prevent directory traversal. The FORGE_CORE_ROOT env var lets
# tests point at a temp dir.
# ---------------------------------------------------------------------------

FORGE_CORE_ROOT = Path(
    os.environ.get(
        "FORGE_CORE_ROOT",
        str(Path(__file__).resolve().parents[4] / "packages" / "forge-core"),
    )
)


def _skill_path(name: str) -> Path:
    """Resolve and validate the SKILL.md path for a forge-* command."""
    if not name.startswith("forge-"):
        raise HTTPException(status_code=400, detail="command name must start with forge-")
    safe = name[len("forge-") :].strip("/")
    if not safe or "/" in safe or ".." in safe or not all(c.isalnum() or c in "-_" for c in safe):
        raise HTTPException(status_code=400, detail="invalid command name")
    candidate = (FORGE_CORE_ROOT / "skills" / name / "SKILL.md").resolve()
    root = FORGE_CORE_ROOT.resolve()
    if not str(candidate).startswith(str(root)):
        raise HTTPException(status_code=400, detail="path traversal blocked")
    return candidate


class CommandArtifact(BaseModel):
    command: str
    path: str
    content: str
    lastModified: str
    etag: str


class CommandArtifactUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(..., min_length=0, max_length=2_000_000)


@router.get("/{name}/artifact", response_model=CommandArtifact)
async def get_command_artifact(
    name: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("commands:read")),
) -> CommandArtifact:
    """Read the SKILL.md for a forge-* command.

    Used by the Command Center's View dialog. Returns 404 if the skill
    file does not exist (some commands are registered but have no skill
    doc — that's fine).
    """
    path = _skill_path(name)
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"no skill file at {path}")
    content = path.read_text(encoding="utf-8")
    stat = path.stat()
    etag = hashlib.sha1(content.encode("utf-8")).hexdigest()
    return CommandArtifact(
        command=name,
        path=str(path.relative_to(FORGE_CORE_ROOT)),
        content=content,
        lastModified=datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
        etag=etag,
    )


@require_approval_phase(SDLCPhase.IMPLEMENTATION)
@router.put("/{name}/artifact", response_model=CommandArtifact)
@audit(action="command.artifact.write", target_type="command")
async def put_command_artifact(
    name: str,
    body: CommandArtifactUpdate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    if_match: str | None = Header(default=None, alias="If-Match"),
    _perm: AuthenticatedPrincipal = Depends(require_permission("commands:write")),
) -> CommandArtifact:
    """Write the SKILL.md for a forge-* command.

    Used by the Command Center's inline editor. Honors ``If-Match`` for
    optimistic concurrency — returns 412 if the etag doesn't match the
    current file content.
    """
    path = _skill_path(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    if if_match is not None and path.is_file():
        current = path.read_text(encoding="utf-8")
        current_etag = hashlib.sha1(current.encode("utf-8")).hexdigest()
        if current_etag != if_match:
            raise HTTPException(
                status_code=412,
                detail={
                    "error": "etag_mismatch",
                    "expected": if_match,
                    "actual": current_etag,
                },
            )
    path.write_text(body.content, encoding="utf-8")
    stat = path.stat()
    new_etag = hashlib.sha1(body.content.encode("utf-8")).hexdigest()
    logger.info(
        "command.artifact_written",
        command=name,
        bytes=len(body.content),
        actor=str(principal.user_id),
    )
    return CommandArtifact(
        command=name,
        path=str(path.relative_to(FORGE_CORE_ROOT)),
        content=body.content,
        lastModified=datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
        etag=new_etag,
    )


# ---------------------------------------------------------------------------
# Per-command run history (for the View History drawer).
#
# Pulled from the GSDWrapper audit log for now; Phase 5-02 will move this
# to the persistent runs table once it ships.
# ---------------------------------------------------------------------------


@router.get("/{name}/runs")
async def get_command_runs(
    name: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    limit: int = 50,
    _perm: AuthenticatedPrincipal = Depends(require_permission("commands:read")),
) -> list[dict[str, Any]]:
    """Return recent run records for a single command."""
    try:
        from app.agents.tools.gsd_wrapper import GSDWrapper
    except Exception:  # pragma: no cover — dev environments
        return []

    try:
        wrapper = GSDWrapper.get_default()
    except Exception:
        wrapper = None

    if wrapper is None:
        return []

    records = [
        r
        for r in wrapper.audit_log
        if r.forge_cmd == name and str(r.tenant_id) == str(principal.tenant_id)
    ]
    records.sort(key=lambda r: r.timestamp, reverse=True)
    return [
        {
            "id": str(r.execution_id),
            "command": r.forge_cmd,
            "status": "succeeded" if r.ok else "failed",
            "startedAt": r.timestamp.isoformat()
            if hasattr(r.timestamp, "isoformat")
            else str(r.timestamp),
            "finishedAt": r.timestamp.isoformat()
            if hasattr(r.timestamp, "isoformat")
            else str(r.timestamp),
            "durationMs": None,
            "error": r.error,
            "message": None,
        }
        for r in records[:limit]
    ]


__all__ = ["router"]
