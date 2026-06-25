"""Persona memory REST endpoints (Pillar 1 — Phase 3).

Mirrors ``usePersonaMemory`` and ``<PersonaMemoryPanel>`` on the
frontend (Phase 4). The endpoints are RBAC-gated by an authenticated
principal; the persona comes from the ``X-Forge-Persona`` header
(set by the Forge shell middleware) with a fallback to the
``Tenant.default_persona`` value (added Phase 3, defaults to
``'developer'``).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Cookie, Header, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.api.deps import Principal
from app.core.audit import audit
from app.db.models.persona_memory import PERSONA_KEYS, PERSONA_NAMES
from app.services.memory.persona_store import PersonaMemoryStore

router = APIRouter(prefix="/persona/memory", tags=["persona"])


class PersonaMemoryRead(BaseModel):
    body: str
    recent_entries: list[dict[str, Any]] = Field(default_factory=list)


class PersonaMemoryAppend(BaseModel):
    entry_md: str = Field(min_length=1, max_length=20_000)


def _resolve_persona(
    *,
    principal: Principal,
    x_forge_persona: str | None,
    forge_persona_cookie: str | None,
) -> str:
    """Pick the persona from header → cookie → tenant default."""
    candidate = (x_forge_persona or forge_persona_cookie or "").strip()
    if candidate and candidate in PERSONA_NAMES:
        return candidate
    # Tenant default falls back to "developer" if unset (Phase 3).
    default = "developer"
    return default


@router.get("/{key}", response_model=PersonaMemoryRead)
@audit(action="persona.memory.read", target_type="persona_file")
async def read_memory(
    key: str,
    principal: Principal,
    x_forge_persona: str | None = Header(default=None, alias="X-Forge-Persona"),
    forge_persona: str | None = Cookie(default=None, alias="forge.persona"),
) -> PersonaMemoryRead:
    if key not in PERSONA_KEYS:
        raise HTTPException(status_code=400, detail=f"unknown_key:{key}")
    persona = _resolve_persona(
        principal=principal,
        x_forge_persona=x_forge_persona,
        forge_persona_cookie=forge_persona,
    )
    store = PersonaMemoryStore()
    body = store.read(principal.tenant_id, persona, key)
    recent = await store.recent_entries(principal.tenant_id, persona, key)
    return PersonaMemoryRead(body=body, recent_entries=recent)


@router.post("/{key}", status_code=status.HTTP_201_CREATED)
@audit(action="persona.memory.append", target_type="persona_file")
async def append_memory(
    key: str,
    body: PersonaMemoryAppend,
    principal: Principal,
    x_forge_persona: str | None = Header(default=None, alias="X-Forge-Persona"),
    forge_persona: str | None = Cookie(default=None, alias="forge.persona"),
) -> dict[str, Any]:
    if key not in PERSONA_KEYS:
        raise HTTPException(status_code=400, detail=f"unknown_key:{key}")
    persona = _resolve_persona(
        principal=principal,
        x_forge_persona=x_forge_persona,
        forge_persona_cookie=forge_persona,
    )
    store = PersonaMemoryStore()
    row = await store.append(
        tenant_id=principal.tenant_id,
        persona=persona,
        key=key,
        entry_md=body.entry_md,
        written_by=principal.user_id,
    )
    return {
        "id": str(row.id),
        "persona": persona,
        "key": key,
        "written_at": row.written_at.isoformat(),
    }


__all__ = ["router"]