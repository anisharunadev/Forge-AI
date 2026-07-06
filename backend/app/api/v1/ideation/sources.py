"""Ideation source REST endpoints (F-260, M4-G1).

REST surface over the puller services (``services/ideation/sources/*``):

* ``GET  /api/v1/ideation/sources``             — list configured puller
  targets for the current tenant, projecting the M3 ``connectors``
  table into the ``IngestSourceRead`` shape the Sources tab consumes.
* ``POST /api/v1/ideation/sources/{id}/sync``   — kick the puller for
  one source; returns the count of freshly-persisted signals.
* ``PATCH /api/v1/ideation/sources/{id}``      — update the
  source's ``config`` JSON (channel allowlist, etc.).

Tenant scoping is enforced on every handler — the Sources tab MUST
NOT see sources belonging to other tenants. RBAC: ``ideation:read``
for GET, ``ideation:write`` for PATCH, and ``ideation:write`` for the
sync trigger (a sync writes new signal rows).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy import update as sa_update

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase
from app.api.deps import get_current_principal, require_permission
from app.core.audit import audit
from app.core.logging import get_logger
from app.core.security import AuthenticatedPrincipal
from app.db.models.connector import Connector, ConnectorType
from app.db.session import get_session_factory
from app.schemas.ideation_source import (
    IngestSourceRead,
    IngestSourceSyncRequest,
    IngestSourceUpdateRequest,
)
from app.services.ideation.sources import (
    confluence_pull,
    slack_pull,
    zendesk_pull,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/ideation/sources", tags=["ideation"])


# ---------------------------------------------------------------------------
# Mapping helpers
# ---------------------------------------------------------------------------


# Source kinds whose puller is wired up today. Adding a new source
# kind here is the single switch point that wires it into the API.
_SOURCE_KIND_TO_PULLER: dict[str, str] = {
    "confluence": "confluence",
    "slack": "slack",
    "zendesk": "zendesk",
}


def _scopes_from_config(type_str: str, config: dict[str, Any]) -> list[str]:
    """Project the connector ``config`` JSON into a scope allowlist.

    Pulled out into its own helper so the seed JSON files can use the
    exact same projection logic (see ``seeds/.../017_ideation_signals.json``).
    """
    if not isinstance(config, dict):
        return []
    if type_str == "slack":
        return _slack_scopes(config)
    if type_str == "confluence":
        space = config.get("space_key") or config.get("space")
        return [space] if isinstance(space, str) else []
    if type_str == "zendesk":
        view = config.get("view_id") or config.get("queue")
        return [view] if isinstance(view, str) else []
    # Fallback — surface the config's top-level string keys as scopes.
    return [k for k, v in config.items() if isinstance(v, (str, int, bool))]


def _slack_scopes(config: dict[str, Any]) -> list[str]:
    """Extract Slack channels from the connector config."""
    channels = config.get("channels")
    if isinstance(channels, list):
        return [str(c) for c in channels]
    single = config.get("channel")
    if isinstance(single, str):
        return [single]
    return []


def _slug_from_connector(name: str) -> str:
    """Stable human-readable slug derived from the connector name.

    Used by the Sources tab's URL routing. We don't store this in the
    DB — it's a derived field.
    """
    if not name:
        return ""
    return name.replace("acme-", "").replace("_", "-").lower()


def _to_read(connector: Connector) -> IngestSourceRead:
    """Project a Connector ORM row into IngestSourceRead."""
    type_str = connector.type.value if hasattr(connector.type, "value") else str(connector.type)
    return IngestSourceRead(
        id=connector.id,
        tenant_id=connector.tenant_id,
        project_id=connector.project_id,
        slug=_slug_from_connector(connector.name),
        type=type_str,  # type: ignore[arg-type]
        config=dict(connector.config or {}),
        last_sync_at=connector.last_sync_at,
        status=connector.status.value
        if hasattr(connector.status, "value")
        else str(connector.status),
        scopes=_scopes_from_config(type_str, dict(connector.config or {})),
        created_at=connector.created_at,
        updated_at=connector.updated_at,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=list[IngestSourceRead])
@audit(action="ideation.source.list", target_type="ideation_source")
async def list_sources(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    project_id: UUID | None = Query(default=None),
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:read")),
) -> list[IngestSourceRead]:
    """List configured puller targets for the current tenant.

    Mirrors M3's ``connectors`` table; only connector types that have
    a wired-up puller are returned (Confluence, Slack, Zendesk).
    """
    factory = get_session_factory()
    async with factory() as session:
        stmt = select(Connector).where(Connector.tenant_id == str(principal.tenant_id))
        if project_id is not None:
            stmt = stmt.where(Connector.project_id == str(project_id))
        else:
            stmt = stmt.where(Connector.project_id == str(principal.project_id))
        # Restrict to ingest-relevant connector types.
        stmt = stmt.where(
            Connector.type.in_(
                [ConnectorType.CONFLUENCE, ConnectorType.SLACK, ConnectorType.ZENDESK]
            )
        )
        stmt = stmt.order_by(Connector.created_at.desc())
        rows = list((await session.execute(stmt)).scalars().all())
    return [_to_read(c) for c in rows]


@router.post("/{source_id}/sync", response_model=dict[str, Any])
@require_approval_phase(SDLCPhase.PLANNING)
@audit(action="ideation.source.sync", target_type="ideation_source")
async def sync_source(
    source_id: UUID,
    body: IngestSourceSyncRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:write")),
) -> dict[str, Any]:
    """Trigger the configured puller for one source.

    Returns a small summary dict:

    * ``source_id`` — the connector's UUID.
    * ``kind``      — confluence / slack / zendesk.
    * ``new_signals`` — count of ``IdeaSourceSignal`` rows this call
      freshly inserted (the puller is idempotent via the
      ``(tenant_id, source, external_id)`` UNIQUE constraint so a
      re-run returns 0).
    * ``synced_at`` — UTC timestamp of the call.

    A 404 is raised when the source is unknown or out-of-tenant.
    A 400 is raised when the source's connector type has no wired-up
    puller (e.g. github, notion — those are M12 scope).
    """
    factory = get_session_factory()
    async with factory() as session:
        connector = await session.get(Connector, str(source_id))
        if connector is None:
            raise HTTPException(status_code=404, detail="source_not_found")
        if str(connector.tenant_id) != str(principal.tenant_id):
            raise HTTPException(status_code=404, detail="source_not_in_tenant")
        type_str = connector.type.value if hasattr(connector.type, "value") else str(connector.type)
        puller_kind = _SOURCE_KIND_TO_PULLER.get(type_str)
        if puller_kind is None:
            raise HTTPException(
                status_code=400,
                detail=f"no_puller_for_type:{type_str}",
            )

        since = body.since or (connector.last_sync_at or (datetime.now(UTC) - timedelta(days=14)))

        # Run the puller (idempotent). Each puller accepts the same
        # signature shape — limit + since + tenant + project.
        project_id = connector.project_id
        tenant_id = connector.tenant_id
        try:
            if puller_kind == "confluence":
                new_rows = await confluence_pull.pull(
                    tenant_id=tenant_id,
                    project_id=project_id,
                    since=since,
                    limit=body.limit,
                )
            elif puller_kind == "slack":
                new_rows = await slack_pull.pull(
                    tenant_id=tenant_id,
                    project_id=project_id,
                    since=since,
                    connector_config=dict(connector.config or {}),
                    limit_per_channel=body.limit,
                )
            else:  # zendesk
                new_rows = await zendesk_pull.pull(
                    tenant_id=tenant_id,
                    project_id=project_id,
                    since=since,
                    limit=body.limit,
                )
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "ideation.source.sync.failed",
                source_id=str(source_id),
                puller=puller_kind,
            )
            raise HTTPException(
                status_code=502,
                detail=f"puller_failed:{type(exc).__name__}",
            ) from exc

        # Update the connector's last_sync_at so the Sources tab
        # shows a fresh "last sync" timestamp.
        await session.execute(
            sa_update(Connector)
            .where(Connector.id == str(source_id))
            .values(last_sync_at=datetime.now(UTC))
        )
        await session.commit()

    return {
        "source_id": str(source_id),
        "kind": puller_kind,
        "new_signals": len(new_rows),
        "synced_at": datetime.now(UTC).isoformat(),
    }


@router.patch("/{source_id}", response_model=IngestSourceRead)
@audit(action="ideation.source.update", target_type="ideation_source")
async def update_source(
    source_id: UUID,
    body: IngestSourceUpdateRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("ideation:write")),
) -> IngestSourceRead:
    """Patch the connector's ``config`` JSON.

    Only the merge-able fields are exposed (id, type, tenant, project
    are immutable). The ``scopes`` field is re-derived from the new
    config on read so the frontend always sees a coherent shape.
    """
    factory = get_session_factory()
    async with factory() as session:
        connector = await session.get(Connector, str(source_id))
        if connector is None:
            raise HTTPException(status_code=404, detail="source_not_found")
        if str(connector.tenant_id) != str(principal.tenant_id):
            raise HTTPException(status_code=404, detail="source_not_in_tenant")
        merged_config = dict(connector.config or {})
        if body.config is not None:
            for k, v in body.config.items():
                merged_config[k] = v
        connector.config = merged_config
        await session.commit()
        await session.refresh(connector)
    return _to_read(connector)


__all__ = ["router"]
