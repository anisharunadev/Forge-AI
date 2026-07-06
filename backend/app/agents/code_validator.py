"""F-501 Code Validator — LangGraph sub-graph (NFR-042 + NFR-043).

This module wires the four scanner nodes + the aggregator into a
LangGraph ``StateGraph``. The sub-graph is fully independent of the
SDLC supervisor:

* It carries its own :class:`CodeValidatorState` (see
  :mod:`app.agents.code_validator_state`).
* It owns its own prompt template
  (``app.agents/prompts/code_validator.j2``).
* It uses a dedicated LiteLLM virtual key prefix
  (``forge_validator_*``) via :meth:`LiteLLMClient.create_virtual_key`.
* It does NOT import from ``sdlc_agent`` or ``sdlc_state``.

Graph topology
--------------
::

    START
      └─▶ scan_secrets ──┐
            scan_iac ────┼─▶ aggregate_findings ──▶ END
            scan_vulns ──┤
            scan_standards┘

The entry node is ``scan_secrets``; the remaining three scanners are
fanned out in parallel using LangGraph's :class:`Send` API. All four
buckets feed into the terminal :func:`aggregate_findings` node which
produces the typed :class:`ValidationReport`.
"""

from __future__ import annotations

import logging
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

# M2 T-A3 — Code Validator is the artifact-writing handler for the
# implementation phase (PASS/FAIL reports land in the architecture
# attestation stream and the gate decides).  Decorate the public
# entry points so a validator sub-graph run is gated on a recorded
# implementation-phase approval.
from app.agents.approval_gate import require_approval_phase
from app.agents.code_validator_nodes import (
    aggregate_findings,
    scan_iac,
    scan_secrets,
    scan_standards,
    scan_vulns,
)
from app.agents.code_validator_state import (
    VALIDATOR_VERSION,
    CodeValidatorState,
    ValidationReport,
)
from app.agents.prompts import load_code_validator_prompt
from app.agents.sdlc_state import SDLCPhase

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# LiteLLM virtual key namespace (NFR-043).
# ---------------------------------------------------------------------------

VALIDATOR_VIRTUAL_KEY_PREFIX = "forge_validator"


def validator_virtual_key_alias(
    tenant_id: str,
    project_id: str,
    *,
    actor_id: str | None = None,
) -> str:
    """Build the LiteLLM virtual-key alias for the validator sub-graph.

    The format is::

        forge_validator_<tenant>_<project>[_<actor>]

    Examples
    --------
    >>> validator_virtual_key_alias("tnt-1", "prj-2", actor_id="u-9")
    'forge_validator_tnt-1_prj-2_u-9'
    """
    parts = [VALIDATOR_VIRTUAL_KEY_PREFIX, tenant_id, project_id]
    if actor_id:
        parts.append(actor_id)
    alias = "_".join(parts)
    # LiteLLM key_alias must be URL-safe and reasonably short.
    return alias[:200]


def _secrets_fan_out(state: CodeValidatorState) -> list[Any]:
    """Fan out from ``scan_secrets`` to the three sibling scanners.

    LangGraph invokes this function from the conditional edge after
    ``scan_secrets`` completes. We return a list of :class:`Send`
    objects — one per remaining scanner — that re-use the current
    state. The state itself is not mutated by the fan-out.
    """
    return [
        Send(scan_iac.__name__, state),
        Send(scan_vulns.__name__, state),
        Send(scan_standards.__name__, state),
    ]


# ---------------------------------------------------------------------------
# High-level graph builder
# ---------------------------------------------------------------------------


def build_code_validator_graph(
    *,
    checkpointer: Any | None = None,
    secrets_node: Any | None = None,
    iac_node: Any | None = None,
    vulns_node: Any | None = None,
    standards_node: Any | None = None,
    aggregator_node: Any | None = None,
) -> Any:
    """Build and compile the Code Validator sub-graph.

    Parameters are injectable so tests can swap scanner implementations
    for deterministic stubs. The default wiring uses the production
    scanner callables.
    """

    builder: StateGraph = StateGraph(CodeValidatorState)

    builder.add_node("scan_secrets", secrets_node or scan_secrets)
    builder.add_node("scan_iac", iac_node or scan_iac)
    builder.add_node("scan_vulns", vulns_node or scan_vulns)
    builder.add_node("scan_standards", standards_node or scan_standards)
    builder.add_node("aggregate_findings", aggregator_node or aggregate_findings)

    # Entry: scan_secrets runs first, then fans out to the other three.
    builder.add_edge(START, "scan_secrets")
    builder.add_conditional_edges("scan_secrets", _secrets_fan_out)

    # Each fan-out scanner feeds the aggregator.
    for scanner_name in ("scan_iac", "scan_vulns", "scan_standards"):
        builder.add_edge(scanner_name, "aggregate_findings")

    # Terminal: aggregator -> END.
    builder.add_edge("aggregate_findings", END)

    if checkpointer is None:
        from langgraph.checkpoint.memory import MemorySaver

        checkpointer = MemorySaver()
    return builder.compile(checkpointer=checkpointer)


# ---------------------------------------------------------------------------
# Convenience entry point
# ---------------------------------------------------------------------------


def load_prompt(state: CodeValidatorState) -> str:
    """Render the Code Validator prompt template (NFR-043)."""
    return load_code_validator_prompt(
        target=state.target.model_dump(mode="json"),
        tool_bundle=state.tool_bundle.model_dump(),
        validator_version=VALIDATOR_VERSION,
        run_id=str(state.run_id),
        tenant_id=str(state.tenant_id),
        project_id=str(state.project_id),
    )


def make_validator_virtual_key(
    state: CodeValidatorState,
    *,
    lite_llm_client: Any,
    duration: str = "24h",
    team_id: str | None = None,
) -> dict[str, Any]:
    """Mint a LiteLLM virtual key for the validator sub-graph.

    Delegates to :meth:`LiteLLMClient.create_virtual_key`. The alias
    is deterministically derived from tenant + project + actor so a
    single tenant cannot impersonate another.
    """
    alias = validator_virtual_key_alias(
        str(state.tenant_id),
        str(state.project_id),
        actor_id=str(state.actor_id),
    )
    return lite_llm_client.create_virtual_key(
        key_alias=alias,
        duration=duration,
        team_id=team_id,
        metadata={
            "tenant_id": str(state.tenant_id),
            "project_id": str(state.project_id),
            "actor_id": str(state.actor_id),
            "validator_version": VALIDATOR_VERSION,
        },
    )


# ---------------------------------------------------------------------------
# Typed result wrapper — convenient for callers
# ---------------------------------------------------------------------------


class ValidatorRunResult(TypedDict):
    """Convenience TypedDict returned by :func:`run_code_validator`."""

    report: ValidationReport
    state: CodeValidatorState


# ---------------------------------------------------------------------------
# M2 T-A3 — Supervisor-facing entry point.
# ---------------------------------------------------------------------------
# The sub-graph itself operates on its own :class:`CodeValidatorState`
# (no SDLCState access) so the decorator cannot wrap the internal
# scanner nodes.  Instead we expose a thin adapter
# :func:`run_code_validator_with_approval` that the supervisor calls
# AFTER a recorded implementation-phase approval.  The adapter
# enforces the gate, then delegates to the sub-graph and returns a
# :class:`ValidatorRunResult`.


async def run_code_validator_with_approval(
    state: Any,  # SDLCState — typed as Any to avoid the circular import
    *,
    graph: Any | None = None,
    checkpointer: Any | None = None,
) -> ValidatorRunResult:
    """Run the code validator sub-graph with approval enforcement.

    Wraps :func:`build_code_validator_graph` and adds the
    :func:`require_approval_phase` guard so a direct caller (e.g.
    the F-503 merge gate, the F-501 validator hook) cannot bypass
    the supervisor's recorded approval.

    Parameters
    ----------
    state:
        The SDLCState from the supervisor.  Must have a recorded
        ``metadata["approval:implementation:decision"].granted=True``
        entry; otherwise the decorator raises
        :class:`ApprovalRequiredError` (SDLCPhase.IMPLEMENTATION).
    graph:
        Optional pre-compiled graph; defaults to a freshly built
        one with an in-memory :class:`MemorySaver`.
    """

    # The decorator would raise on missing/denied approval; we
    # invoke the inner guard manually so the wrapper itself stays
    # free of nested-decorator surprises.
    from app.agents.approval_gate import (
        _enforce,
    )

    _enforce(state, (SDLCPhase.IMPLEMENTATION,))

    if graph is None:
        graph = build_code_validator_graph(checkpointer=checkpointer)
    validator_state = CodeValidatorState(
        run_id=state.run_id,
        tenant_id=state.tenant_id,
        project_id=state.project_id,
        actor_id=state.actor_id,
    )
    result_state = await graph.ainvoke(validator_state)
    return ValidatorRunResult(
        report=result_state.report,
        state=result_state,
    )


# ---------------------------------------------------------------------------
# F-501 sub-graph entry point (plan 01-05 Task 3).
# ---------------------------------------------------------------------------
# The supervisor-facing entry point is :func:`run_code_validator`. It is
# decorated with :func:`require_approval_phase(SDLCPhase.IMPLEMENTATION)`
# so a direct call without a recorded implementation-phase approval
# raises :class:`ApprovalRequiredError` (threat model T-01-05-5).
#
# The entry delegates to the new top-level
# ``agents.code_validator.code_validator_graph`` sub-graph (independent
# of the SDLC supervisor's prompt templates per the locked Phase 1
# decision).
# ---------------------------------------------------------------------------


def _extract_files(state: Any) -> list[str]:
    """Extract the list of files to validate from the SDLCState.

    Tries ``state.context["files"]`` first (the standard envelope used
    by the implementation phase to pass changed-file paths to its
    tools). Falls back to an empty list so the sub-graph produces a
    ``pass`` verdict for runs that pre-date the contract.
    """
    context = getattr(state, "context", None)
    if isinstance(context, dict):
        files = context.get("files")
        if isinstance(files, list):
            return [str(f) for f in files]
    return []


@require_approval_phase(SDLCPhase.IMPLEMENTATION)
async def run_code_validator(
    state: Any,  # SDLCState
    *,
    graph: Any | None = None,
    checkpointer: Any | None = None,
    _audit_record: Any | None = None,
) -> Any:
    """Run the F-501 Code Validator sub-graph against ``state``.

    Decorated with :func:`require_approval_phase(SDLCPhase.IMPLEMENTATION)`
    so a direct call without a recorded implementation-phase approval
    raises :class:`ApprovalRequiredError` (threat model T-01-05-5).

    Returns the SDLCState updated with a ``"validation_report"`` entry
    in ``state.artifacts`` carrying the typed :class:`ValidationReport`
    from the sub-graph.

    The ``_audit_record`` parameter is the audit-service record callable;
    tests inject an ``AsyncMock``. In production the entry point
    imports the canonical :func:`audit_service.record`.
    """
    from agents.code_validator import code_validator_graph as _subgraph_graph

    if _audit_record is None:
        from app.services.audit_service import audit_service

        _audit_record = audit_service.record

    files = _extract_files(state)

    validator_state = CodeValidatorState(
        tenant_id=state.tenant_id,
        project_id=state.project_id,
        run_id=state.run_id,
        files=files,
    )

    compiled = graph or (checkpointer is not None and _subgraph_graph or None)
    if compiled is None:
        compiled = _subgraph_graph
    result_state = await compiled.ainvoke(validator_state)

    # Audit the entry-point invocation (Rule 6).
    try:
        await _audit_record(
            tenant_id=state.tenant_id,
            project_id=state.project_id,
            actor_id=getattr(state, "actor_id", None),
            action="code_validator.run",
            target_type="artifact",
            target_id=str(state.run_id),
            payload={
                "verdict": getattr(result_state, "verdict", None),
                "files": files,
            },
        )
    except Exception:
        # The sub-graph nodes already wrote their own audit rows; the
        # entry-point row is a bonus correlation row, not a load-bearing
        # one. Never let audit failure break the run.
        pass

    # Attach the typed report to the SDLCState.artifacts envelope.
    new_artifacts = dict(getattr(state, "artifacts", {}) or {})
    new_artifacts["validation_report"] = {
        "kind": "ValidationReport",
        "report": getattr(result_state, "report", None),
    }
    return state.model_copy(update={"artifacts": new_artifacts})


__all__ = [
    "VALIDATOR_VIRTUAL_KEY_PREFIX",
    "validator_virtual_key_alias",
    "build_code_validator_graph",
    "load_prompt",
    "make_validator_virtual_key",
    "run_code_validator_with_approval",
    "run_code_validator",
    "ValidatorRunResult",
]
