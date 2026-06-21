'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { ApprovalStatusBadge } from './ApprovalStatusBadge';
import type { ADR } from '@/lib/architecture/data';

function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split('\n');
  const nodes: React.ReactNode[] = [];
  let key = 0;
  for (const line of lines) {
    if (line.startsWith('# ')) {
      nodes.push(
        <h1 key={key++} className="text-xl font-semibold text-forge-50">
          {line.slice(2)}
        </h1>,
      );
    } else if (line.startsWith('## ')) {
      nodes.push(
        <h2 key={key++} className="mt-4 text-base font-semibold text-forge-100">
          {line.slice(3)}
        </h2>,
      );
    } else if (line.trim() === '') {
      nodes.push(<div key={key++} className="h-2" />);
    } else {
      nodes.push(
        <p key={key++} className="text-sm text-forge-100">
          {line}
        </p>,
      );
    }
  }
  return nodes;
}

export interface ADRViewerProps {
  adr: ADR;
  className?: string;
}

export function ADRViewer({ adr, className }: ADRViewerProps) {
  return (
    <article
      data-testid="adr-viewer"
      data-adr-id={adr.id}
      className={cn('card flex flex-col gap-3', className)}
    >
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs text-forge-300">
            ADR-{String(adr.number).padStart(4, '0')}
          </span>
          <ApprovalStatusBadge status={adr.status} />
        </div>
        <h2 className="text-xl font-semibold leading-tight text-forge-50">
          {adr.title}
        </h2>
        <p className="text-xs text-forge-300">
          Owner: <span className="text-forge-100">{adr.owner}</span> · updated{' '}
          {new Date(adr.updatedAt).toLocaleDateString()}
        </p>
      </header>

      <Separator />

      <div className="flex flex-col gap-1">{renderMarkdown(adr.markdown)}</div>

      {adr.supersededBy ? (
        <p className="mt-2 text-xs text-rose-300">
          Superseded by ADR-{String(adr.supersededBy).padStart(4, '0')}.
        </p>
      ) : null}
    </article>
  );
}
