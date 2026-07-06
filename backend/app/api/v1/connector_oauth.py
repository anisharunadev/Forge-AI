"""Connector OAuth install flow (M3 — Gaps M3-G3 / M3-G4).

Routes
------

- ``POST /connectors/oauth/start``     M3-G3  RBAC ``connector:install``
- ``POST /connectors/oauth/callback``  M3-G4  RBAC ``connector:install``

The OAuth pair lives on its own router for two reasons:

1. The Connector Center frontend treats ``oauth/start`` and
   ``oauth/callback`` as a single flow (browser-redirect based) while
   the synchronous ``POST /connectors/install`` is a separate JSON-only
   path.
2. The shared-state token plumbing (``OAuthStateStore``) is imported
   once here rather than spread across the lifecycle router.

The dev-mode shortcut (``code=demo`` round-trip) is gated on
``Settings.environment == "development"`` so it cannot leak into
production by accident — production callers receive 501 until M13
wires up a real provider.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.db.session import get_session_factory
from app.schemas.connectors import ConnectorRead
from app.services.connector_manager import connector_manager
from app.services.connectors.lifecycle import connector_lifecycle
from app.services.connectors.oauth_state import oauth_state_store
from app.services.marketplace import marketplace as marketplace_service

router = APIRouter(prefix="/connectors", tags=["connectors"])


@require_approval_phase(SDLCPhase.REVIEW)
@router.post("/oauth/start")
async def oauth_start(
    body: dict,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("connector:install")),
) -> dict:
    """M3-G3 — Start an OAuth install for a marketplace slug.

    In ``development`` mode (the demo env) we mint an anti-CSRF state
    token via :class:`OAuthStateStore` and return a deterministic
    callback URL that round-trips through the dev-mode shortcut at
    :func:`oauth_callback`. In production this returns 501 —
    real-provider wiring is M13.
    """
    from app.core.config import settings

    slug = str(body.get("slug") or "").strip()
    redirect_uri = str(body.get("redirect_uri") or "").strip()
    if not slug:
        raise HTTPException(status_code=400, detail="slug is required")
    if not redirect_uri:
        raise HTTPException(status_code=400, detail="redirect_uri is required")

    if settings.environment != "development":
        # Real providers (M13) will plug in here.
        raise HTTPException(
            status_code=501,
            detail=(
                "OAuth start in production requires a real provider. "
                "M3 ships a development-only shortcut."
            ),
        )

    state = oauth_state_store.mint(slug)
    authorization_url = f"{redirect_uri}?code=demo&state={state}&slug={slug}"
    return {"authorization_url": authorization_url, "state": state}


@router.post("/oauth/callback", response_model=ConnectorRead)
@audit(action="connector.install", target_type="connector")
async def oauth_callback(
    body: dict,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("connector:install")),
) -> ConnectorRead:
    """M3-G4 — Complete an OAuth install.

    Only the dev-mode ``code=demo`` shortcut is implemented; production
    OAuth is M13. The flow:

    1. Consume the state token via :class:`OAuthStateStore`. A missing
       or replayed state returns ``None``; we surface 400 so the UI
       can prompt the user to restart the flow.
    2. Resolve the slug → ``ConnectorType`` via the marketplace
       catalog (also the source of truth for ``config_schema``).
    3. Run the install via :class:`ConnectorLifecycle.install` (same
       happy path as ``POST /connectors/install``) and stamp an
       ``install`` activity row so the Activity tab can mark the
       OAuth-install events distinctly.
    """
    from app.db.models.connector import ConnectorType
    from app.db.models.connector_credential import (
        ConnectorCredential,
        CredentialType,
    )

    code = str(body.get("code") or "").strip()
    state = str(body.get("state") or "").strip()
    slug = str(body.get("slug") or "").strip()

    if not code or not state or not slug:
        raise HTTPException(
            status_code=400,
            detail="code, state, slug are all required",
        )

    slug_from_state = oauth_state_store.consume(state)
    if slug_from_state is None:
        # Stale or replayed — the start/callback handshake didn't
        # round-trip cleanly. The UI should restart the flow.
        raise HTTPException(
            status_code=400,
            detail="invalid or expired state token",
        )
    if slug_from_state != slug:
        # Defence-in-depth: state token and slug must agree. If a
        # caller swaps one out we treat the request as a replay.
        raise HTTPException(
            status_code=400,
            detail="state/slug mismatch",
        )

    if code != "demo":
        # Real provider exchange is M13; today we only support dev mode.
        raise HTTPException(
            status_code=501,
            detail="only code=demo (dev mode) is supported in M3",
        )

    try:
        entry = await marketplace_service.get_details(slug)
        connector_type = ConnectorType(entry.type)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    config = {
        "slug": slug,
        "oauth": {"code": code, "state": state},
        "is_demo": True,
    }

    # principal.project_id may legitimately be None for an unscoped
    # token; in that case the install endpoint rejects the call
    # upstream of here.
    if not principal.project_id:
        raise HTTPException(
            status_code=400,
            detail="project_id is required for OAuth install",
        )

    connector = await connector_lifecycle.install(
        tenant_id=principal.tenant_id,
        project_id=principal.project_id,
        connector_type=connector_type,
        name=str(entry.name),
        config=config,
        actor_id=principal.user_id,
    )

    # Stamp the OAuth credential alongside the connector so the
    # Credentials tab shows it immediately. Real OAuth will store the
    # encrypted access/refresh tokens; dev-mode writes a placeholder
    # so the row count + audit chain stay consistent.
    factory = get_session_factory()
    async with factory() as session:
        session.add(
            ConnectorCredential(
                tenant_id=str(principal.tenant_id),
                project_id=str(connector.project_id),
                connector_id=connector.id,
                name=f"{entry.name} OAuth Token (dev mode)",
                type=CredentialType.OAUTH_TOKEN,
                scope="project",
                preview=f"dev-mode-{slug}",
                encrypted_secret=b"step55-placeholder",
                meta={"dev_mode": True, "slug": slug},
                last_rotated_at=datetime.now(UTC),
                created_by=str(principal.user_id),
            )
        )
        await session.commit()

    # Append an activity row with event_type=install so the Activity
    # tab can render the lifecycle event distinctly from rotate/disconnect.
    await connector_manager.record_activity(
        tenant_id=principal.tenant_id,
        project_id=connector.project_id,
        connector_id=connector.id,
        event_type="install",
        status="success",
        actor_id=principal.user_id,
        event_metadata={"slug": slug, "source": "oauth_callback"},
    )

    return ConnectorRead.model_validate(connector)


__all__ = ["router"]
