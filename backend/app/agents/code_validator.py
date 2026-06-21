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

from app.agents.code_validator_nodes import (
    aggregate_findings,
    scan_iac,
    scan_secrets,
    scan_standards,
    scan_vulns,
)
from app.agents.code_validator_state import (
    CodeValidatorState,
    VALIDATOR_VERSION,
    ValidationReport,
)
from app.agents.prompts import load_code_validator_prompt

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


__all__ = [
    "VALIDATOR_VIRTUAL_KEY_PREFIX",
    "validator_virtual_key_alias",
    "build_code_validator_graph",
    "load_prompt",
    "make_validator_virtual_key",
    "ValidatorRunResult",
]