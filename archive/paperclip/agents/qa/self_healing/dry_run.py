"""
Deterministic dry-run for the Self-Healing Agent v1 (FORA-37).

The v1 path is rule-based: it reads a recorded Playwright trace JSON
and emits a `RepairProposal`. It never mutates a test file. Phase 4
adds the apply step; in v1 the apply path raises `NotImplementedError`
if it is ever called with the feature flag enabled.

Input trace shape (v1)
----------------------
The dry-run consumes a minimal, hand-written trace schema. We do not
depend on Playwright's binary trace format in v1 — the rules are
simpler and the fixture is human-readable. The shape is:

    {
      "trace_id": "trc-...",
      "framework": "playwright",
      "branch": "main",
      "commit_sha": "<40 lowercase hex>",
      "actions": [
        {
          "action_index": 0,
          "method": "click" | "fill" | "assert_text" | ...,
          "selector": "<the selector the test used>",
          "result": "ok" | "timeout" | "no_element" | "multiple" | "wrong_value",
          "observed": "<free text: what the page actually showed>",
          "page_url": "https://example/...",
          "test_file": "tests/checkout.spec.ts",
          "test_name": "should complete checkout"
        },
        ...
      ]
    }

Rule-based detection
--------------------
v1 recognises three drift kinds, derived from `result`:

    result == "no_element"      -> SELECTOR_MISSING
    result == "multiple"        -> SELECTOR_AMBIGUOUS
    result == "wrong_value"     -> ATTRIBUTE_VALUE_CHANGED

`ok` and `timeout` are recorded as no-drift actions; `timeout` is
flagged in `notes` so a future Phase 4 rule set can promote it to a
drift kind, but it does not emit a repair in v1.

Each drift gets a deterministic id (`drift-<sha16>`) so re-running on
the same trace yields the same ids. The proposal id is
`prop-<sha16(trace_sha + run_id)>` and the repair id is
`repair-<sha16(drift_id)>`.

No LLM calls
------------
There is no model invocation in this module. The proposed selector
for a missing-selector drift is `None` (Phase 4 will fill it in via
the LLM or a hand-curated mapping); for an ambiguous-selector drift
the proposal suggests appending `:nth-of-type(...)`; for an
attribute-value drift the proposal suggests adding a `text=...`
filter. These are placeholders, not apply actions.
"""

from __future__ import annotations

import hashlib
import json
import os
from typing import Any, Dict, List, Optional, Tuple

from . import feature_flag
from .schemas import (
    CONTRACT_VERSION,
    DetectedDrift,
    DriftKind,
    ProposedRepair,
    RepairKind,
    RepairProposal,
    ValidationRunId,
    _new_id,
    _now,
    _stable_id,
)


SUPPORTED_FRAMEWORKS = ("playwright", "cypress")


# ---------------------------------------------------------------------------
# Trace loading
# ---------------------------------------------------------------------------

class TraceShapeError(ValueError):
    """The input trace is missing required fields or has the wrong shape."""


def _load_trace(trace_path: str) -> Dict[str, Any]:
    if not os.path.exists(trace_path):
        raise FileNotFoundError(f"trace fixture not found: {trace_path}")
    with open(trace_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise TraceShapeError("trace root must be an object")
    if "actions" not in data or not isinstance(data["actions"], list):
        raise TraceShapeError("trace must contain a list 'actions'")
    if not data["actions"]:
        raise TraceShapeError("trace 'actions' must contain at least one entry")
    return data


def _trace_sha(trace: Dict[str, Any]) -> str:
    """Stable sha256 of the trace payload (canonical JSON, sorted keys).

    The smoke test asserts that two runs over the same fixture yield
    the same `trace_sha`; sorting the keys is what makes the hash
    stable across re-writes of the fixture.
    """
    payload = json.dumps(trace, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Rule-based drift detection
# ---------------------------------------------------------------------------

def _result_to_kind(result: str) -> Optional[DriftKind]:
    if result == "no_element":
        return DriftKind.SELECTOR_MISSING
    if result == "multiple":
        return DriftKind.SELECTOR_AMBIGUOUS
    if result == "wrong_value":
        return DriftKind.ATTRIBUTE_VALUE_CHANGED
    return None


def _confidence_for(kind: DriftKind) -> float:
    """Deterministic, rule-based confidence. No LLM.

    v1 picks conservative numbers so a consumer can tell that the
    score is heuristic, not learned. Phase 4 will re-derive these
    against a labelled corpus.
    """
    if kind == DriftKind.SELECTOR_MISSING:
        return 0.85
    if kind == DriftKind.SELECTOR_AMBIGUOUS:
        return 0.90
    if kind == DriftKind.ATTRIBUTE_VALUE_CHANGED:
        return 0.70
    return 0.0


def _propose_selector(kind: DriftKind, action: Dict[str, Any]) -> str:
    """Rule-based selector proposal.

    These are advisory placeholders for v1. Phase 4 will replace them
    with LLM-backed or mapping-backed proposals, but the v1 contract
    carries them so the JSON shape is stable.
    """
    selector = action.get("selector", "")
    if kind == DriftKind.SELECTOR_MISSING:
        # No way to know what the new selector is from a trace alone.
        return ""
    if kind == DriftKind.SELECTOR_AMBIGUOUS:
        # Suggest narrowing with a positional pseudo-class. The exact
        # index is a v1 placeholder; Phase 4 should resolve it from
        # the observed snapshot.
        return f"{selector} >> nth=0"
    if kind == DriftKind.ATTRIBUTE_VALUE_CHANGED:
        # Suggest tightening by visible text or attribute match.
        return f"text=\"{action.get('observed', '')}\""
    return ""


def _rationale_for(kind: DriftKind) -> str:
    if kind == DriftKind.SELECTOR_MISSING:
        return "trace shows no_element; target was not in DOM at action time"
    if kind == DriftKind.SELECTOR_AMBIGUOUS:
        return "trace shows multiple matches; selector needs to be disambiguated"
    if kind == DriftKind.ATTRIBUTE_VALUE_CHANGED:
        return "trace shows the element's text/value did not match the test's expectation"
    return "no drift"


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_dry_run(
    trace_path: str,
    *,
    source_test_run_id: Optional[str] = None,
    validation_run_id: Optional[ValidationRunId] = None,
) -> RepairProposal:
    """Run the deterministic v1 dry-run on a recorded trace.

    The result is always a `RepairProposal` with `mode == "dry_run"`.
    The v1 path never mutates a test file. If the feature flag is
    somehow enabled in v1, this function still emits a dry-run
    proposal — the apply path is a separate function that is not
    called by the dry-run.
    """
    trace = _load_trace(trace_path)
    sha = _trace_sha(trace)
    framework = trace.get("framework", "playwright")
    if framework not in SUPPORTED_FRAMEWORKS:
        raise TraceShapeError(
            f"trace.framework must be one of {SUPPORTED_FRAMEWORKS}, got {framework!r}"
        )

    branch = trace.get("branch", "")
    commit_sha = trace.get("commit_sha", "")
    run_id = source_test_run_id or trace.get("trace_id") or _new_id("trc")

    vrn = validation_run_id or ValidationRunId(
        id=run_id,
        framework=framework,
        branch=branch,
        commit_sha=commit_sha,
    )

    proposal_id = _stable_id("prop", sha, run_id)
    drifts: List[DetectedDrift] = []
    repairs: List[ProposedRepair] = []
    notes: List[str] = []

    for action in trace["actions"]:
        result = action.get("result", "ok")
        if result == "ok":
            continue
        if result == "timeout":
            notes.append(
                f"action_index={action.get('action_index')}: timeout (v1 ignores; "
                "Phase 4 may promote to a drift kind)"
            )
            continue
        kind = _result_to_kind(result)
        if kind is None:
            notes.append(
                f"action_index={action.get('action_index')}: unknown result "
                f"{result!r}; skipping"
            )
            continue

        action_index = int(action.get("action_index", 0))
        test_file = action.get("test_file", "tests/unknown.spec.ts")
        test_name = action.get("test_name", "unknown test")
        original_selector = action.get("selector", "")
        observed = action.get("observed", "")
        page_url = action.get("page_url", "")

        drift_id = _stable_id("drift", sha, run_id, str(action_index), kind.value)
        confidence = _confidence_for(kind)
        drift = DetectedDrift(
            drift_id=drift_id,
            kind=kind,
            original_selector=original_selector,
            observed=observed,
            confidence=confidence,
            test_file=test_file,
            test_name=test_name,
            page_url=page_url,
            action_index=action_index,
        )
        drifts.append(drift)

        proposed = _propose_selector(kind, action)
        # Per the v1 contract, propose_new_selector requires a
        # proposed_selector. For SELECTOR_MISSING the placeholder is
        # empty, so we suppress the repair in that case — the drift
        # still appears in detected_drift, but the repair_proposal
        # only carries proposals we can stand behind.
        if proposed:
            repair_id = _stable_id("repair", drift_id)
            repair = ProposedRepair(
                repair_id=repair_id,
                drift_id=drift_id,
                kind=RepairKind.PROPOSE_NEW_SELECTOR,
                proposed_selector=proposed,
                rationale=_rationale_for(kind),
                confidence=confidence,
            )
            repairs.append(repair)

    proposal = RepairProposal(
        schema_version=CONTRACT_VERSION,
        proposal_id=proposal_id,
        validation_run_id=f"vrn-{vn_id(vrn)}",
        trace_sha=sha,
        source_test_run_id=run_id,
        detected_drift=drifts,
        repair_proposal=repairs,
        mode="dry_run",
        feature_flag=feature_flag.flag_payload(),
        produced_at=_now(),
        notes="; ".join(notes) if notes else "",
    )
    return proposal


def vn_id(vrn: ValidationRunId) -> str:
    """Stable hash of a ValidationRunId for the `validation_run_id` field.

    The wire format prefix is `vrn-` followed by a 16-char hex digest
    of the underlying ValidationRunId payload.
    """
    payload = json.dumps(vrn.to_dict(), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Apply path (Phase 4)
# ---------------------------------------------------------------------------

def apply_repair(
    proposal: RepairProposal,
    *,
    apply: bool = False,
) -> None:
    """Apply a `RepairProposal` to test files. NOT IMPLEMENTED IN v1.

    This function exists so the v1 code shape is forward-compatible
    with Phase 4, but it always raises unless the feature flag is
    enabled AND `apply=True` is passed. The smoke test never calls
    this function.
    """
    if not feature_flag.is_enabled():
        raise NotImplementedError(
            "Self-Healing Agent apply path is disabled in v1. "
            "See feature_flag.py and the Phase 4 flip runbook in README.md."
        )
    if not apply:
        raise ValueError("apply_repair must be called with apply=True to take effect")
    # Phase 4: implement the actual diff + write here. The v1 path
    # stops at the raise above so we never accidentally land a write.
    raise NotImplementedError("Phase 4 implementation is out of scope for FORA-37")
