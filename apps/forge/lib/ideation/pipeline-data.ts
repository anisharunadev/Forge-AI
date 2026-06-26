/**
 * Ideation Center — Pipeline data layer (Step 28).
 *
 * Sample fixtures for the new "Continuous Context Orchestration" hub:
 *   - Ingest sources (Zendesk, Jira, GitHub, Slack, Linear, etc.)
 *   - Sync destinations (Jira, Confluence, AI agent via MCP, etc.)
 *   - Market signals (competitor + trend + tech feeds)
 *   - Customer voice clusters (themes from Zendesk + Jira + Intercom)
 *   - Reasoning chains (chain-of-thought transparency)
 *
 * Step 28 keeps the Step 5 Idea model unchanged. New shapes below are
 * additive only and are local to the ideation hub — no orchestrator
 * changes ship in this step.
 */

import type { Idea } from './data';

// ---------------------------------------------------------------------------
// Ingest sources
// ---------------------------------------------------------------------------

export type SourceKind =
  | 'support'
  | 'market'
  | 'codebase'
  | 'team'
  | 'doc'
  | 'webhook'
  | 'feed'
  | 'email';

export type SourceStatus = 'connected' | 'available' | 'error';

export interface IngestSource {
  readonly id: string;
  readonly name: string;
  readonly kind: SourceKind;
  /** Lucide icon name — rendered by <SourceCard>. */
  readonly icon: 'Headphones' | 'TrendingUp' | 'Code' | 'MessageSquare' | 'BookOpen' | 'Rss' | 'Mail' | 'Webhook' | 'Slack';
  readonly description: string;
  readonly status: SourceStatus;
  readonly accent: 'cyan' | 'amber' | 'indigo' | 'violet' | 'rose' | 'emerald';
  /** Last successful sync (relative text, e.g., "12m ago"). */
  readonly lastSync: string;
  /** Records ingested today. */
  readonly todayCount: number;
  /** Records ingested this week. */
  readonly weekCount: number;
  /** Trend badge (e.g., "+18%"). */
  readonly trend?: string;
  /** Mini KPI line. */
  readonly kpi: string;
  /** Latest 3 ingested items (preview). */
  readonly preview: ReadonlyArray<{ title: string; at: string }>;
  /** Cron-ish frequency. */
  readonly frequency: string;
}

export const INGEST_SOURCES: ReadonlyArray<IngestSource> = [
  {
    id: 'src-zendesk',
    name: 'Support feedback',
    kind: 'support',
    icon: 'Headphones',
    description: 'Customer tickets and feature requests from Zendesk and Jira Service Desk.',
    status: 'connected',
    accent: 'cyan',
    lastSync: '12m ago',
    todayCount: 38,
    weekCount: 247,
    trend: '+18%',
    kpi: '247 new this week',
    frequency: 'Every 15m',
    preview: [
      { title: 'Checkout hangs on mobile', at: '4m ago' },
      { title: 'Refund flow — missing receipt', at: '21m ago' },
      { title: 'SSO loop on Okta', at: '38m ago' },
    ],
  },
  {
    id: 'src-jira-sd',
    name: 'Jira Service Desk',
    kind: 'support',
    icon: 'Headphones',
    description: 'Internal IT and ops tickets surfaced as feedback themes.',
    status: 'connected',
    accent: 'cyan',
    lastSync: '1h ago',
    todayCount: 12,
    weekCount: 84,
    kpi: '84 new this week',
    frequency: 'Hourly',
    preview: [
      { title: 'VPN auth flakiness', at: '12m ago' },
      { title: 'CI runners exhausted', at: '47m ago' },
    ],
  },
  {
    id: 'src-market',
    name: 'Market & competitor signals',
    kind: 'market',
    icon: 'TrendingUp',
    description: 'Web intelligence and industry shifts surfaced in real time.',
    status: 'connected',
    accent: 'amber',
    lastSync: '4m ago',
    todayCount: 5,
    weekCount: 28,
    kpi: '5 signals · 2 high-priority',
    frequency: 'Every 5m',
    preview: [
      { title: 'Stripe launches embedded finance SDK', at: '9m ago' },
      { title: 'Linear adds audit-grade approvals', at: '38m ago' },
      { title: 'OpenAI ships cached tool calls', at: '1h ago' },
    ],
  },
  {
    id: 'src-github',
    name: 'Tech stack & debt',
    kind: 'codebase',
    icon: 'Code',
    description: 'Tech debt scores, architecture patterns, and codebase signals from Git and SonarQube.',
    status: 'connected',
    accent: 'indigo',
    lastSync: '2h ago',
    todayCount: 0,
    weekCount: 12,
    kpi: '12 hot spots · 3 critical',
    frequency: 'Every 2h',
    preview: [
      { title: 'PaymentService.ts complexity 78', at: '2h ago' },
      { title: 'Auth middleware — 12 TODOs', at: '5h ago' },
      { title: 'OrderService no tests', at: '1d ago' },
    ],
  },
  {
    id: 'src-slack',
    name: 'Slack',
    kind: 'team',
    icon: 'Slack',
    description: 'Product and engineering channel highlights.',
    status: 'available',
    accent: 'violet',
    lastSync: '—',
    todayCount: 0,
    weekCount: 0,
    kpi: 'Connect to surface highlights',
    frequency: 'Realtime',
    preview: [],
  },
  {
    id: 'src-linear',
    name: 'Linear',
    kind: 'team',
    icon: 'Slack',
    description: 'Mirror issue backlog and team velocity.',
    status: 'available',
    accent: 'violet',
    lastSync: '—',
    todayCount: 0,
    weekCount: 0,
    kpi: 'Connect to import backlog',
    frequency: 'Every 30m',
    preview: [],
  },
  {
    id: 'src-notion',
    name: 'Notion',
    kind: 'doc',
    icon: 'BookOpen',
    description: 'Specs, RFCs, and customer interview notes.',
    status: 'available',
    accent: 'rose',
    lastSync: '—',
    todayCount: 0,
    weekCount: 0,
    kpi: 'Connect to ingest RFCs',
    frequency: 'Every 1h',
    preview: [],
  },
  {
    id: 'src-intercom',
    name: 'Intercom',
    kind: 'support',
    icon: 'MessageSquare',
    description: 'Live chat and product education transcripts.',
    status: 'available',
    accent: 'cyan',
    lastSync: '—',
    todayCount: 0,
    weekCount: 0,
    kpi: 'Connect to add chat themes',
    frequency: 'Every 15m',
    preview: [],
  },
  {
    id: 'src-webhook',
    name: 'Custom webhook',
    kind: 'webhook',
    icon: 'Webhook',
    description: 'Bring your own source via signed HTTP POST.',
    status: 'available',
    accent: 'emerald',
    lastSync: '—',
    todayCount: 0,
    weekCount: 0,
    kpi: 'Connect to receive events',
    frequency: 'Realtime',
    preview: [],
  },
  {
    id: 'src-rss',
    name: 'RSS feeds',
    kind: 'feed',
    icon: 'Rss',
    description: 'Curated industry and competitor blogs.',
    status: 'available',
    accent: 'amber',
    lastSync: '—',
    todayCount: 0,
    weekCount: 0,
    kpi: 'Connect to track feeds',
    frequency: 'Every 30m',
    preview: [],
  },
  {
    id: 'src-email',
    name: 'Email forwarding',
    kind: 'email',
    icon: 'Mail',
    description: 'Forward to ideas@yourcompany.com — AI parses attachments.',
    status: 'available',
    accent: 'indigo',
    lastSync: '—',
    todayCount: 0,
    weekCount: 0,
    kpi: 'Forward ideas@yourcompany.com',
    frequency: 'Realtime',
    preview: [],
  },
];

// ---------------------------------------------------------------------------
// Sync destinations
// ---------------------------------------------------------------------------

export type DestinationKind = 'pm' | 'docs' | 'ide' | 'chat' | 'mirror' | 'digest';

export interface Destination {
  readonly id: string;
  readonly name: string;
  readonly kind: DestinationKind;
  readonly icon: 'Trello' | 'BookOpen' | 'Sparkles' | 'Slack' | 'Github' | 'Mail' | 'MessageSquare';
  readonly description: string;
  readonly status: SourceStatus;
  readonly accent: 'indigo' | 'cyan' | 'violet' | 'emerald' | 'rose' | 'amber';
  readonly lastSync: string;
  readonly kpi: string;
  readonly metric?: { label: string; value: string };
}

export const DESTINATIONS: ReadonlyArray<Destination> = [
  {
    id: 'dst-jira',
    name: 'Jira',
    kind: 'pm',
    icon: 'Trello',
    description: 'Auto-populated Epics, User Stories, and effort estimates ready for sprint planning.',
    status: 'connected',
    accent: 'indigo',
    lastSync: '4m ago',
    kpi: '12 epics · 47 stories · 3 sprints',
    metric: { label: 'Created this month', value: '62' },
  },
  {
    id: 'dst-confluence',
    name: 'Confluence',
    kind: 'docs',
    icon: 'BookOpen',
    description: 'PRD and Architecture Spec auto-generated from the validated concept.',
    status: 'connected',
    accent: 'cyan',
    lastSync: '7m ago',
    kpi: '8 PRDs · 3 arch specs',
    metric: { label: 'Generated this month', value: '11' },
  },
  {
    id: 'dst-ai-agent',
    name: 'ai agent via MCP',
    kind: 'ide',
    icon: 'Sparkles',
    description: 'Picks up context-rich tickets and executes within architecture guardrails.',
    status: 'connected',
    accent: 'violet',
    lastSync: 'now',
    kpi: '3 active · 18 completed · 96% success',
    metric: { label: 'In progress', value: '3' },
  },
  {
    id: 'dst-slack',
    name: 'Slack',
    kind: 'chat',
    icon: 'Slack',
    description: 'Channel notifications when ideas reach a milestone.',
    status: 'available',
    accent: 'emerald',
    lastSync: '—',
    kpi: 'Connect to post updates',
  },
  {
    id: 'dst-teams',
    name: 'Microsoft Teams',
    kind: 'chat',
    icon: 'MessageSquare',
    description: 'Surface ideation updates to your Microsoft Teams channels.',
    status: 'available',
    accent: 'indigo',
    lastSync: '—',
    kpi: 'Connect to post updates',
  },
  {
    id: 'dst-email',
    name: 'Email digest',
    kind: 'digest',
    icon: 'Mail',
    description: 'Daily + weekly summary emails to PMs and stakeholders.',
    status: 'available',
    accent: 'amber',
    lastSync: '—',
    kpi: 'Connect to subscribe',
  },
  {
    id: 'dst-github',
    name: 'GitHub Issues',
    kind: 'mirror',
    icon: 'Github',
    description: 'Mirror ideation as GitHub issues with full context.',
    status: 'available',
    accent: 'rose',
    lastSync: '—',
    kpi: 'Connect to mirror',
  },
];

// ---------------------------------------------------------------------------
// Live agent run — used by the Pipeline tab central panel.
// ---------------------------------------------------------------------------

export type ReasoningStepKind =
  | 'read'
  | 'cluster'
  | 'match'
  | 'score'
  | 'impact'
  | 'final';

export interface ReasoningStep {
  readonly id: string;
  readonly kind: ReasoningStepKind;
  readonly title: string;
  readonly detail: string;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly sources: ReadonlyArray<string>;
}

export interface ReasoningChain {
  readonly id: string;
  readonly ideaTitle: string;
  readonly steps: ReadonlyArray<ReasoningStep>;
  readonly finalScore: number;
  readonly generatedAt: string;
}

export const SAMPLE_REASONING: ReasoningChain = {
  id: 'reasoning-2026-06-26',
  ideaTitle: 'Unify the refund flow across web + mobile',
  generatedAt: 'just now',
  finalScore: 8.4,
  steps: [
    {
      id: 's1',
      kind: 'read',
      title: 'Read context',
      detail: 'Pulled 247 Zendesk tickets from the last 30 days and 84 internal Jira Service Desk items.',
      confidence: 'high',
      sources: ['Zendesk', 'Jira Service Desk'],
    },
    {
      id: 's2',
      kind: 'cluster',
      title: 'Cluster by theme',
      detail: 'Identified 12 themes. Top: refund flow confusion (47 tickets, +15% WoW).',
      confidence: 'high',
      sources: ['Zendesk clustering v3'],
    },
    {
      id: 's3',
      kind: 'match',
      title: 'Match to codebase',
      detail: 'Found RefundService and StripeClient — 78% reusable code, no schema migration required.',
      confidence: 'high',
      sources: ['GitHub', 'SonarQube'],
    },
    {
      id: 's4',
      kind: 'score',
      title: 'Score feasibility',
      detail: '8.2/10 — moderate complexity, 2-week estimate, one engineer already familiar.',
      confidence: 'medium',
      sources: ['CODEOWNERS', 'Past cycle time'],
    },
    {
      id: 's5',
      kind: 'impact',
      title: 'Score impact',
      detail: '8.6/10 — 247 affected customers, est. $14k monthly churn saved.',
      confidence: 'high',
      sources: ['Segment', 'Zendesk impact tags'],
    },
    {
      id: 's6',
      kind: 'final',
      title: 'Final score',
      detail: '8.4/10 — combined weighted (impact 60% · feasibility 30% · confidence 10%).',
      confidence: 'high',
      sources: ['Composite scoring'],
    },
  ],
};

// ---------------------------------------------------------------------------
// Live agent run state — what the center "Forge Ideation Agent" panel shows
// when the pipeline is running. Streamed word-by-word in the UI.
// ---------------------------------------------------------------------------

export const LIVE_REASONING_SCRIPT: ReadonlyArray<string> = [
  'Reading support tickets from Zendesk (247)...',
  'clustering by theme...',
  'surfacing 3 high-impact themes...',
  'linking to codebase signals (Git + SonarQube)...',
  'scoring impact and feasibility...',
  'drafting PRD outline...',
];

// ---------------------------------------------------------------------------
// Market signals — competitor + trend + tech feeds.
// ---------------------------------------------------------------------------

export type MarketSignalKind = 'competitor' | 'trend' | 'tech';

export interface MarketSignal {
  readonly id: string;
  readonly kind: MarketSignalKind;
  readonly title: string;
  readonly source: string;
  readonly url: string;
  readonly publishedAt: string;
  readonly aiAnnotation: string;
  readonly priority: 'low' | 'medium' | 'high';
}

export const MARKET_SIGNALS: ReadonlyArray<MarketSignal> = [
  {
    id: 'sig-1',
    kind: 'competitor',
    title: 'Stripe launches embedded finance SDK for marketplaces',
    source: 'TechCrunch',
    url: 'https://techcrunch.com/2026/stripe-embedded-finance',
    publishedAt: '9m ago',
    aiAnnotation:
      'Why this matters: our RefundService sits adjacent to Stripe payouts — embedded finance gives marketplaces a story we currently lack.',
    priority: 'high',
  },
  {
    id: 'sig-2',
    kind: 'trend',
    title: 'AI agents ship audit-grade approval trails as table stakes',
    source: 'Hacker News',
    url: 'https://news.ycombinator.com/audit-grade',
    publishedAt: '38m ago',
    aiAnnotation:
      'Why this matters: our Approvals queue already supports this — surface in marketing as a differentiator.',
    priority: 'medium',
  },
  {
    id: 'sig-3',
    kind: 'tech',
    title: 'OpenAI ships cached tool calls — 70% latency drop',
    source: 'OpenAI blog',
    url: 'https://openai.com/blog/cached-tools',
    publishedAt: '1h ago',
    aiAnnotation:
      'Why this matters: our RAG layer can cache retrieval results — projected $4k/mo cost reduction.',
    priority: 'medium',
  },
  {
    id: 'sig-4',
    kind: 'competitor',
    title: 'Linear adds audit-grade approvals',
    source: 'Linear blog',
    url: 'https://linear.app/blog/audit-approvals',
    publishedAt: '4h ago',
    aiAnnotation:
      'Why this matters: our existing Approvals center already meets this bar — consider a "Linear parity" comparison page.',
    priority: 'low',
  },
  {
    id: 'sig-5',
    kind: 'trend',
    title: 'B2B SaaS: PM-led ideation hubs replace roadmap docs',
    source: 'Lenny\'s Newsletter',
    url: 'https://lennysnewsletter.com/ideation-hubs',
    publishedAt: '6h ago',
    aiAnnotation:
      'Why this matters: validates the Step 28 Ideation hub design — quote in our launch post.',
    priority: 'medium',
  },
  {
    id: 'sig-6',
    kind: 'tech',
    title: 'Vercel introduces serverless Postgres edge caching',
    source: 'Vercel blog',
    url: 'https://vercel.com/blog/pg-edge',
    publishedAt: '1d ago',
    aiAnnotation:
      'Why this matters: our Ideation Knowledge Graph could cache tenant-scoped queries at the edge.',
    priority: 'low',
  },
  {
    id: 'sig-7',
    kind: 'competitor',
    title: 'Notion AI ships inline idea clustering',
    source: 'The Verge',
    url: 'https://theverge.com/notion-ai-clustering',
    publishedAt: '1d ago',
    aiAnnotation:
      'Why this matters: Notion clustering lacks multi-source ingest (no Zendesk, no Git) — our pitch stays strong.',
    priority: 'medium',
  },
  {
    id: 'sig-8',
    kind: 'trend',
    title: 'Customer Voice analytics surges — Sprig, Dovetail, Maze up 60% YoY',
    source: 'G2 Trends',
    url: 'https://g2.com/trends/voice-analytics',
    publishedAt: '2d ago',
    aiAnnotation:
      'Why this matters: the new Customer Voice tab aligns with this trend — consider G2 listing.',
    priority: 'medium',
  },
];

// ---------------------------------------------------------------------------
// Customer voice — clustered feedback themes.
// ---------------------------------------------------------------------------

export type Sentiment = 'positive' | 'neutral' | 'negative';
export type ClusterTrend = 'up' | 'down' | 'flat';

export interface CustomerCluster {
  readonly id: string;
  readonly theme: string;
  readonly icon: 'MessageCircle' | 'CreditCard' | 'Smartphone' | 'Receipt' | 'Lock' | 'Search';
  readonly ticketCount: number;
  readonly trendDelta: string; // e.g., "+32%"
  readonly trendDirection: ClusterTrend;
  readonly impactScore: number; // 0..10
  readonly sentiment: Readonly<{ positive: number; neutral: number; negative: number }>;
  readonly timeline: ReadonlyArray<{ day: string; count: number }>;
  readonly topExcerpts: ReadonlyArray<string>;
  readonly sampleQuotes: ReadonlyArray<string>;
  readonly linkedCodeSignals: ReadonlyArray<string>;
}

export const CUSTOMER_CLUSTERS: ReadonlyArray<CustomerCluster> = [
  {
    id: 'cl-checkout',
    theme: 'Checkout slowness',
    icon: 'CreditCard',
    ticketCount: 47,
    trendDelta: '+32%',
    trendDirection: 'up',
    impactScore: 8.6,
    sentiment: { positive: 5, neutral: 22, negative: 73 },
    timeline: [
      { day: 'D-30', count: 12 },
      { day: 'D-25', count: 18 },
      { day: 'D-20', count: 22 },
      { day: 'D-15', count: 27 },
      { day: 'D-10', count: 31 },
      { day: 'D-5', count: 39 },
      { day: 'Today', count: 47 },
    ],
    topExcerpts: [
      'Checkout takes 8+ seconds on mobile — losing patience',
      'Payment step hangs after entering card details',
      'Slow checkout on 3G — same site is fast on wifi',
    ],
    sampleQuotes: [
      '"I gave up twice before completing the order."',
      '"Faster to drive to the store."',
      '"Same site is fast on wifi — must be the mobile path."',
    ],
    linkedCodeSignals: ['PaymentService.ts · 78 complexity', 'Checkout flow'],
  },
  {
    id: 'cl-mobile-crash',
    theme: 'Mobile app crashes',
    icon: 'Smartphone',
    ticketCount: 28,
    trendDelta: '-8%',
    trendDirection: 'down',
    impactScore: 7.2,
    sentiment: { positive: 8, neutral: 18, negative: 74 },
    timeline: [
      { day: 'D-30', count: 31 },
      { day: 'D-25', count: 30 },
      { day: 'D-20', count: 30 },
      { day: 'D-15', count: 31 },
      { day: 'D-10', count: 29 },
      { day: 'D-5', count: 28 },
      { day: 'Today', count: 28 },
    ],
    topExcerpts: [
      'App crashes on launch after update 4.2.1',
      'iOS 18 — crash on tab switch',
      'Android — crash when adding to cart',
    ],
    sampleQuotes: [
      '"Crashed 3 times before opening."',
      '"Reverted to the web app."',
    ],
    linkedCodeSignals: ['MobileApp startup · v4.2.1', 'Cart module'],
  },
  {
    id: 'cl-refund',
    theme: 'Refund flow confusing',
    icon: 'Receipt',
    ticketCount: 15,
    trendDelta: '+15%',
    trendDirection: 'up',
    impactScore: 6.4,
    sentiment: { positive: 12, neutral: 28, negative: 60 },
    timeline: [
      { day: 'D-30', count: 8 },
      { day: 'D-25', count: 9 },
      { day: 'D-20', count: 11 },
      { day: 'D-15', count: 12 },
      { day: 'D-10', count: 13 },
      { day: 'D-5', count: 14 },
      { day: 'Today', count: 15 },
    ],
    topExcerpts: [
      'Where is the refund button?',
      'Receipt missing after refund',
      'Refund shows pending for 5 days',
    ],
    sampleQuotes: [
      '"I cannot find the refund button on the order page."',
      '"Got the email but no money back yet."',
    ],
    linkedCodeSignals: ['RefundService.ts', 'StripeClient'],
  },
  {
    id: 'cl-sso',
    theme: 'SSO loop on Okta',
    icon: 'Lock',
    ticketCount: 11,
    trendDelta: '+4%',
    trendDirection: 'flat',
    impactScore: 5.8,
    sentiment: { positive: 6, neutral: 22, negative: 72 },
    timeline: [
      { day: 'D-30', count: 10 },
      { day: 'D-25', count: 10 },
      { day: 'D-20', count: 11 },
      { day: 'D-15', count: 11 },
      { day: 'D-10', count: 11 },
      { day: 'D-5', count: 11 },
      { day: 'Today', count: 11 },
    ],
    topExcerpts: [
      'SSO redirects to Okta then loops back to login',
      'Okta SAML mismatch error',
      'SSO works on web, breaks on mobile app',
    ],
    sampleQuotes: [
      '"Every morning it asks me to log in again."',
    ],
    linkedCodeSignals: ['Auth middleware', 'SAML handler'],
  },
  {
    id: 'cl-search',
    theme: 'Search returns nothing useful',
    icon: 'Search',
    ticketCount: 9,
    trendDelta: '+1%',
    trendDirection: 'flat',
    impactScore: 4.2,
    sentiment: { positive: 14, neutral: 30, negative: 56 },
    timeline: [
      { day: 'D-30', count: 8 },
      { day: 'D-25', count: 8 },
      { day: 'D-20', count: 9 },
      { day: 'D-15', count: 9 },
      { day: 'D-10', count: 9 },
      { day: 'D-5', count: 9 },
      { day: 'Today', count: 9 },
    ],
    topExcerpts: [
      'Search for "refund" returns 0 results',
      'Search does not find order numbers',
    ],
    sampleQuotes: [
      '"Searched for the obvious word — got nothing."',
    ],
    linkedCodeSignals: ['Search index · pgvector'],
  },
];

// ---------------------------------------------------------------------------
// Pipeline status — the single-row status bar below the 3-column bento.
// ---------------------------------------------------------------------------

export interface PipelineStatusSegment {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly tone: 'cyan' | 'amber' | 'emerald' | 'violet' | 'rose';
}

export const PIPELINE_STATUS: ReadonlyArray<PipelineStatusSegment> = [
  { id: 'ingested', label: 'ingested', count: 247, tone: 'cyan' },
  { id: 'scored', label: 'scored', count: 23, tone: 'amber' },
  { id: 'prds', label: 'PRDs drafted', count: 3, tone: 'violet' },
  { id: 'jira', label: 'synced to Jira', count: 8, tone: 'emerald' },
  { id: 'ide', label: 'in IDE execution', count: 3, tone: 'rose' },
];

// ---------------------------------------------------------------------------
// Per-idea enrichment for Step 28.
// Kept additive so the Step 5 Idea data model stays untouched.
// ---------------------------------------------------------------------------

export type IdeaSourceKind =
  | 'zendesk'
  | 'jira'
  | 'github'
  | 'manual'
  | 'market'
  | 'voice';

export interface IdeaSource {
  readonly kind: IdeaSourceKind;
  readonly label: string;
  readonly accent: 'cyan' | 'indigo' | 'violet' | 'amber' | 'rose';
  readonly url?: string;
  readonly title?: string;
  readonly reporter?: string;
  readonly priority?: 'low' | 'medium' | 'high' | 'urgent';
}

export interface IdeaSyncStatus {
  readonly jira?: { state: 'created' | 'syncing' | 'failed' | 'none'; ref?: string; lastSync?: string };
  readonly confluence?: { state: 'created' | 'syncing' | 'failed' | 'none'; ref?: string; lastSync?: string };
  readonly ide?: { state: 'running' | 'queued' | 'completed' | 'failed' | 'none'; active?: number; lastSync?: string };
}

export interface IdeaReasoningSummary {
  readonly chainId: string;
  readonly cluster: string;
  readonly feasibility: string;
  readonly impact: string;
  readonly risk: string;
  readonly finalScore: number;
  readonly confidence: 'high' | 'medium' | 'low';
}

export interface IdeaEnrichment {
  readonly source: IdeaSource;
  readonly sync: IdeaSyncStatus;
  readonly reasoning: IdeaReasoningSummary;
}

/**
 * Local enrichment map — keyed by idea.id. Step 28 looks up an idea
 * here; if absent, fall back to neutral UI (no source badge, etc).
 *
 * In a follow-up these come from the orchestrator, alongside the
 * PushIdeaToJira / DecideApproval / EnhanceIdea hooks.
 */
export const IDEA_ENRICHMENT: ReadonlyArray<IdeaEnrichment> = [
  {
    source: {
      kind: 'zendesk',
      label: 'Zendesk',
      accent: 'cyan',
      url: 'https://acme.zendesk.com/agent/tickets/31402',
      title: 'Checkout hangs on mobile — 47 tickets',
      reporter: 'Multiple customers',
      priority: 'high',
    },
    sync: {
      jira: { state: 'created', ref: 'ENG-481', lastSync: '4m ago' },
      confluence: { state: 'created', ref: 'AC/Refund-Flow-v2', lastSync: '12m ago' },
      ide: { state: 'running', active: 1, lastSync: '2m ago' },
    },
    reasoning: {
      chainId: 'reasoning-checkout',
      cluster: 'Grouped with 47 tickets about "checkout slowness"',
      feasibility: 'Detected PaymentService — 78% reusable code',
      impact: '247 affected customers · est. $14k monthly revenue',
      risk: 'Touches payment flow — high blast radius',
      finalScore: 8.4,
      confidence: 'high',
    },
  },
  {
    source: {
      kind: 'github',
      label: 'GitHub',
      accent: 'violet',
      url: 'https://github.com/acme/forge/issues/2031',
      title: 'Idea: cost-aware agent routing',
      reporter: 'Marcus Lee',
      priority: 'medium',
    },
    sync: {
      jira: { state: 'syncing' },
      confluence: { state: 'none' },
      ide: { state: 'queued' },
    },
    reasoning: {
      chainId: 'reasoning-routing',
      cluster: 'New idea — no cluster yet',
      feasibility: 'Estimated 2 sprints, touches 3 services',
      impact: 'Could reduce LLM cost 35%',
      risk: 'Needs approval from FinOps',
      finalScore: 7.6,
      confidence: 'medium',
    },
  },
  {
    source: {
      kind: 'manual',
      label: 'Manual',
      accent: 'amber',
    },
    sync: {
      jira: { state: 'none' },
      confluence: { state: 'none' },
      ide: { state: 'none' },
    },
    reasoning: {
      chainId: 'reasoning-manual',
      cluster: 'Single idea — no cluster yet',
      feasibility: 'TBD',
      impact: 'TBD',
      risk: 'TBD',
      finalScore: 6.0,
      confidence: 'low',
    },
  },
];

export function findEnrichment(
  ideaId: string,
): IdeaEnrichment | undefined {
  // Cycle the sample list so cards always have *something* to render
  // even when the orchestrator returns an idea id we haven't mapped.
  if (IDEA_ENRICHMENT.length === 0) return undefined;
  let hash = 0;
  for (let i = 0; i < ideaId.length; i += 1) {
    hash = (hash * 31 + ideaId.charCodeAt(i)) >>> 0;
  }
  return IDEA_ENRICHMENT[hash % IDEA_ENRICHMENT.length];
}

// ---------------------------------------------------------------------------
// One-click pipeline preview — what "Send to build pipeline" runs.
// ---------------------------------------------------------------------------

export type PipelineRunStepState = 'pending' | 'running' | 'success' | 'failed';

export interface PipelineRunStep {
  readonly id: string;
  readonly label: string;
  readonly state: PipelineRunStepState;
  readonly detail?: string;
}

export function buildInitialPipelineRun(idea: Idea): PipelineRunStep[] {
  return [
    { id: 'prd', label: 'Generate PRD', state: 'pending', detail: 'Forge Ideation Agent drafts a PRD' },
    { id: 'jira', label: 'Create Jira epic + story', state: 'pending', detail: idea.id },
    { id: 'confluence', label: 'Push to Confluence', state: 'pending', detail: 'Pages: 1' },
    { id: 'ide', label: 'Queue for ai agent', state: 'pending', detail: 'Architecture guardrails applied' },
  ];
}