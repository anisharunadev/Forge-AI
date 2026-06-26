'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import type { WorkflowTemplate } from '@/lib/workflow/types';

/**
 * MiniPreview — 60px-tall monochrome SVG of the workflow's DAG.
 *
 * Renders only boxes + lines in `var(--fg-muted)`. Node count +
 * branching layout is approximated from `nodes` and `edges`.
 */

export interface TemplatePreviewProps {
  readonly template: WorkflowTemplate;
  readonly className?: string;
  readonly height?: number;
}

function nodeBounds(
  nodes: ReadonlyArray<WorkflowTemplate['nodes'][number]>,
): { width: number; height: number } {
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { width: maxX + 80, height: maxY + 60 };
}

export function TemplatePreview({ template, className, height = 60 }: TemplatePreviewProps) {
  const { width, height: contentH } = nodeBounds(template.nodes);
  const w = Math.max(180, width);
  const h = Math.max(48, contentH);
  const scale = height / h;
  const scaled = { width: w * scale, height: h * scale };
  const nodeW = 56 * scale;
  const nodeH = 22 * scale;

  return (
    <div
      data-testid={`template-preview-${template.id}`}
      className={cn(
        'flex h-[60px] w-full items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-inset)]',
        className,
      )}
    >
      <svg
        viewBox={`0 0 ${scaled.width} ${scaled.height}`}
        width={scaled.width}
        height={scaled.height}
        aria-hidden="true"
        role="img"
        className="text-[var(--fg-muted)]"
      >
        {/* edges */}
        {template.edges.map((e) => {
          const srcIdx = Number.parseInt(e.source.split('-')[1] ?? '0', 10);
          const tgtIdx = Number.parseInt(e.target.split('-')[1] ?? '0', 10);
          const src = template.nodes[srcIdx];
          const tgt = template.nodes[tgtIdx];
          if (!src || !tgt) return null;
          const sx = (src.position.x + 40) * scale;
          const sy = (src.position.y + 18) * scale + nodeH / 2;
          const tx = (tgt.position.x + 40) * scale;
          const ty = (tgt.position.y + 18) * scale + nodeH / 2;
          const mx = (sx + tx) / 2;
          return (
            <path
              key={e.id}
              d={`M${sx},${sy} C${mx},${sy} ${mx},${ty} ${tx},${ty}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
              opacity={0.55}
            />
          );
        })}
        {/* nodes */}
        {template.nodes.map((n, i) => {
          const x = n.position.x * scale;
          const y = n.position.y * scale + 18 * scale;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={nodeW}
                height={nodeH}
                rx={3}
                fill="var(--bg-elevated)"
                stroke="currentColor"
                strokeWidth={1}
                opacity={0.9}
              />
              <text
                x={x + 6}
                y={y + nodeH / 2 + 3}
                fontSize={9}
                fill="currentColor"
                opacity={0.7}
                className="font-mono"
              >
                {(n.label ?? n.kind).slice(0, 9)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}