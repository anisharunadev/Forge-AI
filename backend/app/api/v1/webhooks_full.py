"""Webhook CRUD routes (Step 55).

Step-55-v2 Zone 2 — full webhook surface the Connector Center Webhooks
tab expects: list, create, test-ping, and delivery audit. Mounted on
``/webhooks`` so the existing ``/webhooks/github/pre-commit`` security
gate endpoint stays untouched (see ``app.api.v1.webhooks``).
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.db.models.webhook import (
    Webhook,
    WebhookDelivery,
    WebhookDeliveryStatus,
    WebhookStatus,
)
from app.db.session import get_session_factory
from app.schemas.webhooks import (
    WebhookCreate,
    WebhookDeliveryRead,
    WebhookRead,
    WebhookTestResult,
)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.get("", response_model=list[WebhookRead])
@audit(action="webhooks.list", target_type="webhook")
async def list_webhooks(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    direction: str | None = Query(default=None),
    _perm: AuthenticatedPrincipal = Depends(require_permission("webhooks:read")),
) -> list[WebhookRead]:
    factory = get_session_factory()
    async with factory() as session:
        stmt = select(Webhook).where(Webhook.tenant_id == str(principal.tenant_id))
        if direction in ("inbound", "outbound"):
            stmt = stmt.where(Webhook.direction == direction)
        stmt = stmt.order_by(Webhook.created_at.desc())
        rows = list((await session.execute(stmt)).scalars().all())
        return [WebhookRead.model_validate(r) for r in rows]


@require_approval_phase(SDLCPhase.IMPLEMENTATION)
@router.post("", response_model=WebhookRead, status_code=201)
@audit(action="webhooks.create", target_type="webhook")
async def create_webhook(
    body: WebhookCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("webhooks:create")),
) -> WebhookRead:
    factory = get_session_factory()
    async with factory() as session:
        hook = Webhook(
            tenant_id=str(principal.tenant_id),
            project_id=str(principal.project_id),
            name=body.name,
            direction=body.direction,
            url=body.url,
            events=body.events,
            auth_type=body.auth_type,
            auth_secret=body.auth_secret,
            status=WebhookStatus.ACTIVE,
            created_by=str(principal.user_id),
        )
        session.add(hook)
        await session.commit()
        await session.refresh(hook)
        return WebhookRead.model_validate(hook)


@require_approval_phase(SDLCPhase.IMPLEMENTATION)
@router.post("/{webhook_id}/test", response_model=WebhookTestResult)
@audit(action="webhooks.test", target_type="webhook")
async def test_webhook(
    webhook_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("webhooks:read")),
) -> WebhookTestResult:
    """Record a synthetic test delivery. The actual outbound HTTP call
    is out of scope for Step 55 — we record what would have happened so
    the Webhooks tab can show a delivery audit row.
    """
    factory = get_session_factory()
    async with factory() as session:
        hook = await session.get(Webhook, str(webhook_id))
        if hook is None or str(hook.tenant_id) != str(principal.tenant_id):
            raise HTTPException(status_code=404, detail="webhook not found")

        # Synthetic 200 OK (placeholder until outbound client lands).
        response_code = 200
        delivery = WebhookDelivery(
            tenant_id=hook.tenant_id,
            project_id=hook.project_id,
            webhook_id=hook.id,
            event="step55.test.ping",
            status=WebhookDeliveryStatus.OK,
            response_code=response_code,
            duration_ms=42,
            attempted_at=datetime.now(UTC),
            payload_preview='{"event":"step55.test.ping","nonce":"' + secrets.token_hex(8) + '"}',
        )
        session.add(delivery)

        hook.last_triggered_at = datetime.now(UTC)
        hook.last_delivery_status = "ok"
        hook.success_count_24h = (hook.success_count_24h or 0) + 1
        await session.commit()
        return WebhookTestResult(
            status=WebhookDeliveryStatus.OK,
            response_code=response_code,
            message="test ping recorded (outbound client lands in Step 56)",
        )


@router.get("/{webhook_id}/deliveries", response_model=list[WebhookDeliveryRead])
@audit(action="webhooks.deliveries.list", target_type="webhook")
async def list_webhook_deliveries(
    webhook_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    limit: int = Query(default=50, ge=1, le=500),
    _perm: AuthenticatedPrincipal = Depends(require_permission("webhooks:read")),
) -> list[WebhookDeliveryRead]:
    factory = get_session_factory()
    async with factory() as session:
        hook = await session.get(Webhook, str(webhook_id))
        if hook is None or str(hook.tenant_id) != str(principal.tenant_id):
            raise HTTPException(status_code=404, detail="webhook not found")
        stmt = (
            select(WebhookDelivery)
            .where(WebhookDelivery.webhook_id == str(webhook_id))
            .order_by(WebhookDelivery.attempted_at.desc())
            .limit(max(1, min(limit, 500)))
        )
        rows = list((await session.execute(stmt)).scalars().all())
        return [WebhookDeliveryRead.model_validate(r) for r in rows]


__all__ = ["router"]
