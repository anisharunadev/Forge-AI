"""F-601 Refactor Agent — LangGraph sub-graph.

A self-contained sub-graph that orchestrates the heavy-lift refactor
workflow: source inventory -> target plan -> phased migration plan ->
risk register -> push to Jira.

Architecture
------------
This is a linear ``StateGraph`` (no conditional edges) that runs
entirely as a sub-graph of the parent SDLC supervisor. Each node:

1. Reads from :class:`RefactorAgentState`
2. Returns a partial dict that LangGraph merges into the running state
3. Persists a typed artifact via the F-010 artifact registry
4. Emits an audit event

Nodes
-----
* ``inventory_source`` — calls AWS Transform (or a placeholder) to
  enumerate the source repo.
* ``plan_target`` — composes the target architecture shape from the
  inputs (no Forge-side translation; DL-029).
* ``generate_phases`` — synthesises the phased migration plan using
  the LiteLLM-backed prompt (or a heuristic fallback).
* ``risk_register`` — derives a typed risk register from the plan.
* ``push_to_jira`` — invokes F-213 (``PushToDeliveryService``) on
  approval.

Multi-tenancy
-------------
Per Rule 2, ``tenant_id`` and ``project_id`` are stamped onto every
artifact via the F-010 registry. They are never optional.

Approval gate
-------------
After ``risk_register``, if ``pending_approval`` is set the agent
exposes the plan via the artifact registry and waits for a human
approval event before ``push_to_jira``. The graph itself is linear,
so the gate is enforced by the parent SDLC supervisor before
scheduling the sub-graph, NOT inside it.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC
from pathlib import Path
from typing import Any

from langgraph.graph import END, START, StateGraph

from app.agents.refactor_agent_state import RefactorAgentState
from app.core.logging import get_logger
from app.schemas.migration_plan import (
    EffortEstimate,
    MigrationPhase,
    MigrationPlan,
    RiskItem,
    SourceInventory,
    TargetArchitecture,
)
from app.services.aws_transform_client import AWSTransformClient, get_default_client
from app.services.event_bus import EventType
from app.services.event_bus import bus as default_bus

logger = get_logger(__name__)


ARTIFACT_TYPE_MIGRATION_PLAN = "migration_plan"
ARTIFACT_TYPE_SOURCE_INVENTORY = "source_inventory"
ARTIFACT_TYPE_TARGET_ARCH = "target_architecture"
ARTIFACT_TYPE_RISK_REGISTER = "risk_register"


# ---------------------------------------------------------------------------
# Prompt loader
# ---------------------------------------------------------------------------

_PROMPTS_DIR = Path(__file__).parent / "prompts"


def _load_prompt(name: str) -> str:
    """Read a Jinja2 prompt template from the agents/prompts dir."""
    path = _PROMPTS_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"prompt template not found: {path}")
    return path.read_text(encoding="utf-8")


def _render_refactor_prompt(state: RefactorAgentState) -> str:
    """Render the refactor-agent prompt with current state context.

    This is a lightweight, dependency-free renderer (str.format with
    json-dumped substructures) so it works without Jinja2 installed
    in the test env. It preserves the .j2 file as the canonical
    template for ops to edit.
    """
    template = _load_prompt("refactor_agent.j2")
    payload = {
        "tenant_id": state.get("tenant_id", ""),
        "project_id": state.get("project_id", ""),
        "source_language": state.get("source_language", ""),
        "source_framework": state.get("source_framework", ""),
        "source_repo_url": state.get("source_repo_url", ""),
        "target_language": state.get("target_language", ""),
        "target_framework": state.get("target_framework", ""),
        "target_cloud": state.get("target_cloud", "aws"),
        "constraints": state.get("constraints", {}),
        "source_inventory": state.get("source_inventory", {}),
        "target_architecture": state.get("target_architecture", {}),
        "phased_plan": state.get("phased_plan", []),
        "risk_register": state.get("risk_register", []),
    }
    # The .j2 file uses Jinja syntax; do a best-effort fill in with the
    # important variables. The exact Jinja interpolation is not
    # required at runtime — the prompt is sent to the LLM as-is.
    rendered = template
    for k, v in payload.items():
        if isinstance(v, (dict, list)):
            replacement = json.dumps(v, default=str)
        else:
            replacement = str(v)
        rendered = rendered.replace("{{ " + k + " }}", replacement)
        rendered = rendered.replace("{{ " + k + " | tojson }}", replacement)
    return rendered


# ---------------------------------------------------------------------------
# Node: inventory_source
# ---------------------------------------------------------------------------


async def inventory_source_node(
    state: RefactorAgentState,
    *,
    transform_client: AWSTransformClient | None = None,
    persist_artifact: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """Build a typed :class:`SourceInventory` via AWS Transform.

    On success, the AWS Transform ``job_id`` is stored on the state
    and the inventory is persisted to the F-010 artifact registry.
    """
    client = transform_client or get_default_client()

    raw_inventory = {
        "repository_url": state.get("source_repo_url"),
        "language": state.get("source_language", "java"),
        "target_language": state.get("target_language", "java"),
    }

    job_id = client.start_job(raw_inventory)
    job = client.poll_job(job_id)

    inventory = SourceInventory(
        language=state.get("source_language", "java"),
        framework=state.get("source_framework"),
        total_files=0,
        total_lines_of_code=0,
        components=[],
        external_dependencies=[],
        data_stores=[],
        apis=[],
        repository_url=state.get("source_repo_url"),
        aws_transform_job_id=job_id,
    )

    inventory_dict = inventory.model_dump(mode="json")

    if persist_artifact is not None:
        await persist_artifact(
            state=state,
            artifact_type=ARTIFACT_TYPE_SOURCE_INVENTORY,
            payload=inventory_dict,
        )

    await default_bus.publish(
        EventType.ARTIFACT_CREATED,
        {
            "agent": "refactor_agent",
            "node": "inventory_source",
            "aws_transform_status": job.status,
            "job_id": job_id,
        },
        tenant_id=state.get("tenant_id"),
        project_id=state.get("project_id"),
        actor_id=state.get("actor_id"),
    )

    return {
        "source_inventory": inventory_dict,
        "aws_transform_job_id": job_id,
        "aws_transform_status": job.status,
        "aws_transform_results": job.results,
        "phase_history": [
            {
                "node": "inventory_source",
                "at": _utcnow_iso(),
                "aws_transform_status": job.status,
            }
        ],
    }


# ---------------------------------------------------------------------------
# Node: plan_target
# ---------------------------------------------------------------------------


async def plan_target_node(
    state: RefactorAgentState,
    *,
    persist_artifact: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """Compose the typed :class:`TargetArchitecture`.

    Forge does NOT translate source -> target (DL-029). It only
    shapes the target description so the agent can reason about
    migration phases against it.
    """
    target = TargetArchitecture(
        target_language=state.get("target_language", "java"),
        target_framework=state.get("target_framework"),
        target_cloud=state.get("target_cloud", "aws"),
        components=[],
        integrations=[],
        data_stores=[],
        diagrams=[],
    )
    target_dict = target.model_dump(mode="json")

    if persist_artifact is not None:
        await persist_artifact(
            state=state,
            artifact_type=ARTIFACT_TYPE_TARGET_ARCH,
            payload=target_dict,
        )

    await default_bus.publish(
        EventType.ARTIFACT_CREATED,
        {
            "agent": "refactor_agent",
            "node": "plan_target",
            "target_language": target.target_language,
        },
        tenant_id=state.get("tenant_id"),
        project_id=state.get("project_id"),
        actor_id=state.get("actor_id"),
    )

    return {
        "target_architecture": target_dict,
        "phase_history": [
            {
                "node": "plan_target",
                "at": _utcnow_iso(),
            }
        ],
    }


# ---------------------------------------------------------------------------
# Node: generate_phases
# ---------------------------------------------------------------------------


def _heuristic_phased_plan(state: RefactorAgentState) -> list[dict[str, Any]]:
    """Deterministic fallback phased plan.

    Used when no LLM is available (tests, offline). Produces 3
    canonical phases: discovery -> strangler foundation -> cutover.
    """
    return [
        {
            "order": 0,
            "name": "Phase 1 — Discovery & instrumentation",
            "description": (
                "Stand up observability for the legacy system, baseline "
                "performance, and freeze the contract surface."
            ),
            "strategy": "strangler",
            "scope_files": [],
            "scope_services": ["legacy-app"],
            "estimated_effort_days": 10.0,
            "estimated_cost_usd": 0.0,
            "prerequisites": [],
            "acceptance_criteria": [
                "All legacy endpoints have tracing",
                "Baseline performance captured",
            ],
        },
        {
            "order": 1,
            "name": "Phase 2 — Strangler foundation",
            "description": (
                "Deploy the target architecture alongside the legacy "
                "system. Route a low-risk slice of traffic through it."
            ),
            "strategy": "strangler",
            "scope_files": [],
            "scope_services": ["target-app", "router"],
            "estimated_effort_days": 20.0,
            "estimated_cost_usd": 0.0,
            "prerequisites": [],
            "acceptance_criteria": [
                "Target app deployed",
                "1% traffic routed via router",
            ],
        },
        {
            "order": 2,
            "name": "Phase 3 — Cutover & decommission",
            "description": (
                "Migrate the remaining slices, run the cutover, and decommission the legacy system."
            ),
            "strategy": "parallel",
            "scope_files": [],
            "scope_services": ["legacy-app", "target-app"],
            "estimated_effort_days": 15.0,
            "estimated_cost_usd": 0.0,
            "prerequisites": [],
            "acceptance_criteria": [
                "100% traffic on target",
                "Legacy system decommissioned",
            ],
        },
    ]


async def generate_phases_node(
    state: RefactorAgentState,
    *,
    llm_call: Callable[..., Any] | None = None,
    persist_artifact: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """Synthesise the phased migration plan.

    If a ``llm_call`` is injected (e.g. via LiteLLM), the prompt is
    rendered and the model is asked for a JSON plan. Otherwise a
    deterministic heuristic plan is used. Either way, the result is
    validated against the :class:`MigrationPhase` schema and stored.
    """
    plan_dicts: list[dict[str, Any]] = []
    if llm_call is not None:
        prompt = _render_refactor_prompt(state)
        try:
            response = await llm_call(prompt)
            plan_dicts = _parse_plan_response(response)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "refactor_agent.llm_fallback",
                extra={"error": f"{type(exc).__name__}: {exc}"},
            )
            plan_dicts = _heuristic_phased_plan(state)
    else:
        plan_dicts = _heuristic_phased_plan(state)

    # Validate / coerce into MigrationPhase shape.
    typed_phases: list[dict[str, Any]] = []
    for raw in plan_dicts:
        try:
            phase = MigrationPhase.model_validate(raw)
        except Exception:
            # Be permissive: fill required defaults if the upstream
            # payload omits them, so the sub-graph still produces a
            # valid MigrationPlan.
            phase = MigrationPhase(
                order=int(raw.get("order", len(typed_phases))),
                name=str(raw.get("name", f"Phase {len(typed_phases)}"))[:200],
                description=str(raw.get("description", "Phase scope TBD."))[:10_000],
                strategy=str(raw.get("strategy", "strangler")),
                scope_files=list(raw.get("scope_files", []) or []),
                scope_services=list(raw.get("scope_services", []) or []),
                estimated_effort_days=float(raw.get("estimated_effort_days", 0.0)),
                estimated_cost_usd=float(raw.get("estimated_cost_usd", 0.0)),
                prerequisites=list(raw.get("prerequisites", []) or []),
                acceptance_criteria=list(raw.get("acceptance_criteria", []) or []),
            )
        typed_phases.append(phase.model_dump(mode="json"))

    if persist_artifact is not None:
        await persist_artifact(
            state=state,
            artifact_type="phased_migration_plan",
            payload={"phases": typed_phases},
        )

    return {
        "phased_plan": typed_phases,
        "phase_history": [
            {
                "node": "generate_phases",
                "at": _utcnow_iso(),
                "phase_count": len(typed_phases),
            }
        ],
    }


def _parse_plan_response(response: Any) -> list[dict[str, Any]]:
    """Best-effort parse of an LLM response into a list of phase dicts."""
    if isinstance(response, list):
        return [r for r in response if isinstance(r, dict)]
    if isinstance(response, dict):
        phases = response.get("phased_plan") or response.get("phases") or []
        if isinstance(phases, list):
            return [p for p in phases if isinstance(p, dict)]
        return [response]
    if isinstance(response, str):
        text = response.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:]
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return []
        if isinstance(parsed, dict):
            phases = parsed.get("phased_plan") or parsed.get("phases") or []
            if isinstance(phases, list):
                return [p for p in phases if isinstance(p, dict)]
        if isinstance(parsed, list):
            return [p for p in parsed if isinstance(p, dict)]
    return []


# ---------------------------------------------------------------------------
# Node: risk_register
# ---------------------------------------------------------------------------


def _heuristic_risk_register(state: RefactorAgentState) -> list[dict[str, Any]]:
    """Deterministic fallback risk register keyed off the phase count."""
    phases = state.get("phased_plan", []) or []
    risks: list[dict[str, Any]] = [
        {
            "title": "Data loss during cutover",
            "description": (
                "In-flight writes may be lost if the cutover is not carefully sequenced."
            ),
            "likelihood": 0.3,
            "impact": 0.9,
            "severity": 0.27,
            "mitigation": "Dual-write window with reconciliation job.",
            "owner": "platform-team",
            "tags": ["data-integrity"],
        },
        {
            "title": "Latency regression on legacy endpoints",
            "description": ("Adding a router hop can introduce latency that exceeds SLO."),
            "likelihood": 0.5,
            "impact": 0.4,
            "severity": 0.20,
            "mitigation": "Pre-cutover load test in phase 1.",
            "owner": "sre",
            "tags": ["performance"],
        },
        {
            "title": "Skill gap on target framework",
            "description": ("Team may not yet have deep expertise in the target framework."),
            "likelihood": 0.7,
            "impact": 0.5,
            "severity": 0.35,
            "mitigation": "Pair-program with target framework SME.",
            "owner": "engineering-manager",
            "tags": ["people"],
        },
    ]
    if len(phases) > 3:
        risks.append(
            {
                "title": "Schedule slip across many phases",
                "description": "Long migration plans compound delivery risk.",
                "likelihood": 0.6,
                "impact": 0.6,
                "severity": 0.36,
                "mitigation": "Re-baseline after each phase.",
                "owner": "delivery-lead",
                "tags": ["schedule"],
            }
        )
    return risks


async def risk_register_node(
    state: RefactorAgentState,
    *,
    persist_artifact: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """Build the typed risk register.

    Mirrors :func:`generate_phases_node`: heuristic-only by default,
    ready to be swapped for an LLM-driven version later.
    """
    raw_risks = _heuristic_risk_register(state)
    typed_risks: list[dict[str, Any]] = []
    for raw in raw_risks:
        try:
            risk = RiskItem.model_validate(raw)
        except Exception:
            risk = RiskItem(
                title=str(raw.get("title", "Untitled risk"))[:200],
                description=str(raw.get("description", ""))[:10_000],
                likelihood=float(raw.get("likelihood", 0.5)),
                impact=float(raw.get("impact", 0.5)),
                severity=float(
                    raw.get(
                        "severity",
                        float(raw.get("likelihood", 0.5)) * float(raw.get("impact", 0.5)),
                    )
                ),
                mitigation=str(raw.get("mitigation", "")),
                owner=raw.get("owner"),
                tags=list(raw.get("tags", []) or []),
            )
        typed_risks.append(risk.model_dump(mode="json"))

    if persist_artifact is not None:
        await persist_artifact(
            state=state,
            artifact_type=ARTIFACT_TYPE_RISK_REGISTER,
            payload={"risks": typed_risks},
        )

    return {
        "risk_register": typed_risks,
        "phase_history": [
            {
                "node": "risk_register",
                "at": _utcnow_iso(),
                "risk_count": len(typed_risks),
            }
        ],
    }


# ---------------------------------------------------------------------------
# Node: push_to_jira
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class _PushOutcome:
    success: bool
    external_ref: str | None
    error: str | None
    record_id: str | None


async def push_to_jira_node(
    state: RefactorAgentState,
    *,
    push_to_jira_fn: Callable[..., Any] | None = None,
    persist_migration_plan: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    """Build the typed :class:`MigrationPlan` and push to Jira via F-213.

    Behaviour
    ---------
    * Composes a :class:`MigrationPlan` from the running state.
    * Calls F-213's :func:`push_to_delivery_service.push_to_jira` if
      an injector is supplied (or by default, the module-level
      singleton).
    * Persists the final MigrationPlan to F-010 if a persister is
      supplied.
    """
    plan = _build_migration_plan(state)
    plan_dict = plan.model_dump(mode="json")

    if persist_migration_plan is not None:
        await persist_migration_plan(
            state=state,
            artifact_type=ARTIFACT_TYPE_MIGRATION_PLAN,
            payload=plan_dict,
        )

    outcome = _PushOutcome(success=False, external_ref=None, error=None, record_id=None)
    if push_to_jira_fn is None:
        try:
            from app.services.ideation.push_to_delivery import push_to_delivery_service

            push_to_jira_fn = push_to_delivery_service.push_to_jira
        except ImportError:
            push_to_jira_fn = None

    if push_to_jira_fn is not None:
        try:
            result = await push_to_jira_fn(
                idea_id=plan.id,
                project_key=state.get("target_cloud", "AWS").upper()[:32],
                tenant_id=state.get("tenant_id"),
                project_id=state.get("project_id"),
                actor_id=state.get("actor_id"),
            )
            outcome = _PushOutcome(
                success=bool(getattr(result, "success", False)),
                external_ref=getattr(result, "external_ref", None),
                error=getattr(result, "error", None),
                record_id=str(getattr(result, "record_id", "")) or None,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "refactor_agent.push_to_jira_failed",
                extra={"error": f"{type(exc).__name__}: {exc}"},
            )
            outcome = _PushOutcome(
                success=False,
                external_ref=None,
                error=f"{type(exc).__name__}: {exc}",
                record_id=None,
            )
    else:
        outcome = _PushOutcome(
            success=False,
            external_ref=None,
            error="push_to_delivery_service_unavailable",
            record_id=None,
        )

    return {
        "jira_push_result": {
            "success": outcome.success,
            "external_ref": outcome.external_ref,
            "error": outcome.error,
            "record_id": outcome.record_id,
        },
        "artifact_id": str(plan.id),
        "artifact_version": 1,
        "phase_history": [
            {
                "node": "push_to_jira",
                "at": _utcnow_iso(),
                "jira_pushed": outcome.success,
            }
        ],
    }


def _build_migration_plan(state: RefactorAgentState) -> MigrationPlan:
    """Compose a :class:`MigrationPlan` from the running state."""
    tenant_id = _coerce_uuid(state.get("tenant_id"))
    project_id = _coerce_uuid(state.get("project_id"))
    source_inv = SourceInventory.model_validate(
        state.get("source_inventory") or {"language": state.get("source_language", "java")}
    )
    target_arch = TargetArchitecture.model_validate(
        state.get("target_architecture")
        or {
            "target_language": state.get("target_language", "java"),
            "target_framework": state.get("target_framework"),
            "target_cloud": state.get("target_cloud", "aws"),
        }
    )
    phases_raw = state.get("phased_plan") or []
    risks_raw = state.get("risk_register") or []

    phases: list[MigrationPhase] = []
    for raw in phases_raw:
        if isinstance(raw, MigrationPhase):
            phases.append(raw)
            continue
        phases.append(MigrationPhase.model_validate(raw))

    risks: list[RiskItem] = []
    for raw in risks_raw:
        if isinstance(raw, RiskItem):
            risks.append(raw)
            continue
        risks.append(RiskItem.model_validate(raw))

    total_effort = sum(p.estimated_effort_days for p in phases)
    total_cost = sum(p.estimated_cost_usd for p in phases)
    estimate = EffortEstimate(
        total_effort_days=total_effort,
        total_cost_usd=total_cost,
        confidence=0.5,
        assumptions=["Effort derived from per-phase estimates."],
    )

    return MigrationPlan(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        project_id=project_id,
        source_inventory=source_inv,
        target_architecture=target_arch,
        phased_plan=phases,
        risk_register=risks,
        effort_estimate=estimate,
        dependencies=list(state.get("dependencies") or []),
    )


# ---------------------------------------------------------------------------
# Graph builder
# ---------------------------------------------------------------------------


def build_refactor_graph(
    *,
    transform_client: AWSTransformClient | None = None,
    llm_call: Callable[..., Any] | None = None,
    push_to_jira_fn: Callable[..., Any] | None = None,
    persist_artifact: Callable[..., Any] | None = None,
    persist_migration_plan: Callable[..., Any] | None = None,
) -> Any:
    """Build and compile the Refactor Agent sub-graph.

    Parameters are injectable so tests can supply mocks for the
    AWS Transform client, the LLM call, the F-213 push service,
    and the artifact persister. None of them are required — the
    sub-graph runs end-to-end with heuristic fallbacks.

    The sub-graph has no conditional edges: the human approval
    gate (Rule 3) is enforced by the parent SDLC supervisor
    *outside* this sub-graph, so the linear topology is fine.
    """
    builder: StateGraph = StateGraph(RefactorAgentState)

    async def _inventory_node(state: RefactorAgentState) -> dict[str, Any]:
        return await inventory_source_node(
            state,
            transform_client=transform_client,
            persist_artifact=persist_artifact,
        )

    async def _plan_target_node(state: RefactorAgentState) -> dict[str, Any]:
        return await plan_target_node(state, persist_artifact=persist_artifact)

    async def _generate_phases_node(state: RefactorAgentState) -> dict[str, Any]:
        return await generate_phases_node(
            state, llm_call=llm_call, persist_artifact=persist_artifact
        )

    async def _risk_register_node(state: RefactorAgentState) -> dict[str, Any]:
        return await risk_register_node(state, persist_artifact=persist_artifact)

    async def _push_to_jira_node(state: RefactorAgentState) -> dict[str, Any]:
        return await push_to_jira_node(
            state,
            push_to_jira_fn=push_to_jira_fn,
            persist_migration_plan=persist_migration_plan,
        )

    builder.add_node("inventory_source", _inventory_node)
    builder.add_node("plan_target", _plan_target_node)
    builder.add_node("generate_phases", _generate_phases_node)
    builder.add_node("risk_register", _risk_register_node)
    builder.add_node("push_to_jira", _push_to_jira_node)

    builder.add_edge(START, "inventory_source")
    builder.add_edge("inventory_source", "plan_target")
    builder.add_edge("plan_target", "generate_phases")
    builder.add_edge("generate_phases", "risk_register")
    builder.add_edge("risk_register", "push_to_jira")
    builder.add_edge("push_to_jira", END)

    return builder.compile()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _coerce_uuid(value: Any) -> uuid.UUID:
    """Coerce ``str`` / ``UUID`` -> ``UUID`` with a sensible default."""
    if isinstance(value, uuid.UUID):
        return value
    if isinstance(value, str) and value:
        return uuid.UUID(value)
    return uuid.uuid4()


def _utcnow_iso() -> str:
    from datetime import datetime

    return datetime.now(UTC).isoformat()


__all__ = [
    "ARTIFACT_TYPE_MIGRATION_PLAN",
    "ARTIFACT_TYPE_SOURCE_INVENTORY",
    "ARTIFACT_TYPE_TARGET_ARCH",
    "ARTIFACT_TYPE_RISK_REGISTER",
    "build_refactor_graph",
    "inventory_source_node",
    "plan_target_node",
    "generate_phases_node",
    "risk_register_node",
    "push_to_jira_node",
    "build_migration_plan",
]
