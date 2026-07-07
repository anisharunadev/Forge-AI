/**
 * Workflow templates — the 6 starter workflows surfaced in the gallery.
 *
 * Each template is a JSON document the canvas can hydrate into nodes +
 * edges via `hydrateTemplate`. Templates are intentionally simple —
 * they showcase the *shape* of a useful workflow rather than every
 * possible configuration. Users are expected to extend them.
 *
 * Layout convention: nodes are laid out left-to-right on a single row
 * so the mini-preview SVGs render predictably.
 */

import {
  GitBranch,
  Lightbulb,
  Rocket,
  ShieldCheck,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import type { WorkflowNodeData, WorkflowTemplate } from './types';

/* ---------------------------------------------------------------------------
 * 1. Ideation → PRD pipeline
 * --------------------------------------------------------------------------- */

const ideationNodes = [
  { kind: 'trigger' as const, label: 'New idea submitted', triggerType: 'event' as const, triggerDetail: 'idea.created', position: { x: 0, y: 0 } },
  { kind: 'command' as const, label: 'Capture idea', commandName: 'forge-ideation-capture', commandLabel: 'Capture idea', position: { x: 240, y: 0 } },
  { kind: 'llmPrompt' as const, label: 'AI score & tag', prompt: 'Score this idea from 0-10 across clarity, novelty, and feasibility. Output JSON.', model: 'claude-sonnet', temperature: 0.2, position: { x: 480, y: 0 } },
  { kind: 'condition' as const, label: 'Score >= 7?', expression: 'score >= 7', position: { x: 720, y: 0 } },
  { kind: 'approval' as const, label: 'PM approval', approverIds: ['role:product-manager'], timeoutHours: 24, criteria: 'Worth a PRD?', position: { x: 960, y: -60 } },
  { kind: 'command' as const, label: 'Generate PRD', commandName: 'forge-prd-generate', commandLabel: 'Generate PRD', position: { x: 1200, y: -60 } },
  { kind: 'end' as const, label: 'Save to knowledge', outcome: 'success' as const, position: { x: 1440, y: -60 } },
  { kind: 'end' as const, label: 'Archive idea', outcome: 'always' as const, position: { x: 960, y: 80 } },
];

/* ---------------------------------------------------------------------------
 * 2. Bug fix workflow
 * --------------------------------------------------------------------------- */

const bugFixNodes = [
  { kind: 'trigger' as const, label: 'Sentry webhook', triggerType: 'webhook' as const, triggerDetail: 'POST /hooks/sentry', position: { x: 0, y: 0 } },
  { kind: 'command' as const, label: 'Reproduce issue', commandName: 'forge-test-reproduce', commandLabel: 'Reproduce', position: { x: 240, y: 0 } },
  { kind: 'llmPrompt' as const, label: 'AI root-cause', prompt: 'Analyze stack trace and recent commits. Suggest 3 likely root causes ranked by confidence.', model: 'claude-sonnet', position: { x: 480, y: 0 } },
  { kind: 'approval' as const, label: 'Engineer review', approverIds: ['role:engineer'], timeoutHours: 12, position: { x: 720, y: 0 } },
  { kind: 'command' as const, label: 'Open fix branch', commandName: 'forge-branch-fix', commandLabel: 'Open branch', position: { x: 960, y: 0 } },
  { kind: 'command' as const, label: 'Run tests', commandName: 'forge-test-unit', commandLabel: 'Run tests', position: { x: 1200, y: 0 } },
  { kind: 'command' as const, label: 'Notify', commandName: 'forge-notify-slack', commandLabel: 'Notify', position: { x: 1440, y: 0 } },
];

/* ---------------------------------------------------------------------------
 * 3. New feature workflow
 * --------------------------------------------------------------------------- */

const featureNodes = [
  { kind: 'trigger' as const, label: 'Feature ticket ready', triggerType: 'event' as const, triggerDetail: 'jira.issue.ready', position: { x: 0, y: 0 } },
  { kind: 'command' as const, label: 'Scaffold code', commandName: 'forge-dev-scaffold', commandLabel: 'Scaffold', position: { x: 240, y: 0 } },
  { kind: 'agent' as const, label: 'Implement', agentId: 'forge-dev', agentLabel: 'Forge Dev Agent', taskDescription: 'Implement the feature per ticket', position: { x: 480, y: 0 } },
  { kind: 'command' as const, label: 'Run tests', commandName: 'forge-test-unit', commandLabel: 'Run tests', position: { x: 720, y: 0 } },
  { kind: 'approval' as const, label: 'QA approval', approverIds: ['role:qa'], timeoutHours: 48, position: { x: 960, y: 0 } },
  { kind: 'command' as const, label: 'Deploy preview', commandName: 'forge-deploy-preview', commandLabel: 'Deploy preview', position: { x: 1200, y: 0 } },
  { kind: 'command' as const, label: 'Notify team', commandName: 'forge-notify-slack', commandLabel: 'Notify', position: { x: 1440, y: 0 } },
];

/* ---------------------------------------------------------------------------
 * 4. Code review workflow
 * --------------------------------------------------------------------------- */

const reviewNodes = [
  { kind: 'trigger' as const, label: 'PR opened', triggerType: 'event' as const, triggerDetail: 'github.pull_request.opened', position: { x: 0, y: 0 } },
  { kind: 'agent' as const, label: 'AI review', agentId: 'forge-reviewer', agentLabel: 'Forge Reviewer', taskDescription: 'Review PR for correctness, style, and security', position: { x: 240, y: 0 } },
  { kind: 'llmPrompt' as const, label: 'Score quality', prompt: 'Score the PR review: pass/fail + 0-100 quality score.', model: 'claude-sonnet', temperature: 0.1, position: { x: 480, y: 0 } },
  { kind: 'approval' as const, label: 'Maintainer approval', approverIds: ['role:maintainer'], timeoutHours: 24, position: { x: 720, y: 0 } },
  { kind: 'command' as const, label: 'Auto-merge', commandName: 'forge-merge-pr', commandLabel: 'Merge PR', position: { x: 960, y: 0 } },
  { kind: 'end' as const, label: 'Await human merge', outcome: 'failure' as const, position: { x: 960, y: 80 } },
];

/* ---------------------------------------------------------------------------
 * 5. Refactor workflow
 * --------------------------------------------------------------------------- */

const refactorNodes = [
  { kind: 'trigger' as const, label: 'Refactor request', triggerType: 'manual' as const, position: { x: 0, y: 0 } },
  { kind: 'command' as const, label: 'Analyze module', commandName: 'forge-arch-analyze', commandLabel: 'Analyze', position: { x: 240, y: 0 } },
  { kind: 'llmPrompt' as const, label: 'Propose plan', prompt: 'Suggest a refactor plan with steps and risks.', model: 'claude-sonnet', position: { x: 480, y: 0 } },
  { kind: 'approval' as const, label: 'Tech lead approval', approverIds: ['role:tech-lead'], timeoutHours: 48, position: { x: 720, y: 0 } },
  { kind: 'command' as const, label: 'Apply refactor', commandName: 'forge-refactor-apply', commandLabel: 'Apply', position: { x: 960, y: 0 } },
  { kind: 'command' as const, label: 'Run tests', commandName: 'forge-test-unit', commandLabel: 'Run tests', position: { x: 1200, y: 0 } },
  { kind: 'command' as const, label: 'Open PR', commandName: 'forge-pr-open', commandLabel: 'Open PR', position: { x: 1440, y: 0 } },
];

/* ---------------------------------------------------------------------------
 * 6. Deploy workflow
 * --------------------------------------------------------------------------- */

const deployNodes = [
  { kind: 'trigger' as const, label: 'Manual or cron', triggerType: 'schedule' as const, triggerDetail: 'every 6h', position: { x: 0, y: 0 } },
  { kind: 'command' as const, label: 'Health checks', commandName: 'forge-health-check', commandLabel: 'Health', position: { x: 240, y: 0 } },
  { kind: 'approval' as const, label: 'Release manager', approverIds: ['role:release-manager'], timeoutHours: 4, position: { x: 480, y: 0 } },
  { kind: 'command' as const, label: 'Deploy', commandName: 'forge-deploy-prod', commandLabel: 'Deploy', position: { x: 720, y: 0 } },
  { kind: 'command' as const, label: 'Smoke test', commandName: 'forge-test-smoke', commandLabel: 'Smoke test', position: { x: 960, y: 0 } },
  // Step 45 — Canary Agent visual diff between pre-deploy and post-deploy.
  { kind: 'command' as const, label: 'Canary check', commandName: 'forge-browser-deploy-verify', commandLabel: 'Canary', position: { x: 1200, y: 0 } },
  { kind: 'command' as const, label: 'Notify', commandName: 'forge-notify-slack', commandLabel: 'Notify', position: { x: 1440, y: 0 } },
];

/* ---------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------- */

function makeEdges(
  nodes: ReadonlyArray<{ readonly position: { readonly x: number; readonly y: number } }>,
  edges: ReadonlyArray<{ readonly from: number; readonly to: number; readonly label?: string }>,
) {
  return edges.map((e, i) => {
    const src = nodes[e.from];
    const tgt = nodes[e.to];
    const srcId = `n-${e.from}-${src?.position.y === 0 ? 'main' : 'branch'}`;
    const tgtId = `n-${e.to}-${tgt?.position.y === 0 ? 'main' : 'branch'}`;
    return {
      id: `e${i}-${e.from}-${e.to}`,
      source: srcId,
      target: tgtId,
      ...(e.label !== undefined ? { label: e.label } : {}),
    };
  });
}

/** Map raw position into a stable id the canvas can target. */
export function makeTemplateNodeIds(
  nodes: ReadonlyArray<{ readonly position: { readonly x: number; readonly y: number } }>,
): string[] {
  return nodes.map((n, i) => `n-${i}-${n.position.y === 0 ? 'main' : 'branch'}`);
}

/* ---------------------------------------------------------------------------
 * Template list — exported as the 6 starter workflows
 * --------------------------------------------------------------------------- */

const ideationEdges = makeEdges(ideationNodes, [
  { from: 0, to: 1 },
  { from: 1, to: 2 },
  { from: 2, to: 3 },
  { from: 3, to: 4, label: 'true' },
  { from: 3, to: 7, label: 'false' },
  { from: 4, to: 5 },
  { from: 5, to: 6 },
]);

const bugFixEdges = makeEdges(bugFixNodes, [
  { from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 },
  { from: 4, to: 5 }, { from: 5, to: 6 },
]);

const featureEdges = makeEdges(featureNodes, [
  { from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 },
  { from: 4, to: 5 }, { from: 5, to: 6 },
]);

const reviewEdges = makeEdges(reviewNodes, [
  { from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 },
  { from: 3, to: 5 },
]);

const refactorEdges = makeEdges(refactorNodes, [
  { from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 },
  { from: 4, to: 5 }, { from: 5, to: 6 },
]);

const deployEdges = makeEdges(deployNodes, [
  { from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 },
  { from: 4, to: 5 }, { from: 5, to: 6 },
]);

interface TemplateSeed {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly icon: LucideIcon;
  readonly colorVar: string;
  readonly tags: ReadonlyArray<string>;
  readonly nodes: ReadonlyArray<WorkflowNodeData & { readonly position: { readonly x: number; readonly y: number } }>;
  readonly edges: ReadonlyArray<{ readonly id: string; readonly source: string; readonly target: string; readonly label?: string }>;
}

const SEEDS: ReadonlyArray<TemplateSeed> = [
  {
    id: 'tpl-ideation-prd',
    name: 'Ideation → PRD pipeline',
    description: 'Capture an idea, score it with AI, gate on PM approval, then auto-generate a PRD into the knowledge base.',
    category: 'Ideation',
    icon: Lightbulb,
    colorVar: '--accent-amber',
    tags: ['ideation', 'prd', 'ai-scoring'],
    nodes: ideationNodes,
    edges: ideationEdges,
  },
  {
    id: 'tpl-bug-fix',
    name: 'Bug fix workflow',
    description: 'Webhook from Sentry → reproduce → AI root-cause → human review → fix branch → tests → notify.',
    category: 'Development',
    icon: Wrench,
    colorVar: '--accent-rose',
    tags: ['bug', 'sentry', 'remediation'],
    nodes: bugFixNodes,
    edges: bugFixEdges,
  },
  {
    id: 'tpl-feature',
    name: 'New feature workflow',
    description: 'Scaffold code, let the dev agent implement, run tests, gate on QA approval, then deploy to preview.',
    category: 'Development',
    icon: Rocket,
    colorVar: '--accent-cyan',
    tags: ['feature', 'scaffold', 'deploy-preview'],
    nodes: featureNodes,
    edges: featureEdges,
  },
  {
    id: 'tpl-code-review',
    name: 'Code review workflow',
    description: 'PR opened → AI review → quality score → maintainer approval → auto-merge on pass.',
    category: 'Code review',
    icon: GitBranch,
    colorVar: '--accent-primary',
    tags: ['review', 'auto-merge'],
    nodes: reviewNodes,
    edges: reviewEdges,
  },
  {
    id: 'tpl-refactor',
    name: 'Refactor workflow',
    description: 'Analyze module → AI plan → tech-lead approval → apply → tests → open PR.',
    category: 'Architecture',
    icon: Sparkles,
    colorVar: '--accent-violet',
    tags: ['refactor', 'architecture'],
    nodes: refactorNodes,
    edges: refactorEdges,
  },
  {
    id: 'tpl-deploy',
    name: 'Deploy workflow',
    description: 'Scheduled trigger → health checks → release-manager approval → deploy → smoke test → notify.',
    category: 'Deployment',
    icon: ShieldCheck,
    colorVar: '--accent-emerald',
    tags: ['deploy', 'production'],
    nodes: deployNodes,
    edges: deployEdges,
  },
];

export const WORKFLOW_TEMPLATES: ReadonlyArray<WorkflowTemplate> = SEEDS.map((s) => ({
  id: s.id,
  name: s.name,
  description: s.description,
  category: s.category,
  icon: s.icon,
  colorVar: s.colorVar,
  tags: s.tags,
  nodes: s.nodes,
  edges: s.edges,
}));

/** The 4 KPI tiles shown above the gallery. */
export const WORKFLOW_KPIS = [
  {
    id: 'kpi-count',
    label: 'Workflows',
    value: '24',
    delta: '+3 this week',
    trend: 'up' as const,
    sparkline: [12, 14, 16, 18, 19, 20, 22, 24],
    accent: 'indigo' as const,
  },
  {
    id: 'kpi-runs',
    label: 'Runs today',
    value: '187',
    delta: '+12% vs. yesterday',
    trend: 'up' as const,
    sparkline: [120, 132, 141, 152, 158, 170, 178, 187],
    accent: 'cyan' as const,
  },
  {
    id: 'kpi-duration',
    label: 'Avg duration',
    value: '4m 12s',
    delta: '−22s vs. last week',
    trend: 'down' as const,
    sparkline: [4.8, 4.6, 4.7, 4.5, 4.4, 4.3, 4.2, 4.2],
    accent: 'amber' as const,
  },
  {
    id: 'kpi-success',
    label: 'Success rate',
    value: '94%',
    delta: '+1.2pp',
    trend: 'up' as const,
    sparkline: [88, 89, 90, 91, 92, 93, 93.5, 94],
    accent: 'emerald' as const,
  },
] as const;

/**
 * @deprecated Track N (Day 3): no `GET /v1/workflows` list endpoint exists.
 * `WorkflowGallery` now renders an explicit "Backend integration pending — Day 4+"
 * empty state. When the list endpoint ships, replace consumers with the
 * equivalent TanStack Query hook (`useWorkflows`). Kept the export name so
 * legacy imports still resolve to `[]`.
 */
export const SAMPLE_USER_WORKFLOWS: ReadonlyArray<never> = [] as const;

/**
 * @deprecated Track N (Day 3): no `GET /v1/workflows/runs` list endpoint exists.
 * `WorkflowLeftSidebar.RunsTab` now renders an explicit
 * "Backend integration pending — Day 4+" empty state. Replace with
 * `useWorkflowRuns()` once the endpoint ships.
 */
export const SAMPLE_RUNS: ReadonlyArray<never> = [] as const;

/**
 * @deprecated Track N (Day 3): drafts now come from the backend
 * (`useWorkflows({ status: 'draft' })`); the gallery renders an empty
 * state until the list endpoint ships (Day 4+).
 */
export const SAMPLE_DRAFTS: ReadonlyArray<never> = [] as const;

/**
 * @deprecated Track N (Day 3): shared workflows now come from the backend
 * (the closest analog is `status: 'published'`); the gallery renders an
 * empty state until the list endpoint ships (Day 4+).
 */
export const SAMPLE_SHARED: ReadonlyArray<never> = [] as const;