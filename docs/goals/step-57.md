# step-57

> **Status:** completed
> **Last classified:** 2026-07-05

/goal


Wire the Dashboard to real backend data — every widget now shows live data from the agents, runs, workflows, ideas, and approvals APIs. Also apply the Step 42 polish fixes (duplicate breadcrumb, vertical spacing, consolidated greeting, single stale indicator). This is the moment the whole product lights up. Read .claude/design-system/ first.


INVOKE THE SKILL BEFORE CODING:

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "data aggregation dashboard tile KPI real-time fetch" --domain ux-guideline -f markdown

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "optimistic UI stale data background refresh pattern" --domain ux-guideline -f markdown


Adopt every rule. Then build:


==========================================================

ZONE 1 — APPLY STEP 42 POLISH FIXES FIRST

==========================================================


Before wiring data, apply the 5 polish fixes from Step 42:


A. REMOVE DUPLICATE BREADCRUMB (Fix 1):

- The breadcrumb is in the top navbar (Home icon + "Dashboard" text)

- Remove the duplicate breadcrumb from the greeting bar content area

- Greeting bar should just be: greeting + tenant context + health pill


B. REDUCE TOP PADDING (Fix 2):

- Current: pt-32px on content area

- Change to: pt-16px (just enough breathing room)


C. CONSOLIDATE GREETING BAR (Fix 3):

- Single row, h-72px (was multi-row)

- LEFT: greeting + tenant context (one line, truncate)

- RIGHT: tenant health pill + theme toggle + notifications + customize

- REPLACE 👋 emoji with lucide Hand icon (Step 1 token rule)


D. SINGLE STALE INDICATOR (Fix 4):

- Remove "(stale · 1m ago)" from each KPI tile

- Show ONE global "stale" indicator in the greeting bar health pill

- When orchestrator is down: dim all KPI tiles (opacity 0.7) + show clock icon next to values


E. ANIMATE COMMAND BAR PLACEHOLDER (Bonus):

- Cycle through 3-4 placeholder texts every 4s with fade transition

- "Ask Forge to do anything..."

- "Try: 'summarize today's runs'"

- "Type / for commands, @ for context"

- "Or just press ⌘K"


==========================================================

ZONE 2 — TYPE DEFINITIONS

==========================================================


Add to src/lib/api/types.ts:


```typescript

// DASHBOARD AGGREGATIONS

export interface DashboardKPIs {

  // Agent metrics

  active_agents: number;

  total_agents: number;

  

  // Run metrics

  runs_today: number;

  runs_yesterday: number;

  runs_this_week: number;

  success_rate: number;            // 0-100

  avg_duration_seconds: number;

  

  // LLM metrics

  total_cost_today: number;        // USD

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

  runs_by_day: { date: string; count: number; success: number; failed: number }[];

  cost_by_day: { date: string; amount: number }[];

  cost_by_model: { model: string; amount: number; tokens: number }[];

  

  // Top lists

  top_agents: { id: string; name: string; runs: number; success_rate: number }[];

  top_workflows: { id: string; name: string; runs: number; avg_duration: number }[];

}


export interface TeamActivity {

  id: string;

  tenant_id: string;

  actor_id: string;

  actor_name: string;

  actor_avatar_url?: string;

  action: string;                  // 'started 3 workflows', 'approved ADR-017'

  target_type: 'workflow' | 'run' | 'agent' | 'adr' | 'idea' | 'story' | 'ticket' | 'commit';

  target_id?: string;

  target_name?: string;

  metadata?: Record<string, any>;

  created_at: string;

}


export interface PinnedItem {

  id: string;

  user_id: string;

  item_type: 'agent' | 'workflow' | 'command' | 'page' | 'ticket' | 'idea';

  item_id: string;

  item_data: Record<string, any>;   // denormalized for display

  sort_order: number;

  created_at: string;

}


export interface DashboardWidget {

  id: string;

  user_id: string;

  type: 'kpi_strip' | 'live_activity' | 'your_agents' | 'todays_runs' | 'cost_breakdown' | 'runs_overtime' | 'top_agents' | 'pending_approvals' | 'recent_ideas' | 'ai_insights' | 'personal_stats' | 'pinned' | 'quick_actions' | 'team_activity' | 'recent_alerts';

  enabled: boolean;

  position: number;

  config: Record<string, any>;

}


export interface AIInsight {

  id: string;

  tenant_id: string;

  user_id?: string;                  // null = all users

  title: string;

  body: string;

  category: 'trend' | 'anomaly' | 'opportunity' | 'risk' | 'tip';

  severity: 'info' | 'warning' | 'critical';

  related_entities: {

    type: 'agent' | 'workflow' | 'run' | 'idea';

    id: string;

  }[];

  action_url?: string;

  action_label?: string;

  created_at: string;

  read_at?: string;

}


export interface DashboardLayout {

  user_id: string;

  widgets: DashboardWidget[];

  preset: 'engineering_lead' | 'product_manager' | 'operator' | 'custom';

  updated_at: string;

}


export interface Alert {

  id: string;

  tenant_id: string;

  type: 'cost' | 'failure' | 'approval' | 'sync' | 'security' | 'compliance';

  severity: 'info' | 'warning' | 'critical';

  title: string;

  body: string;

  source_type: 'workflow' | 'agent' | 'run' | 'connector' | 'policy';

  source_id?: string;

  source_name?: string;

  action_required: boolean;

  action_url?: string;

  action_label?: string;

  created_at: string;

  read_at?: string;

  resolved_at?: string;

}


// Query keys

export const queryKeys = {

  dashboard: {

    all: ['dashboard'] as const,

    kpis: () => [...queryKeys.dashboard.all, 'kpis'] as const,

    activity: (filter?: any) => [...queryKeys.dashboard.all, 'activity', filter] as const,

    pinned: () => [...queryKeys.dashboard.all, 'pinned'] as const,

    insights: () => [...queryKeys.dashboard.all, 'insights'] as const,

    alerts: (filter?: any) => [...queryKeys.dashboard.all, 'alerts', filter] as const,

    layout: () => [...queryKeys.dashboard.all, 'layout'] as const,

  },

};
========================================================== ZONE 3 — REACT QUERY HOOKS
Add to src/lib/query/hooks.ts:

typescript

Copy
// DASHBOARD

export function useDashboardKPIs() {

  return useQuery({

    queryKey: queryKeys.dashboard.kpis(),

    queryFn: () => api.get<DashboardKPIs>('/dashboard/kpis'),

    refetchInterval: 30_000,        // refresh every 30s

  });

}


export function useTeamActivity(filter?: { since?: string; actor_id?: string }) {

  return useQuery({

    queryKey: queryKeys.dashboard.activity(filter),

    queryFn: () => {

      const params = new URLSearchParams();

      if (filter?.since) params.set('since', filter.since);

      if (filter?.actor_id) params.set('actor_id', filter.actor_id);

      return api.get<TeamActivity[]>(`/dashboard/activity?${params}`);

    },

    refetchInterval: 15_000,

  });

}


export function usePinnedItems() {

  return useQuery({

    queryKey: queryKeys.dashboard.pinned(),

    queryFn: () => api.get<PinnedItem[]>('/dashboard/pinned'),

  });

}


export function usePinItem() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (data: { item_type: string; item_id: string; item_data: any }) =>

      api.post<PinnedItem>('/dashboard/pinned', data),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.dashboard.pinned() }),

  });

}


export function useUnpinItem() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.delete(`/dashboard/pinned/${id}`),

    onMutate: async (id) => {

      await qc.cancelQueries({ queryKey: queryKeys.dashboard.pinned() });

      const previous = qc.getQueryData<PinnedItem[]>(queryKeys.dashboard.pinned());

      qc.setQueryData<PinnedItem[]>(queryKeys.dashboard.pinned(), old =>

        old?.filter(p => p.id !== id) ?? []

      );

      return { previous };

    },

    onError: (err, id, context) => {

      qc.setQueryData(queryKeys.dashboard.pinned(), context?.previous);

    },

    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.dashboard.pinned() }),

  });

}


export function useReorderPinnedItems() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (items: { id: string; sort_order: number }[]) =>

      api.patch('/dashboard/pinned/reorder', { items }),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.dashboard.pinned() }),

  });

}


export function useAIInsights() {

  return useQuery({

    queryKey: queryKeys.dashboard.insights(),

    queryFn: () => api.get<AIInsight[]>('/dashboard/insights'),

    refetchInterval: 60_000,

  });

}


export function useMarkInsightRead() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.post(`/dashboard/insights/${id}/read`),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.dashboard.insights() }),

  });

}


export function useDismissInsight() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.post(`/dashboard/insights/${id}/dismiss`),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.dashboard.insights() }),

  });

}


export function useAlerts(filter?: { unread_only?: boolean; severity?: string }) {

  return useQuery({

    queryKey: queryKeys.dashboard.alerts(filter),

    queryFn: () => {

      const params = new URLSearchParams();

      if (filter?.unread_only) params.set('unread_only', 'true');

      if (filter?.severity) params.set('severity', filter.severity);

      return api.get<Alert[]>(`/dashboard/alerts?${params}`);

    },

    refetchInterval: 10_000,

  });

}


export function useMarkAlertRead() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.post(`/dashboard/alerts/${id}/read`),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.dashboard.all }),

  });

}


export function useMarkAllAlertsRead() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: () => api.post('/dashboard/alerts/read-all'),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.dashboard.all }),

  });

}


export function useDashboardLayout() {

  return useQuery({

    queryKey: queryKeys.dashboard.layout(),

    queryFn: () => api.get<DashboardLayout>('/dashboard/layout'),

    staleTime: 60_000,

  });

}


export function useUpdateDashboardLayout() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (layout: DashboardLayout) => api.put<DashboardLayout>('/dashboard/layout', layout),

    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.dashboard.layout() }),

  });

}
========================================================== ZONE 4 — MAIN DASHBOARD PAGE
In src/app/(workspace)/dashboard/page.tsx:

typescript

Copy
'use client';

import { useDashboardKPIs, useTeamActivity, usePinnedItems, useAIInsights, useAlerts, useDashboardLayout } from '@/lib/query/hooks';

import { useMemo, useState } from 'react';

import { LiveActivity } from '@/components/dashboard/live-activity';

import { AgentGrid } from '@/components/dashboard/agent-grid';

import { RunsTimeline } from '@/components/dashboard/runs-timeline';

import { CostChart } from '@/components/dashboard/cost-chart';

import { TopAgents } from '@/components/dashboard/top-agents';

import { PinnedPanel } from '@/components/dashboard/pinned-panel';

import { QuickActions } from '@/components/dashboard/quick-actions';

import { AIInsightsPanel } from '@/components/dashboard/ai-insights-panel';

import { TeamActivityFeed } from '@/components/dashboard/team-activity';

import { RecentAlerts } from '@/components/dashboard/recent-alerts';

import { CustomizeDrawer } from '@/components/dashboard/customize-drawer';

import { StaleBanner } from '@/components/dashboard/stale-banner';


export default function DashboardPage() {

  const { data: kpis } = useDashboardKPIs();

  const { data: layout } = useDashboardLayout();

  const { data: activity } = useTeamActivity({ since: '24h' });

  const { data: pinned } = usePinnedItems();

  const { data: insights } = useAIInsights();

  const { data: alerts } = useAlerts();

  const [customizeOpen, setCustomizeOpen] = useState(false);

  

  // Check if orchestrator is down (for stale indicator)

  const isStale = kpis && Object.values(kpis).some(v => v === null || v === undefined);

  

  return (

    <div className={cn('space-y-6', isStale && 'opacity-90')}>

      

      {/* Greeting bar (consolidated, Step 42) */}

      <GreetingBar

        user={useAuth().user}

        tenant={useAuth().tenant}

        isStale={isStale}

        onCustomize={() => setCustomizeOpen(true)}

      />

      

      {/* Orchestrator warning (when down) */}

      {isStale && <StaleBanner />}

      

      {/* Command bar */}

      <CommandBar />

      

      {/* KPI strip */}

      {kpis && <KPIStrip kpis={kpis} />}

      

      {/* Bento grid — rendered by layout */}

      <BentoGrid

        layout={layout}

        widgets={{

          'live_activity': <LiveActivity activity={activity} />,

          'your_agents': <AgentGrid />,

          'todays_runs': <RunsTimeline />,

          'cost_breakdown': <CostChart />,

          'runs_overtime': <RunsOvertimeChart kpis={kpis} />,

          'top_agents': <TopAgents agents={kpis?.top_agents} />,

          'pending_approvals': <PendingApprovals />,

          'recent_ideas': <RecentIdeas />,

          'ai_insights': <AIInsightsPanel insights={insights} />,

          'personal_stats': <PersonalStats />,

          'pinned': <PinnedPanel items={pinned} />,

          'quick_actions': <QuickActions />,

          'team_activity': <TeamActivityFeed activities={activity} />,

          'recent_alerts': <RecentAlerts alerts={alerts} />,

        }}

      />

      

      {/* Customize drawer */}

      <CustomizeDrawer

        open={customizeOpen}

        onClose={() => setCustomizeOpen(false)}

        layout={layout}

      />

    </div>

  );

}
========================================================== ZONE 5 — GREETING BAR (consolidated, single row)
In src/components/dashboard/greeting-bar.tsx:

typescript

Copy
'use client';

import { useState, useEffect } from 'react';

import { useAuth } from '@/lib/api/auth';

import { LucideHand, Sun, Moon, Bell, LayoutGrid } from 'lucide-react';


function GreetingBar({ user, tenant, isStale, onCustomize }: GreetingBarProps) {

  const [timeOfDay, setTimeOfDay] = useState('');

  

  useEffect(() => {

    const hour = new Date().getHours();

    if (hour < 12) setTimeOfDay('Good morning');

    else if (hour < 18) setTimeOfDay('Good afternoon');

    else setTimeOfDay('Good evening');

  }, []);

  

  return (

    <div className="flex items-center justify-between gap-4 px-6 h-[72px] bg-surface rounded-xl">

      <div className="flex items-center gap-3 min-w-0">

        <span className="text-lg font-semibold">{timeOfDay}, {user?.name?.split(' ')[0]}</span>

        <LucideHand className="w-4 h-4 text-amber-500" />

        <span className="text-sm text-fg-tertiary truncate">

          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}

          {' · '}{tenant?.name}

          {' · '}<TenantHealth />

        </span>

        {isStale && (

          <Badge variant="warning">

            <Clock className="w-3 h-3 mr-1" />

            STALE · 5s ago

          </Badge>

        )}

      </div>

      

      <div className="flex items-center gap-2">

        <Button variant="ghost" size="icon" onClick={onCustomize}>

          <LayoutGrid className="w-4 h-4" />

        </Button>

        <ThemeToggle />

        <NotificationBell />

        <UserMenu />

      </div>

    </div>

  );

}
========================================================== ZONE 6 — KPI STRIP (real data, with stale indicator)
In src/components/dashboard/kpi-strip.tsx:

typescript

Copy
function KPIStrip({ kpis }: { kpis: DashboardKPIs }) {

  const tiles = [

    { label: 'Active Agents', value: kpis.active_agents, sub: `of ${kpis.total_agents}`, color: 'cyan', sparkline: 'agents' },

    { label: 'Runs Today', value: kpis.runs_today, sub: `vs ${kpis.runs_yesterday} yesterday`, color: 'indigo', sparkline: 'runs' },

    { label: 'Success Rate', value: `${kpis.success_rate}%`, sub: 'succeeded', color: 'emerald', sparkline: 'success' },

    { label: 'Avg Latency', value: formatMs(kpis.avg_duration_seconds), sub: 'p50 latency', color: 'amber', sparkline: 'latency' },

    { label: 'Cost Today', value: `$${kpis.total_cost_today.toFixed(2)}`, sub: `of $${kpis.daily_cost_cap} ceiling`, color: 'rose', sparkline: 'cost' },

    { label: 'Tokens Used', value: formatTokens(kpis.total_tokens_today), sub: 'tokens', color: 'violet', sparkline: 'tokens' },

  ];

  

  return (

    <div className="grid grid-cols-6 gap-3">

      {tiles.map(t => <KPITile key={t.label} {...t} />)}

    </div>

  );

}
========================================================== ZONE 7 — BENTO GRID (layout-driven)
In src/components/dashboard/bento-grid.tsx:

typescript

Copy
function BentoGrid({ layout, widgets }: BentoGridProps) {

  if (!layout) return <Spinner />;

  

  // Group widgets by row based on position

  const rows: Record<number, DashboardWidget[]> = {};

  layout.widgets.filter(w => w.enabled).forEach(w => {

    if (!rows[w.position]) rows[w.position] = [];

    rows[w.position].push(w);

  });

  

  // Render rows in position order

  return (

    <div className="space-y-4">

      {Object.keys(rows).sort((a, b) => Number(a) - Number(b)).map(rowKey => {

        const rowWidgets = rows[Number(rowKey)];

        return (

          <BentoRow key={rowKey} widgets={rowWidgets} components={widgets} />

        );

      })}

    </div>

  );

}


function BentoRow({ widgets, components }) {

  // Calculate column spans based on widget count

  const total = widgets.length;

  const span = Math.floor(12 / total);

  

  return (

    <div className="grid grid-cols-12 gap-4">

      {widgets.map(w => (

        <div key={w.id} className={`col-span-${span}`}>

          {components[w.type]}

        </div>

      ))}

    </div>

  );

}
========================================================== ZONE 8 — KEY DASHBOARD WIDGETS (real data)
A. LIVE ACTIVITY (real WebSocket data):

typescript

Copy
function LiveActivity({ activity }: { activity: TeamActivity[] }) {

  return (

    <Card>

      <CardHeader>

        <CardTitle>Live activity</CardTitle>

        <Badge variant="emerald"><Circle className="w-2 h-2 animate-pulse" /> Streaming</Badge>

      </CardHeader>

      <CardContent>

        <div className="space-y-2 max-h-[280px] overflow-y-auto">

          {activity?.slice(0, 15).map(a => (

            <ActivityRow key={a.id} activity={a} />

          ))}

        </div>

      </CardContent>

    </Card>

  );

}


function ActivityRow({ activity }: { activity: TeamActivity }) {

  return (

    <div className="flex items-start gap-3 text-sm">

      <Avatar src={activity.actor_avatar_url} size="xs" />

      <div className="flex-1 min-w-0">

        <div>

          <span className="font-medium">{activity.actor_name}</span>

          <span className="text-fg-tertiary"> {activity.action} </span>

          {activity.target_name && (

            <Link to={activity.target_id} className="text-fg-primary">

              {activity.target_name}

            </Link>

          )}

        </div>

        <div className="text-xs text-fg-tertiary">{timeAgo(activity.created_at)}</div>

      </div>

    </div>

  );

}
B. YOUR AGENTS (real data, from Phase 2):

typescript

Copy
function YourAgentsWidget() {

  const { data: agents } = useAgents();

  

  return (

    <Card>

      <CardHeader>

        <CardTitle>Your agents</CardTitle>

        <span className="text-sm text-fg-tertiary">{agents?.length} registered</span>

      </CardHeader>

      <CardContent>

        <div className="grid grid-cols-3 gap-3">

          {agents?.slice(0, 9).map(a => (

            <AgentMiniCard key={a.id} agent={a} />

          ))}

        </div>

        {agents && agents.length > 9 && (

          <Link to="/agents" className="text-sm text-accent-primary mt-3 inline-block">

            Manage agents →

          </Link>

        )}

      </CardContent>

    </Card>

  );

}
C. TODAY'S RUNS (real timeline from Phase 4):

typescript

Copy
function TodaysRunsWidget() {

  const { data: runs } = useRuns(undefined, { status: undefined });

  const todayRuns = runs?.filter(r => isToday(r.started_at)) ?? [];

  

  return (

    <Card>

      <CardHeader>

        <CardTitle>Today's runs</CardTitle>

        <Legend>

          <LegendItem color="emerald">ok</LegendItem>

          <LegendItem color="rose">failed</LegendItem>

          <LegendItem color="cyan">running</LegendItem>

        </Legend>

      </CardHeader>

      <CardContent>

        <RunsTimeline24h runs={todayRuns} />

      </CardContent>

    </Card>

  );

}
D. COST BREAKDOWN (real data, from Phase 4):

typescript

Copy
function CostBreakdownWidget({ kpis }: { kpis: DashboardKPIs }) {

  return (

    <Card>

      <CardHeader>

        <CardTitle>Cost by category</CardTitle>

        <span className="text-sm text-fg-tertiary">Last 24h</span>

      </CardHeader>

      <CardContent>

        <Recharts.RadialBarChart data={kpis.cost_by_model.map(c => ({

          name: c.model,

          value: c.amount,

          fill: getModelColor(c.model),

        }))}>

          <Recharts.RadialBar dataKey="value" cornerRadius={4} background />

        </Recharts.RadialBarChart>

        <div className="mt-4 space-y-2">

          {kpis.cost_by_model.slice(0, 5).map(c => (

            <div key={c.model} className="flex justify-between text-sm">

              <span className="flex items-center gap-2">

                <span className="w-2 h-2 rounded-full" style={{ background: getModelColor(c.model) }} />

                {c.model}

              </span>

              <span className="font-mono">${c.amount.toFixed(2)}</span>

            </div>

          ))}

        </div>

      </CardContent>

    </Card>

  );

}
E. AI INSIGHTS (real, from backend):

typescript

Copy
function AIInsightsPanel({ insights }: { insights: AIInsight[] }) {

  if (!insights?.length) {

    return (

      <Card>

        <CardHeader><CardTitle>Today's AI insights</CardTitle></CardHeader>

        <CardContent>

          <EmptyHint>No insights yet. AI will surface patterns as your team works.</EmptyHint>

        </CardContent>

      </Card>

    );

  }

  

  return (

    <Card>

      <CardHeader>

        <CardTitle>Today's AI insights</CardTitle>

        <Badge>{insights.length} new</Badge>

      </CardHeader>

      <CardContent className="space-y-3">

        {insights.slice(0, 2).map(insight => (

          <InsightCard key={insight.id} insight={insight} />

        ))}

        {insights.length > 2 && (

          <button className="text-sm text-accent-primary w-full text-center py-2">

            Show {insights.length - 2} more insights

          </button>

        )}

      </CardContent>

    </Card>

  );

}


function InsightCard({ insight }: { insight: AIInsight }) {

  const dismiss = useDismissInsight();

  return (

    <div className="border-l-2 pl-4 py-2" style={{ borderColor: getSeverityColor(insight.severity) }}>

      <div className="flex items-start justify-between gap-2">

        <div className="flex-1">

          <div className="flex items-center gap-2 mb-1">

            <Sparkles className="w-3 h-3" />

            <span className="text-xs text-fg-tertiary">INSIGHT {insights.indexOf(insight) + 1} OF {insights.length}</span>

            <span className="text-xs text-fg-tertiary">· {timeAgo(insight.created_at)}</span>

          </div>

          <h4 className="font-medium text-sm">{insight.title}</h4>

          <p className="text-sm text-fg-secondary mt-1 line-clamp-3">{insight.body}</p>

          <div className="flex gap-2 mt-2">

            {insight.action_label && (

              <button className="text-xs text-accent-primary">

                {insight.action_label} →

              </button>

            )}

            <button onClick={() => dismiss.mutate(insight.id)} className="text-xs text-fg-tertiary">

              Dismiss

            </button>

          </div>

        </div>

      </div>

    </div>

  );

}
F. PINNED ITEMS (real, drag-drop enabled):

typescript

Copy
function PinnedPanel({ items }: { items: PinnedItem[] }) {

  const reorder = useReorderPinnedItems();

  const unpin = useUnpinItem();

  

  const sensors = useSensors(useSensor(PointerSensor));

  

  const handleDragEnd = (event) => {

    const { active, over } = event;

    if (active.id !== over.id) {

      const oldIndex = items.findIndex(i => i.id === active.id);

      const newIndex = items.findIndex(i => i.id === over.id);

      const reordered = arrayMove(items, oldIndex, newIndex);

      reorder.mutate(reordered.map((item, idx) => ({ id: item.id, sort_order: idx })));

    }

  };

  

  return (

    <Card>

      <CardHeader>

        <CardTitle>Pinned</CardTitle>

        <Link to="/dashboard/customize-pins">Manage</Link>

      </CardHeader>

      <CardContent>

        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>

          <div className="grid grid-cols-4 gap-3">

            {items?.slice(0, 8).map(item => (

              <SortableItem key={item.id} item={item} onUnpin={() => unpin.mutate(item.id)} />

            ))}

            {items && items.length < 8 && <AddPinTile />}

          </div>

        </DndContext>

      </CardContent>

    </Card>

  );

}
G. QUICK ACTIONS (real):

typescript

Copy
function QuickActions() {

  return (

    <Card>

      <CardHeader>

        <CardTitle>Quick actions</CardTitle>

        <Link to="/dashboard/customize-actions">Customize</Link>

      </CardHeader>

      <CardContent>

        <div className="space-y-3">

          {quickActions.map(group => (

            <div key={group.label}>

              <div className="text-xs uppercase tracking-wider text-fg-tertiary mb-1">{group.label}</div>

              <div className="grid grid-cols-2 gap-2">

                {group.actions.map(a => (

                  <QuickActionTile key={a.id} action={a} />

                ))}

              </div>

            </div>

          ))}

        </div>

      </CardContent>

    </Card>

  );

}
H. RECENT ALERTS (real):

typescript

Copy
function RecentAlerts({ alerts }: { alerts: Alert[] }) {

  const markRead = useMarkAlertRead();

  

  return (

    <Card>

      <CardHeader>

        <CardTitle>Recent alerts</CardTitle>

        <Link to="/alerts">All</Link>

        <Link to="?unread=true">Unread</Link>

        <Link to="?severity=critical">Critical</Link>

        <button onClick={() => useMarkAllAlertsRead().mutate()}>Mark all read</button>

      </CardHeader>

      <CardContent>

        <div className="space-y-2">

          {alerts?.slice(0, 5).map(a => (

            <AlertRow key={a.id} alert={a} onRead={() => markRead.mutate(a.id)} />

          ))}

        </div>

      </CardContent>

    </Card>

  );

}
========================================================== ZONE 9 — REMOVE ALL DUMMY DATA
bash

Copy
grep -r "dummyKpis\|mockActivity\|sampleAlerts" apps/forge/

grep -r "Active Agents.*3\|Runs Today.*187\|Cost Today.*32.40" apps/forge/  # your dummy numbers
Remove ALL hardcoded numbers, arrays, objects. Every widget reads from a hook.

========================================================== ZONE 10 — BACKEND ENDPOINTS
python

Copy
# backend/app/api/v1/dashboard.py

> **Status:** completed
> **Last classified:** 2026-07-05

@router.get("/dashboard/kpis")

@router.get("/dashboard/activity")

@router.get("/dashboard/pinned")

@router.post("/dashboard/pinned")

@router.delete("/dashboard/pinned/{id}")

@router.patch("/dashboard/pinned/reorder")

@router.get("/dashboard/insights")

@router.post("/dashboard/insights/{id}/read")

@router.post("/dashboard/insights/{id}/dismiss")

@router.get("/dashboard/alerts")

@router.post("/dashboard/alerts/{id}/read")

@router.post("/dashboard/alerts/read-all")

@router.get("/dashboard/layout")

@router.put("/dashboard/layout")
All endpoints use tenant_id from JWT (Rule 2). All aggregate queries filter by tenant_id.

AI insights generated server-side (e.g., daily cron job + on-demand when user opens dashboard). Alerts aggregated from audit log + run failures.

========================================================== CONSTRAINTS
All dashboard data tenant-scoped (Rule 2)
Apply all 5 Step 42 polish fixes
Real-time updates: 30s polling for KPIs, 15s for activity, 60s for insights
Stale data: when API fails or returns stale, show last-known values with global indicator
All widget positions respect user layout preferences
Don't break the customize drawer (Step 18 v2)
Don't break the floating Co-pilot FAB
Dark mode only
========================================================== DELIVERABLE
files modified, new files in src/components/dashboard/ + src/lib/query/
All 5 Step 42 polish fixes applied (duplicate breadcrumb, spacing, consolidated greeting, single stale indicator, animated placeholder)
All dashboard widgets wired to real data:
Greeting bar (real user + tenant)
KPI strip (6 tiles, real numbers)
Live activity (real team activity)
Your agents (from Phase 2)
Today's runs (from Phase 4)
Cost breakdown (from Phase 4)
Runs over time (from Phase 4)
Top agents (from Phase 4)
Pending approvals (from governance)
Recent ideas (from ideation)
AI insights (from backend)
Personal stats (real user stats)
Pinned (user preferences, drag-reorder)
Quick actions (configurable)
Team activity (from audit)
Recent alerts (from backend)
All dummy data removed
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep the customize drawer, keep the floating Co-pilot FAB, keep the page layout
Test: log in → dashboard shows real data within 2s
Test: trigger a workflow run → "Today's runs" updates within 30s
Test: pin an item → drag-reorder → new order persists
Test: orchestrator goes down → global STALE indicator appears, tiles dim
Test: customize drawer → toggle widgets → layout saves
