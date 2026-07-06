"""F-829g — Per-tenant model assignment resolver.

Maps a Forge-side model tier (e.g. ``"fast"``, ``"standard"``,
``"premium"``, ``"embedding"``) to a concrete LiteLLM model name.
The Steward can rebind tiers without code changes — Rule 8.

Reads consult ``litellm_model_assignments`` with a process-local
in-process cache; writes upsert on ``(tenant_id, tier)``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select

from app.core.config import settings
from app.core.logging import get_logger
from app.db.models.litellm_model_assignment import LiteLLMModelAssignment
from app.db.rls import tenant_context
from app.db.session import get_session_factory

logger = get_logger(__name__)


class ModelAssignmentResolver:
    """Resolves model tier → concrete LiteLLM model name."""

    def __init__(self) -> None:
        # Process-local cache keyed by f"{tenant_id}:{tier}".
        self._cache: dict[str, tuple[str, datetime]] = {}
        self._cache_ttl_seconds = 60

    # ------------------------------------------------------------------
    # Read path
    # ------------------------------------------------------------------
    async def resolve(self, tenant_id: UUID | str, model_tier: str) -> str:
        """Return the LiteLLM model name for a (tenant, tier).

        Order of resolution:
        1. Process-local cache.
        2. ``litellm_model_assignments`` row for (tenant_id, tier) with
           ``enabled = true``.
        3. ``settings.litellm_default_model`` (the platform default).
        """
        tid = str(tenant_id)
        tier = model_tier.strip().lower()
        cache_key = f"{tid}:{tier}"

        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        row = await self._get_assignment(tid, tier)
        if row is not None and row.enabled:
            self._cache_put(cache_key, row.model_name)
            return row.model_name

        default_model = getattr(settings, "litellm_default_model", "gpt-4o-mini")
        self._cache_put(cache_key, default_model)
        return default_model

    # ------------------------------------------------------------------
    # Writes
    # ------------------------------------------------------------------
    async def assign(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        tier: str,
        model_name: str,
        max_input_tokens: int | None = None,
        max_output_tokens: int | None = None,
    ) -> None:
        """Upsert a (tenant, tier) → model_name assignment."""
        tid = str(tenant_id)
        pid = str(project_id)
        normalized_tier = tier.strip().lower()

        factory = get_session_factory()
        async with factory() as session, tenant_context(session, tid, pid):
            row = await session.scalar(
                select(LiteLLMModelAssignment).where(
                    LiteLLMModelAssignment.tenant_id == tid,
                    LiteLLMModelAssignment.tier == normalized_tier,
                )
            )
            if row is None:
                row = LiteLLMModelAssignment(
                    tenant_id=tid,
                    project_id=pid,
                    tier=normalized_tier,
                    model_name=model_name,
                    max_input_tokens=max_input_tokens,
                    max_output_tokens=max_output_tokens,
                    enabled=True,
                    metadata_={},
                )
                session.add(row)
            else:
                row.project_id = pid
                row.model_name = model_name
                row.max_input_tokens = max_input_tokens
                row.max_output_tokens = max_output_tokens
                row.enabled = True
            await session.commit()

        cache_key = f"{tid}:{normalized_tier}"
        self._cache_put(cache_key, model_name)
        logger.info(
            "litellm.model_assignment.assigned",
            tenant_id=tid,
            tier=normalized_tier,
            model_name=model_name,
        )

    async def list_for_tenant(self, tenant_id: UUID | str) -> list[LiteLLMModelAssignment]:
        """Return all assignments for a tenant (admin UI)."""
        tid = str(tenant_id)
        factory = get_session_factory()
        async with factory() as session, tenant_context(session, tid):
            rows = (
                await session.scalars(
                    select(LiteLLMModelAssignment).where(LiteLLMModelAssignment.tenant_id == tid)
                )
            ).all()
            return list(rows)

    # ------------------------------------------------------------------
    # Cache helpers
    # ------------------------------------------------------------------
    def _cache_get(self, key: str) -> str | None:
        entry = self._cache.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if expires_at <= datetime.now(UTC):
            self._cache.pop(key, None)
            return None
        return value

    def _cache_put(self, key: str, value: str) -> None:
        expires_at = datetime.now(UTC).timestamp() + self._cache_ttl_seconds
        from datetime import datetime as _dt

        self._cache[key] = (value, _dt.fromtimestamp(expires_at, tz=UTC))

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    async def _get_assignment(
        self,
        tenant_id: str,
        tier: str,
    ) -> LiteLLMModelAssignment | None:
        factory = get_session_factory()
        async with factory() as session, tenant_context(session, tenant_id):
            return await session.scalar(
                select(LiteLLMModelAssignment).where(
                    LiteLLMModelAssignment.tenant_id == tenant_id,
                    LiteLLMModelAssignment.tier == tier,
                )
            )


# Module-level singleton (mirrors `audit_service.py:49`).
model_assignment_resolver = ModelAssignmentResolver()


__all__ = ["ModelAssignmentResolver", "model_assignment_resolver"]
