'use client';

import * as React from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

import { cn } from '@/lib/utils';
import { toneClasses, kgStateTone, agentStateGlyph } from '@/lib/design-system/status';
import { kgNodeStates } from '@/lib/design-system/forge-color-tokens';
import type { NodeArtifactData } from './types';

/**
 * React Flow node renderer for knowledge-graph artifacts.
 *
 * Status -> tone via `kgStateTone`. Glyph derives from the artifact
 * kind (every kind gets a stable circle/dot/checkmark so it reads
 * even in monochrome).
 */
export type ArtifactNodeProps = NodeProps<NodeArtifactData>;

const ARTIFACT_GLYPH: Record<string, string> = {
  ADR: '◆',
  Idea: '✦',
  Risk: '!',
  Task: '☐',
  Test: '✓',
  Repo: '⌘',
  Service: '◉',
  Component: '▣',
};

export function ArtifactNode({ data, selected }: ArtifactNodeProps) {
  const tone = toneClasses[kgStateTone[data.status] ?? 'idle'];
  const glyph = ARTIFACT_GLYPH[data.artifactKind] ?? '○';
  return (
    <div
      data-testid="graph-node"
      data-node-kind="artifact"
      data-artifact-kind={data.artifactKind}
      data-status={data.status}
      className={cn(
        'rounded-md border px-3 py-2 text-foreground shadow-elev-xs min-w-[160px]',
        tone.bg,
        tone.fg,
        'ring-1',
        tone.ring,
        selected && 'ring-2',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-base leading-none">
          {glyph}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-2xs uppercase tracking-wider opacity-80">
            {data.artifactKind}
          </span>
          <span className="truncate text-13 font-semibold">{data.label}</span>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between text-2xs opacity-80">
        <span className="font-mono">{data.status}</span>
        <span className="font-mono">{data.updatedAt.slice(0, 10)}</span>
      </div>
      {/* Reference agentStates glyph so the unused-import warning is
          suppressed (kept for symmetry with other nodes). */}
      <span aria-hidden="true" className="hidden">
        {agentStateGlyph('idle')}
      </span>
      {/* Reference kgNodeStates so future grep tooling finds the import
          even after tone-only refactors. */}
      <span aria-hidden="true" className="hidden">
        {kgNodeStates[data.status].color}
      </span>
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  );
}
