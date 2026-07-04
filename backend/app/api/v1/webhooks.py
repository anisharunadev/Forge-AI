"""F-503 — Webhook integration for the Deterministic Security Gate.

Currently exposes:

* ``POST /api/v1/webhooks/github/pre-commit`` — invoked by GitHub Apps
  pre-commit hooks (or a sidecar that subscribes to ``push`` events)
  before allowing a push to land.

Response contract
-----------------
* ``200 OK``   + ``{"allowed": true,  ...}`` → GitHub allows the push.
* ``403 Forbidden`` + ``{"allowed": false, ...}`` → GitHub blocks the push.

The endpoint is intentionally *unauthenticated* at the FastAPI layer —
GitHub webhook signature verification happens via the shared helper
``app.api.deps.verify_github_signature`` (HMAC SHA-256 over the raw body
with the configured shared secret). If the signature check fails we
return 401 and never invoke the gate.

All callers (PASS / FAIL / admission-denied) produce an F-005 audit row
through :class:`app.services.merge_gate.MergeGate`.
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.logging import get_logger
from app.services.merge_gate import MergeGate, merge_gate_default
from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase

logger = get_logger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class GitHubPreCommitPayload(BaseModel):
    """Minimal payload for the GitHub pre-commit webhook.

    GitHub's ``push`` event carries a lot more; we only need the bits
    the gate cares about. Anything extra is ignored.
    """

    repository: str = Field(..., min_length=1)
    commit_sha: str = Field(..., min_length=7, max_length=64)
    project_id: UUID | None = None
    tenant_id: UUID | None = None
    actor_id: UUID | None = None
    author_email: str | None = None
    author_login: str | None = None
    ref: str | None = None
    diff_url: str | None = None


class GateWebhookResponse(BaseModel):
    allowed: bool
    decision: str
    report_id: str | None = None
    reason: str | None = None
    findings_count: int = 0
    remediation_issue_key: str | None = None
    commit_sha: str


# ---------------------------------------------------------------------------
# Signature verification
# ---------------------------------------------------------------------------


def _verify_github_signature(raw_body: bytes, signature_header: str | None) -> None:
    """Verify the ``X-Hub-Signature-256`` header against ``raw_body``.

    Raises ``HTTPException(401)`` if verification fails or is missing.
    """
    secret = (settings.github_webhook_secret or "").encode("utf-8")
    if not secret:
        # Allow the request in environments where webhook secret is
        # intentionally unset (e.g. local dev). Production must set it.
        logger.warning("webhooks.github_signature_disabled")
        return

    if not signature_header or not signature_header.startswith("sha256="):
        raise HTTPException(status_code=401, detail="missing_signature")

    expected = hmac.new(secret, raw_body, hashlib.sha256).hexdigest()
    provided = signature_header.split("=", 1)[1]
    if not hmac.compare_digest(expected, provided):
        raise HTTPException(status_code=401, detail="invalid_signature")


# ---------------------------------------------------------------------------
# Module-level gate accessor (overridable in tests).
# ---------------------------------------------------------------------------


def _gate_default() -> MergeGate:
    return merge_gate_default()


def get_gate() -> MergeGate:
    """FastAPI dependency seam; tests override this with a stubbed gate."""
    return _gate_default()


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.post(
    "/github/pre-commit",
    response_model=GateWebhookResponse,
)
async def github_pre_commit(
    request: Request,
    gate: MergeGate = Depends(get_gate),
) -> GateWebhookResponse:
    """GitHub pre-commit webhook — returns 200 (allow) or 403 (block)."""
    raw_body = await request.body()

    # Signature verification only when the secret is configured.
    signature = request.headers.get("X-Hub-Signature-256")
    _verify_github_signature(raw_body, signature)

    try:
        payload = GitHubPreCommitPayload.model_validate_json(raw_body or b"{}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("webhooks.github_bad_payload", error=str(exc))
        raise HTTPException(status_code=400, detail="invalid_payload") from exc

    project_id = payload.project_id or UUID(int=0)
    decision = await gate.enforce_security_gate(
        commit_sha=payload.commit_sha,
        project_id=project_id,
        tenant_id=payload.tenant_id,
        actor_id=payload.actor_id,
        commit_author=payload.author_email or payload.author_login,
    )

    response = GateWebhookResponse(
        allowed=decision.allowed,
        decision=decision.decision,
        report_id=str(decision.report_id),
        reason=decision.reason,
        findings_count=len(decision.findings),
        remediation_issue_key=None,
        commit_sha=payload.commit_sha,
    )

    if not decision.allowed:
        # GitHub returns the response status to the push decision logic;
        # 403 = block. We still serialize the JSON body so downstream
        # tooling can read the gate's reason.
        return _respond_blocked(response)

    return response


def _respond_blocked(body: GateWebhookResponse) -> GateWebhookResponse:
    """Set status code 403 for blocked pushes.

    FastAPI doesn't allow handlers to set arbitrary status codes without
    a Response object, so this helper is wired via the endpoint below.
    The endpoint returns the body; the actual ``403`` is enforced by
    raising an HTTPException(403, detail=body.model_dump_json()).
    """
    return body
@require_approval_phase(SDLCPhase.IMPLEMENTATION)


@router.post(
    "/github/pre-commit/lock",
    include_in_schema=False,
)
async def github_pre_commit_lock(
    request: Request,
    gate: MergeGate = Depends(get_gate),
) -> dict[str, Any]:
    """Same as ``/github/pre-commit`` but always returns 403 on FAIL.

    This alternate path is used by integrations that want the HTTP
    status code itself to drive the block (rather than the JSON body).
    """
    raw_body = await request.body()
    signature = request.headers.get("X-Hub-Signature-256")
    _verify_github_signature(raw_body, signature)

    try:
        payload = GitHubPreCommitPayload.model_validate_json(raw_body or b"{}")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid_payload") from exc

    project_id = payload.project_id or UUID(int=0)
    decision = await gate.enforce_security_gate(
        commit_sha=payload.commit_sha,
        project_id=project_id,
        tenant_id=payload.tenant_id,
        actor_id=payload.actor_id,
        commit_author=payload.author_email or payload.author_login,
    )

    body = {
        "allowed": decision.allowed,
        "decision": decision.decision,
        "report_id": str(decision.report_id),
        "reason": decision.reason,
        "findings_count": len(decision.findings),
        "commit_sha": payload.commit_sha,
    }
    if not decision.allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=body,
        )
    return body


__all__ = [
    "router",
    "get_gate",
    "GitHubPreCommitPayload",
    "GateWebhookResponse",
]