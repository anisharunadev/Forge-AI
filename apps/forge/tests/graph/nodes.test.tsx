/**
 * Vitest render tests for the typed React Flow node components
 * (Phase 0.5-06). Each test mounts the component directly (React
 * Flow's Handle/NodeProps context is shallow-rendered as plain
 * elements here so we don't need the full ReactFlowProvider plumbing).
 */

import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';

import {
  ArtifactNode,
  RepoFileNode,
  ServiceNode,
  AgentStepNode,
  ApprovalNode,
} from '@/components/graph';
import type {
  NodeArtifactData,
  NodeRepoFileData,
  NodeServiceData,
  NodeAgentStepData,
  NodeApprovalData,
} from '@/components/graph';
import type { Node, NodeProps } from '@xyflow/react';

/**
 * React Flow renders node components via `<NodeWrapper data={...} />`,
 * but the node component itself only reads `data` (and `selected`).
 * The `<Handle>` children use zustand internally, so we wrap each
 * render in a `ReactFlowProvider`.
 *
 * The component constraint is intentionally `ComponentType<any>` so
 * each production node's `NodeProps<Node<TData, 'kind'>>` shape
 * passes through without us re-creating the per-node generic. The
 * cast inside is the bridge.
 */
function mountNode(Comp: React.ComponentType<any>, data: unknown, selected = false): void {
  // NodeProps has many fields; the node components only consume
  // `data` and `selected`. Cast the stub so we don't fabricate 15
  // optional fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stub = { data, selected } as any;
  render(
    <ReactFlowProvider>
      <Comp {...stub} />
    </ReactFlowProvider>,
  );
}

describe('ArtifactNode', () => {
  it('renders the artifact label + tone classes for approved status', () => {
    const data: NodeArtifactData = {
      kind: 'artifact',
      label: 'ADR-014 typed artifacts',
      artifactKind: 'ADR',
      status: 'approved',
      updatedAt: '2026-06-22T12:00:00Z',
    };
    mountNode(ArtifactNode, data);
    const node = screen.getByTestId('graph-node');
    expect(node.getAttribute('data-node-kind')).toBe('artifact');
    expect(node.getAttribute('data-status')).toBe('approved');
    expect(node.textContent).toContain('ADR-014 typed artifacts');
    expect(node.textContent).toContain('ADR');
    // Tone classes from `toneClasses.success` map
    expect(node.className).toMatch(/bg-success\/15/);
    expect(node.className).toMatch(/text-success/);
  });
});

describe('RepoFileNode', () => {
  it('renders path + language eyebrow', () => {
    const data: NodeRepoFileData = {
      kind: 'repoFile',
      label: 'services/auth/login.ts',
      path: 'services/auth/login.ts',
      language: 'ts',
      loc: 240,
    };
    mountNode(RepoFileNode, data);
    const node = screen.getByTestId('graph-node');
    expect(node.getAttribute('data-language')).toBe('ts');
    expect(node.textContent).toContain('services/auth/login.ts');
    expect(node.textContent).toContain('240 loc');
  });

  it('renders without loc gracefully', () => {
    const data: NodeRepoFileData = {
      kind: 'repoFile',
      label: 'README.md',
      path: 'README.md',
      language: 'md',
    };
    mountNode(RepoFileNode, data);
    const node = screen.getByTestId('graph-node');
    expect(node.textContent).not.toContain('loc');
  });
});

describe('ServiceNode', () => {
  it('renders region when provided', () => {
    const data: NodeServiceData = {
      kind: 'service',
      label: 'auth-api',
      serviceKind: 'service',
      status: 'healthy',
      region: 'us-east-1',
    };
    mountNode(ServiceNode, data);
    const node = screen.getByTestId('graph-node');
    expect(node.textContent).toContain('us-east-1');
    expect(node.textContent).toContain('healthy');
    expect(node.className).toMatch(/bg-success\/15/);
  });

  it('renders without region gracefully', () => {
    const data: NodeServiceData = {
      kind: 'service',
      label: 'auth-api',
      serviceKind: 'service',
      status: 'idle',
    };
    mountNode(ServiceNode, data);
    const node = screen.getByTestId('graph-node');
    expect(node.textContent).not.toContain('undefined');
  });
});

describe('AgentStepNode', () => {
  it('renders the executing glyph + spin animation class', () => {
    const data: NodeAgentStepData = {
      kind: 'agentStep',
      label: 'Generate tests',
      agent: 'forge-tests',
      state: 'executing',
      durationMs: 1_400,
    };
    mountNode(AgentStepNode, data);
    const node = screen.getByTestId('graph-node');
    expect(node.getAttribute('data-state')).toBe('executing');
    expect(node.textContent).toContain('Generate tests');
    // Executing glyph is the filled circle (●)
    expect(node.textContent).toContain('●');
    expect(node.className).toMatch(/bg-execution\/15/);
  });

  it('renders thinking state with the slow glyph', () => {
    const data: NodeAgentStepData = {
      kind: 'agentStep',
      label: 'Decompose ADR',
      agent: 'forge-arch',
      state: 'thinking',
    };
    mountNode(AgentStepNode, data);
    const node = screen.getByTestId('graph-node');
    expect(node.getAttribute('data-state')).toBe('thinking');
    expect(node.textContent).toContain('◐');
  });
});

describe('ApprovalNode', () => {
  it('renders rejected approval with destructive tone', () => {
    const data: NodeApprovalData = {
      kind: 'approval',
      label: 'Promote to prod',
      phase: 'Deployment',
      runState: 'rejected',
      requestedBy: 'sre',
    };
    mountNode(ApprovalNode, data);
    const node = screen.getByTestId('graph-node');
    expect(node.getAttribute('data-run-state')).toBe('rejected');
    expect(node.textContent).toContain('Deployment');
    expect(node.textContent).toContain('Promote to prod');
    expect(node.className).toMatch(/bg-destructive\/15/);
  });

  it('renders pending approval with review tone', () => {
    const data: NodeApprovalData = {
      kind: 'approval',
      label: 'Approve ADR-014',
      phase: 'Architecture',
      runState: 'waiting_approval',
      requestedBy: 'forge-arch',
    };
    mountNode(ApprovalNode, data);
    const node = screen.getByTestId('graph-node');
    expect(node.getAttribute('data-run-state')).toBe('waiting_approval');
    expect(node.className).toMatch(/bg-review\/15/);
  });
});
