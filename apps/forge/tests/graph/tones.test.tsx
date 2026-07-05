/**
 * M8 T-B5 — tone mapping test for the 5 typed React Flow node components.
 *
 * Each node component is mounted with a state/status prop, and we assert
 * the `data-tone` attribute on the rendered root matches the AC-2
 * canonical mapping (`emerald` / `amber` / `rose` / `neutral`).
 *
 * The full tone palette lives in `lib/design-system/status.ts`; this file
 * is the seam that pins it to the 4 canonical names tests + consumers
 * can rely on without knowing the full StatusTone union.
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

/**
 * Each typed node is rendered inside a `ReactFlowProvider` because the
 * `<Handle>` children pull zustand internals. We cast the prop stub to
 * `any` so the per-node `NodeProps<Node<TData, 'kind'>>` shape passes
 * through without us re-creating the full 15-field interface.
 */
function mountNode(Comp: React.ComponentType<any>, data: unknown): HTMLElement {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stub = { data, selected: false } as any;
  const result = render(
    <ReactFlowProvider>
      <Comp {...stub} />
    </ReactFlowProvider>,
  );
  // data-testid="graph-node" is added by every typed node; pull the root
  // element directly so the assertion is unambiguous when the test
  // suite adds additional nodes that share the testid.
  return result.getByTestId('graph-node');
}

describe('typed React Flow nodes — data-tone (AC-2)', () => {
  it('ArtifactNode → emerald for approved status', () => {
    const data: NodeArtifactData = {
      kind: 'artifact',
      label: 'ADR-014',
      artifactKind: 'ADR',
      status: 'approved',
      updatedAt: '2026-06-22T12:00:00Z',
    };
    const node = mountNode(ArtifactNode, data);
    expect(node.getAttribute('data-tone')).toBe('emerald');
    expect(node.getAttribute('data-status')).toBe('approved');
  });

  it('ArtifactNode → amber for conflicted status', () => {
    const data: NodeArtifactData = {
      kind: 'artifact',
      label: 'Risk-007',
      artifactKind: 'Risk',
      status: 'conflicted',
      updatedAt: '2026-06-22T12:00:00Z',
    };
    const node = mountNode(ArtifactNode, data);
    expect(node.getAttribute('data-tone')).toBe('amber');
  });

  it('ArtifactNode → neutral for draft status', () => {
    const data: NodeArtifactData = {
      kind: 'artifact',
      label: 'Idea-042',
      artifactKind: 'Idea',
      status: 'draft',
      updatedAt: '2026-06-22T12:00:00Z',
    };
    const node = mountNode(ArtifactNode, data);
    expect(node.getAttribute('data-tone')).toBe('neutral');
  });

  it('ServiceNode → emerald for healthy', () => {
    const data: NodeServiceData = {
      kind: 'service',
      label: 'auth-api',
      serviceKind: 'service',
      status: 'healthy',
    };
    const node = mountNode(ServiceNode, data);
    expect(node.getAttribute('data-tone')).toBe('emerald');
  });

  it('ServiceNode → rose for down', () => {
    const data: NodeServiceData = {
      kind: 'service',
      label: 'payment-api',
      serviceKind: 'service',
      status: 'down',
    };
    const node = mountNode(ServiceNode, data);
    expect(node.getAttribute('data-tone')).toBe('rose');
  });

  it('AgentStepNode → emerald for completed', () => {
    const data: NodeAgentStepData = {
      kind: 'agentStep',
      label: 'Generate tests',
      agent: 'forge-tests',
      state: 'completed',
    };
    const node = mountNode(AgentStepNode, data);
    expect(node.getAttribute('data-tone')).toBe('emerald');
  });

  it('AgentStepNode → rose for failed', () => {
    const data: NodeAgentStepData = {
      kind: 'agentStep',
      label: 'Compile',
      agent: 'forge-dev',
      state: 'failed',
    };
    const node = mountNode(AgentStepNode, data);
    expect(node.getAttribute('data-tone')).toBe('rose');
  });

  it('ApprovalNode → amber for waiting_approval', () => {
    const data: NodeApprovalData = {
      kind: 'approval',
      label: 'Promote to prod',
      phase: 'Deployment',
      runState: 'waiting_approval',
      requestedBy: 'sre',
    };
    const node = mountNode(ApprovalNode, data);
    expect(node.getAttribute('data-tone')).toBe('amber');
  });

  it('ApprovalNode → rose for rejected', () => {
    const data: NodeApprovalData = {
      kind: 'approval',
      label: 'Promote to prod',
      phase: 'Deployment',
      runState: 'rejected',
      requestedBy: 'sre',
    };
    const node = mountNode(ApprovalNode, data);
    expect(node.getAttribute('data-tone')).toBe('rose');
  });

  it('RepoFileNode → neutral for small files', () => {
    const data: NodeRepoFileData = {
      kind: 'repoFile',
      label: 'README.md',
      path: 'README.md',
      language: 'md',
      loc: 120,
    };
    const node = mountNode(RepoFileNode, data);
    expect(node.getAttribute('data-tone')).toBe('neutral');
  });

  it('RepoFileNode → amber for medium files', () => {
    const data: NodeRepoFileData = {
      kind: 'repoFile',
      label: 'auth/login.ts',
      path: 'auth/login.ts',
      language: 'ts',
      loc: 800,
    };
    const node = mountNode(RepoFileNode, data);
    expect(node.getAttribute('data-tone')).toBe('amber');
  });

  it('RepoFileNode → rose for large files', () => {
    const data: NodeRepoFileData = {
      kind: 'repoFile',
      label: 'monolith.ts',
      path: 'monolith.ts',
      language: 'ts',
      loc: 3_500,
    };
    const node = mountNode(RepoFileNode, data);
    expect(node.getAttribute('data-tone')).toBe('rose');
  });
});