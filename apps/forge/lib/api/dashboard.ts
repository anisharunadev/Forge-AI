/**
 * Dashboard REST API types — F-014 / step-57.
 *
 * Typed mirror of the locked Pydantic schemas served by
 * `backend/app/api/v1/dashboard.py`. The Pydantic schemas are the
 * source of truth; if you change one side, change the other.
 *
 * All aggregation types are tenant-scoped (Rule 2 — multi-tenancy is
 * never optional). The backend reads `tenant_id` from the JWT and
 * scopes every aggregate query to it.
 *
 * Skill rules adopted:
 *   - **Tenant scoping (Rule 2)** — every field that originates from
 *     tenant-scoped data carries `tenant_id`.
 *   - **Typed artifacts (Rule 4)** — no free-form blobs; every shape
 *     here is a structured payload the UI can render directly.
 */

// ---------------------------------------------------------------------------
// Aggregated KPI strip payload
// ---------------------------------------------------------------------------

export interface DashboardKPIs {
  // Agent metrics
  active_agents: number;
  total_agents: number;

  // Run metrics
  runs_today: number;
  runs_yesterday: number;
  runs_this_week: number;
  /** Percentage 0-100. */
  success_rate: number;
  /** Average run duration in seconds. */
  avg_duration_seconds: number;

  // LLM metrics
  total_cost_today: number;
  daily_cost_cap: number;
  total_tokens_today: number;
  input_tokens_today: number;
  output_tokens_today: number;

  // Approval metrics
  pending_approvals: number;
  critical_approvals: number;

  // Idea metrics
  ideas_this_week: number;
  ideas_scored: number;

  // Time-series (last 7 days)
  runs_by_day: {
    date: string;
    count: number;
    success: number;
    failed: number;
  }[];
  cost_by_day: { date: string; amount: number }[];
  cost_by_model: { model: string; amount: number; tokens: number }[];

  // Top lists
  top_agents: {
    id: string;
    name: string;
    runs: number;
    success_rate: number;
  }[];
  top_workflows: {
    id: string;
    name: string;
    runs: number;
    avg_duration: number;
  }[];

  /** Server timestamp the snapshot was computed (ISO 8601). */
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Team activity (one row of the live activity feed)
// ---------------------------------------------------------------------------

export type ActivityTargetType =
  | 'workflow'
  | 'run'
  | 'agent'
  | 'adr'
  | 'idea'
  | 'story'
  | 'ticket'
  | 'commit';

export interface TeamActivity {
  id: string;
  tenant_id: string;
  actor_id: string;
  actor_name: string;
  actor_avatar_url?: string;
  /** Human-readable verb phrase e.g. "started 3 workflows". */
  action: string;
  target_type: ActivityTargetType;
  target_id?: string;
  target_name?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Pinned items (drag-reorderable shortcuts)
// ---------------------------------------------------------------------------

export type PinnedItemType = 'agent' | 'workflow' | 'command' | 'page' | 'ticket' | 'idea';

export interface PinnedItem {
  id: string;
  user_id: string;
  item_type: PinnedItemType;
  item_id: string;
  /** Denormalized for display — backend flattens the underlying entity. */
  item_data: Record<string, unknown>;
  sort_order: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Dashboard widget (the layout grid)
// ---------------------------------------------------------------------------

export type DashboardWidgetType =
  | 'kpi_strip'
  | 'live_activity'
  | 'your_agents'
  | 'todays_runs'
  | 'cost_breakdown'
  | 'runs_overtime'
  | 'top_agents'
  | 'pending_approvals'
  | 'recent_ideas'
  | 'ai_insights'
  | 'personal_stats'
  | 'pinned'
  | 'quick_actions'
  | 'team_activity'
  | 'recent_alerts';

export interface DashboardWidget {
  id: string;
  user_id: string;
  type: DashboardWidgetType;
  enabled: boolean;
  /** Sort order — lower numbers render first. */
  position: number;
  config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// AI insight (proactive suggestions)
// ---------------------------------------------------------------------------

export type AIInsightCategory = 'trend' | 'anomaly' | 'opportunity' | 'risk' | 'tip';
export type AIInsightSeverity = 'info' | 'warning' | 'critical';

export interface AIInsight {
  id: string;
  tenant_id: string;
  /** null = insight is shown to every user in the tenant. */
  user_id?: string | null;
  title: string;
  body: string;
  category: AIInsightCategory;
  severity: AIInsightSeverity;
  related_entities: {
    type: 'agent' | 'workflow' | 'run' | 'idea';
    id: string;
  }[];
  action_url?: string;
  action_label?: string;
  created_at: string;
  read_at?: string;
}

// ---------------------------------------------------------------------------
// Dashboard layout
// ---------------------------------------------------------------------------

export type DashboardPreset = 'engineering_lead' | 'product_manager' | 'operator' | 'custom';

export interface DashboardLayout {
  user_id: string;
  widgets: DashboardWidget[];
  preset: DashboardPreset;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Alerts (one row of the recent alerts tile)
// ---------------------------------------------------------------------------

export type AlertType = 'cost' | 'failure' | 'approval' | 'sync' | 'security' | 'compliance';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertSourceType = 'workflow' | 'agent' | 'run' | 'connector' | 'policy';

export interface Alert {
  id: string;
  tenant_id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string;
  source_type: AlertSourceType;
  source_id?: string;
  source_name?: string;
  action_required: boolean;
  action_url?: string;
  action_label?: string;
  created_at: string;
  read_at?: string;
  resolved_at?: string;
}

// ---------------------------------------------------------------------------
// Query keys (TanStack Query invalidation targets)
// ---------------------------------------------------------------------------

export const queryKeys = {
  dashboard: {
    all: ['dashboard'] as const,
    kpis: () => [...queryKeys.dashboard.all, 'kpis'] as const,
    activity: (filter?: { since?: string; actor_id?: string }) =>
      [...queryKeys.dashboard.all, 'activity', filter ?? {}] as const,
    pinned: () => [...queryKeys.dashboard.all, 'pinned'] as const,
    insights: () => [...queryKeys.dashboard.all, 'insights'] as const,
    alerts: (filter?: { unread_only?: boolean; severity?: string }) =>
      [...queryKeys.dashboard.all, 'alerts', filter ?? {}] as const,
    layout: () => [...queryKeys.dashboard.all, 'layout'] as const,
  },
};
