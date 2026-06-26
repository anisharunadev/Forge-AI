/**
 * Step 45 — 3 new package-backed agents registered in Agent Center.
 *
 * These three agents are NOT defined by the orchestrator. They are
 * backed by the local `@forge-ai/forge-pi` and `@forge-ai/forge-browser`
 * packages. The Agent Center renders them as first-class agents with
 * the same `Agent` shape so the UI never has to branch on source.
 *
 *   - PM Agent     (forge-pi)  → Ideation, Command Center, Co-pilot
 *   - QA Agent     (forge-browser) → Stories (PR), Code Review, Deploy
 *   - Canary Agent (forge-browser) → Deploy workflow, Analytics
 *
 * Invariant: every agent carries `package` so the Agent Center can
 * badge it with the originating 3-package tab.
 */

import type { Agent } from './data';

type Step45Agent = Agent & {
  /** Originating package — drives the Agent Center badge. */
  package: 'forge-pi' | 'forge-browser';
  /** Surface entry points for the agent. */
  entry_points: ReadonlyArray<string>;
};

export const STEP45_AGENTS: ReadonlyArray<Step45Agent> = [
  {
    id: 'agent.pm',
    name: 'PM Agent',
    type: 'custom',
    status: 'active',
    version: '0.1.0',
    description:
      'Scans customer feedback, market signals, and existing PRDs to generate a quarterly roadmap with ranked features and predicted impact.',
    defaultProvider: 'internal',
    supportedTasks: ['ideation', 'product-strategy'],
    lastInvokedAt: new Date().toISOString(),
    invocations24h: 0,
    costUsd24h: 0,
    package: 'forge-pi',
    entry_points: [
      'Ideation Center',
      'Command Center',
      'Co-pilot',
    ],
  },
  {
    id: 'agent.qa',
    name: 'QA Agent',
    type: 'custom',
    status: 'active',
    version: '0.1.0',
    description:
      'Opens a PR preview, navigates changed screens, takes screenshots, and produces a visual diff report + WCAG accessibility check.',
    defaultProvider: 'internal',
    supportedTasks: ['qa', 'code-review', 'deploy'],
    lastInvokedAt: new Date().toISOString(),
    invocations24h: 0,
    costUsd24h: 0,
    package: 'forge-browser',
    entry_points: [
      'Stories (PR linked)',
      'Code Review',
      'Deploy phase',
    ],
  },
  {
    id: 'agent.canary',
    name: 'Canary Agent',
    type: 'custom',
    status: 'active',
    version: '0.1.0',
    description:
      'Post-deploy — opens the production URL, captures a screenshot, compares to pre-deploy baseline, and alerts on visual regressions.',
    defaultProvider: 'internal',
    supportedTasks: ['deploy', 'monitoring'],
    lastInvokedAt: new Date().toISOString(),
    invocations24h: 0,
    costUsd24h: 0,
    package: 'forge-browser',
    entry_points: [
      'Deploy workflow',
      'Analytics Center',
    ],
  },
];

/**
 * Merge the Step 45 agents into the orchestrator-provided list. Idempotent
 * — if an agent with the same `id` is already present, the orchestrator's
 * version wins (since it carries live runtime data).
 */
export function withStep45Agents(
  orchestratorAgents: ReadonlyArray<Agent>,
): ReadonlyArray<Agent> {
  const existing = new Set(orchestratorAgents.map((a) => a.id));
  const additions = STEP45_AGENTS.filter((a) => !existing.has(a.id));
  return [...orchestratorAgents, ...additions];
}