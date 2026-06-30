# Reference: DB Schema (All 43 Model Files, ~150 Tables)

> **Status:** ✅ Canonical — every SQLAlchemy model + relationship documented
> **Doc owner:** Platform team
> **Source of truth:** `~/forge-ai/backend/app/db/models/` + `backend/app/db/migrations/versions/`
> **Last updated:** 2026-06-30
> **Total model files:** 43 (~150 tables)

---

## Purpose

This document is the **canonical inventory of every database table** in Forge AI. For each model, it captures the table name, file, columns, relationships, and RLS policy.

For detailed per-feature data semantics, see the relevant feature doc under `/docs/features/`. This schema doc is the **map**, not the explanation.

---

## Source of truth

- **This file** — `/docs/reference/db-schema.md`
- **Backend source** — `backend/app/db/models/`
- **Migrations** — `backend/app/db/migrations/versions/`
- **Base mixins** — `backend/app/db/models/base.py` (`TenantScopedModel`, `SoftDeleteMixin`, `TimestampMixin`, `UUIDPrimaryKeyMixin`)
- **Per-feature docs** — `/docs/features/<feature>.md` (each doc has a "Data touched" section)

---

## Conventions

- **Every table has a UUID PK** (via `UUIDPrimaryKeyMixin`) — no auto-increment integers
- **Every table has `created_at` + `updated_at`** (via `TimestampMixin`) — timezone-aware
- **Tenant-aware tables** extend `TenantScopedModel` (adds `tenant_id` + `project_id`)
- **Mutable tables** extend `SoftDeleteMixin` (adds `deleted_at` + `deleted_by`)
- **Every tenant-scoped table has an RLS policy** in its migration
- **Audit tables** are append-only (DB-level `_reject_mutation` listener)

**See:** `/docs/standards/data-model.md` for the full model patterns.

---

## Models by feature

### Tenant + Auth — 3 models

#### `tenants` (`backend/app/db/models/tenant.py`)

```python
class Tenant(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "tenants"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
```

**Index:** `slug` (unique)

#### `users` (`backend/app/db/models/user.py`)

```python
class User(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "users"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("tenants.id"), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(2048))
    keycloak_subject: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scopes: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
```

**Indexes:** `tenant_id`, `email`, `keycloak_subject` (unique)

#### `roles` (`backend/app/db/models/role.py`)

```python
class Role(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "roles"

    tenant_id: Mapped[UUID] = mapped_column(GUID(), ForeignKey("tenants.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    permissions: Mapped[list[str]] = mapped_column(ARRAY(String), nullable=False, default=list)
```

---

### Audit + Cost — 3 models

#### `audit_events` (`backend/app/db/models/audit.py`)

```python
class AuditEvent(Base, UUIDPrimaryKeyMixin):
    """Append-only audit log. UPDATE/DELETE blocked by DB listener."""

    __tablename__ = "audit_events"

    action: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    actor_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    tenant_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    previous_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    current_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    __table_args__ = (
        Index("ix_audit_tenant_target", "tenant_id", "target_type", "target_id"),
        Index("ix_audit_tenant_action_time", "tenant_id", "action", "timestamp"),
    )
```

**Immutability:** DB-level `_reject_mutation` listener blocks UPDATE/DELETE.

→ [Features: Audit](../features/audit.md)

#### `cost_ledger` (`backend/app/db/models/cost.py`)

```python
class CostLedgerEntry(Base, TenantScopedModel, UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "cost_ledger"

    actor_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    feature: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    amount_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False)  # "litellm" | "cli"
```

#### `litellm_call_records` (`backend/app/db/models/litellm_call_record.py`)

```python
class LiteLLMCallRecord(Base, TenantScopedModel, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "litellm_call_records"

    virtual_key: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    feature: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    cost_usd: Mapped[float] = mapped_column(Numeric(12, 6), nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    forge_trace_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
```

→ [Features: Analytics](../features/analytics.md), [Reference: litellm-bridge](./litellm-bridge.md)

---

### LiteLLM Gateway — 6 models

| Model | File | Purpose |
|---|---|---|
| `litellm_team_mapping` | `litellm_team_mapping.py` | Forge tenant ↔ LiteLLM team |
| `litellm_budget_config` | `litellm_budget_config.py` | Per-tenant budget config |
| `litellm_key_audit` | `litellm_key_audit.py` | Virtual key creation/rotation/revocation |
| `litellm_guardrail_violation` | `litellm_guardrail_violation.py` | F-829i compliance feed |
| `litellm_model_assignment` | `litellm_model_assignment.py` | Per-tenant model allowlist |
| `litellm_call_records` | (see Cost section above) | Per-call LLM usage |

→ [Features: Admin Hub](../features/admin-hub.md)

---

### Workflows + Runs — 7 models

| Model | File | Purpose |
|---|---|---|
| `workflows` | `workflow.py` | DAG definition |
| `workflow_runs` | `workflow.py` | Execution instance |
| `workflow_phases` | `workflow.py` | Per-phase state within a run |
| `workflow_budget` | `workflow_budget.py` | Per-workflow cost cap |
| `workflow_budget_alerts` | `workflow_budget.py` | Budget exceeded alerts |
| `workflow_run_events` | `workflow_budget.py` | SSE event stream |
| `command_runs` | `command_run.py` | forge-* command invocations |

→ [Features: Workflows](../features/workflows.md), [Features: Runs](../features/runs.md)

---

### Stories + Projects + Sprints + Epics — 11 models

| Model | File | Purpose |
|---|---|---|
| `projects` | `project.py` | Project intelligence container |
| `stories` | `story.py` | Story (unit of work) |
| `story_comments` | `story.py` | Comments on stories |
| `story_links` | `story.py` | Cross-story relationships |
| `story_history` | `story.py` | Audit trail per story |
| `sprints` | `story.py` | Timeboxed iteration |
| `sprint_stories` | `story.py` | M2M (sprint ↔ story) |
| `epics` | `story.py` | Goal-bounded grouping |
| `epic_stories` | `story.py` | M2M (epic ↔ story) |
| `milestones` | `story.py` | Milestone (longer than sprint) |
| `labels` | `story.py` | Free-form tags |

→ [Features: Stories](../features/stories.md), [Features: Projects](../features/projects.md)

---

### Repos + Knowledge Graph — 5 + 4 = 9 models

| Model | File | Purpose |
|---|---|---|
| `repositories` | `repo_ingestion.py` | Source code repo metadata |
| `repo_files` | `repo_ingestion.py` | Per-file metadata |
| `repo_commits` | `repo_ingestion.py` | Per-commit metadata |
| `repo_sync_runs` | `repo_ingestion.py` | Ingestion history |
| `repo_sync_errors` | `repo_ingestion.py` | Ingestion errors |
| `kg_nodes` | `graph.py` | Apache AGE graph node mirror |
| `kg_edges` | `graph.py` | Apache AGE graph edge mirror |
| `kg_embeddings` | `graph.py` | pgvector embeddings |
| `kg_ingestion_runs` | `graph.py` | KG ingest history |

→ [Features: Knowledge Center](../features/knowledge-center.md), [Features: Project Intelligence](../features/project-intelligence.md)

---

### Connector Center — 5 models

| Model | File | Purpose |
|---|---|---|
| `connectors` | `connector.py` | Connector config |
| `connector_credentials` | `connector.py` | Fernet-encrypted credentials |
| `connector_health_history` | `connector.py` | Health check history |
| `connector_sync_runs` | `connector.py` | Sync history |
| `connector_events` | `connector.py` | Event stream |

→ [Features: Connector Center](../features/connector-center.md)

---

### Ideation Center — 24 models

24 tables in `backend/app/db/models/ideation.py` + 2 in `ideation_signal.py`:

| Category | Tables |
|---|---|
| Intake + Ideas | `ideation_intake`, `ideation_ideas`, `ideation_tags` |
| Scoring | `ideation_scores`, `ideation_score_dimensions`, `ideation_voice_clusters` |
| PRD | `ideation_prds`, `ideation_prd_sections`, `ideation_prd_revisions` |
| Roadmap | `ideation_roadmap`, `ideation_roadmap_items`, `ideation_sequencing_runs` |
| Research | `ideation_source_signals`, `ideation_market_signals`, `ideation_voice_segments` |
| Validation | `ideation_validation_experiments`, `ideation_validation_results` |
| Collaboration | `ideation_comments`, `ideation_reviews`, `ideation_decisions` |
| Analytics | `ideation_funnel`, `ideation_conversion_events` |
| Templates | `ideation_templates`, `ideation_template_sections` |
| Push (Jira/Linear) | `ideation_push_records`, `ideation_push_failures` |
| Approvals | `ideation_approvals`, `ideation_approval_decisions` |
| Workflow sessions | `ideation_workflow_sessions`, `ideation_workflow_steps` |
| Ingest runs | `ideation_ingest_runs`, `ideation_ingest_items` |

→ [Features: Ideation Center](../features/ideation-center.md)

---

### Architecture Center — 5 + 6 = 11 models

| Model | File | Purpose |
|---|---|---|
| `architecture_adrs` | `architecture.py` | ADR (Architecture Decision Record) |
| `architecture_contracts` | `architecture.py` | API contracts |
| `architecture_risks` | `architecture.py` | Risk register |
| `architecture_acceptance` | `architecture.py` | Acceptance criteria |
| `architecture_diagrams` | `architecture.py` | Auto-generated diagrams |
| `architecture_services` | `architecture_services.py` | Service catalog |
| `architecture_service_dependencies` | `architecture_services.py` | Service deps |
| `architecture_standards` | `architecture_services.py` | Coding standards |
| `architecture_approvals` | `architecture_services.py` | Approval flow |
| `architecture_traceability` | `architecture_services.py` | Decision traceability |
| `architecture_versions` | `architecture_services.py` | Version history |

→ [Features: Architecture Center](../features/architecture-center.md)

---

### Seeds — 5 models

| Model | File | Purpose |
|---|---|---|
| `seed_packages` | `seed.py` | Seed manifest metadata |
| `seed_data_files` | `seed.py` | Per-file data declarations |
| `seed_runs` | `seed.py` | Run history |
| `seed_run_logs` | `seed.py` | Per-run log entries |
| `seed_drift_snapshots` | `seed.py` | Drift detection snapshots |

→ [Features: Seed Management](../features/seeds-admin.md)

---

### Agents — 3 models

| Model | File | Purpose |
|---|---|---|
| `agents` | `agent.py` | Registered agent |
| `agent_runtimes` | `agent.py` | Runtime instances |
| `agent_executions` | `agent.py` | Execution history |

→ [Features: Agent Center](../features/agent-center.md)

---

### Co-pilot — 2 models

| Model | File | Purpose |
|---|---|---|
| `copilot_sessions` | `copilot.py` | Co-pilot session metadata |
| `copilot_messages` | `copilot.py` | Messages within a session |

→ [Features: Co-pilot](../features/copilot.md)

---

### Terminal — 1 model

#### `terminal_costs` (`backend/app/db/models/terminal_cost.py`)

```python
class TerminalCost(Base, TenantScopedModel, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "terminal_costs"

    session_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    actor_id: Mapped[UUID | None] = mapped_column(GUID(), nullable=True)
    command: Mapped[str] = mapped_column(String(2048), nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False)  # "exact" | "heuristic" | "burn_rate"
```

→ [Features: Terminal](../features/terminal.md)

---

### Onboarding — 4 models

| Model | File | Purpose |
|---|---|---|
| `onboarding_states` | `onboarding.py` | Per-tenant wizard state |
| `onboarding_steps` | `onboarding.py` | Per-step completion |
| `onboarding_provisions` | `onboarding.py` | Provisioned resources |
| `onboarding_assets` | `onboarding.py` | Generated assets |

→ [Features: Onboarding](../features/onboarding.md)

---

### Governance — 2 models

| Model | File | Purpose |
|---|---|---|
| `policies` | `policy.py` | Governance policies |
| `policy_violations` | `policy.py` | Violation events |

→ [Features: Governance](../features/governance.md)

---

### Approvals — 2 models

| Model | File | Purpose |
|---|---|---|
| `approvals` | `approval.py` | Pending + decided approvals |
| `approval_decisions` | `approval.py` | Decision audit |

---

### Artifacts + Templates + Standards — 5 models

| Model | File | Purpose |
|---|---|---|
| `artifacts` | `artifact.py` | Typed artifact registry (append-only) |
| `artifact_versions` | `artifact.py` | Version history |
| `templates` | `template.py` | Org templates |
| `standards` | `standard.py` | Coding standards (org-scoped) |
| `marketplace_listings` | `marketplace.py` | Marketplace items |

---

### Steering + Hooks + Personas + Conflicts — 7 models

| Model | File | Purpose |
|---|---|---|
| `steering_rules` | `steering_rule.py` | Steering rules per project |
| `hooks` | `hook.py` | Event-driven hooks |
| `hook_executions` | `hook.py` | Hook firing history |
| `persona_memory` | `persona_memory.py` | 6 memory keys per persona |
| `persona_memory_history` | `persona_memory.py` | Change history |
| `conflicts` | `conflict.py` | Code vs Jira vs Confluence conflicts |
| `conflict_resolutions` | `conflict.py` | Conflict resolution history |

---

### Dashboard — 4 models

| Model | File | Purpose |
|---|---|---|
| `dashboard_widgets` | `dashboard.py` | Per-user widget config |
| `dashboard_layouts` | `dashboard.py` | Bento layout positions |
| `dashboard_refresh_log` | `dashboard.py` | Manual refresh history |
| `dashboard_announcements` | `dashboard.py` | Steward-pushed announcements |

→ [Features: Dashboard](../features/dashboard.md)

---

### Tool Bundles — 2 models

| Model | File | Purpose |
|---|---|---|
| `tool_bundles` | `tool_bundle.py` | Per-stage tool bundles |
| `tool_bundle_items` | `tool_bundle.py` | Tools within a bundle |

---

### Observability — 3 models

| Model | File | Purpose |
|---|---|---|
| `observability_alerts` | `observability.py` | Active alerts |
| `observability_incidents` | `observability.py` | Incident history |
| `observability_slos` | `observability.py` | SLO definitions |

---

### Model Provider — 2 models

| Model | File | Purpose |
|---|---|---|
| `model_providers` | `model_provider.py` | Registered LLM providers |
| `model_provider_models` | `model_provider.py` | Models per provider |

---

### Webhooks + MCP — 2 models

| Model | File | Purpose |
|---|---|---|
| `webhooks` | (in `webhooks.py` or `__init__.py`) | Outbound webhooks |
| `mcp_servers` | (in `mcp.py`) | MCP server registry |

---

## Migration history (8 migrations)

| Migration | Purpose |
|---|---|
| `0001_steering_rules.py` | Initial steering rules + RLS |
| `0002_initial_schema.py` | Core tables (tenants, users, projects, stories) |
| `0003_seed_drift.py` | Seed drift detection columns |
| `0004_ideation_source_signals.py` | Ideation source signals + RLS |
| `0005_persona_memory_history.py` | Persona memory history + RLS |
| `0006_ideation_ingest_runs.py` | Ideation ingest runs + RLS |
| `0007_connector_health_history.py` | Connector health history + RLS |
| `0008_*` (varies) | Latest feature migrations |

**Future migrations** add new tables (e.g. validation_reports, refactor tables) per feature landing.

---

## RLS policies (per tenant-scoped table)

Every tenant-scoped table has a Postgres RLS policy:

```sql
-- Example
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY stories_tenant_isolation ON stories
  USING (
    tenant_id = current_setting('app.tenant_id')::uuid
    AND deleted_at IS NULL
  );
```

**Session sets the GUC per request:**

```python
# backend/app/db/session.py
await session.execute(text(f"SET LOCAL app.tenant_id = '{principal.tenant_id}'"))
await session.execute(text(f"SET LOCAL app.actor_id = '{principal.actor_id}'"))
```

---

## Multi-tenancy summary

| Layer | Tenant-scoped? | RLS policy? | Soft delete? |
|---|---|---|---|
| **Org Knowledge** (standards, templates) | ❌ No | ❌ No | ❌ No |
| **Project Intelligence** (repos, KG) | ✅ Yes | ✅ Yes | ✅ Yes |
| **Tenant-scoped** (stories, workflows, runs) | ✅ Yes | ✅ Yes | ✅ Yes |
| **Audit** (`audit_events`) | ⚠️ Tenant-id (nullable) | ❌ No (global) | ❌ Append-only |
| **LiteLLM** (call_records, costs) | ✅ Yes | ✅ Yes | ❌ Append-only |
| **System** (webhooks, mcp_servers) | ❌ No | ❌ No | ❌ No |

**Pattern:** Most tables are tenant-scoped. The exceptions are: org knowledge (shared), audit (cross-tenant forensic view), system (global config).

---

## Indexes (convention)

- **Every FK has `index=True`**
- **Every column in WHERE / ORDER BY has an index**
- **Composite indexes** for multi-column queries (`ix_stories_tenant_status`)
- **Partial indexes** for `deleted_at IS NULL` filters

**Naming:** `ix_<table>_<col1>[_<col2>...]`

---

## Soft delete pattern

Every tenant-scoped table extends `SoftDeleteMixin`:

```python
deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
deleted_by: Mapped[UUID | None] = mapped_column(GUID())
```

**Hard delete ONLY for GDPR.** All other deletes are soft.

---

## Forbidden patterns

- ❌ Auto-increment integer PK (UUIDs only)
- ❌ Naive datetime (always `timezone=True`)
- ❌ Tenant-scoped table without RLS policy
- ❌ Hard delete (except GDPR)
- ❌ Mutable default (use `default_factory=list`)
- ❌ JSON (not JSONB)
- ❌ Direct DB UPDATE on `audit_events` (immutable)

---

## Verification checklist (per new table)

- [ ] UUID PK via `UUIDPrimaryKeyMixin`
- [ ] `created_at` + `updated_at` via `TimestampMixin`
- [ ] `TenantScopedModel` for tenant-aware tables
- [ ] `SoftDeleteMixin` for mutable tables
- [ ] RLS policy in migration
- [ ] All FKs have `index=True`
- [ ] All WHERE / ORDER BY columns have indexes
- [ ] All datetimes are `DateTime(timezone=True)`
- [ ] All JSON columns are `JSONB`
- [ ] Migration has `downgrade()`
- [ ] Tests cover tenant isolation

---

## Where to go next

- [Standards: data-model](../standards/data-model.md) — Full model patterns
- [Standards: api-conventions](../standards/api-conventions.md) — Route conventions
- [Features index](../features/README.md) — Per-feature data explanations
- [Reference: api-catalog](./api-catalog.md) — Every route that touches these tables
- [Migrations](../../codebase/forge-ai/backend/app/db/migrations/versions/) — Schema evolution history