'use client';

import * as React from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

import { cn } from '@/lib/utils';
import { toneClasses } from '@/lib/design-system/status';
import type { NodeRepoFileData } from './types';

/**
 * React Flow node renderer for a single repository file.
 *
 * Tone derives from lines-of-code: small files are idle, larger files
 * draw attention with the warn tone, oversized files with danger.
 * Thresholds are intentionally generous so a single 1k-line file does
 * not flash red.
 */
export type RepoFileNodeProps = NodeProps<NodeRepoFileData>;

function toneForLoc(loc: number | undefined): 'idle' | 'warn' | 'danger' {
  if (loc === undefined) return 'idle';
  if (loc > 2_000) return 'danger';
  if (loc > 500) return 'warn';
  return 'idle';
}

const LANG_GLYPH: Record<string, string> = {
  ts: 'TS',
  tsx: 'TX',
  py: 'PY',
  json: '{}',
  md: '#',
  yml: '⊞',
  yaml: '⊞',
  sql: 'DB',
  rs: 'RS',
  go: 'GO',
};

export function RepoFileNode({ data, selected }: RepoFileNodeProps) {
  const tone = toneClasses[toneForLoc(data.loc)];
  const langGlyph = LANG_GLYPH[data.language.toLowerCase()] ?? data.language.slice(0, 2).toUpperCase();
  return (
    <div
      data-testid="graph-node"
      data-node-kind="repoFile"
      data-language={data.language}
      className={cn(
        'rounded-md border px-3 py-2 text-foreground shadow-elev-xs min-w-[200px]',
        tone.bg,
        tone.fg,
        'ring-1',
        tone.ring,
        selected && 'ring-2',
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-flex h-5 w-7 items-center justify-center rounded-sm border border-current/30 bg-background/50 font-mono text-2xs"
        >
          {langGlyph}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-2xs uppercase tracking-wider opacity-80">
            {data.language}
          </span>
          <span className="truncate font-mono text-13">{data.path}</span>
        </div>
      </div>
      {data.loc !== undefined ? (
        <div className="mt-1 text-2xs font-mono opacity-80">{data.loc} loc</div>
      ) : null}
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  );
}
