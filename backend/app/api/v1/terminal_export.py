"""F-415 — Terminal Export endpoints."""

from __future__ import annotations

import base64
import os
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel

from app.api.deps import Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.services.terminal.exporter import ExportFormat, session_exporter
from app.terminal.session_manager import session_manager

router = APIRouter(prefix="/terminal", tags=["terminal-export"])


ExportFormatLiteral = Literal["txt", "json", "md", "cast", "html"]


class UploadResponse(BaseModel):
    ok: bool
    url: str
    format: ExportFormatLiteral
    uploaded_at: str


class ExportHistoryItem(BaseModel):
    upload_id: str
    session_id: str
    url: str
    format: ExportFormatLiteral
    uploaded_at: str


def _coerce_format(value: str | None) -> ExportFormat:
    if value not in {"txt", "json", "md", "cast", "html"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"unsupported_format:{value}",
        )
    return value  # type: ignore[return-value]


async def _check_session(session_id: str, principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)]) -> None:
    session = await session_manager.get_session(session_id)
    if session is None or session.tenant_id != principal.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="session_not_found",
        )


@router.get(
    "/sessions/{session_id}/export",
    response_class=Response,
)
@audit(action="terminal.export", target_type="terminal_session")
async def export_session(
    session_id: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("terminal:read")),
    format: ExportFormatLiteral = Query(default="md"),
) -> Response:
    """Render the session in the requested format and return it as a file."""
    await _check_session(session_id, principal)
    fmt = _coerce_format(format)
    rendered = await session_exporter.export_session(session_id, format=fmt)
    return Response(
        content=rendered.content,
        media_type=rendered.mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{rendered.filename}"',
            "X-Audit-Chain-Length": str(len(rendered.audit_hash_chain)),
        },
    )


@router.post(
    "/sessions/{session_id}/export/upload",
    response_model=UploadResponse,
)
@audit(action="terminal.export.upload", target_type="terminal_session")
async def upload_export(
    session_id: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("terminal:read")),
    format: ExportFormatLiteral = Query(default="md"),
) -> UploadResponse:
    """Render the export and return a (mock) signed URL.

    In production this would push to S3/MinIO; the local stub
    encodes the export content into a data URL so the dashboard
    can download immediately. We register the upload in the
    exporter's history list so ``/export/history`` can list it.
    """
    await _check_session(session_id, principal)
    fmt = _coerce_format(format)
    rendered = await session_exporter.export_session(session_id, format=fmt)
    encoded = base64.b64encode(rendered.content.encode("utf-8")).decode("ascii")
    url = (
        f"data:{rendered.mime_type};base64,{encoded}"
        if len(encoded) < 1024 * 1024
        else f"https://forge-exports.local/{rendered.filename}"
    )
    session_exporter.record_upload(session_id, url, fmt)
    return UploadResponse(
        ok=True,
        url=url,
        format=fmt,
        uploaded_at=datetime.now(timezone.utc).isoformat(),
    )


@router.get(
    "/sessions/{session_id}/export/history",
    response_model=list[ExportHistoryItem],
)
@audit(action="terminal.export.history", target_type="terminal_session")
async def export_history(
    session_id: str,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("terminal:read"))
) -> list[ExportHistoryItem]:
    """List prior exports for a session."""
    await _check_session(session_id, principal)
    rows = await session_exporter.list_history(session_id)
    return [ExportHistoryItem(**row) for row in rows]


__all__ = ["router"]
