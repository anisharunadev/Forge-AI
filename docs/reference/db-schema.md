# Reference: DB Schema (All SQLAlchemy Models)

<!-- AUTO-GENERATED. DO NOT EDIT. Regenerate via ./scripts/gen-db-schema.py -->

> **Status:** ✅ Auto-generated
> **Doc owner:** Platform team
> **Source of truth:** `backend/app/db/models/`
> **Last regenerated:** 2026-07-06
> **Total model files:** 62
> **Total model classes:** 113
> **Total tables:** 113

---

## Purpose

Canonical inventory of every SQLAlchemy model. For per-feature data
semantics, see `docs/features/<feature>.md`.

## Conventions

- Every table has a UUID PK (via `UUIDPrimaryKeyMixin`).
- Every table has `created_at` + `updated_at`.
- Tenant-scoped tables extend `TenantScopedModel` (adds `tenant_id` + `project_id`) and have a composite index.
- Mutable tables extend `SoftDeleteMixin`.

## Models by table

### `agent.py` — 1 model(s)

#### `agents` (`Agent`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` | NULL |
| `name` | `String(...)` |  NOT NULL |
| `type` | `SAEnum(...)` |  NOT NULL |
| `capabilities` | `JSONB` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `version` | `String(...)` |  NOT NULL |

### `agent_config.py` — 1 model(s)

#### `agent_configs` (`AgentConfig`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `agent_id` | `GUID(...)` |  NOT NULL |
| `enabled` | `Boolean` |  NOT NULL |
| `default_model` | `String(...)` | NULL |
| `temperature` | `Float` |  NOT NULL |
| `max_tokens` | `Integer` |  NOT NULL |
| `allowed_tools` | `JSONB` |  NOT NULL |
| `config` | `JSONB` |  NOT NULL |

### `alert_config.py` — 1 model(s)

#### `alert_configs` (`AlertConfig`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `warn_pct` | `Integer` |  NOT NULL |
| `exceed_pct` | `Integer` |  NOT NULL |
| `channels` | `JSONB` |  NOT NULL |

### `approval.py` — 1 model(s)

#### `approval_requests` (`ApprovalRequest`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `type` | `String(...)` |  NOT NULL |
| `target_artifact_id` | `GUID(...)` | NULL |
| `requested_by` | `GUID(...)` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `decided_by` | `GUID(...)` | NULL |
| `decided_at` | `DateTime(...)` | NULL |
| `reason` | `Text` | NULL |
| `payload` | `JSONB` |  NOT NULL |

### `architecture.py` — 5 model(s)

#### `architecture_adrs` (`ADR`)

| Column | Type | Nullable |
|---|---|---|
| `number` | `Integer` |  NOT NULL |
| `title` | `String(...)` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `context` | `Text` |  NOT NULL |
| `decision` | `Text` |  NOT NULL |
| `consequences` | `JSONB` |  NOT NULL |
| `alternatives` | `JSONB` |  NOT NULL |
| `related_adrs` | `ARRAY(...)` |  NOT NULL |
| `generated_by` | `String(...)` | NULL |
| `reviewed_by` | `String(...)` | NULL |
| `approved_by` | `GUID(...)` | NULL |
| `approved_at` | `DateTime(...)` | NULL |

#### `architecture_api_contracts` (`APIContract`)

| Column | Type | Nullable |
|---|---|---|
| `name` | `String(...)` |  NOT NULL |
| `version` | `String(...)` |  NOT NULL |
| `spec_type` | `String(...)` |  NOT NULL |
| `spec_content` | `JSONB` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `source_artifact_id` | `GUID(...)` | NULL |
| `generated_by` | `String(...)` | NULL |
| `approved_by` | `GUID(...)` | NULL |

#### `architecture_approvals` (`ArchitectureApproval`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `artifact_type` | `String(...)` |  NOT NULL |
| `artifact_id` | `GUID(...)` |  NOT NULL |
| `requested_by` | `GUID(...)` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `decided_by` | `GUID(...)` | NULL |
| `decided_at` | `DateTime(...)` | NULL |
| `reason` | `Text` | NULL |

#### `architecture_risk_registers` (`RiskRegister`)

| Column | Type | Nullable |
|---|---|---|
| `name` | `String(...)` |  NOT NULL |
| `risks` | `JSONB` |  NOT NULL |
| `mitigation_strategy` | `Text` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `generated_by` | `String(...)` | NULL |
| `approved_by` | `GUID(...)` | NULL |

#### `architecture_task_breakdowns` (`TaskBreakdown`)

| Column | Type | Nullable |
|---|---|---|
| `name` | `String(...)` |  NOT NULL |
| `parent_artifact_type` | `String(...)` |  NOT NULL |
| `parent_artifact_id` | `GUID(...)` |  NOT NULL |
| `tasks` | `JSONB` |  NOT NULL |
| `total_estimate_hours` | `Float` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `generated_by` | `String(...)` | NULL |

### `architecture_services.py` — 3 model(s)

#### `api_catalog` (`ApiCatalogEntry`)

| Column | Type | Nullable |
|---|---|---|
| `api_key` | `String(...)` |  NOT NULL |
| `service_id` | `GUID(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `surface` | `SAEnum(...)` |  NOT NULL |
| `path` | `String(...)` |  NOT NULL |
| `method` | `String(...)` |  NOT NULL |
| `version` | `String(...)` |  NOT NULL |
| `description` | `Text` | NULL |
| `is_public` | `Boolean` |  NOT NULL |
| `contract_id` | `GUID(...)` | NULL |
| `properties` | `JSONB` |  NOT NULL |

#### `database_map` (`DatabaseMapEntry`)

| Column | Type | Nullable |
|---|---|---|
| `db_key` | `String(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `engine` | `SAEnum(...)` |  NOT NULL |
| `version` | `String(...)` |  NOT NULL |
| `owning_service_id` | `GUID(...)` | NULL |
| `region` | `String(...)` |  NOT NULL |
| `instance_class` | `String(...)` |  NOT NULL |
| `storage_gb` | `Integer` |  NOT NULL |
| `pii` | `Boolean` |  NOT NULL |
| `properties` | `JSONB` |  NOT NULL |

#### `services` (`Service`)

| Column | Type | Nullable |
|---|---|---|
| `service_key` | `String(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `description` | `Text` | NULL |
| `owner_team` | `String(...)` |  NOT NULL |
| `repository_id` | `GUID(...)` | NULL |
| `lifecycle` | `SAEnum(...)` |  NOT NULL |
| `tier` | `String(...)` |  NOT NULL |
| `tags` | `ARRAY(...)` |  NOT NULL |
| `properties` | `JSONB` |  NOT NULL |

### `artifact.py` — 1 model(s)

#### `artifacts` (`Artifact`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `type` | `String(...)` |  NOT NULL |
| `version` | `?` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `created_by` | `GUID(...)` |  NOT NULL |
| `superseded_by_id` | `GUID(...)` | NULL |
| `superseded_at` | `DateTime(...)` | NULL |
| `content_hash` | `String(...)` |  NOT NULL |
| `payload` | `JSONB` |  NOT NULL |

### `audit.py` — 1 model(s)

#### `audit_events` (`AuditEvent`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `actor_id` | `GUID(...)` | NULL |
| `action` | `String(...)` |  NOT NULL |
| `target_type` | `String(...)` |  NOT NULL |
| `target_id` | `String(...)` |  NOT NULL |
| `payload` | `JSONB` |  NOT NULL |
| `occurred_at` | `DateTime(...)` |  NOT NULL |
| `hash_chain_ref` | `String(...)` | NULL |

### `board_confirmation.py` — 1 model(s)

#### `board_confirmations` (`BoardConfirmation`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `subject_id` | `String(...)` |  NOT NULL |
| `plan_rev` | `String(...)` |  NOT NULL |
| `outcome` | `SAEnum(...)` |  NOT NULL |
| `decider_id` | `GUID(...)` | NULL |
| `decided_at` | `DateTime(...)` | NULL |
| `idempotency_key` | `String(...)` |  NOT NULL |
| `prompt` | `Text` | NULL |
| `payload` | `JSONB` |  NOT NULL |

### `command_run.py` — 1 model(s)

#### `command_runs` (`CommandRun`)

| Column | Type | Nullable |
|---|---|---|
| `run_key` | `String(...)` |  NOT NULL |
| `command_name` | `String(...)` |  NOT NULL |
| `invoked_by` | `GUID(...)` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `started_at` | `DateTime(...)` |  NOT NULL |
| `completed_at` | `DateTime(...)` | NULL |
| `duration_ms` | `Integer` | NULL |
| `cost_usd` | `Float` |  NOT NULL |
| `input` | `JSONB` |  NOT NULL |
| `output` | `JSONB` |  NOT NULL |
| `error` | `Text` | NULL |
| `artifacts_produced` | `ARRAY(...)` |  NOT NULL |

### `conflict.py` — 1 model(s)

#### `conflicts` (`Conflict`)

| Column | Type | Nullable |
|---|---|---|
| `conflict_key` | `String(...)` |  NOT NULL |
| `title` | `String(...)` |  NOT NULL |
| `description` | `Text` |  NOT NULL |
| `severity` | `SAEnum(...)` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `sources` | `JSONB` |  NOT NULL |
| `resolution_path` | `JSONB` |  NOT NULL |
| `resolved_by` | `GUID(...)` | NULL |
| `resolved_at` | `DateTime(...)` | NULL |
| `tags` | `ARRAY(...)` |  NOT NULL |
| `related_node_ids` | `ARRAY(...)` |  NOT NULL |

### `connector.py` — 3 model(s)

#### `connector_health_history` (`ConnectorHealthHistory`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `connector_id` | `GUID(...)` |  NOT NULL |
| `probed_at` | `DateTime(...)` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `latency_ms` | `Integer` | NULL |
| `error_message` | `Text` | NULL |

#### `connector_sync_history` (`ConnectorSyncHistory`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `connector_id` | `GUID(...)` |  NOT NULL |
| `started_at` | `DateTime(...)` |  NOT NULL |
| `finished_at` | `DateTime(...)` | NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `items_synced` | `Integer` |  NOT NULL |
| `error_message` | `Text` | NULL |

#### `connectors` (`Connector`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `type` | `SAEnum(...)` |  NOT NULL |
| `config` | `JSONB` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `last_sync_at` | `DateTime(...)` | NULL |
| `last_error` | `Text` | NULL |
| `created_by` | `GUID(...)` |  NOT NULL |

### `connector_activity.py` — 1 model(s)

#### `connector_activity` (`ConnectorActivity`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `connector_id` | `GUID(...)` |  NOT NULL |
| `event_type` | `SAEnum(...)` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `started_at` | `DateTime(...)` |  NOT NULL |
| `finished_at` | `DateTime(...)` | NULL |
| `records_affected` | `Integer` | NULL |
| `actor_id` | `GUID(...)` | NULL |
| `error_message` | `Text` | NULL |
| `event_metadata` | `'metadata'` |  NOT NULL |

### `connector_credential.py` — 1 model(s)

#### `connector_credentials` (`ConnectorCredential`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `connector_id` | `GUID(...)` | NULL |
| `name` | `String(...)` |  NOT NULL |
| `type` | `SAEnum(...)` |  NOT NULL |
| `scope` | `SAEnum(...)` |  NOT NULL |
| `preview` | `String(...)` |  NOT NULL |
| `encrypted_secret` | `?` |  NOT NULL |
| `meta` | `JSONB` |  NOT NULL |
| `expires_at` | `DateTime(...)` | NULL |
| `last_rotated_at` | `DateTime(...)` |  NOT NULL |
| `last_used_at` | `DateTime(...)` | NULL |
| `rotation_reminder_days` | `Integer` |  NOT NULL |
| `created_by` | `GUID(...)` |  NOT NULL |

### `copilot.py` — 2 model(s)

#### `copilot_conversations` (`CopilotConversation`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` | NULL |
| `user_id` | `GUID(...)` |  NOT NULL |
| `title` | `String(...)` | NULL |
| `archived_at` | `DateTime(...)` | NULL |
| `message_count` | `?` |  NOT NULL |
| `total_cost_usd` | `Numeric(...)` |  NOT NULL |
| `total_tokens_in` | `?` |  NOT NULL |
| `total_tokens_out` | `?` |  NOT NULL |

#### `copilot_messages` (`CopilotMessage`)

| Column | Type | Nullable |
|---|---|---|
| `conversation_id` | `GUID(...)` |  NOT NULL |
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `role` | `String(...)` |  NOT NULL |
| `content` | `Text` |  NOT NULL |
| `citations` | `JSONB` | NULL |
| `tool_calls` | `JSONB` | NULL |
| `suggested_actions` | `JSONB` | NULL |
| `confidence` | `String(...)` | NULL |
| `feedback_rating` | `String(...)` | NULL |
| `feedback_comment` | `Text` | NULL |
| `feedback_at` | `DateTime(...)` | NULL |
| `model` | `String(...)` | NULL |
| `cost_usd` | `Numeric(...)` |  NOT NULL |
| `tokens_in` | `?` |  NOT NULL |
| `tokens_out` | `?` |  NOT NULL |
| `latency_ms` | `?` |  NOT NULL |
| `context_tokens` | `?` |  NOT NULL |

### `cost.py` — 1 model(s)

#### `cost_entries` (`CostEntry`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `workflow_id` | `GUID(...)` | NULL |
| `run_id` | `GUID(...)` | NULL |
| `agent` | `String(...)` | NULL |
| `source` | `String(...)` |  NOT NULL |
| `model` | `String(...)` | NULL |
| `prompt_tokens` | `?` |  NOT NULL |
| `completion_tokens` | `?` |  NOT NULL |
| `cost_usd` | `Numeric(...)` |  NOT NULL |
| `projected` | `Boolean` |  NOT NULL |
| `recorded_at` | `DateTime(...)` |  NOT NULL |
| `metadata_` | `'metadata'` |  NOT NULL |

### `customer.py` — 1 model(s)

#### `customers` (`Customer`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `org_id` | `GUID(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `description` | `String(...)` | NULL |
| `blocked` | `Boolean` |  NOT NULL |
| `billing_ref` | `String(...)` | NULL |

### `dashboard.py` — 4 model(s)

#### `dashboard_insight_reads` (`AIInsightRead`)

| Column | Type | Nullable |
|---|---|---|
| `user_id` | `GUID(...)` |  NOT NULL |
| `insight_id` | `GUID(...)` |  NOT NULL |
| `read_at` | `DateTime(...)` |  NOT NULL |

#### `dashboard_insights` (`AIInsight`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `user_id` | `GUID(...)` | NULL |
| `title` | `String(...)` |  NOT NULL |
| `body` | `String(...)` |  NOT NULL |
| `category` | `String(...)` |  NOT NULL |
| `severity` | `String(...)` |  NOT NULL |
| `related_entities` | `JSONB` |  NOT NULL |
| `action_url` | `String(...)` | NULL |
| `action_label` | `String(...)` | NULL |
| `created_at` | `DateTime(...)` |  NOT NULL |

#### `dashboard_layouts` (`DashboardLayoutRow`)

| Column | Type | Nullable |
|---|---|---|
| `user_id` | `GUID(...)` |  NOT NULL |
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `widgets` | `JSONB` |  NOT NULL |
| `preset` | `String(...)` |  NOT NULL |
| `updated_at` | `DateTime(...)` |  NOT NULL |

#### `dashboard_pinned_items` (`PinnedItem`)

| Column | Type | Nullable |
|---|---|---|
| `user_id` | `GUID(...)` |  NOT NULL |
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `item_type` | `String(...)` |  NOT NULL |
| `item_id` | `String(...)` |  NOT NULL |
| `item_data` | `JSONB` |  NOT NULL |
| `sort_order` | `Integer` |  NOT NULL |
| `created_at` | `DateTime(...)` |  NOT NULL |

### `env_var.py` — 1 model(s)

#### `env_vars` (`EnvVar`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `key` | `String(...)` |  NOT NULL |
| `encrypted_value` | `Text` |  NOT NULL |
| `description` | `Text` | NULL |
| `scope` | `String(...)` |  NOT NULL |
| `visibility` | `String(...)` |  NOT NULL |
| `last_used_at` | `?` | NULL |
| `created_by` | `GUID(...)` |  NOT NULL |

### `graph.py` — 2 model(s)

#### `graph_edges` (`GraphEdge`)

| Column | Type | Nullable |
|---|---|---|
| `edge_key` | `String(...)` |  NOT NULL |
| `kind` | `SAEnum(...)` |  NOT NULL |
| `from_node_id` | `GUID(...)` |  NOT NULL |
| `to_node_id` | `GUID(...)` |  NOT NULL |
| `weight` | `?` |  NOT NULL |
| `properties` | `JSONB` |  NOT NULL |

#### `graph_nodes` (`GraphNode`)

| Column | Type | Nullable |
|---|---|---|
| `node_key` | `String(...)` |  NOT NULL |
| `kind` | `SAEnum(...)` |  NOT NULL |
| `label` | `String(...)` |  NOT NULL |
| `source_table` | `String(...)` |  NOT NULL |
| `source_id` | `GUID(...)` |  NOT NULL |
| `properties` | `JSONB` |  NOT NULL |
| `tags` | `ARRAY(...)` |  NOT NULL |

### `hook.py` — 1 model(s)

#### `hooks` (`Hook`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` | NULL |
| `name` | `String(...)` |  NOT NULL |
| `event_type` | `String(...)` |  NOT NULL |
| `phase` | `SAEnum(...)` |  NOT NULL |
| `action` | `String(...)` |  NOT NULL |
| `script` | `Text` |  NOT NULL |
| `enabled` | `Boolean` |  NOT NULL |
| `run_order` | `Integer` |  NOT NULL |
| `timeout_seconds` | `Integer` |  NOT NULL |

### `ideation.py` — 12 model(s)

#### `architecture_previews` (`ArchitecturePreview`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `idea_id` | `GUID(...)` |  NOT NULL |
| `version` | `Integer` |  NOT NULL |
| `components` | `JSONB` |  NOT NULL |
| `integrations` | `JSONB` |  NOT NULL |
| `data_flows` | `JSONB` |  NOT NULL |
| `risks` | `JSONB` |  NOT NULL |
| `generated_by` | `GUID(...)` |  NOT NULL |
| `superseded_by_id` | `GUID(...)` | NULL |

#### `idea_analyses` (`IdeaAnalysis`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `idea_id` | `GUID(...)` |  NOT NULL |
| `summary` | `Text` |  NOT NULL |
| `problem_statement` | `Text` |  NOT NULL |
| `target_users` | `JSONB` |  NOT NULL |
| `success_metrics` | `JSONB` |  NOT NULL |
| `assumptions` | `JSONB` |  NOT NULL |
| `risks` | `JSONB` |  NOT NULL |
| `related_artifacts` | `JSONB` |  NOT NULL |
| `model_used` | `String(...)` | NULL |
| `cost_usd` | `Float` |  NOT NULL |
| `analyzed_at` | `DateTime(...)` |  NOT NULL |

#### `ideas` (`Idea`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `title` | `String(...)` |  NOT NULL |
| `description` | `Text` |  NOT NULL |
| `source` | `SAEnum(...)` |  NOT NULL |
| `submitted_by` | `GUID(...)` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `tags` | `JSONB` |  NOT NULL |
| `attachments` | `JSONB` |  NOT NULL |

#### `ideation_approval_items` (`ApprovalItem`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `idea_id` | `GUID(...)` |  NOT NULL |
| `request_type` | `SAEnum(...)` |  NOT NULL |
| `subject_id` | `GUID(...)` | NULL |
| `payload` | `JSONB` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `requested_by` | `GUID(...)` |  NOT NULL |
| `reviewer_id` | `GUID(...)` | NULL |
| `decided_by` | `GUID(...)` | NULL |
| `decided_at` | `DateTime(...)` | NULL |
| `reason` | `Text` | NULL |

#### `ideation_push_attempts` (`PushAttempt`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `idea_id` | `GUID(...)` |  NOT NULL |
| `idempotency_key` | `String(...)` |  NOT NULL |
| `target` | `SAEnum(...)` |  NOT NULL |
| `result` | `JSONB` |  NOT NULL |
| `actor_id` | `GUID(...)` |  NOT NULL |

#### `ideation_push_records` (`PushRecord`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `idea_id` | `GUID(...)` |  NOT NULL |
| `target` | `SAEnum(...)` |  NOT NULL |
| `external_ref` | `String(...)` | NULL |
| `config` | `JSONB` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `actor_id` | `GUID(...)` |  NOT NULL |
| `error` | `Text` | NULL |

#### `opportunity_scores` (`OpportunityScore`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `idea_id` | `GUID(...)` |  NOT NULL |
| `value_score` | `Float` |  NOT NULL |
| `feasibility_score` | `Float` |  NOT NULL |
| `risk_score` | `Float` |  NOT NULL |
| `reach_score` | `Float` |  NOT NULL |
| `total_score` | `Float` |  NOT NULL |
| `scoring_rationale` | `Text` |  NOT NULL |
| `scored_by` | `SAEnum(...)` |  NOT NULL |
| `scored_at` | `DateTime(...)` |  NOT NULL |

#### `output_bundles` (`OutputBundle`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `idea_id` | `GUID(...)` |  NOT NULL |
| `bundle` | `JSONB` |  NOT NULL |
| `storage_ref` | `String(...)` | NULL |

#### `prds` (`PRD`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `idea_id` | `GUID(...)` |  NOT NULL |
| `version` | `Integer` |  NOT NULL |
| `content` | `JSONB` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `generated_by` | `GUID(...)` |  NOT NULL |
| `reviewed_by` | `GUID(...)` | NULL |
| `superseded_by_id` | `GUID(...)` | NULL |

#### `roadmaps` (`Roadmap`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `horizon` | `SAEnum(...)` |  NOT NULL |
| `theme` | `String(...)` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `items` | `JSONB` |  NOT NULL |
| `generated_by` | `GUID(...)` |  NOT NULL |
| `approved_by` | `GUID(...)` | NULL |

#### `workflow_sessions` (`WorkflowSession`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `idea_id` | `GUID(...)` |  NOT NULL |
| `user_id` | `GUID(...)` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `state` | `JSONB` |  NOT NULL |
| `current_step` | `String(...)` | NULL |
| `completed_at` | `DateTime(...)` | NULL |

#### `workflow_steps` (`WorkflowStep`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `session_id` | `GUID(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `position` | `Integer` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `started_at` | `DateTime(...)` | NULL |
| `finished_at` | `DateTime(...)` | NULL |
| `result` | `JSONB` |  NOT NULL |
| `error` | `Text` | NULL |

### `ideation_signal.py` — 2 model(s)

#### `ideation_ingest_runs` (`IdeationIngestRun`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `started_at` | `DateTime(...)` |  NOT NULL |
| `finished_at` | `DateTime(...)` | NULL |
| `signals_seen` | `Integer` |  NOT NULL |
| `ideas_created` | `Integer` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `error` | `Text` | NULL |
| `degraded_budget` | `Boolean` |  NOT NULL |

#### `ideation_source_signals` (`IdeaSourceSignal`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `source` | `String(...)` |  NOT NULL |
| `external_id` | `String(...)` |  NOT NULL |
| `title` | `String(...)` |  NOT NULL |
| `body` | `Text` |  NOT NULL |
| `occurred_at` | `DateTime(...)` |  NOT NULL |
| `ingested_at` | `DateTime(...)` |  NOT NULL |
| `idea_id` | `GUID(...)` | NULL |

### `lesson.py` — 1 model(s)

#### `lesson_candidates` (`LessonCandidate`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` | NULL |
| `run_id` | `GUID(...)` | NULL |
| `source_event` | `String(...)` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `title` | `String(...)` |  NOT NULL |
| `body` | `Text` |  NOT NULL |
| `proposed_skill_name` | `String(...)` | NULL |
| `evidence` | `JSONB` |  NOT NULL |
| `promoted_template_id` | `GUID(...)` | NULL |
| `decided_by` | `GUID(...)` | NULL |
| `decided_at` | `DateTime(...)` | NULL |
| `review_notes` | `Text` | NULL |
| `created_at` | `DateTime(...)` |  NOT NULL |

### `litellm_budget_config.py` — 1 model(s)

#### `litellm_budget_configs` (`LiteLLMBudgetConfig`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `litellm_team_id` | `String(...)` |  NOT NULL |
| `litellm_budget_id` | `String(...)` | NULL |
| `max_usd` | `Numeric(...)` |  NOT NULL |
| `period` | `String(...)` |  NOT NULL |
| `hard_limit` | `?` |  NOT NULL |
| `last_synced_at` | `DateTime(...)` | NULL |

### `litellm_call_record.py` — 1 model(s)

#### `litellm_call_records` (`LiteLLMCallRecord`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `workflow_id` | `GUID(...)` | NULL |
| `actor_id` | `GUID(...)` | NULL |
| `forge_trace_id` | `String(...)` |  NOT NULL |
| `litellm_call_id` | `String(...)` | NULL |
| `model` | `String(...)` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `prompt_tokens` | `Integer` |  NOT NULL |
| `completion_tokens` | `Integer` |  NOT NULL |
| `cost_usd` | `Float` |  NOT NULL |
| `latency_ms` | `Integer` |  NOT NULL |
| `error` | `Text` | NULL |
| `metadata_` | `'metadata'` |  NOT NULL |
| `occurred_at` | `DateTime(...)` |  NOT NULL |

### `litellm_guardrail_assignment.py` — 1 model(s)

#### `litellm_guardrail_assignments` (`LiteLLMGuardrailAssignment`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `litellm_team_id` | `String(...)` |  NOT NULL |
| `guardrail_ids` | `ARRAY(...)` |  NOT NULL |
| `assigned_at` | `DateTime(...)` |  NOT NULL |
| `assigned_by` | `String(...)` | NULL |
| `metadata_` | `'metadata'` |  NOT NULL |

### `litellm_key_audit.py` — 1 model(s)

#### `litellm_key_audit` (`LiteLLMKeyAudit`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `litellm_team_id` | `String(...)` |  NOT NULL |
| `litellm_key_alias` | `String(...)` |  NOT NULL |
| `litellm_key_hash` | `String(...)` |  NOT NULL |
| `action` | `String(...)` |  NOT NULL |
| `actor_id` | `GUID(...)` | NULL |
| `reason` | `Text` | NULL |
| `occurred_at` | `DateTime(...)` |  NOT NULL |

### `litellm_model_assignment.py` — 1 model(s)

#### `litellm_model_assignments` (`LiteLLMModelAssignment`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `tier` | `String(...)` |  NOT NULL |
| `model_name` | `String(...)` |  NOT NULL |
| `max_input_tokens` | `?` | NULL |
| `max_output_tokens` | `?` | NULL |
| `enabled` | `?` |  NOT NULL |
| `metadata_` | `'metadata'` |  NOT NULL |

### `litellm_team_mapping.py` — 1 model(s)

#### `litellm_team_mappings` (`LiteLLMTeamMapping`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `org_id` | `GUID(...)` | NULL |
| `team_id` | `GUID(...)` | NULL |
| `litellm_team_id` | `String(...)` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `last_synced_at` | `DateTime(...)` | NULL |
| `metadata_` | `'metadata'` |  NOT NULL |

### `marketplace.py` — 1 model(s)

#### `marketplace_connectors` (`MarketplaceConnector`)

| Column | Type | Nullable |
|---|---|---|
| `slug` | `String(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `type` | `String(...)` |  NOT NULL |
| `description` | `Text` |  NOT NULL |
| `config_schema` | `JSONB` |  NOT NULL |
| `icon` | `String(...)` | NULL |
| `version` | `String(...)` |  NOT NULL |
| `author` | `String(...)` |  NOT NULL |
| `downloads` | `Integer` |  NOT NULL |
| `rating` | `Float` |  NOT NULL |

### `model_provider.py` — 1 model(s)

#### `model_providers` (`ModelProvider`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `type` | `SAEnum(...)` |  NOT NULL |
| `config` | `JSONB` |  NOT NULL |
| `litellm_model_alias` | `String(...)` |  NOT NULL |
| `enabled` | `Boolean` |  NOT NULL |
| `rate_limit_rpm` | `Integer` |  NOT NULL |
| `rate_limit_tpm` | `Integer` |  NOT NULL |

### `observability.py` — 2 model(s)

#### `metric_snapshots` (`MetricSnapshot`)

| Column | Type | Nullable |
|---|---|---|
| `metric_key` | `String(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `value` | `Float` |  NOT NULL |
| `unit` | `String(...)` |  NOT NULL |
| `dimensions` | `JSONB` |  NOT NULL |
| `snapshot_at` | `DateTime(...)` |  NOT NULL |
| `note` | `Text` | NULL |

#### `pulse_events` (`PulseEvent`)

| Column | Type | Nullable |
|---|---|---|
| `event_key` | `String(...)` |  NOT NULL |
| `kind` | `SAEnum(...)` |  NOT NULL |
| `actor_id` | `GUID(...)` | NULL |
| `target_type` | `String(...)` | NULL |
| `target_id` | `GUID(...)` | NULL |
| `summary` | `String(...)` |  NOT NULL |
| `payload` | `JSONB` |  NOT NULL |
| `occurred_at` | `DateTime(...)` |  NOT NULL |
| `tags` | `ARRAY(...)` |  NOT NULL |

### `onboarding.py` — 2 model(s)

#### `onboarding_sessions` (`OnboardingSession`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `user_id` | `GUID(...)` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `current_step` | `String(...)` |  NOT NULL |
| `state` | `JSONB` |  NOT NULL |
| `completed_at` | `DateTime(...)` | NULL |

#### `onboarding_steps` (`OnboardingStep`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `session_id` | `GUID(...)` |  NOT NULL |
| `step_name` | `String(...)` |  NOT NULL |
| `step_order` | `Integer` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `input` | `JSONB` |  NOT NULL |
| `output` | `JSONB` |  NOT NULL |
| `error_message` | `Text` | NULL |

### `organization.py` — 1 model(s)

#### `organizations` (`Organization`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `brand` | `JSONB` |  NOT NULL |
| `billing_ref` | `String(...)` | NULL |

### `persona_memory.py` — 1 model(s)

#### `persona_memory_history` (`PersonaMemoryHistory`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `persona` | `String(...)` |  NOT NULL |
| `key` | `String(...)` |  NOT NULL |
| `entry_md` | `Text` |  NOT NULL |
| `written_by` | `GUID(...)` |  NOT NULL |
| `written_at` | `DateTime(...)` |  NOT NULL |
| `consolidated` | `Boolean` |  NOT NULL |

### `phase4.py` — 13 model(s)

#### `phase4_a2a_delegations` (`Phase4A2ADelegation`)

| Column | Type | Nullable |
|---|---|---|
| `from_agent_id` | `String(...)` |  NOT NULL |
| `to_agent_id` | `String(...)` |  NOT NULL |
| `direction` | `String(...)` |  NOT NULL |
| `jwt_jti` | `String(...)` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `started_at` | `DateTime(...)` |  NOT NULL |
| `completed_at` | `DateTime(...)` | NULL |
| `payload` | `JSONB` |  NOT NULL |

#### `phase4_cache_keys` (`Phase4CacheKey`)

| Column | Type | Nullable |
|---|---|---|
| `key_hash` | `String(...)` |  NOT NULL |
| `model` | `String(...)` |  NOT NULL |
| `cache_type` | `String(...)` |  NOT NULL |
| `size_bytes` | `BigInteger` |  NOT NULL |
| `hit_count` | `Integer` |  NOT NULL |
| `last_hit_at` | `DateTime(...)` | NULL |
| `ttl_seconds` | `Integer` |  NOT NULL |
| `expires_at` | `DateTime(...)` |  NOT NULL |

#### `phase4_credentials` (`Phase4Credential`)

| Column | Type | Nullable |
|---|---|---|
| `credential_name` | `String(...)` |  NOT NULL |
| `provider` | `String(...)` |  NOT NULL |
| `vault_path` | `Text` | NULL |
| `is_vault_backed` | `Boolean` |  NOT NULL |
| `created_by` | `GUID(...)` | NULL |
| `deleted_at` | `DateTime(...)` | NULL |

#### `phase4_finops_exports` (`Phase4FinopsExport`)

| Column | Type | Nullable |
|---|---|---|
| `destination` | `String(...)` |  NOT NULL |
| `run_id` | `String(...)` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `record_count` | `Integer` |  NOT NULL |
| `total_cost_usd` | `Numeric(...)` |  NOT NULL |
| `requested_by` | `GUID(...)` | NULL |
| `started_at` | `DateTime(...)` |  NOT NULL |
| `completed_at` | `DateTime(...)` | NULL |
| `error_message` | `Text` | NULL |

#### `phase4_finops_settings` (`Phase4FinopsSettings`)

| Column | Type | Nullable |
|---|---|---|
| `destination` | `String(...)` |  NOT NULL |
| `api_key_ref` | `Text` |  NOT NULL |
| `account_mapping` | `JSONB` |  NOT NULL |
| `schedule_cron` | `String(...)` | NULL |
| `last_export_at` | `DateTime(...)` | NULL |

#### `phase4_jwt_signing_keys` (`Phase4JwtSigningKey`)

| Column | Type | Nullable |
|---|---|---|
| `kid` | `String(...)` |  NOT NULL |
| `algorithm` | `String(...)` |  NOT NULL |
| `public_jwk` | `JSONB` |  NOT NULL |
| `private_pem_path` | `Text` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `created_at` | `DateTime(...)` |  NOT NULL |
| `retired_at` | `DateTime(...)` | NULL |

#### `phase4_oauth_clients` (`Phase4OAuthClient`)

| Column | Type | Nullable |
|---|---|---|
| `client_id` | `String(...)` |  NOT NULL |
| `client_secret_hash` | `String(...)` |  NOT NULL |
| `redirect_uris` | `PG_ARRAY(...)` |  NOT NULL |
| `scopes` | `PG_ARRAY(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `revoked_at` | `DateTime(...)` | NULL |

#### `phase4_realtime_client_secrets` (`Phase4RealtimeClientSecret`)

| Column | Type | Nullable |
|---|---|---|
| `session_id` | `GUID(...)` |  NOT NULL |
| `secret_hash` | `String(...)` |  NOT NULL |
| `expires_at` | `DateTime(...)` |  NOT NULL |
| `consumed_at` | `DateTime(...)` | NULL |

#### `phase4_scim_tokens` (`Phase4ScimToken`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `token_hash` | `String(...)` |  NOT NULL |
| `last_used_at` | `DateTime(...)` | NULL |
| `expires_at` | `DateTime(...)` | NULL |
| `rotated_at` | `DateTime(...)` | NULL |
| `created_at` | `DateTime(...)` |  NOT NULL |

#### `phase4_session_events` (`Phase4SessionEvent`)

| Column | Type | Nullable |
|---|---|---|
| `session_id` | `GUID(...)` |  NOT NULL |
| `event_type` | `String(...)` |  NOT NULL |
| `duration_ms` | `Integer` | NULL |
| `payload` | `JSONB` |  NOT NULL |
| `occurred_at` | `DateTime(...)` |  NOT NULL |

#### `phase4_sessions` (`Phase4Session`)

| Column | Type | Nullable |
|---|---|---|
| `session_type` | `String(...)` |  NOT NULL |
| `owner_user_id` | `GUID(...)` | NULL |
| `agent_id` | `String(...)` | NULL |
| `status` | `String(...)` |  NOT NULL |
| `started_at` | `DateTime(...)` |  NOT NULL |
| `last_heartbeat_at` | `DateTime(...)` | NULL |
| `expires_at` | `DateTime(...)` |  NOT NULL |
| `max_duration_seconds` | `Integer` |  NOT NULL |
| `session_metadata` | `'metadata'` |  NOT NULL |

#### `phase4_sso_configs` (`Phase4SsoConfig`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `provider` | `String(...)` |  NOT NULL |
| `issuer_url` | `Text` |  NOT NULL |
| `client_id` | `Text` |  NOT NULL |
| `client_secret_cipher` | `Text` |  NOT NULL |
| `claim_mapping` | `JSONB` |  NOT NULL |
| `scopes` | `PG_ARRAY(...)` | NULL |
| `enabled` | `Boolean` |  NOT NULL |
| `created_at` | `DateTime(...)` |  NOT NULL |
| `updated_at` | `DateTime(...)` |  NOT NULL |

#### `phase4_vault_configs` (`Phase4VaultConfig`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `vault_url` | `Text` |  NOT NULL |
| `auth_method` | `String(...)` |  NOT NULL |
| `auth_ref` | `Text` |  NOT NULL |
| `namespace` | `String(...)` | NULL |
| `kv_engine_mount` | `String(...)` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `last_checked_at` | `DateTime(...)` | NULL |

### `policy.py` — 1 model(s)

#### `policies` (`Policy`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `description` | `String(...)` | NULL |
| `expression` | `JSONB` |  NOT NULL |
| `severity` | `SAEnum(...)` |  NOT NULL |
| `enabled` | `Boolean` |  NOT NULL |

### `project.py` — 1 model(s)

#### `projects` (`Project`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `ForeignKey(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `slug` | `String(...)` |  NOT NULL |
| `description` | `Text` | NULL |
| `default_branch` | `String(...)` |  NOT NULL |
| `visibility` | `String(...)` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `settings` | `JSONB` |  NOT NULL |
| `created_by` | `GUID(...)` | NULL |

### `project_invitation.py` — 1 model(s)

#### `project_invitations` (`ProjectInvitation`)

| Column | Type | Nullable |
|---|---|---|
| `project_id` | `GUID(...)` |  NOT NULL |
| `email` | `String(...)` |  NOT NULL |
| `role_id` | `GUID(...)` |  NOT NULL |
| `invited_by` | `GUID(...)` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `token` | `Text` |  NOT NULL |
| `expires_at` | `DateTime(...)` |  NOT NULL |

### `project_member.py` — 1 model(s)

#### `project_members` (`ProjectMember`)

| Column | Type | Nullable |
|---|---|---|
| `project_id` | `GUID(...)` |  NOT NULL |
| `user_id` | `GUID(...)` |  NOT NULL |
| `role_id` | `GUID(...)` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |

### `prompt.py` — 2 model(s)

#### `prompt_versions` (`PromptVersion`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `prompt_id` | `GUID(...)` |  NOT NULL |
| `version_number` | `Integer` |  NOT NULL |
| `template` | `Text` |  NOT NULL |
| `model_defaults` | `JSONB` |  NOT NULL |
| `variables` | `JSONB` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `source` | `String(...)` |  NOT NULL |
| `created_by` | `GUID(...)` | NULL |

#### `prompts` (`Prompt`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `category` | `String(...)` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `current_version` | `Integer` |  NOT NULL |
| `tags` | `JSONB` |  NOT NULL |
| `metadata_` | `'metadata'` |  NOT NULL |
| `created_by` | `GUID(...)` | NULL |

### `rag.py` — 2 model(s)

#### `rag_chunks` (`RagChunk`)

| Column | Type | Nullable |
|---|---|---|
| `vector_store_id` | `GUID(...)` |  NOT NULL |
| `file_id` | `String(...)` |  NOT NULL |
| `text` | `Text` |  NOT NULL |
| `embedding` | `JSONB` | NULL |
| `chunk_index` | `?` |  NOT NULL |
| `created_at` | `DateTime(...)` |  NOT NULL |

#### `vector_stores` (`VectorStore`)

| Column | Type | Nullable |
|---|---|---|
| `external_id` | `String(...)` |  NOT NULL |
| `name` | `String(...)` | NULL |
| `status` | `String(...)` |  NOT NULL |
| `archived_at` | `DateTime(...)` | NULL |
| `metadata_` | `'metadata'` |  NOT NULL |
| `created_at` | `DateTime(...)` |  NOT NULL |

### `repo_ingestion.py` — 3 model(s)

#### `ingestion_artifacts` (`IngestionArtifact`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `ingestion_run_id` | `GUID(...)` |  NOT NULL |
| `type` | `SAEnum(...)` |  NOT NULL |
| `content_ref` | `String(...)` |  NOT NULL |
| `content_hash` | `String(...)` |  NOT NULL |
| `size_bytes` | `Integer` |  NOT NULL |
| `created_at` | `DateTime(...)` |  NOT NULL |

#### `ingestion_runs` (`IngestionRun`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `repo_id` | `GUID(...)` |  NOT NULL |
| `started_at` | `DateTime(...)` |  NOT NULL |
| `finished_at` | `DateTime(...)` | NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `items_processed` | `Integer` |  NOT NULL |
| `error_message` | `Text` | NULL |
| `artifacts_produced` | `JSONB` |  NOT NULL |
| `started_by` | `GUID(...)` |  NOT NULL |
| `started_commit_sha` | `String(...)` | NULL |
| `finished_commit_sha` | `String(...)` | NULL |

#### `repos` (`Repo`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `source_url` | `String(...)` |  NOT NULL |
| `default_branch` | `String(...)` |  NOT NULL |
| `provider` | `String(...)` |  NOT NULL |
| `last_ingested_at` | `DateTime(...)` | NULL |
| `last_commit_sha` | `String(...)` | NULL |
| `ingestion_status` | `SAEnum(...)` |  NOT NULL |
| `ingestion_meta` | `'metadata'` |  NOT NULL |
| `credentials_ref` | `String(...)` | NULL |
| `created_by` | `GUID(...)` |  NOT NULL |

### `role.py` — 1 model(s)

#### `roles` (`Role`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `description` | `String(...)` | NULL |
| `permissions` | `ARRAY(...)` |  NOT NULL |
| `parent_role_id` | `GUID(...)` | NULL |
| `metadata_` | `'metadata'` |  NOT NULL |

### `security_report.py` — 1 model(s)

#### `architecture_security_reports` (`SecurityReport`)

| Column | Type | Nullable |
|---|---|---|
| `title` | `String(...)` |  NOT NULL |
| `severity` | `String(...)` |  NOT NULL |
| `category` | `String(...)` |  NOT NULL |
| `description` | `Text` |  NOT NULL |
| `affected_service` | `String(...)` |  NOT NULL |
| `recommendation` | `Text` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `source_adr_id` | `GUID(...)` | NULL |
| `discovered_at` | `DateTime(...)` |  NOT NULL |
| `mitigated_at` | `DateTime(...)` | NULL |
| `generated_by` | `String(...)` | NULL |

### `seed.py` — 2 model(s)

#### `seed_migrations` (`SeedMigration`)

| Column | Type | Nullable |
|---|---|---|
| `version` | `String(...)` |  NOT NULL |
| `seed_name` | `String(...)` |  NOT NULL |
| `manifest_version` | `Integer` |  NOT NULL |
| `description` | `Text` | NULL |
| `applied_at` | `DateTime(...)` |  NOT NULL |
| `applied_by` | `GUID(...)` |  NOT NULL |
| `checksum` | `String(...)` |  NOT NULL |
| `row_counts` | `JSONB` |  NOT NULL |
| `success` | `Boolean` |  NOT NULL |
| `error` | `Text` | NULL |

#### `seed_runs` (`SeedRun`)

| Column | Type | Nullable |
|---|---|---|
| `seed_name` | `String(...)` |  NOT NULL |
| `manifest_version` | `Integer` |  NOT NULL |
| `operation` | `SAEnum(...)` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `env` | `String(...)` |  NOT NULL |
| `triggered_by` | `String(...)` |  NOT NULL |
| `actor_id` | `GUID(...)` | NULL |
| `tenant_id` | `GUID(...)` | NULL |
| `project_id` | `GUID(...)` | NULL |
| `applied_versions` | `ARRAY(...)` |  NOT NULL |
| `row_counts` | `JSONB` |  NOT NULL |
| `dropped_rows` | `JSONB` |  NOT NULL |
| `checksum_before` | `String(...)` | NULL |
| `checksum_after` | `String(...)` | NULL |
| `drift_summary` | `JSONB` |  NOT NULL |
| `error` | `JSONB` |  NOT NULL |
| `started_at` | `DateTime(...)` |  NOT NULL |
| `completed_at` | `DateTime(...)` | NULL |
| `duration_ms` | `Integer` | NULL |
| `is_demo` | `Boolean` |  NOT NULL |

### `standard.py` — 1 model(s)

#### `standards` (`Standard`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` | NULL |
| `name` | `String(...)` |  NOT NULL |
| `content` | `Text` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `version` | `?` |  NOT NULL |
| `metadata_` | `'metadata'` |  NOT NULL |

### `steering_rule.py` — 1 model(s)

#### `steering_rules` (`SteeringRule`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `rule_id` | `String(...)` |  NOT NULL |
| `file_path` | `Text` |  NOT NULL |
| `content_hash` | `String(...)` |  NOT NULL |
| `indexed_at` | `DateTime(...)` |  NOT NULL |
| `content` | `Text` |  NOT NULL |
| `scope` | `String(...)` |  NOT NULL |
| `applies_to_stages` | `ARRAY(...)` |  NOT NULL |
| `metadata_` | `'metadata'` |  NOT NULL |

### `story.py` — 4 model(s)

#### `epics` (`Epic`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `title` | `String(...)` |  NOT NULL |
| `description` | `Text` | NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `start_date` | `DateTime(...)` | NULL |
| `target_date` | `DateTime(...)` | NULL |
| `progress` | `Float` |  NOT NULL |
| `story_count` | `Integer` |  NOT NULL |
| `completed_story_count` | `Integer` |  NOT NULL |

#### `sprints` (`Sprint`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `goal` | `Text` | NULL |
| `start_date` | `DateTime(...)` |  NOT NULL |
| `end_date` | `DateTime(...)` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `story_ids` | `JSONB` |  NOT NULL |
| `total_points` | `Integer` |  NOT NULL |
| `completed_points` | `Integer` |  NOT NULL |

#### `stories` (`Story`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `epic_id` | `GUID(...)` | NULL |
| `sprint_id` | `GUID(...)` | NULL |
| `title` | `String(...)` |  NOT NULL |
| `description` | `Text` | NULL |
| `acceptance_criteria` | `JSONB` |  NOT NULL |
| `subtasks` | `JSONB` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `priority` | `SAEnum(...)` |  NOT NULL |
| `estimate` | `SAEnum(...)` |  NOT NULL |
| `labels` | `JSONB` |  NOT NULL |
| `assignee_id` | `GUID(...)` | NULL |
| `reporter_id` | `GUID(...)` |  NOT NULL |
| `jira_key` | `String(...)` | NULL |
| `jira_url` | `Text` | NULL |
| `jira_synced_at` | `DateTime(...)` | NULL |
| `jira_sync_status` | `SAEnum(...)` |  NOT NULL |
| `active_run_id` | `GUID(...)` | NULL |
| `last_run_id` | `GUID(...)` | NULL |
| `run_count` | `Integer` |  NOT NULL |
| `source` | `SAEnum(...)` |  NOT NULL |
| `source_id` | `String(...)` | NULL |
| `started_at` | `DateTime(...)` | NULL |
| `completed_at` | `DateTime(...)` | NULL |
| `linked_items` | `JSONB` |  NOT NULL |

#### `story_comments` (`StoryComment`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `story_id` | `GUID(...)` |  NOT NULL |
| `author_id` | `GUID(...)` |  NOT NULL |
| `body` | `Text` |  NOT NULL |
| `mentions` | `JSONB` |  NOT NULL |
| `edited_at` | `DateTime(...)` | NULL |

### `team.py` — 1 model(s)

#### `teams` (`Team`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `org_id` | `GUID(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `description` | `String(...)` | NULL |
| `model_allowlist` | `JSONB` |  NOT NULL |
| `default_agent_config` | `JSONB` |  NOT NULL |
| `blocked` | `Boolean` |  NOT NULL |

### `team_member.py` — 1 model(s)

#### `team_members` (`TeamMember`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `team_id` | `GUID(...)` |  NOT NULL |
| `user_id` | `GUID(...)` |  NOT NULL |
| `role` | `String(...)` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |

### `template.py` — 1 model(s)

#### `templates` (`Template`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` | NULL |
| `type` | `String(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `content` | `JSONB` |  NOT NULL |
| `variables` | `JSONB` |  NOT NULL |
| `version` | `?` |  NOT NULL |

### `tenant.py` — 1 model(s)

#### `tenants` (`Tenant`)

| Column | Type | Nullable |
|---|---|---|
| `name` | `String(...)` |  NOT NULL |
| `slug` | `String(...)` |  NOT NULL |
| `status` | `String(...)` |  NOT NULL |
| `settings` | `JSONB` |  NOT NULL |

### `tenant_settings.py` — 1 model(s)

#### `tenant_settings` (`TenantSettings`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `ForeignKey(...)` |  NOT NULL |
| `sampling_rate` | `Float` |  NOT NULL |
| `log_quota_per_hour` | `Integer` |  NOT NULL |
| `debug_force_sample` | `Boolean` |  NOT NULL |

### `terminal_cost.py` — 1 model(s)

#### `terminal_session_costs` (`TerminalSessionCost`)

| Column | Type | Nullable |
|---|---|---|
| `session_id` | `String(...)` |  NOT NULL |
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `model` | `String(...)` |  NOT NULL |
| `prompt_tokens` | `?` |  NOT NULL |
| `completion_tokens` | `?` |  NOT NULL |
| `cost_usd` | `Numeric(...)` |  NOT NULL |
| `recorded_at` | `DateTime(...)` |  NOT NULL |
| `command_count` | `?` |  NOT NULL |
| `duration_seconds` | `?` |  NOT NULL |

### `tool_bundle.py` — 1 model(s)

#### `tool_bundles` (`ToolBundle`)

| Column | Type | Nullable |
|---|---|---|
| `bundle_key` | `String(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `description` | `Text` | NULL |
| `tier` | `SAEnum(...)` |  NOT NULL |
| `tools` | `JSONB` |  NOT NULL |
| `requires_approval` | `Boolean` |  NOT NULL |
| `tags` | `ARRAY(...)` |  NOT NULL |

### `user.py` — 1 model(s)

#### `users` (`User`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `keycloak_sub` | `String(...)` |  NOT NULL |
| `email` | `String(...)` |  NOT NULL |
| `display_name` | `String(...)` | NULL |
| `mfa_enabled` | `Boolean` |  NOT NULL |
| `role_ids` | `ARRAY(...)` |  NOT NULL |
| `profile` | `JSONB` |  NOT NULL |

### `user_session.py` — 2 model(s)

#### `user_api_tokens` (`UserApiToken`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `user_id` | `GUID(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `scope` | `String(...)` |  NOT NULL |
| `fingerprint_sha256` | `String(...)` |  NOT NULL |
| `secret_hash` | `String(...)` |  NOT NULL |
| `last_used_at` | `DateTime(...)` | NULL |
| `expires_at` | `DateTime(...)` | NULL |
| `revoked_at` | `DateTime(...)` | NULL |

#### `user_sessions` (`UserSession`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `user_id` | `GUID(...)` |  NOT NULL |
| `user_agent` | `String(...)` |  NOT NULL |
| `ip` | `String(...)` |  NOT NULL |
| `label` | `String(...)` |  NOT NULL |
| `last_seen_at` | `DateTime(...)` |  NOT NULL |
| `revoked_at` | `DateTime(...)` | NULL |
| `is_current` | `Boolean` |  NOT NULL |

### `webhook.py` — 2 model(s)

#### `webhook_deliveries` (`WebhookDelivery`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `webhook_id` | `GUID(...)` |  NOT NULL |
| `event` | `String(...)` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `response_code` | `Integer` | NULL |
| `duration_ms` | `Integer` |  NOT NULL |
| `attempted_at` | `DateTime(...)` |  NOT NULL |
| `payload_preview` | `Text` |  NOT NULL |
| `error_message` | `Text` | NULL |

#### `webhooks` (`Webhook`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `direction` | `SAEnum(...)` |  NOT NULL |
| `url` | `String(...)` | NULL |
| `events` | `JSONB` |  NOT NULL |
| `auth_type` | `SAEnum(...)` |  NOT NULL |
| `auth_secret` | `Text` | NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `last_triggered_at` | `DateTime(...)` | NULL |
| `last_delivery_status` | `String(...)` | NULL |
| `success_count_24h` | `Integer` |  NOT NULL |
| `error_count_24h` | `Integer` |  NOT NULL |
| `created_by` | `GUID(...)` |  NOT NULL |

### `workflow.py` — 2 model(s)

#### `workflow_runs` (`WorkflowRun`)

| Column | Type | Nullable |
|---|---|---|
| `workflow_id` | `GUID(...)` |  NOT NULL |
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `started_at` | `DateTime(...)` | NULL |
| `finished_at` | `DateTime(...)` | NULL |
| `triggered_by` | `GUID(...)` |  NOT NULL |
| `current_step_id` | `String(...)` | NULL |
| `state` | `JSONB` |  NOT NULL |
| `error` | `Text` | NULL |

#### `workflows` (`Workflow`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `name` | `String(...)` |  NOT NULL |
| `description` | `Text` | NULL |
| `status` | `String(...)` |  NOT NULL |
| `definition` | `JSONB` |  NOT NULL |
| `created_by` | `GUID(...)` |  NOT NULL |
| `latest_run_id` | `GUID(...)` | NULL |
| `deleted_at` | `DateTime(...)` | NULL |

### `workflow_budget.py` — 2 model(s)

#### `workflow_budget_decisions` (`WorkflowBudgetDecision`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `workflow_id` | `GUID(...)` |  NOT NULL |
| `decision` | `String(...)` |  NOT NULL |
| `projected_cost_usd` | `Numeric(...)` |  NOT NULL |
| `spent_usd` | `Numeric(...)` |  NOT NULL |
| `ceiling_usd` | `Numeric(...)` |  NOT NULL |
| `actor_id` | `GUID(...)` | NULL |
| `reason` | `String(...)` | NULL |
| `occurred_at` | `DateTime(...)` |  NOT NULL |

#### `workflow_budgets` (`WorkflowBudget`)

| Column | Type | Nullable |
|---|---|---|
| `tenant_id` | `GUID(...)` |  NOT NULL |
| `project_id` | `GUID(...)` |  NOT NULL |
| `workflow_id` | `GUID(...)` |  NOT NULL |
| `ceiling_usd` | `Numeric(...)` |  NOT NULL |
| `spent_usd` | `Numeric(...)` |  NOT NULL |
| `status` | `SAEnum(...)` |  NOT NULL |
| `declared_by` | `GUID(...)` | NULL |
| `declared_at` | `DateTime(...)` |  NOT NULL |
| `metadata_` | `'metadata'` |  NOT NULL |

---

_Generated by `scripts/gen-db-schema.py` on 2026-07-06._
