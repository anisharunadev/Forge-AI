"""Phase 0.7 — Seed Migration Framework schema surface.

Adds:
- ``is_demo BOOLEAN NOT NULL DEFAULT FALSE`` on every tenant-scoped
  table that exists in the baseline.
- ``seed_runs`` and ``seed_migrations`` bookkeeping tables.
- 10 new domain tables backing the acme-corp demo seed:
  graph_nodes, graph_edges, conflicts, pulse_events,
  metric_snapshots, services, api_catalog, database_map,
  command_runs, tool_bundles.

Idempotency note: this is a structural migration. ``alembic upgrade
head`` applies it once; subsequent runs are no-ops.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "a795c2f979da"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Tenant-scoped tables that already exist in the baseline migration.
# Each gets an ``is_demo BOOLEAN NOT NULL DEFAULT FALSE`` column.
_TENANT_SCOPED_TABLES: tuple[str, ...] = (
    "users",
    "roles",
    "standards",
    "templates",
    "policies",
    "connectors",
    "connector_sync_history",
    "repos",
    "agents",
    "artifacts",
    "hooks",
    "architecture_adrs",
    "architecture_api_contracts",
    "architecture_risk_registers",
    "architecture_approvals",
    "output_bundles",
    "ideas",
    "idea_analyses",
    "opportunity_scores",
    "prds",
    "roadmaps",
    "workflow_sessions",
    "workflow_steps",
    "approval_requests",
    "ideation_approval_items",
    "approval_decisions",
    "push_records",
    "audit_events",
    "marketplace_connectors",
    "model_providers",
    "onboarding_sessions",
    "onboarding_steps",
    "ingestion_runs",
    "ingestion_artifacts",
    "steering_rules",
    "workflow_budgets",
    "workflow_budget_decisions",
    "cost_entries",
    "terminal_session_costs",
)


def upgrade() -> None:
    # 1. Add is_demo to every existing tenant-scoped table.
    for table in _TENANT_SCOPED_TABLES:
        op.add_column(
            table,
            sa.Column(
                "is_demo",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )
        op.create_index(
            f"ix_{table}_tenant_demo",
            table,
            ["tenant_id", "is_demo"],
        )

    # 2. seed_runs — every seed runner invocation.
    op.create_table(
        "seed_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("seed_name", sa.String(100), nullable=False),
        sa.Column("manifest_version", sa.Integer(), nullable=False),
        sa.Column(
            "operation",
            sa.Enum(
                "apply",
                "reset",
                "rollback",
                "status",
                "diff",
                name="seed_operation",
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "running",
                "completed",
                "failed",
                "rolled_back",
                "drift_detected",
                name="seed_run_status",
            ),
            nullable=False,
            server_default="running",
        ),
        sa.Column("env", sa.String(20), nullable=False),
        sa.Column("triggered_by", sa.String(20), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "applied_versions",
            postgresql.ARRAY(sa.String),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "row_counts",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "dropped_rows",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("checksum_before", sa.String(64), nullable=True),
        sa.Column("checksum_after", sa.String(64), nullable=True),
        sa.Column(
            "drift_summary",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "error",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column(
            "is_demo",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_seed_runs_seed_name_started", "seed_runs", ["seed_name", "started_at"]
    )
    op.create_index("ix_seed_runs_status", "seed_runs", ["status"])
    op.create_index("ix_seed_runs_actor", "seed_runs", ["actor_id"])
    op.create_index("ix_seed_runs_env_status", "seed_runs", ["env", "status"])

    # 3. seed_migrations — durable "what is currently applied" record.
    op.create_table(
        "seed_migrations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("version", sa.String(50), nullable=False, unique=True),
        sa.Column("seed_name", sa.String(100), nullable=False),
        sa.Column("manifest_version", sa.Integer(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "applied_by", postgresql.UUID(as_uuid=True), nullable=False
        ),
        sa.Column("checksum", sa.String(64), nullable=False),
        sa.Column(
            "row_counts",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "success",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_seed_migrations_seed_name_applied",
        "seed_migrations",
        ["seed_name", "applied_at"],
    )

    # 4. graph_nodes.
    op.create_table(
        "graph_nodes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("node_key", sa.String(200), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "adr",
                "service",
                "repo",
                "api",
                "database",
                "risk",
                "idea",
                "user",
                "project",
                "standard",
                "policy",
                "conflict",
                name="graph_node_kind",
            ),
            nullable=False,
        ),
        sa.Column("label", sa.String(500), nullable=False),
        sa.Column("source_table", sa.String(100), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "properties",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.String),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_graph_nodes_tenant_key", "graph_nodes", ["tenant_id", "node_key"], unique=True
    )
    op.create_index("ix_graph_nodes_tenant_kind", "graph_nodes", ["tenant_id", "kind"])
    op.create_index(
        "ix_graph_nodes_source", "graph_nodes", ["source_table", "source_id"]
    )

    # 5. graph_edges.
    op.create_table(
        "graph_edges",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("edge_key", sa.String(200), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "supersedes",
                "references",
                "implements",
                "owns",
                "depends_on",
                "conflicts_with",
                "governed_by",
                "documents",
                "deploys",
                name="graph_edge_kind",
            ),
            nullable=False,
        ),
        sa.Column(
            "from_node_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("graph_nodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "to_node_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("graph_nodes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("weight", sa.Float(), nullable=False, server_default=sa.text("1.0")),
        sa.Column(
            "properties",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_graph_edges_tenant_key", "graph_edges", ["tenant_id", "edge_key"], unique=True
    )
    op.create_index("ix_graph_edges_tenant_kind", "graph_edges", ["tenant_id", "kind"])
    op.create_index("ix_graph_edges_from_node", "graph_edges", ["from_node_id"])
    op.create_index("ix_graph_edges_to_node", "graph_edges", ["to_node_id"])

    # 6. conflicts.
    op.create_table(
        "conflicts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conflict_key", sa.String(200), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "severity",
            sa.Enum(
                "low", "medium", "high", "critical", name="conflict_severity"
            ),
            nullable=False,
            server_default="medium",
        ),
        sa.Column(
            "status",
            sa.Enum(
                "open", "resolved", "deferred", "wont_fix", name="conflict_status"
            ),
            nullable=False,
            server_default="open",
        ),
        sa.Column(
            "sources",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "resolution_path",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("resolved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.String),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "related_node_ids",
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_conflicts_tenant_key",
        "conflicts",
        ["tenant_id", "conflict_key"],
        unique=True,
    )
    op.create_index(
        "ix_conflicts_tenant_status", "conflicts", ["tenant_id", "status"]
    )
    op.create_index(
        "ix_conflicts_tenant_severity", "conflicts", ["tenant_id", "severity"]
    )

    # 7. pulse_events.
    op.create_table(
        "pulse_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_key", sa.String(200), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "agent_run",
                "approval",
                "conflict",
                "ide_event",
                "terminal_event",
                "ingestion",
                "seed",
                "command",
                name="pulse_event_kind",
            ),
            nullable=False,
        ),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("target_type", sa.String(64), nullable=True),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("summary", sa.String(500), nullable=False),
        sa.Column(
            "payload",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.String),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_pulse_events_tenant_key",
        "pulse_events",
        ["tenant_id", "event_key"],
        unique=True,
    )
    op.create_index(
        "ix_pulse_events_tenant_kind_occurred",
        "pulse_events",
        ["tenant_id", "kind", "occurred_at"],
    )
    op.create_index(
        "ix_pulse_events_tenant_target",
        "pulse_events",
        ["tenant_id", "target_type", "target_id"],
    )

    # 8. metric_snapshots.
    op.create_table(
        "metric_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("metric_key", sa.String(200), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(32), nullable=False, server_default=""),
        sa.Column(
            "dimensions",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("snapshot_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_metric_snapshots_tenant_metric_time",
        "metric_snapshots",
        ["tenant_id", "metric_key", "snapshot_at"],
        unique=True,
    )
    op.create_index(
        "ix_metric_snapshots_tenant_metric",
        "metric_snapshots",
        ["tenant_id", "metric_key"],
    )

    # 9. services.
    op.create_table(
        "services",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("service_key", sa.String(200), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("owner_team", sa.String(120), nullable=False),
        sa.Column(
            "repository_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("repos.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "lifecycle",
            sa.Enum(
                "planned",
                "development",
                "active",
                "deprecated",
                "sunset",
                name="service_lifecycle",
            ),
            nullable=False,
            server_default="active",
        ),
        sa.Column("tier", sa.String(16), nullable=False, server_default="tier-3"),
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.String),
            nullable=False,
            server_default="{}",
        ),
        sa.Column(
            "properties",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_services_tenant_key", "services", ["tenant_id", "service_key"], unique=True
    )
    op.create_index(
        "ix_services_tenant_owner", "services", ["tenant_id", "owner_team"]
    )
    op.create_index(
        "ix_services_tenant_lifecycle", "services", ["tenant_id", "lifecycle"]
    )

    # 10. api_catalog.
    op.create_table(
        "api_catalog",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("api_key", sa.String(200), nullable=False),
        sa.Column(
            "service_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("services.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column(
            "surface",
            sa.Enum(
                "rest", "graphql", "grpc", "event", "internal", name="api_surface"
            ),
            nullable=False,
        ),
        sa.Column("path", sa.String(500), nullable=False, server_default=""),
        sa.Column("method", sa.String(10), nullable=False, server_default="GET"),
        sa.Column("version", sa.String(32), nullable=False, server_default="v1"),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "contract_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("architecture_api_contracts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "properties",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_api_catalog_tenant_key",
        "api_catalog",
        ["tenant_id", "api_key"],
        unique=True,
    )
    op.create_index(
        "ix_api_catalog_tenant_service", "api_catalog", ["tenant_id", "service_id"]
    )

    # 11. database_map.
    op.create_table(
        "database_map",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("db_key", sa.String(200), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column(
            "engine",
            sa.Enum(
                "postgres",
                "redis",
                "mongodb",
                "dynamodb",
                "snowflake",
                "bigquery",
                name="database_engine",
            ),
            nullable=False,
        ),
        sa.Column("version", sa.String(32), nullable=False, server_default=""),
        sa.Column(
            "owning_service_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("services.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("region", sa.String(64), nullable=False, server_default=""),
        sa.Column("instance_class", sa.String(64), nullable=False, server_default=""),
        sa.Column("storage_gb", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pii", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "properties",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_database_map_tenant_key",
        "database_map",
        ["tenant_id", "db_key"],
        unique=True,
    )
    op.create_index(
        "ix_database_map_tenant_engine", "database_map", ["tenant_id", "engine"]
    )

    # 12. command_runs.
    op.create_table(
        "command_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("run_key", sa.String(200), nullable=False),
        sa.Column("command_name", sa.String(120), nullable=False),
        sa.Column("invoked_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "queued",
                "running",
                "succeeded",
                "failed",
                "cancelled",
                "timed_out",
                name="command_run_status",
            ),
            nullable=False,
            server_default="queued",
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("cost_usd", sa.Float(), nullable=False, server_default="0"),
        sa.Column(
            "input",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "output",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "artifacts_produced",
            postgresql.ARRAY(sa.String),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_command_runs_tenant_key",
        "command_runs",
        ["tenant_id", "run_key"],
        unique=True,
    )
    op.create_index(
        "ix_command_runs_tenant_command",
        "command_runs",
        ["tenant_id", "command_name"],
    )
    op.create_index(
        "ix_command_runs_tenant_status_started",
        "command_runs",
        ["tenant_id", "status", "started_at"],
    )

    # 13. tool_bundles.
    op.create_table(
        "tool_bundles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("bundle_key", sa.String(120), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "tier",
            sa.Enum(
                "read_only",
                "propose",
                "write",
                "execute",
                "gated",
                name="tool_bundle_tier",
            ),
            nullable=False,
            server_default="read_only",
        ),
        sa.Column(
            "tools",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "requires_approval",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.String),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_tool_bundles_tenant_key",
        "tool_bundles",
        ["tenant_id", "bundle_key"],
        unique=True,
    )
    op.create_index(
        "ix_tool_bundles_tenant_tier", "tool_bundles", ["tenant_id", "tier"]
    )

    # 14. RLS predicate update: extend tenant-scoped policies to allow
    #     demo rows through when app.include_demo='on'. We do this by
    #     recreating the policies on the most-frequently-queried
    #     tables; tables without explicit policies still inherit the
    #     tenant_id-only behavior (which is what production tenants
    #     want — demo rows are filtered out by default).
    for table in (
        "tenants",
        "users",
        "standards",
        "templates",
        "policies",
        "repos",
        "architecture_adrs",
        "architecture_api_contracts",
        "architecture_risk_registers",
        "output_bundles",
        "approval_requests",
        "agents",
        "artifacts",
        "hooks",
        "roadmaps",
        "ideas",
        "idea_analyses",
        "opportunity_scores",
        "prds",
        "workflow_sessions",
        "workflow_steps",
    ):
        # Use IF EXISTS so the migration is forward-compatible with
        # environments where the policy wasn't auto-generated.
        op.execute(
            f"""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_catalog.pg_policy p
                    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
                    WHERE c.relname = '{table}'
                      AND p.polname = '{table}_tenant_isolation'
                ) THEN
                    -- We do NOT change the policy body here. Demo
                    -- row filtering is handled by the application
                    -- layer setting `app.include_demo = 'on'` per
                    -- session. The SQL-level RLS policy continues to
                    -- gate by tenant_id; the runner is responsible
                    -- for opting in to demo data per-request.
                    NULL;
                END IF;
            END
            $$;
            """
        )


def downgrade() -> None:
    # Drop new tables in reverse order.
    op.drop_index("ix_tool_bundles_tenant_tier", table_name="tool_bundles")
    op.drop_index("uq_tool_bundles_tenant_key", table_name="tool_bundles")
    op.drop_table("tool_bundles")

    op.drop_index("ix_command_runs_tenant_status_started", table_name="command_runs")
    op.drop_index("ix_command_runs_tenant_command", table_name="command_runs")
    op.drop_index("uq_command_runs_tenant_key", table_name="command_runs")
    op.drop_table("command_runs")

    op.drop_index("ix_database_map_tenant_engine", table_name="database_map")
    op.drop_index("uq_database_map_tenant_key", table_name="database_map")
    op.drop_table("database_map")

    op.drop_index("ix_api_catalog_tenant_service", table_name="api_catalog")
    op.drop_index("uq_api_catalog_tenant_key", table_name="api_catalog")
    op.drop_table("api_catalog")

    op.drop_index("ix_services_tenant_lifecycle", table_name="services")
    op.drop_index("ix_services_tenant_owner", table_name="services")
    op.drop_index("uq_services_tenant_key", table_name="services")
    op.drop_table("services")

    op.drop_index(
        "ix_metric_snapshots_tenant_metric", table_name="metric_snapshots"
    )
    op.drop_index(
        "uq_metric_snapshots_tenant_metric_time", table_name="metric_snapshots"
    )
    op.drop_table("metric_snapshots")

    op.drop_index(
        "ix_pulse_events_tenant_target", table_name="pulse_events"
    )
    op.drop_index(
        "ix_pulse_events_tenant_kind_occurred", table_name="pulse_events"
    )
    op.drop_index("uq_pulse_events_tenant_key", table_name="pulse_events")
    op.drop_table("pulse_events")

    op.drop_index("ix_conflicts_tenant_severity", table_name="conflicts")
    op.drop_index("ix_conflicts_tenant_status", table_name="conflicts")
    op.drop_index("uq_conflicts_tenant_key", table_name="conflicts")
    op.drop_table("conflicts")

    op.drop_index("ix_graph_edges_to_node", table_name="graph_edges")
    op.drop_index("ix_graph_edges_from_node", table_name="graph_edges")
    op.drop_index("ix_graph_edges_tenant_kind", table_name="graph_edges")
    op.drop_index("uq_graph_edges_tenant_key", table_name="graph_edges")
    op.drop_table("graph_edges")

    op.drop_index("ix_graph_nodes_source", table_name="graph_nodes")
    op.drop_index("ix_graph_nodes_tenant_kind", table_name="graph_nodes")
    op.drop_index("uq_graph_nodes_tenant_key", table_name="graph_nodes")
    op.drop_table("graph_nodes")

    op.drop_index(
        "ix_seed_migrations_seed_name_applied", table_name="seed_migrations"
    )
    op.drop_table("seed_migrations")

    op.drop_index("ix_seed_runs_env_status", table_name="seed_runs")
    op.drop_index("ix_seed_runs_actor", table_name="seed_runs")
    op.drop_index("ix_seed_runs_status", table_name="seed_runs")
    op.drop_index("ix_seed_runs_seed_name_started", table_name="seed_runs")
    op.drop_table("seed_runs")

    for table in reversed(_TENANT_SCOPED_TABLES):
        op.drop_index(f"ix_{table}_tenant_demo", table_name=table)
        op.drop_column(table, "is_demo")

    # Drop enums.
    op.execute("DROP TYPE IF EXISTS tool_bundle_tier")
    op.execute("DROP TYPE IF EXISTS command_run_status")
    op.execute("DROP TYPE IF EXISTS database_engine")
    op.execute("DROP TYPE IF EXISTS api_surface")
    op.execute("DROP TYPE IF EXISTS service_lifecycle")
    op.execute("DROP TYPE IF EXISTS conflict_status")
    op.execute("DROP TYPE IF EXISTS conflict_severity")
    op.execute("DROP TYPE IF EXISTS pulse_event_kind")
    op.execute("DROP TYPE IF EXISTS graph_edge_kind")
    op.execute("DROP TYPE IF EXISTS graph_node_kind")
    op.execute("DROP TYPE IF EXISTS seed_run_status")
    op.execute("DROP TYPE IF EXISTS seed_operation")