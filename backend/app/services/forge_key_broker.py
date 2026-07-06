"""step-75 P4 — Per-agent Virtual Key Broker.

The single point that issues, rotates, revokes, and reads the LiteLLM
virtual key for an agent. The plaintext key NEVER leaves this module:
it is encrypted at rest via :func:`app.core.crypto.encrypt` and only
ever put on the wire to LiteLLM (via the per-agent ``chat_client``) or
to issue a rotation / revoke.

All public surfaces (typed schemas) return ``fingerprint`` + meta only.
The ``fingerprint`` is the SHA-256 hex of the plaintext — non-secret,
useful for correlating with LiteLLM's own spend log.

Rules respected:
* Rule 1 — provider-shaped SDKs are forbidden; this module only uses
  ``httpx`` via :class:`LiteLLMBaseClient`.
* Rule 2 — every row carries ``tenant_id`` + ``project_id`` and is
  keyed by ``(agent_id)`` partial-unique for ``status = 'active'``.
* Rule 6 — every lifecycle event writes a typed audit row.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import httpx
from sqlalchemy import DateTime, Index, Integer, Numeric, String, Text, func, select
from sqlalchemy.orm import Mapped, mapped_column

from app.core.crypto import encrypt
from app.core.logging import get_logger
from app.db.base import ARRAY, GUID, Base, UUIDPrimaryKeyMixin
from app.db.models.agent import Agent
from app.db.session import get_session_factory
from app.integrations.litellm.litellm_base_client import LiteLLMBaseClient
from app.schemas.forge_keys import (
    ForgeKeyRevokeResponse,
    ForgeKeyRotateResponse,
    ForgeKeyStatus,
)
from app.services.audit_service import audit_service
from app.services.forge_spend import SpendRecord

logger = get_logger(__name__)

#: Default per-agent budget ceiling in USD. Mirrors BudgetGuard default.
DEFAULT_BUDGET_USD: float = 500.00

#: Number of days after which an active key is auto-rotated.
ROTATE_AGE_DAYS: int = 7

#: Spend / ceiling ratio that triggers proactive rotation.
ROTATE_BUDGET_PCT: float = 0.80

#: Spend / ceiling window for the 30-day verify_budget.
BUDGET_WINDOW_DAYS: int = 30


# ---------------------------------------------------------------------------
# ORM — co-located so this file is self-contained. The alembic migration
# (step_75_p4_agent_virtual_key_001) defines the same shape.
# ---------------------------------------------------------------------------


class AgentVirtualKey(Base, UUIDPrimaryKeyMixin):
    """Encrypted LiteLLM virtual key for one agent.

    One row per issued key. The partial UNIQUE on ``(agent_id) WHERE
    status='active'`` (declared in the alembic migration) enforces
    "one active key per agent" at the DB level. Older rows live on
    as ``status='rotated'`` or ``'revoked'`` for the audit trail.
    """

    __tablename__ = "agent_virtual_key"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    project_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    agent_id: Mapped[UUID] = mapped_column(GUID(), nullable=False, index=True)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    encrypted_key: Mapped[str] = mapped_column(Text, nullable=False)
    model_scope: Mapped[list[str] | None] = mapped_column(ARRAY(String), nullable=True)
    max_budget_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    tpm_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rpm_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="active")
    litellm_key_alias: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index(
            "ix_agent_virtual_key_tenant_project_status",
            "tenant_id",
            "project_id",
            "status",
        ),
        Index("ix_agent_virtual_key_agent_created", "agent_id", "created_at"),
    )


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


def _uuid(value: Any) -> UUID:
    if isinstance(value, UUID):
        return value
    return UUID(str(value))


def _fingerprint(secret: str) -> str:
    """SHA-256 hex of the upstream-secret value (never log the source)."""
    return hashlib.sha256(secret.encode()).hexdigest()


def _short_fingerprint(full: str) -> str:
    return full[:16]


class ForgeKeyBroker:
    """Per-agent virtual-key lifecycle.

    Every public method returns a typed Pydantic model that carries
    ``fingerprint`` + meta only. The plaintext key is consumed once
    at issue time, encrypted, and never returned.
    """

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _admin_post(
        self, path: str, *, json_body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        async with LiteLLMBaseClient() as base:
            response = await base.admin_client.post(path, json=json_body or {})
        try:
            return response.json() or {}
        except Exception:  # noqa: BLE001
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

    async def _provision_litellm_key(
        self,
        *,
        alias: str,
        model_scope: list[str] | None,
        max_budget_usd: float,
        tpm_limit: int | None,
        rpm_limit: int | None,
        expires_at: datetime | None,
        agent: Agent,
    ) -> str:
        """Call ``POST /key/generate`` and return the upstream secret.

        Internal-only. The caller MUST encrypt immediately and never
        log or surface the returned value beyond the encrypt step.
        """
        body: dict[str, Any] = {
            "key_alias": alias,
            "metadata": {
                "forge_agent_id": str(agent.id),
                "forge_tenant_id": str(agent.tenant_id),
                "forge_project_id": str(agent.project_id) if agent.project_id else None,
            },
        }
        if model_scope:
            body["models"] = model_scope
        if max_budget_usd is not None:
            body["max_budget"] = float(max_budget_usd)
        if tpm_limit is not None:
            body["tpm_limit"] = int(tpm_limit)
        if rpm_limit is not None:
            body["rpm_limit"] = int(rpm_limit)
        if expires_at is not None:
            body["duration"] = (expires_at - datetime.now(UTC)).total_seconds()

        try:
            response = await self._admin_post("/key/generate", json_body=body)
        except httpx.HTTPError as exc:
            raise RuntimeError(f"litellm /key/generate failed for agent {agent.id}: {exc}") from exc
        secret = self._extract_key_value(response)
        if not secret:
            raise RuntimeError(f"litellm /key/generate returned no key for agent {agent.id}")
        return secret

    async def _block_litellm_key(self, key_alias: str) -> None:
        """Best-effort ``POST /key/block`` against the upstream key alias.

        Failures are logged but never raised — the DB row is the
        authoritative source of truth for forge-side revocation.
        """
        try:
            await self._admin_post("/key/block", json_body={"key_aliases": [key_alias]})
        except Exception as exc:  # noqa: BLE001 — network path
            logger.warning(
                "forge_key_broker.block_failed",
                alias=_short_fingerprint(key_alias),
                error=str(exc),
            )

    async def _revoke_prior_active(
        self, agent_id: UUID, new_status: str
    ) -> tuple[str | None, str | None]:
        """Mark any prior active row for ``agent_id`` as ``new_status``.

        Returns ``(prior_alias, prior_encrypted)`` so the caller can
        block the upstream LiteLLM key and use its alias for the new row.
        """
        factory = get_session_factory()
        async with factory() as session:
            prior = await session.scalar(
                select(AgentVirtualKey).where(
                    AgentVirtualKey.agent_id == agent_id,
                    AgentVirtualKey.status == "active",
                )
            )
            if prior is None:
                return None, None
            prior.status = new_status
            if new_status == "rotated":
                prior.rotated_at = datetime.now(UTC)
            elif new_status == "revoked":
                prior.revoked_at = datetime.now(UTC)
            await session.commit()
            return prior.litellm_key_alias, prior.encrypted_key

    # ------------------------------------------------------------------
    # issue
    # ------------------------------------------------------------------

    async def issue(
        self,
        agent: Agent,
        model_scope: list[str] | None = None,
        max_budget_usd: float = DEFAULT_BUDGET_USD,
        tpm_limit: int | None = None,
        rpm_limit: int | None = None,
        expires_at: datetime | None = None,
    ) -> ForgeKeyStatus:
        """Provision a fresh LiteLLM virtual key for ``agent``.

        On any provisioning failure nothing is persisted — the row insert
        is the *last* step, after encrypt + fingerprint succeed.
        """
        alias = f"forge-agent-{agent.id}-{int(datetime.now(UTC).timestamp())}"

        # Provision the upstream key FIRST. If this fails we never
        # touch the DB, never produce a phantom plaintext column.
        plaintext = await self._provision_litellm_key(
            alias=alias,
            model_scope=model_scope,
            max_budget_usd=max_budget_usd,
            tpm_limit=tpm_limit,
            rpm_limit=rpm_limit,
            expires_at=expires_at,
            agent=agent,
        )

        encrypted = encrypt(plaintext)
        fingerprint = _fingerprint(plaintext)
        # Drop the plaintext reference as soon as we've encrypted it.
        plaintext = None  # noqa: F841 — explicit null-out for clarity

        # Revoke any prior active row before we INSERT the new one
        # (DB has a partial UNIQUE on (agent_id) WHERE status='active').
        await self._revoke_prior_active(agent.id, "rotated")

        now = datetime.now(UTC)
        row = AgentVirtualKey(
            id=uuid4(),
            tenant_id=agent.tenant_id,
            project_id=agent.project_id,
            agent_id=agent.id,
            fingerprint=fingerprint,
            encrypted_key=encrypted,
            model_scope=list(model_scope) if model_scope else None,
            max_budget_usd=Decimal(str(max_budget_usd)),
            tpm_limit=tpm_limit,
            rpm_limit=rpm_limit,
            expires_at=expires_at,
            status="active",
            litellm_key_alias=alias,
            created_at=now,
        )
        factory = get_session_factory()
        async with factory() as session:
            session.add(row)
            await session.commit()
            await session.refresh(row)

        # Audit outside the DB tx; failure here must not roll back the
        # key issuance — the row is already the source of truth.
        try:
            await audit_service.record(
                tenant_id=agent.tenant_id,
                project_id=agent.project_id,
                actor_id=None,
                action="forge.keys.issued",
                target_type="agent",
                target_id=str(agent.id),
                payload={
                    "fingerprint": _short_fingerprint(fingerprint),
                    "model_scope": list(model_scope) if model_scope else [],
                    "max_budget_usd": float(max_budget_usd),
                    "tpm_limit": tpm_limit,
                    "rpm_limit": rpm_limit,
                    "expires_at": expires_at.isoformat() if expires_at else None,
                },
            )
        except Exception as exc:  # noqa: BLE001 — audit is best-effort
            logger.warning(
                "forge_key_broker.issue.audit_failed",
                agent_id=str(agent.id),
                error=str(exc),
            )

        logger.info(
            "forge_key_broker.issued",
            agent_id=str(agent.id),
            fingerprint=_short_fingerprint(fingerprint),
        )

        return ForgeKeyStatus(
            agent_id=agent.id,
            fingerprint=fingerprint,
            status="active",
            model_scope=list(model_scope) if model_scope else [],
            max_budget_usd=float(max_budget_usd),
            budget_used_usd=0.0,
            budget_pct=0.0,
            tpm_limit=tpm_limit,
            rpm_limit=rpm_limit,
            expires_at=expires_at,
            created_at=now,
            rotated_at=None,
            revoked_at=None,
            litellm_key_alias=alias,
        )

    # ------------------------------------------------------------------
    # rotate
    # ------------------------------------------------------------------

    async def rotate(
        self,
        agent_id: UUID,
        reason: str | None = None,
    ) -> ForgeKeyRotateResponse:
        """Issue a new key and block the old one.

        If no active key exists, raises ``LookupError``. The plaintext
        is never returned to the caller.
        """
        agent, prior_alias, prior_fingerprint = await self._load_active_for_rotate(agent_id)
        if agent is None:
            raise LookupError(f"no active virtual key for agent {agent_id}")

        new_alias = f"forge-agent-{agent.id}-rotated-{int(datetime.now(UTC).timestamp())}"

        # Mint a new key upstream.
        plaintext = await self._provision_litellm_key(
            alias=new_alias,
            model_scope=None,  # inherit by default — caller can re-issue
            max_budget_usd=DEFAULT_BUDGET_USD,
            tpm_limit=None,
            rpm_limit=None,
            expires_at=None,
            agent=agent,
        )
        encrypted = encrypt(plaintext)
        new_fingerprint = _fingerprint(plaintext)
        plaintext = None  # noqa: F841

        now = datetime.now(UTC)
        factory = get_session_factory()
        async with factory() as session:
            # Mark the old row as rotated, then insert the new active row.
            prior = await session.scalar(
                select(AgentVirtualKey).where(
                    AgentVirtualKey.agent_id == agent_id,
                    AgentVirtualKey.status == "active",
                )
            )
            if prior is not None:
                prior.status = "rotated"
                prior.rotated_at = now
            session.add(
                AgentVirtualKey(
                    id=uuid4(),
                    tenant_id=agent.tenant_id,
                    project_id=agent.project_id,
                    agent_id=agent.id,
                    fingerprint=new_fingerprint,
                    encrypted_key=encrypted,
                    model_scope=None,
                    max_budget_usd=Decimal(str(DEFAULT_BUDGET_USD)),
                    tpm_limit=None,
                    rpm_limit=None,
                    expires_at=None,
                    status="active",
                    litellm_key_alias=new_alias,
                    created_at=now,
                )
            )
            await session.commit()

        # Best-effort upstream block of the OLD alias.
        if prior_alias:
            await self._block_litellm_key(prior_alias)

        try:
            await audit_service.record(
                tenant_id=agent.tenant_id,
                project_id=agent.project_id,
                actor_id=None,
                action="forge.keys.rotated",
                target_type="agent",
                target_id=str(agent.id),
                payload={
                    "old_fingerprint": _short_fingerprint(prior_fingerprint or ""),
                    "new_fingerprint": _short_fingerprint(new_fingerprint),
                    "reason": reason,
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "forge_key_broker.rotate.audit_failed",
                agent_id=str(agent_id),
                error=str(exc),
            )

        logger.info(
            "forge_key_broker.rotated",
            agent_id=str(agent_id),
            old_fingerprint=_short_fingerprint(prior_fingerprint or ""),
            new_fingerprint=_short_fingerprint(new_fingerprint),
        )

        return ForgeKeyRotateResponse(
            agent_id=agent.id,
            old_fingerprint=prior_fingerprint or "",
            new_fingerprint=new_fingerprint,
            rotated_at=now,
            reason=reason,
        )

    async def _load_active_for_rotate(
        self, agent_id: UUID
    ) -> tuple[Agent | None, str | None, str | None]:
        """Return ``(agent, prior_alias, prior_fingerprint)`` for rotate()."""
        factory = get_session_factory()
        async with factory() as session:
            prior = await session.scalar(
                select(AgentVirtualKey).where(
                    AgentVirtualKey.agent_id == agent_id,
                    AgentVirtualKey.status == "active",
                )
            )
            if prior is None:
                return None, None, None
            agent = await session.get(Agent, agent_id)
            if agent is None:
                return None, None, None
            return agent, prior.litellm_key_alias, prior.fingerprint

    # ------------------------------------------------------------------
    # revoke
    # ------------------------------------------------------------------

    async def revoke(
        self,
        agent_id: UUID,
        reason: str | None = None,
    ) -> ForgeKeyRevokeResponse:
        """Block the upstream key and mark the active row as revoked."""
        factory = get_session_factory()
        async with factory() as session:
            prior = await session.scalar(
                select(AgentVirtualKey).where(
                    AgentVirtualKey.agent_id == agent_id,
                    AgentVirtualKey.status == "active",
                )
            )
            if prior is None:
                raise LookupError(f"no active virtual key for agent {agent_id}")
            prior.status = "revoked"
            prior.revoked_at = datetime.now(UTC)
            await session.commit()
            alias = prior.litellm_key_alias
            fingerprint = prior.fingerprint
            tenant_id = prior.tenant_id
            project_id = prior.project_id

        if alias:
            await self._block_litellm_key(alias)

        try:
            await audit_service.record(
                tenant_id=tenant_id,
                project_id=project_id,
                actor_id=None,
                action="forge.keys.revoked",
                target_type="agent",
                target_id=str(agent_id),
                payload={
                    "fingerprint": _short_fingerprint(fingerprint),
                    "reason": reason,
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "forge_key_broker.revoke.audit_failed",
                agent_id=str(agent_id),
                error=str(exc),
            )

        logger.info(
            "forge_key_broker.revoked",
            agent_id=str(agent_id),
            fingerprint=_short_fingerprint(fingerprint),
        )

        return ForgeKeyRevokeResponse(
            agent_id=agent_id,
            fingerprint=fingerprint,
            revoked_at=datetime.now(UTC),
            reason=reason,
        )

    # ------------------------------------------------------------------
    # get_status
    # ------------------------------------------------------------------

    async def get_status(self, agent_id: UUID) -> ForgeKeyStatus | None:
        """Return typed status for the active key, with budget used.

        The plaintext key is NEVER returned — the response carries the
        ``fingerprint`` (SHA-256 hex) only.
        """
        factory = get_session_factory()
        async with factory() as session:
            row = await session.scalar(
                select(AgentVirtualKey).where(
                    AgentVirtualKey.agent_id == agent_id,
                    AgentVirtualKey.status == "active",
                )
            )
            if row is None:
                return None
            spent = await self._spent_30d(session, agent_id)
            row_fingerprint = row.fingerprint
            row_alias = row.litellm_key_alias
            row_model_scope = list(row.model_scope) if row.model_scope else []
            row_max_budget = float(row.max_budget_usd or 0.0)
            row_tpm = row.tpm_limit
            row_rpm = row.rpm_limit
            row_expires = row.expires_at
            row_created = row.created_at
            row_rotated = row.rotated_at
            row_revoked = row.revoked_at

        budget_used = float(spent or 0.0)
        pct = (budget_used / row_max_budget) if row_max_budget > 0 else 0.0
        return ForgeKeyStatus(
            agent_id=agent_id,
            fingerprint=row_fingerprint,
            status="active",
            model_scope=row_model_scope,
            max_budget_usd=row_max_budget,
            budget_used_usd=budget_used,
            budget_pct=pct,
            tpm_limit=row_tpm,
            rpm_limit=row_rpm,
            expires_at=row_expires,
            created_at=row_created,
            rotated_at=row_rotated,
            revoked_at=row_revoked,
            litellm_key_alias=row_alias,
        )

    # ------------------------------------------------------------------
    # verify_budget
    # ------------------------------------------------------------------

    async def verify_budget(self, agent_id: UUID) -> dict[str, Any]:
        """Return ``{spent_usd, ceiling_usd, pct, blocked}``.

        Reads the last 30 days of spend from ``spend_records`` and the
        active key's ``max_budget_usd``. Used by :class:`BudgetGuard`.
        """
        factory = get_session_factory()
        async with factory() as session:
            spent = await self._spent_30d(session, agent_id)
            row = await session.scalar(
                select(AgentVirtualKey).where(
                    AgentVirtualKey.agent_id == agent_id,
                    AgentVirtualKey.status == "active",
                )
            )
            ceiling = (
                float(row.max_budget_usd) if row and row.max_budget_usd else DEFAULT_BUDGET_USD
            )
        spent_f = float(spent or 0.0)
        pct = (spent_f / ceiling) if ceiling > 0 else 0.0
        return {
            "spent_usd": spent_f,
            "ceiling_usd": ceiling,
            "pct": pct,
            "blocked": spent_f >= ceiling > 0,
        }

    async def _spent_30d(self, session: Any, agent_id: UUID) -> float:
        """SUM(cost_usd) for ``agent_id`` in the last 30 days."""
        cutoff = datetime.now(UTC) - timedelta(days=BUDGET_WINDOW_DAYS)
        result = await session.execute(
            select(func.coalesce(func.sum(SpendRecord.cost_usd), 0)).where(
                SpendRecord.agent_id == agent_id,
                SpendRecord.created_at >= cutoff,
            )
        )
        return float(result.scalar_one() or 0.0)

    # ------------------------------------------------------------------
    # issue_or_rotate (background task entry point)
    # ------------------------------------------------------------------

    async def issue_or_rotate(self, agent: Agent) -> ForgeKeyStatus:
        """Issue if missing, rotate if stale or near budget, else return.

        Called from the agent create / update flow as a background
        task. Never raises on rotation failure — falls back to the
        existing active key.
        """
        factory = get_session_factory()
        async with factory() as session:
            row = await session.scalar(
                select(AgentVirtualKey).where(
                    AgentVirtualKey.agent_id == agent.id,
                    AgentVirtualKey.status == "active",
                )
            )
            if row is None:
                return await self.issue(agent)

            created_at = row.created_at
            max_budget = float(row.max_budget_usd or DEFAULT_BUDGET_USD)
            spent = await self._spent_30d(session, agent.id)

        # Stale? rotate.
        if created_at and (datetime.now(UTC) - created_at) >= timedelta(days=ROTATE_AGE_DAYS):
            try:
                await self.rotate(agent.id, reason="auto_age")
            except Exception as exc:  # noqa: BLE001 — fall through to status
                logger.warning(
                    "forge_key_broker.issue_or_rotate.rotate_failed",
                    agent_id=str(agent.id),
                    error=str(exc),
                )
            return await self.get_status(agent.id) or await self.issue(agent)

        # Over budget threshold? rotate.
        if max_budget > 0 and (spent / max_budget) >= ROTATE_BUDGET_PCT:
            try:
                await self.rotate(agent.id, reason="auto_budget")
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "forge_key_broker.issue_or_rotate.rotate_failed",
                    agent_id=str(agent.id),
                    error=str(exc),
                )
            return await self.get_status(agent.id) or await self.issue(agent)

        return await self.get_status(agent.id) or await self.issue(agent)


# Module-level singleton (DI-friendly, mirrors forge_spend.py:759).
forge_key_broker = ForgeKeyBroker()


__all__ = [
    "ForgeKeyBroker",
    "forge_key_broker",
    "AgentVirtualKey",
    "DEFAULT_BUDGET_USD",
    "ROTATE_AGE_DAYS",
    "ROTATE_BUDGET_PCT",
    "BUDGET_WINDOW_DAYS",
]
