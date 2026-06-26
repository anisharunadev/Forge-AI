/**
 * Color and sizing tables shared by the canvas renderer, the legend,
 * the filter bar, and the inspector.
 *
 * All values come from the v2.0 dark-theme design tokens — no hard-coded
 * hex anywhere else in this folder.
 */

import type { EdgeKind, NodeKind } from '@/src/data/sample-graph';

export const KIND_COLOR: Record<NodeKind, string> = {
  Repo: '#22D3EE', // cyan
  Service: '#10B981', // emerald
  Component: '#67E8F9', // cyan-light
  ADR: '#A855F7', // violet
  Idea: '#F59E0B', // amber
  Risk: '#F43F5E', // rose
  Task: '#EAB308', // yellow
  Test: '#06B6D4', // cyan-bright
  Agent: '#818CF8', // indigo
  Run: '#22D3EE', // cyan-running
  Story: '#A1A1AA', // muted
  Epic: '#7C3AED', // violet-dark
  Command: '#A5B4FC', // indigo-light
  PRD: '#B45309', // amber-dark
};

export const KIND_ICON: Record<NodeKind, string> = {
  Repo: '📁',
  Service: '⚙️',
  Component: '🧩',
  ADR: '📜',
  Idea: '💡',
  Risk: '⚠️',
  Task: '✅',
  Test: '🧪',
  Agent: '🤖',
  Run: '▶️',
  Story: '📋',
  Epic: '📦',
  Command: '⚡',
  PRD: '📄',
};

export const EDGE_COLOR: Record<EdgeKind, string> = {
  references: '#52525B', // --fg-muted
  depends_on: '#F43F5E', // rose
  blocks: '#F59E0B', // amber
  implements: '#10B981', // emerald
  supersedes: '#A855F7', // violet (animated dashed)
  related_to: '#22D3EE', // cyan (dashed)
};

export const EDGE_LABEL: Record<EdgeKind, string> = {
  references: 'references',
  depends_on: 'depends on',
  blocks: 'blocks',
  implements: 'implements',
  supersedes: 'supersedes',
  related_to: 'related to',
};

export const ALL_KINDS: ReadonlyArray<NodeKind> = [
  'Repo',
  'Service',
  'Component',
  'ADR',
  'Idea',
  'Risk',
  'Task',
  'Test',
  'Agent',
  'Run',
  'Story',
  'Epic',
  'Command',
  'PRD',
];

export const ALL_EDGE_KINDS: ReadonlyArray<EdgeKind> = [
  'references',
  'depends_on',
  'blocks',
  'implements',
  'supersedes',
  'related_to',
];

/**
 * Maps a node's degree (edge count) to a render radius in pixels.
 * Spec: min 8px, max 32px.
 */
export function radiusForDegree(degree: number): number {
  return Math.min(32, 8 + Math.sqrt(degree) * 5);
}