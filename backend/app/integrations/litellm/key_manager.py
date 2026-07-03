"""F-829b — Virtual Key Manager (LiteLLM `key/generate` adapter).

Provisions, rotates, and revokes per-tenant Virtual Keys. The key
VALUE never lives in the database — only its SHA-256 fingerprint (for
correlation with LiteLLM's own spend logs). The value is stored in
AWS Secrets Manager under ``{prefix}{tenant_id}/litellm-key``.

Rules respected:
* Rule 6 — every lifecycle event is written to ``litellm_key_audit``.
* The key value is NEVER logged, NEVER returned via any API endpoint.
  The single public surface that returns the value is
  :meth:`VirtualKeyManager.get_key`, and it is intended only for the
  internal :class:`ForgeLLMClient` hot path.

step-65 (Keycloak ↔ LiteLLM JWT auth bridge) — admin-vs-user note
---------------------------------------------------------------
Admin operations in this module (``/key/generate``, ``/key/info``,
``/key/delete``, ``/budget/info``) continue to authenticate with the
``LITELLM_ADMIN_KEY`` (master key).  End-user LLM calls
(``/v1/chat/completions``, ``/v1/embeddings``) are migrating to a
per-user RS256 ``proxy_token`` issued at ``/auth/oidc/callback`` and
cached in Redis; see :mod:`app.core.oauth2_rsa` and
:mod:`app.core.proxy_token_cache`.  Call sites that already have a
Virtual Key keep using it via :meth:`VirtualKeyManager.get_key`;
new flows pass the proxy_token through ``LiteLLMClient.chat(
proxy_token=...)``.  Both paths coexist during the rollout window.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.core.config import settings
from app.core.logging import get_logger
from app.db.models.litellm_key_audit import LiteLLMKeyAction, LiteLLMKeyAudit
from app.db.rls import tenant_context
from app.db.session import get_session_factory
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient
from app.integrations.litellm.secrets_manager_client import (
    SecretsManagerClient,
    SecretsManagerUnavailable,
    get_default_client as get_default_secrets_client,
)

logger = get_logger(__name__)

_PLACEHOLDER_VALUE = "<redacted>"


def _redact(value: str | None) -> str:
    """Redact a key for logging (returns a short fingerprint marker)."""
    if value is None:
        return "<none>"
    return f"sha256:{hashlib.sha256(value.encode()).hexdigest()[:12]}"


def _fingerprint(value: str) -> str:
    """SHA-256 hex digest of a key — for correlation only, never logged raw."""
    return hashlib.sha256(value.encode()).hexdigest()


class VirtualKeyManager:
    """Per-tenant Virtual Key lifecycle.

    The cache is intentionally local (in-process). LiteLLM itself is
    the source of truth; the cache only short-circuits a Secrets
    Manager round-trip on the hot path. TTL is bounded by
    ``settings.litellm_key_cache_ttl_seconds``.
    """

    def __init__(
        self,
        base_client_factory: Any | None = None,
        secrets_client: SecretsManagerClient | None = None,
    ) -> None:
        # ``base_client_factory`` lets callers (tests) inject a
        # :class:`LiteLLMBaseClient` factory. When ``None``, the
        # service creates a fresh client per call via the async context
        # manager.
        self._base_client_factory = base_client_factory
        self._secrets = secrets_client or get_default_secrets_client()
        self._cache: dict[str, tuple[str, datetime]] = {}

    # ------------------------------------------------------------------
    # Provisioning
    # ------------------------------------------------------------------
    async def provision_key(
        self,
        tenant_id: UUID | str,
        litellm_team_id: str,
        key_alias: str,
    ) -> str:
        """Mint a new Virtual Key for the tenant.

        Calls LiteLLM ``/key/generate``, stores the value in AWS Secrets
        Manager at ``{prefix}{tenant_id}/litellm-key``, and writes a
        ``LiteLLMKeyAudit`` row with action=MINTED. Returns the key
        value; the caller MUST NOT log it.

        Idempotency: if a key already exists for the tenant, returns
        the cached value rather than minting a duplicate.
        """
        tid = str(tenant_id)

        existing = await self._cache_get(tid)
        if existing is not None:
            logger.info(
                "litellm.key_manager.provision_cached",
                tenant_id=tid,
                alias=_redact(key_alias),
            )
            return existing

        body = {
            "team_id": litellm_team_id,
            "key_alias": key_alias,
        }
        response = await self._admin_post("/key/generate", json_body=body)
        key_value = self._extract_key_value(response)
        if not key_value:
            raise RuntimeError(
                f"LiteLLM /key/generate returned no key value for tenant {tid}"
            )

        secret_name = self._secret_name(tid)
        await self._secrets.put_secret(secret_name, key_value)

        await self._write_audit(
            tenant_id=tid,
            project_id=await self._project_id_for_tenant(tid),
            litellm_team_id=litellm_team_id,
            litellm_key_alias=key_alias,
            key_value=key_value,
            action=LiteLLMKeyAction.MINTED,
            actor_id=None,
            reason=None,
        )

        await self._cache_put(tid, key_value)

        logger.info(
            "litellm.key_manager.minted",
            tenant_id=tid,
            alias=_redact(key_alias),
            team_id=_redact(litellm_team_id),
        )
        return key_value

    # ------------------------------------------------------------------
    # Read path (hot path; never expose via API endpoints)
    # ------------------------------------------------------------------
    async def get_key(self, tenant_id: UUID | str) -> str | None:
        """Return the tenant's Virtual Key value, or None.

        Read-through cache (TTL = ``settings.litellm_key_cache_ttl_seconds``).
        On miss, fetches from AWS Secrets Manager and caches.
        """
        tid = str(tenant_id)

        cached = await self._cache_get(tid)
        if cached is not None:
            return cached

        secret_name = self._secret_name(tid)
        try:
            value = await self._secrets.get_secret(secret_name)
        except LookupError:
            return None
        except SecretsManagerUnavailable as exc:
            logger.warning(
                "litellm.key_manager.get_failed",
                tenant_id=tid,
                error=str(exc),
            )
            return None
        except Exception as exc:  # pragma: no cover — network path
            logger.warning(
                "litellm.key_manager.get_failed",
                tenant_id=tid,
                error=str(exc),
            )
            return None
        if value is None:
            return None

        await self._cache_put(tid, value)
        return value

    # ------------------------------------------------------------------
    # Rotation
    # ------------------------------------------------------------------
    async def rotate_key(
        self,
        tenant_id: UUID | str,
        actor_id: UUID | str | None,
    ) -> str:
        """Rotate the tenant's Virtual Key.

        Mints a new key, writes a ROTATED audit row, and revokes the
        old key in LiteLLM (the spend log is preserved per OQ-30).
        Returns the new key value; the caller MUST NOT log it.
        """
        tid = str(tenant_id)
        mapping_team_id = await self._team_id_for_tenant(tid)
        if mapping_team_id is None:
            raise LookupError(f"no LiteLLM Team mapping for tenant {tid}")

        old_key = await self.get_key(tid)
        new_alias = f"forge-{tid}-{int(datetime.now(timezone.utc).timestamp())}"

        body = {"team_id": mapping_team_id, "key_alias": new_alias}
        response = await self._admin_post("/key/generate", json_body=body)
        new_key_value = self._extract_key_value(response)
        if not new_key_value:
            raise RuntimeError(
                f"LiteLLM /key/generate returned no key value for tenant {tid}"
            )

        await self._secrets.put_secret(self._secret_name(tid), new_key_value)
        await self._cache_put(tid, new_key_value)

        await self._write_audit(
            tenant_id=tid,
            project_id=await self._project_id_for_tenant(tid),
            litellm_team_id=mapping_team_id,
            litellm_key_alias=new_alias,
            key_value=new_key_value,
            action=LiteLLMKeyAction.ROTATED,
            actor_id=actor_id,
            reason=None,
        )

        if old_key is not None:
            try:
                await self._admin_post("/key/delete", json_body={"keys": [old_key]})
            except Exception as exc:  # pragma: no cover — network path
                logger.warning(
                    "litellm.key_manager.rotate_old_delete_failed",
                    tenant_id=tid,
                    error=str(exc),
                )

        logger.info(
            "litellm.key_manager.rotated",
            tenant_id=tid,
            alias=_redact(new_alias),
        )
        return new_key_value

    # ------------------------------------------------------------------
    # Revocation
    # ------------------------------------------------------------------
    async def revoke_key(
        self,
        tenant_id: UUID | str,
        actor_id: UUID | str | None,
        reason: str,
    ) -> None:
        """Revoke the tenant's Virtual Key.

        Calls LiteLLM ``/key/delete``, writes a REVOKED audit row, and
        clears the in-process cache. Best-effort: the LiteLLM call may
        fail but the audit row is still written.
        """
        tid = str(tenant_id)
        mapping_team_id = await self._team_id_for_tenant(tid)
        current = await self.get_key(tid)

        if current is not None:
            try:
                await self._admin_post("/key/delete", json_body={"keys": [current]})
            except Exception as exc:  # pragma: no cover — network path
                logger.warning(
                    "litellm.key_manager.delete_failed",
                    tenant_id=tid,
                    error=str(exc),
                )

        try:
            await self._secrets.delete_secret(self._secret_name(tid))
        except Exception as exc:  # pragma: no cover — network path
            logger.warning(
                "litellm.key_manager.secret_delete_failed",
                tenant_id=tid,
                error=str(exc),
            )

        await self._cache_evict(tid)

        if mapping_team_id is not None:
            await self._write_audit(
                tenant_id=tid,
                project_id=await self._project_id_for_tenant(tid),
                litellm_team_id=mapping_team_id,
                litellm_key_alias=_PLACEHOLDER_VALUE,
                key_value=None,
                action=LiteLLMKeyAction.REVOKED,
                actor_id=actor_id,
                reason=reason,
            )

        logger.info(
            "litellm.key_manager.revoked",
            tenant_id=tid,
            actor_id=str(actor_id) if actor_id else None,
            reason=reason,
        )

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------
    async def _admin_post(self, path: str, *, json_body: dict[str, Any] | None = None) -> dict[str, Any]:
        if self._base_client_factory is not None:
            async with self._base_client_factory() as client:
                response = await client.admin_client.post(path, json=json_body or {})
                return self._parse(response)

        async with LiteLLMBaseClient() as client:
            response = await client.admin_client.post(path, json=json_body or {})
            return self._parse(response)

    # ------------------------------------------------------------------
    # Cache helpers
    # ------------------------------------------------------------------
    async def _cache_get(self, tenant_id: str) -> str | None:
        entry = self._cache.get(tenant_id)
        if entry is None:
            return None
        value, expires_at = entry
        if expires_at <= datetime.now(timezone.utc):
            self._cache.pop(tenant_id, None)
            return None
        return value

    async def _cache_put(self, tenant_id: str, value: str) -> None:
        ttl = int(getattr(settings, "litellm_key_cache_ttl_seconds", 300))
        expires_at = datetime.now(timezone.utc).timestamp() + ttl
        from datetime import datetime as _dt

        self._cache[tenant_id] = (
            value,
            _dt.fromtimestamp(expires_at, tz=timezone.utc),
        )

    async def _cache_evict(self, tenant_id: str) -> None:
        self._cache.pop(tenant_id, None)

    # ------------------------------------------------------------------
    # Audit + lookups
    # ------------------------------------------------------------------
    async def _write_audit(
        self,
        tenant_id: str,
        project_id: str | None,
        litellm_team_id: str,
        litellm_key_alias: str,
        key_value: str | None,
        action: LiteLLMKeyAction,
        actor_id: UUID | str | None,
        reason: str | None,
    ) -> None:
        key_hash = _fingerprint(key_value) if key_value else ""
        factory = get_session_factory()
        async with factory() as session:
            async with tenant_context(session, tenant_id, project_id):
                session.add(
                    LiteLLMKeyAudit(
                        tenant_id=tenant_id,
                        project_id=project_id or "00000000-0000-0000-0000-000000000000",
                        litellm_team_id=litellm_team_id,
                        litellm_key_alias=litellm_key_alias,
                        litellm_key_hash=key_hash,
                        action=action.value,
                        actor_id=str(actor_id) if actor_id else None,
                        reason=reason,
                        occurred_at=datetime.now(timezone.utc),
                    )
                )
                await session.commit()

    async def _team_id_for_tenant(self, tenant_id: str) -> str | None:
        from app.db.models.litellm_team_mapping import LiteLLMTeamMapping

        factory = get_session_factory()
        async with factory() as session:
            async with tenant_context(session, tenant_id):
                row = await session.scalar(
                    select(LiteLLMTeamMapping).where(
                        LiteLLMTeamMapping.tenant_id == tenant_id
                    )
                )
                if row is None:
                    return None
                return row.litellm_team_id

    async def _project_id_for_tenant(self, tenant_id: str) -> str | None:
        from app.db.models.litellm_team_mapping import LiteLLMTeamMapping

        factory = get_session_factory()
        async with factory() as session:
            async with tenant_context(session, tenant_id):
                row = await session.scalar(
                    select(LiteLLMTeamMapping).where(
                        LiteLLMTeamMapping.tenant_id == tenant_id
                    )
                )
                if row is None:
                    return None
                return str(row.project_id)

    # ------------------------------------------------------------------
    # Static helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _secret_name(tenant_id: str) -> str:
        prefix = getattr(settings, "aws_secrets_manager_prefix", "forge/tenants/")
        return f"{prefix}{tenant_id}/litellm-key"

    @staticmethod
    def _parse(response: Any) -> dict[str, Any]:
        if response is None:
            return {}
        try:
            return response.json() or {}
        except Exception:
            return {}

    @staticmethod
    def _extract_key_value(response: dict[str, Any] | None) -> str | None:
        if not response:
            return None
        for key in ("key", "api_key", "token"):
            value = response.get(key)
            if value:
                return str(value)
        return None


# Module-level singleton (mirrors `audit_service.py:49`).
virtual_key_manager = VirtualKeyManager()


__all__ = ["VirtualKeyManager", "virtual_key_manager"]