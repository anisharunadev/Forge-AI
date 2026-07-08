"""F-503 — typed Pydantic v2 artifact for the rules-only Merge Gate.

The Merge Gate is the substrate gate that decides whether a run is
allowed to merge into the protected branch. It consumes a
:class:`ValidationReport` from the F-501 Code Validator sub-graph
(plan 01-05) and emits a typed :class:`MergeGateDecision`.

Locked Phase 1 decision (STATE.md):

  "Merge Gate (F-503) is rules-only — LLM is excluded from the gate
   decision."

The gate therefore never imports :mod:`app.services.litellm_client`
and never calls a provider. The rule lives here, enforced by
``tests/test_merge_gate_rules_only.py::test_no_llm_call``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

BlockerCategory = Literal[
    "validation",
    "cost_cap",
    "approval_missing",
    "bundle_violation",
    "policy",
]
VerdictLiteral = Literal["pass", "warn", "fail"]


class MergeGateBlocker(BaseModel):
    """One reason the Merge Gate produced ``verdict == "fail"``.

    Every blocker carries a category, a human-readable message, and a
    stable ``evidence_ref`` pointing back to the rule or artifact that
    triggered the block (e.g. ``validation_report_id``,
    ``cost_ledger_entry_id``).
    """

    model_config = ConfigDict(extra="forbid")

    category: BlockerCategory
    message: str = Field(..., min_length=1)
    evidence_ref: str = Field(..., min_length=1)


class MergeGateDecision(BaseModel):
    """Typed artifact emitted by :class:`MergeGateEngine`.

    Rule 2 (multi-tenancy by default): ``tenant_id`` and
    ``project_id`` are required UUIDs, never optional. The verdict
    set is closed (``"pass"`` / ``"warn"`` / ``"fail"``) so the UI
    does not need to handle free-form strings.
    """

    model_config = ConfigDict(extra="forbid")

    tenant_id: UUID
    project_id: UUID
    run_id: UUID
    validation_report_id: UUID
    verdict: VerdictLiteral
    blockers: list[MergeGateBlocker] = Field(default_factory=list)
    produced_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @property
    def is_blocking(self) -> bool:
        """``True`` iff ``verdict == "fail"`` — downstream gates MUST
        block traffic on this decision.
        """
        return self.verdict == "fail"

    def to_kg_payload(self) -> dict[str, Any]:
        """Return a dict shaped for the React Flow knowledge graph.

        Schema matches the ``KGNode`` contract used by the
        Architecture Center renderer::

            {
                "id": "merge-gate:<run_id>",
                "type": "artifact",
                "label": "MergeGate fail",
                "data": {
                    "kind": "MergeGateDecision",
                    "verdict": "fail",
                    "is_blocking": True,
                    "blocker_count": 2,
                    "categories": ["validation", "cost_cap"],
                    ...
                },
            }
        """
        return {
            "id": f"merge-gate:{self.run_id}",
            "type": "artifact",
            "label": f"MergeGate {self.verdict}",
            "data": {
                "kind": "MergeGateDecision",
                "verdict": self.verdict,
                "is_blocking": self.is_blocking,
                "blocker_count": len(self.blockers),
                "categories": sorted({b.category for b in self.blockers}),
                "run_id": str(self.run_id),
                "validation_report_id": str(self.validation_report_id),
                "tenant_id": str(self.tenant_id),
                "project_id": str(self.project_id),
                "produced_at": self.produced_at.isoformat(),
            },
        }


__all__ = [
    "BlockerCategory",
    "VerdictLiteral",
    "MergeGateBlocker",
    "MergeGateDecision",
]
