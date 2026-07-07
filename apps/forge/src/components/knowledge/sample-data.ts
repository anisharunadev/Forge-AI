/**
 * Type definitions + empty data arrays for the Organization Knowledge page.
 *
 * ponytail: this file was deleted by Track S (mock-data removal) but the
 * components in this directory still reference the types and exported arrays.
 * Re-introducing the file with empty arrays lets consumers typecheck and
 * render empty states until they are wired to real data sources
 * (`lib/org-knowledge/data.ts` for org knowledge, `lib/hooks/useKnowledgeGraph.ts`
 * for the knowledge graph). Replace each empty `export const X = []` with a
 * query against the appropriate hook when wiring real data.
 *
 * This file does NOT re-introduce seed/mock content. Consumers should expect
 * arrays to be empty at runtime and render empty states accordingly.
 */

import type {
  Policy,
  Standard,
  Template,
} from '@/lib/org-knowledge/data';

export type RunbookStepKind = 'manual' | 'command' | 'check';

export interface RunbookStep {
  id: string;
  title: string;
  description: string;
  kind: RunbookStepKind;
  command?: string;
  expectedOutput?: string;
}

export interface Runbook {
  id: string;
  title: string;
  summary: string;
  steps: RunbookStep[];
  status: 'draft' | 'tested' | 'production' | 'outdated';
  successRate: number;
  lastRunAt: string;
  lastRunStatus: 'success' | 'failure' | 'cancelled';
}

export interface BestPractice {
  id: string;
  title: string;
  summary: string;
  category: 'code-quality' | 'testing' | 'security' | 'performance' | 'collaboration' | 'documentation';
  author: string;
  readingMinutes: number;
  read: boolean;
  featured: boolean;
}

export interface ProjectRef {
  id: string;
  name: string;
  artifactsCount: number;
  compliance: number;
  lastAudit: string;
}

export interface OverviewKpi {
  id: 'total' | 'recent' | 'adoption' | 'approval' | 'compliance';
  label: string;
  value: string;
  delta?: string;
  iconKey: 'book' | 'sparkles' | 'users' | 'clock' | 'shield';
  tone: 'indigo' | 'emerald' | 'cyan' | 'amber' | 'violet';
}

export interface ActivityEvent {
  id: string;
  when: string;
  actor: string;
  action: 'created' | 'updated' | 'approved' | 'archived' | 'published';
  ref: { id: string; label: string };
  summary?: string;
}

export interface KnowledgeGap {
  id: string;
  title: string;
  detail: string;
  severity: 'low' | 'medium' | 'high';
  // ponytail: optional — overview tab renders "View N projects →" when set.
  affectedProjects?: number;
}

export interface ArtifactEdge {
  from: string;
  to: string;
  kind: 'references' | 'supersedes' | 'depends-on' | 'related-to';
}

export interface RecommendedItem {
  id: string;
  title: string;
  reason: string;
  refId: string;
  tone: 'info' | 'warning' | 'positive';
  // ponytail: optional UI helpers — adoption badges use icon/label; other consumers ignore.
  icon?: string;
  label?: string;
}

export interface TemplateUsage {
  id: string;
  name: string;
  uses: number;
  type: 'prd' | 'adr' | 'bug' | 'runbook' | 'rfc' | 'spec' | 'custom';
}

// ponytail: empty arrays — components render empty states. Wire to real APIs.
// ponytail upgrade path: replace each with a query result (e.g.,
// `useKGNodes()`, `useOrgKnowledgeProjects()`).

export const PROJECTS: ReadonlyArray<ProjectRef> = [];

export const KPIS: ReadonlyArray<OverviewKpi> = [];

export const ACTIVITY: ReadonlyArray<ActivityEvent> = [];

export const KNOWLEDGE_GAPS: ReadonlyArray<KnowledgeGap> = [];

export const DRIFT_ALERTS: ReadonlyArray<KnowledgeGap> = [];

export const ADOPTION_BADGES: ReadonlyArray<RecommendedItem> = [];

export const QUICK_ACCESS: ReadonlyArray<Template> = [];

export const RECOMMENDED: ReadonlyArray<RecommendedItem> = [];

export const TEMPLATE_USAGE: ReadonlyArray<TemplateUsage> = [];

export const BEST_PRACTICES: ReadonlyArray<BestPractice> = [];

export const RUNBOOKS: ReadonlyArray<Runbook> = [];

export const GRAPH_EDGES: ReadonlyArray<ArtifactEdge> = [];
