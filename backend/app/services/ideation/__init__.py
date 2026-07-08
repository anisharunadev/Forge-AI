"""Ideation Center services (F-201..F-213)."""

from __future__ import annotations

# Re-exports so callers (and tests) can use a single import surface.
from app.services.ideation.agent_selector import (
    AgentAssignmentPlan,
    AgentAssignmentStep,
    AgentSelector,
    agent_selector,
)
from app.services.ideation.approval_queue import (
    ApprovalQueueService,
    approval_queue_service,
)
from app.services.ideation.arch_preview import (
    ArchPreviewService,
    arch_preview_service,
)
from app.services.ideation.idea_analysis import (
    IdeaAnalysisService,
    idea_analysis_service,
)
from app.services.ideation.idea_intake import (
    IdeaIntakeService,
    ValidationResult,
    extract_entities,
    idea_intake_service,
    validate_idea,
)
from app.services.ideation.impact_graph import (
    ComparisonResult,
    GraphEdge,
    GraphNode,
    ImpactEntry,  # noqa: F401
    ImpactGraph,  # noqa: F401
    ImpactGraphService,  # noqa: F401
    impact_graph_service,
)
from app.services.ideation.kg_integration import (
    GraphEdgePayload,
    GraphNodePayload,
    IdeaGraph,
    IdeationKGService,
    ideation_kg_service,
)
from app.services.ideation.output_bundle import (
    OutputBundleService,
    output_bundle_service,
)
from app.services.ideation.prd_generator import (
    BMAD_SECTIONS,
    PRDGenerator,
    prd_generator,
)
from app.services.ideation.push_to_delivery import (
    PushResult,
    PushToDeliveryService,
    push_to_delivery_service,
)
from app.services.ideation.realtime_workflow import (
    PIPELINE,
    PipelineStep,
    RealtimeWorkflow,
    WorkflowState,
    realtime_workflow,
    serialize_event,
)
from app.services.ideation.roadmap_generator import (
    RoadmapGenerator,
    roadmap_generator,
)
from app.services.ideation.scoring import (
    OpportunityScoringService,  # noqa: F401
    ScoreComponents,
    opportunity_scoring_service,
)

# Test-friendly aliases
idea_knowledge_graph_service = ideation_kg_service
idea_output_bundle_service = output_bundle_service
idea_push_to_delivery_service = push_to_delivery_service

__all__ = [
    "AgentAssignmentPlan",
    "AgentAssignmentStep",
    "AgentSelector",
    "ApprovalQueueService",
    "ArchPreviewService",
    "BMAD_SECTIONS",
    "ComparisonResult",
    "GraphEdge",
    "GraphEdgePayload",
    "GraphNode",
    "GraphNodePayload",
    "IdeaAnalysisService",
    "IdeaGraph",
    "IdeaIntakeService",
    "IdeationKGService",
    "OutputBundleService",
    "PIPELINE",
    "PRDGenerator",
    "PipelineStep",
    "PushResult",
    "PushToDeliveryService",
    "RealtimeWorkflow",
    "RoadmapGenerator",
    "ScoreComponents",
    "ValidationResult",
    "WorkflowState",
    "agent_selector",
    "approval_queue_service",
    "arch_preview_service",
    "extract_entities",
    "idea_analysis_service",
    "idea_intake_service",
    "idea_knowledge_graph_service",
    "idea_output_bundle_service",
    "idea_push_to_delivery_service",
    "ideation_kg_service",
    "impact_graph_service",
    "opportunity_scoring_service",
    "output_bundle_service",
    "prd_generator",
    "push_to_delivery_service",
    "realtime_workflow",
    "roadmap_generator",
    "serialize_event",
    "validate_idea",
]
