/**
 * Shared types for the Mission Control dashboard (Step 25).
 *
 * Kept in a dedicated module so the (very large) MissionControl.tsx
 * surface can import them without bloating its own type block.
 */

export type KpiMetric =
  | 'active-agents'
  | 'runs-today'
  | 'success-rate'
  | 'avg-latency'
  | 'cost-today'
  | 'tokens-used';

export type AccentName = 'cyan' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'violet';

export interface KpiDelta {
  value: number;
  /** Compared to yesterday / last week. */
  delta: number;
  /** Sparkline series, oldest first. */
  trend: ReadonlyArray<number>;
  /** Accent color name (drives icon + chart color). */
  accent: AccentName;
  unit: string;
  /** Secondary descriptor under the metric ("of 5 online", "vs yesterday"). */
  label: string;
  /** When present, show as `value of total` instead of plain value. */
  of?: number;
}

export type AgentState = 'running' | 'idle' | 'paused' | 'error';

export interface AgentStatus {
  id: string;
  name: string;
  role: string;
  status: AgentState;
  task: string;
  lastActivity: string;
}

export type ActivityColor = 'cyan' | 'emerald' | 'rose' | 'amber';

export interface LiveActivityEntry {
  id: string;
  agent: string;
  agentId: string;
  verb: 'started' | 'completed' | 'failed' | 'paused';
  target: string;
  timestamp: string;
  duration: string;
  color: ActivityColor;
}

export interface CostSlice {
  name: string;
  value: number;
  color: string;
}

export interface RunsOverTimePoint {
  hour: number;
  succeeded: number;
  failed: number;
  running: number;
}

export interface TopAgentRow {
  id: string;
  name: string;
  runs: number;
  successRate: number;
}

export interface ApprovalItem {
  id: string;
  title: string;
  submitter: string;
  submittedAt: string;
  kind: 'adr' | 'deployment' | 'security' | 'review';
}

export interface IdeaItem {
  id: string;
  title: string;
  author: string;
  score: number;
  status: 'backlog' | 'exploring' | 'scoping' | 'building';
  age: string;
}

export interface AiInsight {
  id: string;
  generatedAt: string;
  title: string;
  body: string;
  accent: AccentName;
}

export interface TeamActivityEntry {
  id: string;
  actor: string;
  verb: string;
  target: string;
  minutesAgo: number;
}

export type AlertSeverity = 'critical' | 'warning' | 'info' | 'success';

export interface AlertItem {
  id: string;
  severity: AlertSeverity;
  icon: 'triangle' | 'check' | 'info';
  title: string;
  body: string;
  timestamp: string;
}

export type PinKind = 'agent' | 'workflow' | 'page' | 'command';

export interface PinnedItem {
  id: string;
  label: string;
  kind: PinKind;
  icon: 'sparkles' | 'wrench' | 'bot' | 'play' | 'lightbulb' | 'bar' | 'terminal' | 'git';
  href: string;
}

export interface QuickAction {
  id: string;
  label: string;
  icon: 'sparkles' | 'wrench' | 'terminal' | 'lightbulb';
  shortcut: string;
  color: AccentName;
  href: string;
}