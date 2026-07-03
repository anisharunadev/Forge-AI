"""Schemas for Step 75 P4 — Forge Key issuance, rotation, revocation, status.

Security-critical: never expose plaintext key material. The response models
carry only the `fingerprint` (a short non-secret identifier) and LiteLLM
alias metadata; the secret itself is returned one-shot at issuance over an
authenticated, server-side channel handled outside these schemas.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from app.schemas.common import ForgeBaseModel

KeyStatus = Literal["active", "rotated", "revoked"]


class ForgeKeyStatus(ForgeBaseModel):
    agent_id: UUID
    fingerprint: str
    status: KeyStatus
    model_scope: list[str]
    max_budget_usd: float
    budget_used_usd: float
    budget_pct: float
    tpm_limit: int | None = None
    rpm_limit: int | None = None
    expires_at: datetime | None = None
    created_at: datetime
    rotated_at: datetime | None = None
    revoked_at: datetime | None = None
    litellm_key_alias: str | None = None


class ForgeKeyIssueRequest(ForgeBaseModel):
    agent_id: UUID
    model_scope: list[str] | None = None
    max_budget_usd: float = 500.00
    tpm_limit: int | None = None
    rpm_limit: int | None = None
    expires_at: datetime | None = None


class ForgeKeyIssueResponse(ForgeBaseModel):
    agent_id: UUID
    fingerprint: str
    status: str
    model_scope: list[str]
    created_at: datetime


class ForgeKeyRotateRequest(ForgeBaseModel):
    agent_id: UUID
    reason: str | None = None


class ForgeKeyRotateResponse(ForgeBaseModel):
    agent_id: UUID
    old_fingerprint: str
    new_fingerprint: str
    rotated_at: datetime
    reason: str | None = None


class ForgeKeyRevokeRequest(ForgeBaseModel):
    agent_id: UUID
    reason: str | None = None


class ForgeKeyRevokeResponse(ForgeBaseModel):
    agent_id: UUID
    fingerprint: str
    revoked_at: datetime
    reason: str | None = None


class ForgeKeyStatusListResponse(ForgeBaseModel):
    keys: list[ForgeKeyStatus]
    fetched_at: datetime


__all__ = [
    "ForgeKeyStatus",
    "ForgeKeyIssueRequest",
    "ForgeKeyIssueResponse",
    "ForgeKeyRotateRequest",
    "ForgeKeyRotateResponse",
    "ForgeKeyRevokeRequest",
    "ForgeKeyRevokeResponse",
    "ForgeKeyStatusListResponse",
]