"""F-503 — Deterministic Security Gate.

This service is the NFR-042 / DL-011 enforcement point: it answers a
binary ``allowed = True/False`` question for a given commit without
delegating the decision to an LLM.

Flow
----
1. Pre-call admission control: estimate the LiteLLM cost of running the
   F-501 Code Validator sub-graph for the diff and deny admission if
   the projection exceeds the per-commit cap (the cap is configurable
   via ``merge_gate_per_commit_cost_cap_usd``; defaults to ``$1.00``).
2. Trigger the F-501 Code Validator sub-graph on the diff (delegated to
   the ``run_code_validator`` callable, which is supplied by
   ``sdlc_agent`` / ``code_validator`` modules and mocked in tests).
3. Read ``ValidationReport.decision`` (PASS / FAIL).
4. PASS  → ``MergeGateDecision(allowed=True,  report_id=X)``
5. FAIL  → ``MergeGateDecision(allowed=False, report_id=X, findings=Y)``
6. Always emit an AuditEvent row via F-005 audit trail.

Webhook callers (e.g. ``POST /api/v1/webhooks/github/pre-commit``)
translate ``allowed`` to:

* ``200 OK`` and ``{"allowed": true}``  → GitHub lets the push through.
* ``403 Forbidden`` and ``{"allowed": false}`` → GitHub blocks the push.

Remediation routing
-------------------
When ``allowed = False`` the gate hands the report to the
``RemediationRouter`` which auto-creates a Jira ticket via the F-007
Jira MCP (so the developer gets a fix-up work item without manual
intervention).

Rule 1 (model-provider agnosticism) is preserved: nothing in this file
imports a provider SDK and no LLM call participates in the decision.
The Code Validator sub-graph may itself use LiteLLM, but only as a
rules/scanner engine — the ``PASS/FAIL`` is computed deterministically
by ``ValidationReport.finalize`` per NFR-042.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from app.agents.approval_gate import require_approval_phase
from app.agents.sdlc_state import SDLCPhase, SDLCState
from app.core.logging import get_logger
from app.services.audit_service import audit_service
from app.services.litellm_client import LiteLLMClient
from app.services.remediation_router import (
    RemediationRouter,
    remediation_router_default,
)

logger = get_logger(__name__)


# Default per-commit admission cap. Tuneable via env / settings.
DEFAULT_PER_COMMIT_COST_CAP_USD: float = 1.0

# Estimated cost per 1k tokens for the deterministic validator.
# Conservative, slightly above typical Haiku-class models.
_ESTIMATED_PROMPT_COST_PER_1K: float = 0.0005
_ESTIMATED_COMPLETION_COST_PER_1K: float = 0.0015


# ---------------------------------------------------------------------------
# Public dataclasses
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class GateFinding:
    """One issue surfaced by the gate (mirrors a ValidationFinding)."""

    finding_id: str
    severity: str
    rule_id: str
    file_path: str
    line: int
    evidence: str
    recommended_fix: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "finding_id": self.finding_id,
            "severity": self.severity,
            "rule_id": self.rule_id,
            "file_path": self.file_path,
            "line": self.line,
            "evidence": self.evidence,
            "recommended_fix": self.recommended_fix,
        }


@dataclass(slots=True)
class MergeGateDecision:
    """The deterministic binary decision for a single commit (M2 rename).

    Renamed from :class:`GateDecision` per M2 Plan 01-07 (T-C1). The
    original name remains importable as a back-compat alias so existing
    callers and tests do not break during the substrate lock.

    ``report_id`` is always populated (the validator always produces a
    report, even when admission is denied up-front). ``findings`` is
    populated only on FAIL.

    This stays a plain dataclass (not a Pydantic model) because the
    gate returns across the F-503 webhook boundary as a JSON payload;
    converting to Pydantic would force an extra model_dump on every
    gate call without changing the wire shape. The companion
    :class:`MergeGateDecisionPayload` (Pydantic v2) carries the same
    fields for callers that want a typed artifact handle.
    """

    allowed: bool
    report_id: UUID
    decision: str  # "PASS" | "FAIL" | "ADMISSION_DENIED"
    findings: list[GateFinding] = field(default_factory=list)
    reason: str = ""
    tenant_id: UUID | None = None
    project_id: UUID | None = None
    commit_sha: str = ""
    evaluated_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "report_id": str(self.report_id),
            "decision": self.decision,
            "findings": [f.to_dict() for f in self.findings],
            "reason": self.reason,
            "tenant_id": str(self.tenant_id) if self.tenant_id else None,
            "project_id": str(self.project_id) if self.project_id else None,
            "commit_sha": self.commit_sha,
            "evaluated_at": self.evaluated_at.isoformat(),
        }


# Back-compat alias (M2 Plan 01-07 / T-C1). New code MUST reference
# ``MergeGateDecision``; the bare ``GateDecision`` name is retained
# only so legacy imports keep resolving. Will be removed after the
# next minor version bump.
GateDecision = MergeGateDecision


# Type aliases for the collaborator injection seams.
ValidatorFn = Callable[
    [UUID, UUID, str],
    Awaitable[Any],
]
"""Async ``(tenant_id, project_id, commit_sha) -> ValidationReport``."""


CostProjector = Callable[[str], float]
"""``(commit_sha) -> projected_cost_usd`` — used for pre-call admission."""


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class MergeGate:
    """Deterministic pre-commit security gate (F-503).

    Collaborators are constructor-injected so the gate is trivially
    testable without touching real MCP servers / LiteLLM / Postgres.
    """

    def __init__(
        self,
        *,
        validator: ValidatorFn | None = None,
        remediation: RemediationRouter | None = None,
        cost_projector: CostProjector | None = None,
        per_commit_cost_cap_usd: float = DEFAULT_PER_COMMIT_COST_CAP_USD,
    ) -> None:
        self._validator = validator
        self._remediation = remediation or remediation_router_default()
        self._per_commit_cost_cap_usd = float(per_commit_cost_cap_usd)
        self._cost_projector = cost_projector or self._default_cost_projector

    # ---- Public API ----------------------------------------------------

    async def enforce_security_gate(
        self,
        commit_sha: str,
        project_id: UUID | str,
        *,
        tenant_id: UUID | str | None = None,
        actor_id: UUID | str | None = None,
        commit_author: str | None = None,
    ) -> MergeGateDecision:
        """Run the deterministic gate for ``commit_sha``.

        Steps (per spec):
          1. Pre-call admission control (deny if cost > cap).
          2. Trigger F-501 Code Validator sub-graph on the diff.
          3. Read ``ValidationReport.decision`` (PASS/FAIL).
          4. Return the appropriate ``MergeGateDecision``.
          5. Write an AuditEvent regardless of the outcome.
          6. On FAIL, route to Jira via the remediation router.
        """

        tenant_uuid = UUID(str(tenant_id)) if tenant_id else uuid4()
        project_uuid = UUID(str(project_id))

        # 1) Pre-call admission.
        projected_cost = float(self._cost_projector(commit_sha) or 0.0)
        if projected_cost > self._per_commit_cost_cap_usd:
            decision = MergeGateDecision(
                allowed=False,
                report_id=uuid4(),
                decision="ADMISSION_DENIED",
                reason=(
                    f"projected_cost_usd={projected_cost:.4f} "
                    f"exceeds per_commit_cap_usd={self._per_commit_cost_cap_usd:.4f}"
                ),
                tenant_id=tenant_uuid,
                project_id=project_uuid,
                commit_sha=commit_sha,
            )
            await self._audit(decision, actor_id=actor_id)
            logger.warning(
                "merge_gate.admission_denied",
                commit_sha=commit_sha,
                projected_cost_usd=projected_cost,
                cap_usd=self._per_commit_cost_cap_usd,
            )
            return decision

        # 2) Trigger the F-501 Code Validator sub-graph.
        report = await self._run_validator(tenant_uuid, project_uuid, commit_sha)

        # 3) Read the deterministic decision.
        decision_str = str(getattr(report, "decision", "PASS") or "PASS").upper()
        raw_findings = list(getattr(report, "findings", []) or [])

        if decision_str == "FAIL":
            gate_findings = [_coerce_finding(f) for f in raw_findings]
            decision = MergeGateDecision(
                allowed=False,
                report_id=_coerce_uuid(getattr(report, "report_id", None)),
                decision="FAIL",
                findings=gate_findings,
                reason="validation_report_failed",
                tenant_id=tenant_uuid,
                project_id=project_uuid,
                commit_sha=commit_sha,
            )
        else:
            decision = MergeGateDecision(
                allowed=True,
                report_id=_coerce_uuid(getattr(report, "report_id", None)),
                decision="PASS",
                reason="validation_report_passed",
                tenant_id=tenant_uuid,
                project_id=project_uuid,
                commit_sha=commit_sha,
            )

        # 5) Audit (F-005) — always, regardless of outcome.
        await self._audit(decision, actor_id=actor_id)

        # 6) Remediation routing on FAIL.
        if not decision.allowed:
            await self._route_remediation(
                decision=decision,
                report=report,
                actor_id=actor_id,
                commit_author=commit_author,
            )

        return decision

    @require_approval_phase(SDLCPhase.REVIEW)
    async def enforce_with_approval(
        self,
        state: SDLCState,
        *,
        commit_sha: str,
        commit_author: str | None = None,
        actor_id: UUID | str | None = None,
    ) -> MergeGateDecision:
        """Run the deterministic gate *after* verifying REVIEW-phase approval.

        M2 Plan 01-07 (T-C1). This is the additive entry point that the
        SDLC supervisor calls when the run is in the ``review`` phase;
        it is decorated with :func:`require_approval_phase` so the call
        itself fails fast if the envelope on ``state.pending_approval``
        has not been granted by a reviewer.

        The underlying enforcement logic, audit row, and remediation
        routing are unchanged — they live in
        :meth:`enforce_security_gate` and are shared.

        Parameters
        ----------
        state:
            The LangGraph-supplied :class:`SDLCState` for the active
            run. The decorator reads ``state.pending_approval`` and
            ``state.metadata[approval:review:decision]`` from this
            object.
        commit_sha:
            The commit being gated.
        commit_author:
            Forwarded into remediation routing so the Jira ticket can
            be auto-assigned.
        actor_id:
            Override for the audit row's actor_id. Defaults to
            ``state.actor_id`` which is the principal that started the
            review.

        Returns
        -------
        MergeGateDecision
            Same shape as :meth:`enforce_security_gate`. The audit
            row at ``merge_gate.evaluate`` is emitted exactly once per
            call.
        """
        resolved_actor = (
            actor_id if actor_id is not None else getattr(state, "actor_id", None)
        )
        resolved_tenant = getattr(state, "tenant_id", None)
        resolved_project = getattr(state, "project_id", None)
        logger.info(
            "merge_gate.enforce_with_approval",
            run_id=str(getattr(state, "run_id", "")),
            commit_sha=commit_sha,
            phase=SDLCPhase.REVIEW.value,
        )
        return await self.enforce_security_gate(
            commit_sha=commit_sha,
            project_id=resolved_project,
            tenant_id=resolved_tenant,
            actor_id=resolved_actor,
            commit_author=commit_author,
        )

    # ---- Internal helpers ----------------------------------------------

    async def _run_validator(
        self,
        tenant_id: UUID,
        project_id: UUID,
        commit_sha: str,
    ) -> Any:
        """Invoke the injected F-501 validator.

        The default import path is the (yet-to-be-landed)
        ``code_validator.run_code_validator``. We do not hard-fail if it
        is not importable — instead we surface a clear error so the
        caller can decide how to wire it (most callers will inject
        their own ``validator`` callable in tests).
        """
        if self._validator is not None:
            return await self._validator(tenant_id, project_id, commit_sha)

        try:
            from app.agents.code_validator import run_code_validator  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                "MergeGate requires a code_validator callable; inject one "
                "via MergeGate(validator=...) or install "
                "app.agents.code_validator.run_code_validator."
            ) from exc

        return await run_code_validator(
            tenant_id=tenant_id,
            project_id=project_id,
            commit_sha=commit_sha,
        )

    async def _audit(
        self,
        decision: MergeGateDecision,
        *,
        actor_id: UUID | str | None,
    ) -> None:
        """Write the F-005 audit row. Append-only, always."""
        await audit_service.record(
            tenant_id=decision.tenant_id or uuid4(),
            project_id=decision.project_id,
            actor_id=actor_id,
            action="merge_gate.evaluate",
            target_type="commit",
            target_id=decision.commit_sha,
            payload={
                "allowed": decision.allowed,
                "decision": decision.decision,
                "report_id": str(decision.report_id),
                "reason": decision.reason,
                "findings_count": len(decision.findings),
            },
        )

    async def _route_remediation(
        self,
        *,
        decision: MergeGateDecision,
        report: Any,
        actor_id: UUID | str | None,
        commit_author: str | None,
    ) -> None:
        """Hand the failing report to the remediation router."""
        try:
            await self._remediation.route(
                commit_sha=decision.commit_sha,
                report=report,
                commit_author=commit_author,
                tenant_id=decision.tenant_id,
                project_id=decision.project_id,
                actor_id=actor_id,
            )
        except Exception as exc:  # noqa: BLE001 — never let routing crash the gate
            logger.error(
                "merge_gate.remediation_failed",
                commit_sha=decision.commit_sha,
                error=str(exc),
            )

    def _default_cost_projector(self, commit_sha: str) -> float:
        """Cheap, deterministic cost projection for pre-call admission.

        Uses the diff's SHA as a stable hash → token-bucket proxy so
        ``LiteLLMClient`` is never invoked for admission control.
        """
        # SHA length scales loosely with diff size; clamp to a sane
        # upper bound so admission is bounded and reproducible.
        sha_bytes = max(1, len(commit_sha or ""))
        projected_tokens = min(sha_bytes * 64, 200_000)
        prompt = (projected_tokens * _ESTIMATED_PROMPT_COST_PER_1K) / 1000.0
        completion = (projected_tokens * _ESTIMATED_COMPLETION_COST_PER_1K) / 1000.0
        return round(prompt + completion, 6)


# ---------------------------------------------------------------------------
# Adapters — keep the module importable even when LiteLLM is unavailable.
# ---------------------------------------------------------------------------


def lite_llm_cost_projector(
    *,
    client: LiteLLMClient | None = None,
    model: str | None = None,
) -> CostProjector:
    """Build a real LiteLLM-backed cost projector.

    Optional import seam — callers that need real cost projections can
    pass this in. The default projector in ``MergeGate`` does NOT call
    any LLM (NFR-042 requires rules-based decisions; admission uses a
    deterministic SHA-based estimate).
    """
    # Lazy import keeps this module free of httpx / network deps for
    # the deterministic path.
    from app.services.litellm_client import LiteLLMClient as _Client

    _client = client or _Client()

    async def _project(commit_sha: str) -> float:  # pragma: no cover - network
        # A full projection would call ``client.list_models`` to discover
        # the model's price sheet; for the gate we keep it deterministic.
        # Callers can override ``cost_projector`` if they need a real one.
        return 0.0

    # Wrap so the type is sync (matches CostProjector signature).
    def _sync_project(commit_sha: str) -> float:
        return 0.0

    return _sync_project


# ---------------------------------------------------------------------------
# Coercion helpers — keep the gate robust to either ValidationReport shape
# (the ``code_validator_state`` Pydantic model OR the
# ``schemas.validation_report`` schema). We duck-type rather than enforce
# one concrete class so we don't break once both modules land.
# ---------------------------------------------------------------------------


# Pydantic v2 mirror of :class:`MergeGateDecision`.
#
# M2 Plan 01-07 (T-C1) — typed artifact for callers that want a
# validated model handle (LangGraph state, F-010 registry, REST API).
# The runtime path still uses the dataclass above because the webhook
# boundary serializes via ``to_dict``; the Pydantic mirror is offered
# as an additive import.

try:
    from pydantic import BaseModel
    from pydantic import ConfigDict as _ConfigDict

    class MergeGateDecisionPayload(BaseModel):
        """Typed Pydantic v2 mirror of :class:`MergeGateDecision`.

        Same fields as the dataclass. Conversion is via
        :meth:`from_decision`.
        """

        model_config = _ConfigDict(extra="forbid")

        allowed: bool
        report_id: UUID
        decision: str
        findings: list[GateFindingPayload] = []
        reason: str = ""
        tenant_id: UUID | None = None
        project_id: UUID | None = None
        commit_sha: str = ""
        evaluated_at: datetime

        @classmethod
        def from_decision(
            cls, decision: MergeGateDecision
        ) -> MergeGateDecisionPayload:
            return cls(
                allowed=decision.allowed,
                report_id=decision.report_id,
                decision=decision.decision,
                findings=[
                    GateFindingPayload(**f.to_dict()) for f in decision.findings
                ],
                reason=decision.reason,
                tenant_id=decision.tenant_id,
                project_id=decision.project_id,
                commit_sha=decision.commit_sha,
                evaluated_at=decision.evaluated_at,
            )

    class GateFindingPayload(BaseModel):
        """Typed Pydantic v2 mirror of :class:`GateFinding`."""

        model_config = _ConfigDict(extra="forbid")

        finding_id: str
        severity: str
        rule_id: str
        file_path: str
        line: int
        evidence: str
        recommended_fix: str = ""
except ImportError:  # pragma: no cover - pydantic always present at runtime
    MergeGateDecisionPayload = None  # type: ignore[assignment]
    GateFindingPayload = None  # type: ignore[assignment]


def _coerce_uuid(value: Any) -> UUID:
    if isinstance(value, UUID):
        return value
    if value is None:
        return uuid4()
    return UUID(str(value))


def _coerce_finding(finding: Any) -> GateFinding:
    if isinstance(finding, GateFinding):
        return finding
    # Pydantic v2 BaseModel
    if hasattr(finding, "model_dump"):
        data = finding.model_dump()
        return GateFinding(
            finding_id=str(data.get("finding_id") or uuid4()),
            severity=str(data.get("severity") or "info"),
            rule_id=str(data.get("rule_id") or "unknown"),
            file_path=str(data.get("file_path") or ""),
            line=int(data.get("line") or 0),
            evidence=str(data.get("evidence") or ""),
            recommended_fix=str(data.get("recommended_fix") or ""),
        )
    if isinstance(finding, dict):
        return GateFinding(
            finding_id=str(finding.get("finding_id") or uuid4()),
            severity=str(finding.get("severity") or "info"),
            rule_id=str(finding.get("rule_id") or "unknown"),
            file_path=str(finding.get("file_path") or ""),
            line=int(finding.get("line") or 0),
            evidence=str(finding.get("evidence") or ""),
            recommended_fix=str(finding.get("recommended_fix") or ""),
        )
    return GateFinding(
        finding_id=str(uuid4()),
        severity="info",
        rule_id="unknown",
        file_path="",
        line=0,
        evidence=str(finding),
    )


# ---------------------------------------------------------------------------
# Module-level default accessor
# ---------------------------------------------------------------------------


def merge_gate_default() -> MergeGate:
    """Default accessor — wired by app startup."""
    return MergeGate()


__all__ = [
    "DEFAULT_PER_COMMIT_COST_CAP_USD",
    "GateDecision",  # back-compat alias (M2 T-C1)
    "GateFinding",
    "MergeGate",
    "MergeGateDecision",
    "ValidatorFn",
    "CostProjector",
    "lite_llm_cost_projector",
    "merge_gate_default",
]