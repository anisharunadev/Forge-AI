/**
 * Mock data + connectivity probe for the Mission Control dashboard
 * (Step 25).
 *
 * The orchestrator is unreachable in the current dev environment
 * (see goal file). Rather than render an empty page, we ship a
 * curated dataset that exercises every widget on the dashboard so
 * the visual layout can be reviewed end-to-end. When the backend
 * is wired in (a follow-up step), the consumers swap `mockData` for
 * a `forgeFetch` call and the widgets do not need to change.
 *
 * All data is intentionally domain-flavored for a fictional "Acme
 * Corp" tenant so the dashboard reads like a real mission control
 * rather than Lorem Ipsum. Numbers are realistic but illustrative.
 */

import type {
  AgentStatus,
  AiInsight,
  AlertItem,
  ApprovalItem,
  CostSlice,
  IdeaItem,
  KpiDelta,
  KpiMetric,
  LiveActivityEntry,
  PinnedItem,
  QuickAction,
  RunsOverTimePoint,
  TeamActivityEntry,
  TopAgentRow,
} from './types';

export interface DashboardSnapshot {
  generatedAt: string;
  user: { firstName: string; email: string };
  tenant: { name: string; plan: string };
  online: boolean;
  retryInSec: number;
  metrics: Record<KpiMetric, KpiDelta>;
  agents: ReadonlyArray<AgentStatus>;
  activity: ReadonlyArray<LiveActivityEntry>;
  runsToday: ReadonlyArray<{ id: string; agent: string; status: 'succeeded' | 'failed' | 'running' | 'paused'; startMinutesAgo: number; durationMinutes: number }>;
  cost: ReadonlyArray<CostSlice>;
  runsOverTime: ReadonlyArray<RunsOverTimePoint>;
  topAgents: ReadonlyArray<TopAgentRow>;
  approvals: ReadonlyArray<ApprovalItem>;
  ideas: ReadonlyArray<IdeaItem>;
  insights: ReadonlyArray<AiInsight>;
  team: ReadonlyArray<TeamActivityEntry>;
  alerts: ReadonlyArray<AlertItem>;
  pinnedCatalog: ReadonlyArray<PinnedItem>;
  quickActions: ReadonlyArray<QuickAction>;
}

