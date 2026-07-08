"""SQLAlchemy 2.0 ORM models."""

from app.db.models.agent import Agent
from app.db.models.agent_config import AgentConfig
from app.db.models.alert_config import AlertConfig
from app.db.models.approval import ApprovalRequest
from app.db.models.artifact import Artifact
from app.db.models.audit import AuditEvent
from app.db.models.board_confirmation import BoardConfirmation, BoardConfirmationOutcome
from app.db.models.connector import Connector, ConnectorSyncHistory
from app.db.models.connector_activity import ConnectorActivity  # noqa: F401
from app.db.models.connector_credential import (
    ConnectorCredential,
    CredentialScope,
    CredentialType,
)
from app.db.models.cost import CostEntry
from app.db.models.cost_rollup import CostMinuteRollup  # noqa: F401
from app.db.models.customer import Customer
from app.db.models.dashboard import (
    AIInsight,
    AIInsightRead,
    DashboardLayoutRow,
    PinnedItem,
)
from app.db.models.env_var import EnvVar
from app.db.models.hook import Hook
from app.db.models.ideation import (
    PRD,
    ApprovalDecision,
    ApprovalItem,
    ApprovalItemStatus,
    ApprovalItemType,
    ArchitecturePreview,
    Idea,
    IdeaAnalysis,
    IdeaSource,
    IdeaStatus,
    OpportunityScore,
    OutputBundle,
    PRDStatus,
    PushRecord,
    PushStatus,
    PushTarget,
    Roadmap,
    RoadmapHorizon,
    RoadmapStatus,
    ScoreSource,
    WorkflowSession,
    WorkflowSessionStatus,
    WorkflowStep,
    WorkflowStepStatus,
)
from app.db.models.lesson import LessonCandidate, LessonSource, LessonStatus
from app.db.models.marketplace import MarketplaceConnector
from app.db.models.model_provider import ModelProvider
from app.db.models.onboarding import OnboardingSession, OnboardingStep
from app.db.models.organization import Organization

# step-80 — Phase 4 (cache, sessions, identity, credentials, finops).
from app.db.models.phase4 import (
    Phase4A2ADelegation,  # noqa: F401
    Phase4CacheKey,  # noqa: F401
    Phase4Credential,  # noqa: F401
    Phase4FinopsExport,  # noqa: F401
    Phase4FinopsSettings,  # noqa: F401
    Phase4JwtSigningKey,  # noqa: F401
    Phase4OAuthClient,  # noqa: F401
    Phase4RealtimeClientSecret,  # noqa: F401
    Phase4ScimToken,  # noqa: F401
    Phase4Session,  # noqa: F401
    Phase4SessionEvent,  # noqa: F401
    Phase4SsoConfig,  # noqa: F401
    Phase4VaultConfig,  # noqa: F401
)
from app.db.models.policy import Policy
from app.db.models.project import Project
from app.db.models.project_invitation import ProjectInvitation
from app.db.models.project_member import ProjectMember
from app.db.models.prompt import Prompt, PromptVersion  # noqa: F401
from app.db.models.rag import RagChunk, VectorStore  # noqa: F401
from app.db.models.repo_ingestion import (
    IngestionArtifact,
    IngestionArtifactType,
    IngestionRun,
    IngestionStatus,
    Repo,
)
from app.db.models.role import Role

# M5 T-A3 — SecurityReport model (architecture_security_reports table).
from app.db.models.security_report import SecurityReport
from app.db.models.standard import Standard
from app.db.models.steering_rule import SteeringRule
from app.db.models.team import Team
from app.db.models.team_member import TeamMember
from app.db.models.template import Template
from app.db.models.tenant import Tenant
from app.db.models.tenant_settings import TenantSettings  # noqa: F401
from app.db.models.terminal_cost import TerminalSessionCost
from app.db.models.user import User
from app.db.models.user_session import UserApiToken, UserSession
from app.db.models.webhook import (
    Webhook,
    WebhookAuthType,
    WebhookDelivery,
    WebhookDeliveryStatus,
    WebhookDirection,
    WebhookStatus,
)
from app.db.models.workflow_budget import (
    WorkflowBudget,
    WorkflowBudgetDecision,
    WorkflowBudgetStatus,
)

__all__ = [
    "Agent",
    "AgentConfig",
    "AlertConfig",
    "AIInsight",
    "AIInsightRead",
    "ApprovalDecision",
    "ApprovalItem",
    "ApprovalItemStatus",
    "ApprovalItemType",
    "ApprovalRequest",
    "ArchitecturePreview",
    "Artifact",
    "AuditEvent",
    "BoardConfirmation",
    "BoardConfirmationOutcome",
    "Connector",
    "ConnectorCredential",
    "ConnectorSyncHistory",
    "CostEntry",
    "Customer",
    "CredentialScope",
    "CredentialType",
    "DashboardLayoutRow",
    "PinnedItem",
    "EnvVar",
    "Hook",
    "Idea",
    "IdeaAnalysis",
    "IdeaSource",
    "IdeaStatus",
    "IngestionArtifact",
    "IngestionArtifactType",
    "IngestionRun",
    "IngestionStatus",
    "LessonCandidate",
    "LessonSource",
    "LessonStatus",
    "MarketplaceConnector",
    "ModelProvider",
    "OnboardingSession",
    "Organization",
    "OnboardingStep",
    "OpportunityScore",
    "OutputBundle",
    "PRD",
    "PRDStatus",
    "Policy",
    "Project",
    "ProjectInvitation",
    "ProjectMember",
    "PushRecord",
    "PushStatus",
    "PushTarget",
    "Repo",
    "Roadmap",
    "RoadmapHorizon",
    "RoadmapStatus",
    "Role",
    "ScoreSource",
    "Standard",
    "SteeringRule",
    "SecurityReport",
    "Template",
    "Team",
    "TeamMember",
    "Tenant",
    "TerminalSessionCost",
    "User",
    "UserApiToken",
    "UserSession",
    "Webhook",
    "WebhookAuthType",
    "WebhookDelivery",
    "WebhookDeliveryStatus",
    "WebhookDirection",
    "WebhookStatus",
    "WorkflowSession",
    "WorkflowSessionStatus",
    "WorkflowStep",
    "WorkflowStepStatus",
    "WorkflowBudget",
    "WorkflowBudgetDecision",
    "WorkflowBudgetStatus",
]
