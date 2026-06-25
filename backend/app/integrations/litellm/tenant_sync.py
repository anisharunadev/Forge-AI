"""F-829a — Tenant ↔ LiteLLM Team synchronization.

Keeps a 1:1 mapping between a Forge tenant and a LiteLLM Team. The
:class:`TenantSync` is invoked from the tenant lifecycle (creation,
archive, reconcile). It is the single source of truth for whether a
tenant has a corresponding LiteLLM Team.

Rules respected:
* Rule 1 — LiteLLM is the only LLM gateway; this module talks to it
  via :class:`LiteLLMBaseClient` (httpx).
* Rule 2 — every DB write goes through ``tenant_context``.
* Rule 3 — tenant creation must not be blocked by LiteLLM unavailability
  (the existing call site in tenant creation calls this best-effort).
* Rule 6 — every successful sync is recorded in ``litellm_team_mappings``
  (which feeds the audit timeline).

Failure policy: a failed sync must NOT block tenant creation. Failures
are logged at WARNING level; the caller (``on_tenant_created``) returns
``None`` so the tenant row is created even when LiteLLM is unreachable.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.logging import get_logger
from app.db.models.litellm_team_mapping import (
    LiteLLMTeamMapping,
    LiteLLMTeamStatus,
)
from app.db.rls import tenant_context
from app.db.session import get_session_factory
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient

logger = get_logger(__name__)


def _redact(value: str | None) -> str:
    """Redact a value for logging. Used for tokens/keys/secrets."""
    if value is None:
        return "<none>"
    if len(value) <= 8:
        return "***"
    return f"{value[:4]}...{value[-4:]}"


def _settings_match(expected: dict[str, Any], actual: Any) -> bool:
    """Compare Forge tenant settings dict to LiteLLM Team metadata.

    LiteLLM stores metadata as JSON-encoded string in some proxies;
    tolerate both shapes. Returns True when they compare equal, False
    on any structural divergence.
    """
    if isinstance(actual, str):
        try:
            actual = json.loads(actual)
        except (TypeError, ValueError):
            return False
    if not isinstance(actual, dict):
        return False
    if expected is None:
        expected = {}
    if len(expected) != len(actual):
        return False
    for key, value in expected.items():
        if key not in actual:
            return False
        if actual[key] != value:
            return False
    return True


class TenantSync:
    """Synchronizes Forge tenants with LiteLLM Teams.

    Per OQ-30, archiving a tenant POSTs ``/team/delete`` to LiteLLM and
    revokes the tenant's Virtual Key. Per OQ-31, the mapping is 1:1 —
    one LiteLLM Team per Forge tenant. Idempotent on creation: if a
    mapping already exists, returns the existing ``litellm_team_id``.
    """

    def __init__(self, base_client_factory: Any | None = None) -> None:
        # ``base_client_factory`` lets callers (tests) inject an
        # already-opened :class:`LiteLLMBaseClient`. When ``None``, the
        # service creates a fresh client per call via the async context
        # manager.
        self._base_client_factory = base_client_factory

    # ------------------------------------------------------------------
    # Creation
    # ------------------------------------------------------------------
    async def on_tenant_created(
        self,
        tenant_id: UUID | str,
        project_id: UUID | str,
        name: str,
    ) -> str | None:
        """Create a LiteLLM Team for the tenant; persist the mapping.

        Idempotent: if a mapping already exists, returns the existing
        ``litellm_team_id`` without contacting LiteLLM. Returns ``None``
        on LiteLLM failure (logged at WARNING) — tenant creation must
        not be blocked.
        """
        tid = str(tenant_id)
        pid = str(project_id)

        existing = await self._get_mapping(tid)
        if existing is not None:
            logger.info(
                "litellm.tenant_sync.already_mapped",
                tenant_id=tid,
                litellm_team_id=_redact(existing.litellm_team_id),
            )
            return existing.litellm_team_id

        body = {
            "team_alias": f"forge-{tid}",
            "models": [],
            "max_budget_in_team": None,
            "metadata": {"forge_tenant_id": tid, "forge_project_id": pid, "name": name},
        }

        try:
            response = await self._admin_post("/team/new", json_body=body)
        except Exception as exc:  # pragma: no cover — network path
            logger.warning(
                "litellm.tenant_sync.create_failed",
                tenant_id=tid,
                error=str(exc),
                error_type=type(exc).__name__,
            )
            return None

        litellm_team_id = self._extract_team_id(response)
        if litellm_team_id is None:
            logger.warning(
                "litellm.tenant_sync.no_team_id",
                tenant_id=tid,
                response=response,
            )
            return None

        try:
            await self._persist_mapping(
                tenant_id=tid,
                project_id=pid,
                litellm_team_id=litellm_team_id,
                status=LiteLLMTeamStatus.ACTIVE,
                metadata={"name": name},
            )
        except Exception as exc:
            logger.warning(
                "litellm.tenant_sync.persist_failed",
                tenant_id=tid,
                litellm_team_id=_redact(litellm_team_id),
                error=str(exc),
            )
            return litellm_team_id

        logger.info(
            "litellm.tenant_sync.created",
            tenant_id=tid,
            litellm_team_id=_redact(litellm_team_id),
        )
        return litellm_team_id

    # ------------------------------------------------------------------
    # Archive
    # ------------------------------------------------------------------
    async def on_tenant_archived(self, tenant_id: UUID | str) -> None:
        """Archive the tenant's LiteLLM Team + revoke its Virtual Key.

        Best-effort: LiteLLM API errors are logged but do not raise —
        the audit row + status update happen regardless, and the spend
        logs in LiteLLM are preserved per OQ-30.
        """
        from app.integrations.litellm.key_manager import virtual_key_manager

        tid = str(tenant_id)
        mapping = await self._get_mapping(tid)
        if mapping is None:
            logger.info("litellm.tenant_sync.archive_noop", tenant_id=tid)
            return

        try:
            await self._admin_post(
                "/team/delete", json_body={"team_ids": [mapping.litellm_team_id]}
            )
        except Exception as exc:  # pragma: no cover — network path
            logger.warning(
                "litellm.tenant_sync.delete_failed",
                tenant_id=tid,
                litellm_team_id=_redact(mapping.litellm_team_id),
                error=str(exc),
            )

        try:
            await virtual_key_manager.revoke_key(
                tenant_id=tid,
                actor_id=None,
                reason="tenant_archived",
            )
        except Exception as exc:
            logger.warning(
                "litellm.tenant_sync.revoke_failed",
                tenant_id=tid,
                error=str(exc),
            )

        try:
            await self._update_status(
                tenant_id=tid,
                litellm_team_id=mapping.litellm_team_id,
                status=LiteLLMTeamStatus.ARCHIVED,
            )
        except Exception as exc:
            logger.warning(
                "litellm.tenant_sync.archive_persist_failed",
                tenant_id=tid,
                error=str(exc),
            )

        logger.info(
            "litellm.tenant_sync.archived",
            tenant_id=tid,
            litellm_team_id=_redact(mapping.litellm_team_id),
        )

    # ------------------------------------------------------------------
    # Read path
    # ------------------------------------------------------------------
    async def get_team_id(self, tenant_id: UUID | str) -> str | None:
        """Return the LiteLLM Team id for a tenant, or None.

        Read-through: queries ``litellm_team_mappings``. Returns
        ``None`` if the tenant has no mapping or it is archived.
        """
        tid = str(tenant_id)
        mapping = await self._get_mapping(tid)
        if mapping is None:
            return None
        if mapping.status == LiteLLMTeamStatus.ARCHIVED:
            return None
        return mapping.litellm_team_id

    # ------------------------------------------------------------------
    # Reconciliation
    # ------------------------------------------------------------------
    async def reconcile(self, tenant_id: UUID | str) -> bool:
        """Compare Forge tenant mapping to LiteLLM Team.

        Returns True when the state matches (no drift). On divergence,
        marks the mapping ``DRIFTED`` and returns False. Best-effort:
        API errors are logged and treated as drift (fail-closed).

        Phase D extension: in addition to the ``forge_tenant_id``
        identity check, the reconcile pass now also compares the
        Forge-side tenant ``name`` and ``settings`` to the LiteLLM
        Team metadata (``forge_name`` / ``forge_settings``). If any
        field has diverged the mapping is marked ``DRIFTED``.
        """
        tid = str(tenant_id)
        mapping = await self._get_mapping(tid)
        if mapping is None:
            logger.info("litellm.tenant_sync.reconcile_no_mapping", tenant_id=tid)
            return True  # nothing to compare

        try:
            response = await self._admin_get(
                "/team/info", params={"team_id": mapping.litellm_team_id}
            )
        except Exception as exc:
            logger.warning(
                "litellm.tenant_sync.reconcile_failed",
                tenant_id=tid,
                error=str(exc),
            )
            await self._mark_drifted(tid, mapping.litellm_team_id)
            return False

        team_info = (response or {}).get("team_info") or response or {}
        if not isinstance(team_info, dict):
            team_info = {}
        litellm_metadata = team_info.get("metadata") or {}
        if isinstance(litellm_metadata, str):
            try:
                litellm_metadata = json.loads(litellm_metadata)
            except (TypeError, ValueError):
                litellm_metadata = {}
        if not isinstance(litellm_metadata, dict):
            litellm_metadata = {}

        expected_tenant_id = str(mapping.tenant_id)
        actual_tenant_id = litellm_metadata.get("forge_tenant_id")
        if actual_tenant_id != expected_tenant_id:
            logger.warning(
                "litellm.tenant_sync.drift",
                tenant_id=tid,
                field="forge_tenant_id",
                expected=expected_tenant_id,
                actual=actual_tenant_id,
            )
            await self._mark_drifted(tid, mapping.litellm_team_id)
            return False

        # ---- Phase D: metadata drift detection (name, settings) ----
        forge_tenant = await self._load_tenant(tid)
        if forge_tenant is not None:
            expected_name = getattr(forge_tenant, "name", None)
            actual_name = litellm_metadata.get("forge_name")
            if expected_name is not None and actual_name != expected_name:
                logger.warning(
                    "litellm.tenant_sync.drift",
                    tenant_id=tid,
                    field="forge_name",
                    expected=expected_name,
                    actual=actual_name,
                )
                await self._mark_drifted(tid, mapping.litellm_team_id)
                return False

            expected_settings = getattr(forge_tenant, "settings", None) or {}
            actual_settings = litellm_metadata.get("forge_settings")
            if not _settings_match(expected_settings, actual_settings):
                logger.warning(
                    "litellm.tenant_sync.drift",
                    tenant_id=tid,
                    field="forge_settings",
                    expected=expected_settings,
                    actual=actual_settings,
                )
                await self._mark_drifted(tid, mapping.litellm_team_id)
                return False

        try:
            factory = get_session_factory()
            async with factory() as session:
                async with tenant_context(session, tid):
                    row = await session.scalar(
                        select(LiteLLMTeamMapping).where(
                            LiteLLMTeamMapping.litellm_team_id == mapping.litellm_team_id
                        )
                    )
                    if row is not None:
                        row.last_synced_at = datetime.now(timezone.utc)
                        row.status = LiteLLMTeamStatus.ACTIVE
                        await session.commit()
        except Exception as exc:
            logger.warning(
                "litellm.tenant_sync.reconcile_persist_failed",
                tenant_id=tid,
                error=str(exc),
            )

        logger.debug(
            "litellm.tenant_sync.reconciled",
            tenant_id=tid,
            litellm_team_id=_redact(mapping.litellm_team_id),
        )
        return True

    async def _load_tenant(self, tenant_id: str) -> Any | None:
        """Return the :class:`Tenant` row, or None if unavailable.

        Read-outside-RLS: this runs from a scheduled job that walks
        all tenants; the team mapping already enforces tenant scope.
        """
        try:
            from app.db.models.tenant import Tenant

            factory = get_session_factory()
            async with factory() as session:
                return await session.get(Tenant, tenant_id)
        except Exception as exc:  # noqa: BLE001 — best-effort
            logger.warning(
                "litellm.tenant_sync.tenant_load_failed",
                tenant_id=tenant_id,
                error=str(exc),
            )
            return None

    # ------------------------------------------------------------------
    # HTTP helpers — open a LiteLLMBaseClient per call
    # ------------------------------------------------------------------
    async def _admin_post(self, path: str, *, json_body: dict[str, Any] | None = None) -> dict[str, Any]:
        """POST against the admin endpoint, returning the parsed JSON dict."""
        if self._base_client_factory is not None:
            async with self._base_client_factory() as client:
                response = await client.admin_client.post(path, json=json_body or {})
                return self._parse(response)

        async with LiteLLMBaseClient() as client:
            response = await client.admin_client.post(path, json=json_body or {})
            return self._parse(response)

    async def _admin_get(self, path: str, *, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """GET against the admin endpoint, returning the parsed JSON dict."""
        if self._base_client_factory is not None:
            async with self._base_client_factory() as client:
                response = await client.admin_client.get(path, params=params or {})
                return self._parse(response)

        async with LiteLLMBaseClient() as client:
            response = await client.admin_client.get(path, params=params or {})
            return self._parse(response)

    # ------------------------------------------------------------------
    # DB helpers
    # ------------------------------------------------------------------
    async def _get_mapping(self, tenant_id: str) -> LiteLLMTeamMapping | None:
        factory = get_session_factory()
        async with factory() as session:
            async with tenant_context(session, tenant_id):
                return await session.scalar(
                    select(LiteLLMTeamMapping).where(
                        LiteLLMTeamMapping.tenant_id == tenant_id
                    )
                )

    async def _persist_mapping(
        self,
        tenant_id: str,
        project_id: str,
        litellm_team_id: str,
        status: LiteLLMTeamStatus,
        metadata: dict[str, Any],
    ) -> None:
        factory = get_session_factory()
        async with factory() as session:
            async with tenant_context(session, tenant_id, project_id):
                row = LiteLLMTeamMapping(
                    tenant_id=tenant_id,
                    project_id=project_id,
                    litellm_team_id=litellm_team_id,
                    status=status.value,
                    last_synced_at=datetime.now(timezone.utc),
                    metadata_=metadata,
                )
                session.add(row)
                await session.commit()

    async def _update_status(
        self,
        tenant_id: str,
        litellm_team_id: str,
        status: LiteLLMTeamStatus,
    ) -> None:
        factory = get_session_factory()
        async with factory() as session:
            async with tenant_context(session, tenant_id):
                row = await session.scalar(
                    select(LiteLLMTeamMapping).where(
                        LiteLLMTeamMapping.litellm_team_id == litellm_team_id
                    )
                )
                if row is None:
                    return
                row.status = status.value
                row.last_synced_at = datetime.now(timezone.utc)
                await session.commit()

    async def _mark_drifted(self, tenant_id: str, litellm_team_id: str) -> None:
        try:
            await self._update_status(
                tenant_id=tenant_id,
                litellm_team_id=litellm_team_id,
                status=LiteLLMTeamStatus.DRIFTED,
            )
        except Exception:  # pragma: no cover — best-effort
            pass

    @staticmethod
    def _parse(response: Any) -> dict[str, Any]:
        if response is None:
            return {}
        try:
            return response.json() or {}
        except Exception:
            return {}

    @staticmethod
    def _extract_team_id(response: dict[str, Any] | None) -> str | None:
        if not response:
            return None
        for key in ("team_id", "teamId", "id"):
            value = response.get(key)
            if value is not None:
                return str(value)
        team_info = response.get("team_info") or {}
        if isinstance(team_info, dict):
            for key in ("team_id", "teamId", "id"):
                value = team_info.get(key)
                if value is not None:
                    return str(value)
        return None


# Module-level singleton (mirrors `audit_service.py:49`).
tenant_sync = TenantSync()


__all__ = ["TenantSync", "tenant_sync"]