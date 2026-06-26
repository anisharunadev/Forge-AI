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

export function mockSnapshot(): DashboardSnapshot {
  const now = new Date();
  return {
    generatedAt: now.toISOString(),
    user: { firstName: 'Arun', email: 'arun@acme-corp.com' },
    tenant: { name: 'Acme Corp', plan: 'Dev Demo' },
    online: false,
    retryInSec: 12,
    metrics: {
      'active-agents': { value: 3, of: 5, delta: +1, trend: [2, 2, 3, 3, 3, 4, 3], accent: 'cyan', unit: '', label: 'of 5 online' },
      'runs-today': { value: 23, delta: +5, trend: [12, 14, 17, 18, 19, 21, 23], accent: 'indigo', unit: '', label: 'vs yesterday' },
      'success-rate': { value: 91.3, delta: +2.4, trend: [85, 87, 88, 89, 90, 91, 91.3], accent: 'emerald', unit: '%', label: 'succeeded' },
      'avg-latency': { value: 412, delta: -38, trend: [480, 470, 455, 440, 430, 420, 412], accent: 'amber', unit: 'ms', label: 'p50 latency' },
      'cost-today': { value: 32.40, delta: +4.12, trend: [22, 24, 26, 28, 30, 31, 32.4], accent: 'rose', unit: '$', label: 'of $50 ceiling' },
      'tokens-used': { value: 482_310, delta: +51_200, trend: [380, 400, 420, 440, 460, 470, 482.31], accent: 'violet', unit: '', label: 'tokens' },
    },
    agents: [
      { id: 'atlas', name: 'Atlas', role: 'Backend Engineer', status: 'running', task: 'Refactoring order-service', lastActivity: '2m ago' },
      { id: 'aria', name: 'Aria', role: 'Frontend Engineer', status: 'running', task: 'Wiring dashboard bento', lastActivity: 'just now' },
      { id: 'mira', name: 'Mira', role: 'QA Engineer', status: 'idle', task: 'Awaiting next run', lastActivity: '8m ago' },
      { id: 'orion', name: 'Orion', role: 'Security', status: 'paused', task: 'Audit gate', lastActivity: '14m ago' },
      { id: 'lyra', name: 'Lyra', role: 'Docs', status: 'error', task: 'Failed: schema drift', lastActivity: '21m ago' },
      { id: 'kira', name: 'Kira', role: 'DevOps', status: 'idle', task: 'Awaiting deployment', lastActivity: '34m ago' },
      { id: 'neo', name: 'Neo', role: 'Architecture', status: 'idle', task: 'Drafting ADR-018', lastActivity: '1h ago' },
      { id: 'vex', name: 'Vex', role: 'Migration', status: 'idle', task: 'Pending input', lastActivity: '2h ago' },
      { id: 'zen', name: 'Zen', role: 'Test Synth', status: 'idle', task: 'Idle', lastActivity: '3h ago' },
    ],
    activity: [
      { id: 'a-001', agent: 'Aria', agentId: 'aria', verb: 'completed', target: 'Wiring dashboard bento', timestamp: '00:01:12', duration: '4m 12s', color: 'emerald' },
      { id: 'a-002', agent: 'Atlas', agentId: 'atlas', verb: 'started', target: 'Refactor: order-service.ts', timestamp: '00:01:34', duration: '—', color: 'cyan' },
      { id: 'a-003', agent: 'Mira', agentId: 'mira', verb: 'failed', target: 'E2E: checkout-flow', timestamp: '00:02:11', duration: '2m 04s', color: 'rose' },
      { id: 'a-004', agent: 'Aria', agentId: 'aria', verb: 'started', target: 'Fix: type definitions', timestamp: '00:02:58', duration: '—', color: 'cyan' },
      { id: 'a-005', agent: 'Orion', agentId: 'orion', verb: 'paused', target: 'Security audit: auth module', timestamp: '00:03:21', duration: '—', color: 'amber' },
      { id: 'a-006', agent: 'Atlas', agentId: 'atlas', verb: 'completed', target: 'Refactor: order-service.ts', timestamp: '00:05:47', duration: '4m 13s', color: 'emerald' },
      { id: 'a-007', agent: 'Lyra', agentId: 'lyra', verb: 'failed', target: 'Schema migration: v3.4', timestamp: '00:07:02', duration: '1m 09s', color: 'rose' },
      { id: 'a-008', agent: 'Aria', agentId: 'aria', verb: 'completed', target: 'Fix: type definitions', timestamp: '00:09:31', duration: '6m 33s', color: 'emerald' },
      { id: 'a-009', agent: 'Mira', agentId: 'mira', verb: 'started', target: 'Regression: payment', timestamp: '00:10:00', duration: '—', color: 'cyan' },
      { id: 'a-010', agent: 'Orion', agentId: 'orion', verb: 'completed', target: 'Security audit: auth module', timestamp: '00:12:48', duration: '9m 27s', color: 'emerald' },
    ],
    runsToday: [
      { id: 'r-001', agent: 'Atlas', status: 'succeeded', startMinutesAgo: 380, durationMinutes: 12 },
      { id: 'r-002', agent: 'Aria', status: 'succeeded', startMinutesAgo: 360, durationMinutes: 8 },
      { id: 'r-003', agent: 'Mira', status: 'failed', startMinutesAgo: 240, durationMinutes: 18 },
      { id: 'r-004', agent: 'Lyra', status: 'failed', startMinutesAgo: 220, durationMinutes: 6 },
      { id: 'r-005', agent: 'Atlas', status: 'succeeded', startMinutesAgo: 180, durationMinutes: 14 },
      { id: 'r-006', agent: 'Aria', status: 'running', startMinutesAgo: 60, durationMinutes: 24 },
      { id: 'r-007', agent: 'Mira', status: 'succeeded', startMinutesAgo: 45, durationMinutes: 9 },
      { id: 'r-008', agent: 'Orion', status: 'paused', startMinutesAgo: 30, durationMinutes: 5 },
      { id: 'r-009', agent: 'Atlas', status: 'succeeded', startMinutesAgo: 8, durationMinutes: 11 },
      { id: 'r-010', agent: 'Aria', status: 'running', startMinutesAgo: 2, durationMinutes: 4 },
    ],
    cost: [
      { name: 'Agents', value: 12.40, color: 'var(--accent-primary)' },
      { name: 'Models', value: 11.85, color: 'var(--accent-cyan)' },
      { name: 'Tools', value: 5.20, color: 'var(--accent-amber)' },
      { name: 'Infra', value: 2.95, color: 'var(--accent-rose)' },
    ],
    runsOverTime: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      succeeded: [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 3, 2, 2, 1, 2, 1, 1, 0, 0, 0, 0, 0][hour] ?? 0,
      failed: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0][hour] ?? 0,
      running: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0][hour] ?? 0,
    })),
    topAgents: [
      { id: 'atlas', name: 'Atlas', runs: 142, successRate: 94 },
      { id: 'aria', name: 'Aria', runs: 118, successRate: 91 },
      { id: 'mira', name: 'Mira', runs: 96, successRate: 88 },
      { id: 'orion', name: 'Orion', runs: 74, successRate: 96 },
      { id: 'lyra', name: 'Lyra', runs: 51, successRate: 71 },
    ],
    approvals: [
      { id: 'apr-001', title: 'ADR-018: switch to Postgres 17', submitter: 'Neo', submittedAt: '12m ago', kind: 'adr' },
      { id: 'apr-002', title: 'Production deploy: forge-platform v2.4.1', submitter: 'Kira', submittedAt: '38m ago', kind: 'deployment' },
      { id: 'apr-003', title: 'Security review: vault migration', submitter: 'Orion', submittedAt: '1h ago', kind: 'security' },
    ],
    ideas: [
      { id: 'idea-001', title: 'Auto-rollback on cost spike', author: 'Arun', score: 87, status: 'scoping', age: '2h' },
      { id: 'idea-002', title: 'Per-tenant token budgeting', author: 'Priya', score: 74, status: 'backlog', age: '5h' },
      { id: 'idea-003', title: 'Realtime agent heatmap', author: 'Marcus', score: 62, status: 'exploring', age: '1d' },
    ],
    insights: [
      {
        id: 'ins-001',
        generatedAt: '2h ago',
        title: 'Your team ran 23% more workflows than last Tuesday',
        body: 'Success rate held at 91%. The "Bug fix workflow" was the top performer, averaging 4m 12s per execution. Cost per workflow dropped 6% thanks to shorter prompts.',
        accent: 'cyan',
      },
      {
        id: 'ins-002',
        generatedAt: '5h ago',
        title: 'Cost spike detected in "Refactor" workflow',
        body: 'Used 2.3× more tokens than usual yesterday. Likely cause: large legacy file (~8k lines) in acme-corp/forge-platform. Suggest splitting before next run.',
        accent: 'amber',
      },
      {
        id: 'ins-003',
        generatedAt: 'yesterday',
        title: 'Approval backlog is shrinking',
        body: 'You cleared 4 of 6 pending ADRs this week. Median time-to-decision is down to 3h 12m. Keep momentum on the security gate.',
        accent: 'emerald',
      },
    ],
    team: [
      { id: 't-001', actor: 'Arun', verb: 'started 3 workflows', target: 'Refactor + tests', minutesAgo: 3 },
      { id: 't-002', actor: 'Priya', verb: 'approved', target: 'ADR-017 Postgres migration', minutesAgo: 12 },
      { id: 't-003', actor: 'Marcus', verb: '\'s agent fixed', target: 'checkout-flow e2e', minutesAgo: 24 },
      { id: 't-004', actor: 'Devon', verb: 'commented on', target: 'adr-018 review', minutesAgo: 47 },
      { id: 't-005', actor: 'Sana', verb: 'pushed commit', target: 'feat/agent-heatmav2', minutesAgo: 64 },
      { id: 't-006', actor: 'Arun', verb: 'pinned', target: 'cmd:new-feature', minutesAgo: 95 },
    ],
    alerts: [
      { id: 'al-001', severity: 'critical', icon: 'triangle', title: 'Cost ceiling 64% used', body: 'Acme Corp daily ceiling $50 — $32.40 spent, on pace to exceed by 18:00 UTC.', timestamp: '4m ago' },
      { id: 'al-002', severity: 'warning', icon: 'info', title: 'Lyra failed twice in a row', body: 'Schema migration v3.4 failed on retry. Manual review recommended.', timestamp: '21m ago' },
      { id: 'al-003', severity: 'success', icon: 'check', title: 'Production deploy succeeded', body: 'forge-platform v2.4.0 rolled out to 100% of fleet.', timestamp: '1h ago' },
      { id: 'al-004', severity: 'info', icon: 'info', title: 'New agent available', body: '"Zen" test synth joined the agent center.', timestamp: '3h ago' },
      { id: 'al-005', severity: 'warning', icon: 'triangle', title: 'Approval queue growing', body: '3 ADRs awaiting decision > 2 hours.', timestamp: '5h ago' },
    ],
    pinnedCatalog: [
      { id: 'cmd:new-feature', label: 'New feature', kind: 'command', icon: 'sparkles', href: '/copilot?prompt=Plan%20a%20new%20feature' },
      { id: 'cmd:fix-bug', label: 'Fix bug', kind: 'command', icon: 'wrench', href: '/copilot?prompt=Help%20me%20debug' },
      { id: 'agent:atlas', label: 'Atlas', kind: 'agent', icon: 'bot', href: '/agent-center/atlas' },
      { id: 'agent:aria', label: 'Aria', kind: 'agent', icon: 'bot', href: '/agent-center/aria' },
      { id: 'page:runs', label: 'Runs', kind: 'page', icon: 'play', href: '/runs' },
      { id: 'page:ideation', label: 'Ideation', kind: 'page', icon: 'lightbulb', href: '/ideation' },
      { id: 'page:analytics', label: 'Analytics', kind: 'page', icon: 'bar', href: '/analytics' },
      { id: 'agent:orion', label: 'Orion', kind: 'agent', icon: 'bot', href: '/agent-center/orion' },
      { id: 'page:copilot', label: 'Co-pilot', kind: 'page', icon: 'sparkles', href: '/copilot' },
      { id: 'cmd:review', label: 'Review PR', kind: 'command', icon: 'git', href: '/copilot?prompt=Review%20my%20open%20PRs' },
    ],
    quickActions: [
      { id: 'qa-1', label: 'Run "New feature"', icon: 'sparkles', shortcut: '⌘⇧N', color: 'indigo', href: '/copilot?prompt=Plan%20a%20new%20feature' },
      { id: 'qa-2', label: 'Run "Fix bug"', icon: 'wrench', shortcut: '⌘⇧B', color: 'amber', href: '/copilot?prompt=Help%20me%20debug' },
      { id: 'qa-3', label: 'Open Terminal', icon: 'terminal', shortcut: '⌘⇧T', color: 'emerald', href: '/forge-terminal' },
      { id: 'qa-4', label: 'Create idea', icon: 'lightbulb', shortcut: '⌘⇧I', color: 'cyan', href: '/ideation/new' },
    ],
  };
}