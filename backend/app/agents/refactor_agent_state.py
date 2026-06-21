"""Refactor Agent state (F-601).

This is the typed state carried by the Refactor Agent's LangGraph
sub-graph. It is intentionally a TypedDict (not a Pydantic model) so
that LangGraph can use its native reducer semantics while we still get
typed-checked field names.

State lifecycle
---------------
::

    inventory_source  -> plan_target -> generate_phases -> risk_register
                                                              |
                                                              v
                                                       push_to_jira

Graph topology
--------------
::

    START
      └─▶ inventory_source
            └─▶ plan_target
                  └─▶ generate_phases
                        └─▶ risk_register
                              └─▶ push_to_jira
                                    └─▶ END

The sub-graph is linear. Each node reads from ``RefactorAgentState`` and
returns a partial dict with the keys it produced; LangGraph merges the
partial dict into the running state.

Multi-tenancy
-------------
Per Rule 2, ``tenant_id`` and ``project_id`` are mandatory. They flow
through every node and are stamped onto every persisted artifact.
"""

from __future__ import annotations

from typing import Any, TypedDict


class RefactorAgentState(TypedDict, total=False):
    """Typed state for the Refactor Agent sub-graph.

    All fields are optional from LangGraph's perspective (so partial
    merges don't crash) but downstream nodes treat them as required
    once ``inventory_source`` has run.
    """

    # -- Identity / tenancy (Rule 2) ---------------------------------------
    run_id: str
    tenant_id: str
    project_id: str
    actor_id: str

    # -- Inputs ------------------------------------------------------------
    source_repo_url: str
    source_language: str
    source_framework: str
    target_language: str
    target_framework: str
    target_cloud: str
    constraints: dict[str, Any]

    # -- Outputs from each node -------------------------------------------
    source_inventory: dict[str, Any]
    target_architecture: dict[str, Any]
    phased_plan: list[dict[str, Any]]
    risk_register: list[dict[str, Any]]
    effort_estimate: dict[str, Any]
    dependencies: list[dict[str, Any]]

    # -- AWS Transform orchestration bookkeeping --------------------------
    aws_transform_job_id: str | None
    aws_transform_status: str
    aws_transform_results: dict[str, Any] | None

    # -- Approval gate ----------------------------------------------------
    pending_approval: bool
    approved_by: str | None
    approval_reason: str

    # -- Push to Jira (F-213) ---------------------------------------------
    jira_push_result: dict[str, Any] | None

    # -- Artifact references (post-creation) ------------------------------
    artifact_id: str | None
    artifact_version: int

    # -- Audit / errors ----------------------------------------------------
    phase_history: list[dict[str, Any]]
    errors: list[dict[str, Any]]
    cost_so_far: float


# ---------------------------------------------------------------------------
# Phase enum (string values — kept simple to stay LangGraph-friendly)
# ---------------------------------------------------------------------------

REFACTOR_PHASES: tuple[str, ...] = (
    "inventory_source",
    "plan_target",
    "generate_phases",
    "risk_register",
    "push_to_jira",
)


__all__ = ["RefactorAgentState", "REFACTOR_PHASES"]
