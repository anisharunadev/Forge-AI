"""LangGraph SDLC supervisor.

Builds the :class:`langgraph.graph.StateGraph` that orchestrates a full
SDLC cycle using GSD phases as nodes, with human approval gates at the
Architecture, Security, and Deployment boundaries (Rule 3).

Graph topology
--------------
::

    START
      └─▶ discovery
            └─▶ planning
                  └─▶ architecture
                        └─▶ approval_gate ── (granted) ──▶ implementation
                            ▲                              └─▶ testing
                            │                                    └─▶ security
                            │                                          └─▶ approval_gate
                            │                                              ▲
                            │                                              │
                            │                                              ▼
                            │                                            review
                            │                                              │
                            │                                              ▼
                            │                                          deployment
                            │                                              │
                            │                                              ▼
                            │                                          approval_gate
                            │                                              │
                            │                                  (granted) ──┴─▶ done
                            │
                            └─ (denied) ──▶ failed

The graph is pure-Python: there is no I/O outside of phase nodes, so it
can be compiled once per process and reused for many concurrent runs.

Checkpointing
-------------
For production, pass an :class:`AsyncPostgresSaver`. For tests,
``from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver`` works
against an in-memory database.

The ``thread_id`` argument to ``run_sdlc`` is used as LangGraph's
``configurable.thread_id``, which scopes checkpointing and is what
``SDLCRunManager.resume_run`` uses to pick back up where a run left off.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, AsyncIterator
from uuid import UUID, uuid4

from langgraph.graph import END, START, StateGraph
from langgraph.checkpoint.base import BaseCheckpointSaver

from app.agents.approval_gate import ApprovalGateNode
from app.agents.nodes.architecture import ArchitectureNode
from app.agents.nodes.base import BasePhaseNode
from app.agents.nodes.deployment import DeploymentNode
from app.agents.nodes.discovery import DiscoveryNode
from app.agents.nodes.implementation import ImplementationNode
from app.agents.nodes.planning import PlanningNode
from app.agents.nodes.review import ReviewNode
from app.agents.nodes.security import SecurityNode
from app.agents.nodes.testing import TestingNode
from app.agents.sdlc_state import SDLCPhase, SDLCState

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Edge routing — the supervisor's brain
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class GraphSpec:
    """Declarative list of edges in the SDLC supervisor graph.

    Each edge is ``(from, to)``. Conditional edges are described by
    :func:`route_after_node` below.
    """

    sequential_edges: tuple[tuple[str, str], ...] = (
        ("discovery", "planning"),
        ("planning", "architecture"),
        ("implementation", "testing"),
        ("testing", "security"),
        ("review", "deployment"),
    )
    approval_gates_after: tuple[str, ...] = ("architecture", "security", "deployment")
    forward_after_gate: dict[str, str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.forward_after_gate is None:
            self.forward_after_gate = {
                "architecture": "implementation",
                "security": "review",
                "deployment": "done",
            }


def route_after_phase(state: SDLCState) -> str:
    """Decide the next phase after a node finishes.

    Returns the *node name* the supervisor should execute next, or
    ``END`` to terminate the run.

    Rules
    -----
    * If ``state.current_phase`` is ``FAILED`` → END.
    * If ``state.current_phase`` is ``BLOCKED_APPROVAL`` → ``approval_gate``.
    * Otherwise → the next sequential phase.
    """

    if state.current_phase == SDLCPhase.FAILED:
        return END
    if state.current_phase == SDLCPhase.BLOCKED_APPROVAL:
        return "approval_gate"
    # Sequential ordering is encoded in the graph edges; this is the
    # safety-net for nodes that exit with the next phase already set.
    return _next_sequential(state.current_phase)


def route_after_gate(state: SDLCState) -> str:
    """Decide where to go after the approval gate resolves."""

    if state.current_phase == SDLCPhase.FAILED:
        return END
    if state.current_phase == SDLCPhase.DONE:
        return END
    # Find the gate that just cleared by inspecting metadata.
    cleared = state.metadata.get("__gate_cleared__")
    if cleared and cleared in _FORWARD_AFTER_GATE:
        return _FORWARD_AFTER_GATE[cleared]
    # Fallback: return to implementation (covers legacy states).
    return "implementation"


_FORWARD_AFTER_GATE: dict[str, str] = {
    "architecture": "implementation",
    "security": "review",
    "deployment": "done",
}


def _next_sequential(phase: SDLCPhase) -> str:
    mapping = {
        SDLCPhase.DISCOVERY: "planning",
        SDLCPhase.PLANNING: "architecture",
        SDLCPhase.ARCHITECTURE: "approval_gate",
        SDLCPhase.IMPLEMENTATION: "testing",
        SDLCPhase.TESTING: "security",
        SDLCPhase.SECURITY: "approval_gate",
        SDLCPhase.REVIEW: "deployment",
        SDLCPhase.DEPLOYMENT: "approval_gate",
        SDLCPhase.BLOCKED_APPROVAL: "approval_gate",
        SDLCPhase.DONE: END,
        SDLCPhase.FAILED: END,
    }
    return mapping[phase]


async def _terminal_done_node(state: SDLCState) -> dict[str, Any]:
    """Terminal node: marks the run DONE and returns the final state dict."""

    final = state.with_phase(SDLCPhase.DONE, reason="completed")
    return final.model_dump(mode="json")


def _route_done(state: SDLCState) -> str:
    """Terminal node routing — always :data:`END`."""

    return END


# ---------------------------------------------------------------------------
# Graph builder
# ---------------------------------------------------------------------------

def build_sdlc_graph(
    *,
    checkpointer: BaseCheckpointSaver[Any, Any] | None = None,
    discovery: DiscoveryNode | None = None,
    planning: PlanningNode | None = None,
    architecture: ArchitectureNode | None = None,
    implementation: ImplementationNode | None = None,
    testing: TestingNode | None = None,
    security: SecurityNode | None = None,
    review: ReviewNode | None = None,
    deployment: DeploymentNode | None = None,
    approval_gate: ApprovalGateNode | None = None,
) -> Any:
    """Build and compile the SDLC supervisor graph.

    Parameters are injectable so tests can swap nodes for mocks. The
    default wiring uses :func:`_default_nodes` which constructs each
    phase node with its substrate services.
    """

    nodes: dict[str, BasePhaseNode] = {
        "discovery": discovery or _default_nodes()["discovery"],
        "planning": planning or _default_nodes()["planning"],
        "architecture": architecture or _default_nodes()["architecture"],
        "implementation": implementation or _default_nodes()["implementation"],
        "testing": testing or _default_nodes()["testing"],
        "security": security or _default_nodes()["security"],
        "review": review or _default_nodes()["review"],
        "deployment": deployment or _default_nodes()["deployment"],
    }
    gate: ApprovalGateNode = approval_gate or ApprovalGateNode()

    builder: StateGraph = StateGraph(SDLCState)
    

    for name, node in nodes.items():
        builder.add_node(name, node)
    builder.add_node("approval_gate", gate)
    # A terminal "done" node is required because LangGraph validates
    # that every key in a conditional-edges path map names a real node.
    # The node simply forwards to END via its conditional edge.
    builder.add_node("done", _terminal_done_node)

    # Sequential edges.
    builder.add_edge(START, "discovery")
    builder.add_edge("discovery", "planning")
    builder.add_edge("planning", "architecture")
    builder.add_edge("implementation", "testing")
    builder.add_edge("testing", "security")
    builder.add_edge("review", "deployment")

    # Phase exits — each phase node decides whether to advance, pause,
    # or fail by writing ``state.current_phase``. The conditional edge
    # inspects that field via :func:`route_after_phase`.
    for phase_name, after_node in (
        ("architecture", "implementation"),
        ("security", "review"),
        ("deployment", "done"),
    ):
        builder.add_conditional_edges(
            phase_name,
            route_after_phase,
            {
                "approval_gate": "approval_gate",
                after_node: after_node,
                END: END,
            },
        )

    # Non-approval phase exits route straight to the next phase or end.
    for phase_name, after_node in (
        ("discovery", "planning"),
        ("planning", "architecture"),
        ("implementation", "testing"),
        ("testing", "security"),
        ("review", "deployment"),
    ):
        builder.add_conditional_edges(
            phase_name,
            route_after_phase,
            {
                "approval_gate": "approval_gate",
                after_node: after_node,
                END: END,
            },
        )

    # Gate exit — after a grant, advance; after a deny, fail.
    builder.add_conditional_edges(
        "approval_gate",
        route_after_gate,
        {
            "implementation": "implementation",
            "review": "review",
            "done": "done",
            END: END,
        },
    )

    # Terminal "done" node forwards to END.
    builder.add_conditional_edges(
        "done",
        _route_done,
        {END: END},
    )

    if checkpointer is None:
        from langgraph.checkpoint.memory import MemorySaver

        checkpointer = MemorySaver()
    return builder.compile(checkpointer=checkpointer)


def _default_nodes() -> dict[str, BasePhaseNode]:
    """Construct the default phase nodes with their services wired in."""

    return {
        "discovery": DiscoveryNode(),
        "planning": PlanningNode(),
        "architecture": ArchitectureNode(),
        "implementation": ImplementationNode(),
        "testing": TestingNode(),
        "security": SecurityNode(),
        "review": ReviewNode(),
        "deployment": DeploymentNode(),
    }


# ---------------------------------------------------------------------------
# High-level entry point — the public run helper
# ---------------------------------------------------------------------------

async def run_sdlc(
    initial_state: SDLCState,
    *,
    thread_id: str | None = None,
    graph: Any | None = None,
    checkpointer: BaseCheckpointSaver[Any, Any] | None = None,
) -> AsyncIterator[SDLCState]:
    """Drive the supervisor graph from ``initial_state`` to completion.

    Yields :class:`SDLCState` snapshots after each node so callers can
    stream state updates to a UI / WebSocket / SSE endpoint.
    """

    if graph is None:
        graph = build_sdlc_graph(checkpointer=checkpointer)
    config: dict[str, Any] = {
        "configurable": {"thread_id": thread_id or str(initial_state.run_id)}
    }
    async for snapshot in graph.astream(initial_state.model_dump(mode="json"), config=config):
        if not isinstance(snapshot, dict):
            continue
        for value in snapshot.values():
            if isinstance(value, dict):
                yield SDLCState.model_validate(value)
                continue
            if isinstance(value, SDLCState):
                yield value


__all__ = [
    "GraphSpec",
    "build_sdlc_graph",
    "run_sdlc",
    "route_after_phase",
    "route_after_gate",
]
