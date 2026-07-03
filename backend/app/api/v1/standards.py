"""Standards — combines LiteLLM guardrails with manual attestations.

Two categories of standards are surfaced here:

1. **LLM safety standards** (PII masking, content moderation, prompt
   injection detection, secret detection, ...) — these are
   **LiteLLM guardrails** configured at the proxy. The canonical
   source of truth lives in LiteLLM; we proxy through
   ``list_guardrails()`` and re-shape the payload into
   ``StandardRead`` with ``category='llm_safety'`` and
   ``source='litellm_guardrail'``.

2. **Regulatory standards** (SOC 2, GDPR, HIPAA, ...) — these are
   **manual attestations** that are Forge-specific (LiteLLM does
   not own regulatory compliance). They live in the ``standards``
   table with the marker metadata ``{'source': 'manual_attestation',
   'category': 'regulatory'}``.

NOTE: The original spec referenced ``StandardAttestation`` in
``app/db/models/standard.py`` but recon confirmed only ``Standard``
exists. We therefore reuse the ``Standard`` table and tag rows via
the JSONB ``metadata_`` column. A ``StandardAttestationRead`` Pydantic
shim is defined inline so future schema additions stay backward
compatible.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import DbSession, Principal, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.db.models.standard import Standard
from app.services.litellm_admin import list_guardrails

router = APIRouter(prefix="/standards", tags=["standards"])


class StandardRead(BaseModel):
    """Unified standard view — LiteLLM guardrail OR manual attestation."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True, extra="allow")

    id: str
    name: str
    category: Literal["llm_safety", "regulatory", "internal"] = "internal"
    source: Literal["litellm_guardrail", "manual_attestation", "external"] = "manual_attestation"
    status: Literal["active", "pending", "deprecated"] = "active"
    description: str | None = None
    attested_at: datetime | None = None
    config: dict[str, Any] | None = None


class StandardAttestationRead(StandardRead):
    """Inline Pydantic shim for rows that originated as manual attestations.

    Defined here (rather than as a SQLA model) because the canonical
    ``standards`` table is the single source of truth for regulatory
    entries; this shim simply normalizes a ``Standard`` row into the
    combined ``StandardRead`` shape with ``source='manual_attestation'``.
    """

    tenant_id: UUID | None = None
    project_id: UUID | None = None
    version: int | None = None


class StandardCreate(BaseModel):
    """Payload for creating a new manual attestation (regulatory)."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)
    status: Literal["active", "pending", "deprecated"] = "active"
    project_id: UUID | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    description: str | None = None


def _guardrail_to_standard(g: dict[str, Any]) -> StandardRead:
    """Shape a LiteLLM guardrail dict into a ``StandardRead``."""
    name = g.get("guardrail_name") or g.get("name") or ""
    return StandardRead(
        id=name,
        name=name,
        category="llm_safety",
        source="litellm_guardrail",
        status="active" if g.get("enabled", True) else "pending",
        description=g.get("description"),
        config=g.get("litellm_params") or g.get("config"),
    )


def _standard_row_to_attestation(row: Standard) -> StandardAttestationRead:
    """Shape a ``Standard`` ORM row into a manual-attestation read."""
    meta = dict(row.metadata_ or {})
    attested_at = meta.get("attested_at")
    parsed_attested: datetime | None = None
    if isinstance(attested_at, str):
        try:
            parsed_attested = datetime.fromisoformat(attested_at)
        except ValueError:
            parsed_attested = None
    elif isinstance(attested_at, datetime):
        parsed_attested = attested_at

    status_value = (row.status or "active").lower()
    if status_value not in ("active", "pending", "deprecated"):
        status_value = "active"

    category = meta.get("category", "regulatory")
    if category not in ("llm_safety", "regulatory", "internal"):
        category = "regulatory"

    return StandardAttestationRead(
        id=str(row.id),
        name=row.name,
        category=category,  # type: ignore[arg-type]
        source="manual_attestation",
        status=status_value,  # type: ignore[arg-type]
        description=meta.get("description") or (row.content[:200] if row.content else None),
        attested_at=parsed_attested,
        config=meta.get("config"),
        tenant_id=row.tenant_id,
        project_id=row.project_id,
        version=row.version,
    )


@router.get("", response_model=list[StandardRead])
@audit(action="standards.list", target_type="standard")
async def list_standards(
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession,
) -> list[StandardRead]:
    """Combine LiteLLM guardrails + manual attestations for the tenant.

    LLM safety entries are pulled live from LiteLLM (``/guardrails/list``).
    Regulatory entries are pulled from the local ``standards`` table,
    filtered by ``Standard.tenant_id == principal.tenant_id`` and tagged
    with ``source='manual_attestation'`` in ``metadata_``.
    """
    guardrails = await list_guardrails()
    llm_standards = [_guardrail_to_standard(g) for g in guardrails]

    stmt = select(Standard).where(Standard.tenant_id == principal.tenant_id)
    rows = (await db.execute(stmt)).scalars().all()
    manual_standards = [_standard_row_to_attestation(r) for r in rows]

    return llm_standards + manual_standards


@router.post("", response_model=StandardRead, status_code=201)
@audit(action="standards.create", target_type="standard")
async def create_standard(
    body: StandardCreate,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    db: DbSession,
) -> StandardRead:
    """Add a new manual attestation (regulatory standard)."""
    metadata_payload: dict[str, Any] = dict(body.metadata or {})
    metadata_payload.setdefault("source", "manual_attestation")
    metadata_payload.setdefault("category", "regulatory")
    if body.description is not None:
        metadata_payload.setdefault("description", body.description)
    metadata_payload.setdefault("attested_at", datetime.utcnow().isoformat())

    row = Standard(
        tenant_id=principal.tenant_id,
        project_id=body.project_id or principal.project_id,
        name=body.name,
        content=body.content,
        status=body.status,
        metadata_=metadata_payload,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    attestation = _standard_row_to_attestation(row)
    # Ensure tenant_id is populated even if principal.project_id is None.
    attestation.tenant_id = row.tenant_id
    return attestation


__all__ = ["router"]
