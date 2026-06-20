"""
Schemas for the Self-Healing Agent v1 contract (FORA-37).

This module defines the wire format that the Self-Healing Agent (Epic
4 / Goal 4.2) uses to communicate selector-drift detections and
proposed test repairs to downstream stages. The actual selector-repair
loop lives in Phase 4 and is feature-flagged off in v1; v1 ships a
deterministic dry-run that only reads a recorded Playwright trace and
emits a `RepairProposal` JSON, never mutating a test file.

Three top-level types are exported:

    DetectedDrift    — one observed selector change in a recorded trace
    RepairProposal   — a per-run bundle of detected drifts and a
                       list of proposed repairs (no applies in v1)
    ValidationRunId  — opaque join key to the test run that surfaced
                       the drift (the run whose trace was the input)

The contract is intentionally narrow: the Phase 4 implementation can
extend it without breaking the v1 dry-run, but the v1 fields are
frozen. A `schema_version` field on every top-level payload is the
gate; a payload whose major version this code does not know about is
rejected (fail closed).

Versioning
----------
The package is at contract version 0.1.0 (CONTRACT_VERSION). The
major version is `0` while the v1 scaffold is in place. Phase 4
bumps it to `1.0.0` when the apply path is enabled. Additive
changes between major versions are minor bumps; breaking changes
require a major bump and a new ADR (or a comment thread on FORA-37).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import re
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


# v1 wire format. Bump major when the apply path lands in Phase 4.
CONTRACT_VERSION = "0.1.0"


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class DriftKind(str, Enum):
    """The kind of drift observed between a recorded trace and the
    selector that the test currently expects.

    v1 only emits a small, observable subset. Phase 4 may add kinds
    (e.g. ROLE_RENAMED, ARIA_LABEL_CHANGED) but must not redefine any
    of these.
    """
    SELECTOR_MISSING = "selector_missing"        # target element not in DOM
    SELECTOR_AMBIGUOUS = "selector_ambiguous"    # >1 element matches
    ATTRIBUTE_VALUE_CHANGED = "attribute_value_changed"


class RepairKind(str, Enum):
    """The kind of repair being proposed.

    v1 emits PROPOSE_NEW_SELECTOR only. Phase 4 emits APPLY and may
    add others (e.g. SKIP_WITH_REASON).
    """
    PROPOSE_NEW_SELECTOR = "propose_new_selector"
    # Phase 4 (not in v1): APPLY, REVERT, SKIP_WITH_REASON


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_ISO_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$")


def _now() -> str:
    """Return the current UTC timestamp in ISO 8601 with a `Z` suffix."""
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _is_iso8601_utc(s: str) -> bool:
    return bool(s) and bool(_ISO_UTC.match(s))


def _new_id(prefix: str) -> str:
    """Generate `<prefix>-<uuid4>` style ids. v1 uses uuid4 hex; the
    wire format only requires the id to be unique and prefixed, so
    Phase 4 can swap to a different scheme without breaking the v1
    consumer as long as the prefix is preserved.
    """
    import uuid
    return f"{prefix}-{uuid.uuid4().hex}"


def _stable_id(prefix: str, *parts: str) -> str:
    """A stable id derived from the inputs (used for the trace-keyed
    proposal id so re-running the dry-run on the same trace yields
    the same `proposal_id`).
    """
    h = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:16]
    return f"{prefix}-{h}"


# ---------------------------------------------------------------------------
# DetectedDrift
# ---------------------------------------------------------------------------

@dataclass
class DetectedDrift:
    """One observable drift in a recorded trace.

    `original_selector` is the selector the test issued; `observed`
    carries the trace event that disagreed with it (a snapshot of the
    action result or the page state). `confidence` is a deterministic
    rule-based score in [0.0, 1.0] — v1 does not call an LLM to set it.
    """
    drift_id: str
    kind: DriftKind
    original_selector: str
    observed: str
    confidence: float
    test_file: str
    test_name: str
    page_url: str = ""
    action_index: int = -1

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["kind"] = self.kind.value
        return out

    def validate(self) -> List[str]:
        errors: List[str] = []
        if not self.drift_id:
            errors.append("drift.drift_id is required")
        if self.kind not in DriftKind:
            errors.append(
                f"drift.kind must be one of {[k.value for k in DriftKind]}, "
                f"got {self.kind!r}"
            )
        if not self.original_selector:
            errors.append("drift.original_selector is required")
        if not self.observed:
            errors.append("drift.observed is required")
        if not (0.0 <= self.confidence <= 1.0):
            errors.append(
                f"drift.confidence must be in [0.0, 1.0], got {self.confidence!r}"
            )
        if not self.test_file:
            errors.append("drift.test_file is required")
        if not self.test_name:
            errors.append("drift.test_name is required")
        if self.action_index < 0:
            errors.append(
                f"drift.action_index must be >= 0, got {self.action_index!r}"
            )
        return errors


# ---------------------------------------------------------------------------
# RepairProposal
# ---------------------------------------------------------------------------

@dataclass
class ProposedRepair:
    """One proposed repair inside a `RepairProposal`.

    v1 only carries a `proposed_selector` (a text alternative) and a
    rule-based rationale. Phase 4 will add a `diff` and an `apply` path
    gated on the feature flag; the v1 shape must not change.
    """
    repair_id: str
    drift_id: str
    kind: RepairKind
    proposed_selector: str
    rationale: str
    confidence: float

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["kind"] = self.kind.value
        return out

    def validate(self) -> List[str]:
        errors: List[str] = []
        if not self.repair_id:
            errors.append("repair.repair_id is required")
        if not self.drift_id:
            errors.append("repair.drift_id is required")
        if self.kind not in RepairKind:
            errors.append(
                f"repair.kind must be one of {[k.value for k in RepairKind]}, "
                f"got {self.kind!r}"
            )
        if self.kind == RepairKind.PROPOSE_NEW_SELECTOR and not self.proposed_selector:
            errors.append("repair.proposed_selector is required for propose_new_selector")
        if not (0.0 <= self.confidence <= 1.0):
            errors.append(
                f"repair.confidence must be in [0.0, 1.0], got {self.confidence!r}"
            )
        if not self.rationale:
            errors.append("repair.rationale is required")
        return errors


@dataclass
class RepairProposal:
    """A bundle of detected drifts and proposed repairs produced from
    a single recorded trace.

    `validation_run_id` joins the proposal back to the originating test
    run (the run whose trace was read). `proposal_id` is stable for a
    given (trace_sha, run_id) pair so re-running the dry-run is
    idempotent. `mode == "dry_run"` is the v1 invariant: nothing in
    this payload has been applied to a test file.
    """
    schema_version: str
    proposal_id: str
    validation_run_id: str        # join key into the test run
    trace_sha: str                # sha256 of the input trace
    source_test_run_id: str       # the CI run the trace came from
    detected_drift: List[DetectedDrift] = field(default_factory=list)
    repair_proposal: List[ProposedRepair] = field(default_factory=list)
    mode: str = "dry_run"         # v1 invariant; Phase 4 adds "applied"
    feature_flag: Dict[str, Any] = field(default_factory=dict)
    produced_at: str = field(default_factory=_now)
    notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        out = asdict(self)
        out["detected_drift"] = [d.to_dict() for d in self.detected_drift]
        out["repair_proposal"] = [r.to_dict() for r in self.repair_proposal]
        return out

    def validate(self) -> List[str]:
        errors: List[str] = []
        if self.schema_version != CONTRACT_VERSION:
            errors.append(
                f"RepairProposal.schema_version must be {CONTRACT_VERSION!r}, "
                f"got {self.schema_version!r}"
            )
        if not self.proposal_id:
            errors.append("repair_proposal.proposal_id is required")
        if not self.validation_run_id:
            errors.append("repair_proposal.validation_run_id is required")
        if not self.trace_sha:
            errors.append("repair_proposal.trace_sha is required")
        if not self.source_test_run_id:
            errors.append("repair_proposal.source_test_run_id is required")
        if self.mode not in ("dry_run", "applied"):
            errors.append(
                f"repair_proposal.mode must be 'dry_run' or 'applied', "
                f"got {self.mode!r}"
            )
        # v1 invariant: mode MUST be dry_run.
        if self.mode != "dry_run":
            errors.append(
                "repair_proposal.mode == 'applied' is reserved for Phase 4; "
                "v1 is dry-run only"
            )
        if not _is_iso8601_utc(self.produced_at):
            errors.append(
                f"repair_proposal.produced_at must be ISO 8601 UTC, "
                f"got {self.produced_at!r}"
            )
        seen_drifts = set()
        for d in self.detected_drift:
            errs = d.validate()
            errors.extend(f"detected_drift[{d.drift_id}] {e}" for e in errs)
            if d.drift_id in seen_drifts:
                errors.append(
                    f"detected_drift has duplicate id: {d.drift_id!r}"
                )
            seen_drifts.add(d.drift_id)
        seen_repairs = set()
        for r in self.repair_proposal:
            errs = r.validate()
            errors.extend(f"repair_proposal[{r.repair_id}] {e}" for e in errs)
            if r.repair_id in seen_repairs:
                errors.append(
                    f"repair_proposal has duplicate id: {r.repair_id!r}"
                )
            seen_repairs.add(r.repair_id)
            if r.drift_id not in seen_drifts:
                errors.append(
                    f"repair_proposal[{r.repair_id}] references unknown "
                    f"drift_id {r.drift_id!r}"
                )
        return errors


# ---------------------------------------------------------------------------
# ValidationRunId
# ---------------------------------------------------------------------------

@dataclass
class ValidationRunId:
    """Opaque join key for the test run whose trace was the input.

    The `id` is the run id assigned by the test framework (e.g.
    Playwright's `run_id`, an Allure `uuid`, or a CI run number). The
    `framework` makes the id's provenance explicit so the Phase 4
    implementation can route it back to the right reporter.
    """
    id: str
    framework: str                # e.g. "playwright", "cypress", "allure"
    branch: str = ""
    commit_sha: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def validate(self) -> List[str]:
        errors: List[str] = []
        if not self.id:
            errors.append("validation_run_id.id is required")
        if not self.framework:
            errors.append("validation_run_id.framework is required")
        if self.commit_sha and not re.match(r"^[0-9a-f]{40}$", self.commit_sha):
            errors.append(
                "validation_run_id.commit_sha must be 40 lowercase hex if set"
            )
        return errors
