'use client';

import * as React from 'react';
import { FileText } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { PRD } from '@/lib/ideation/data';

function renderMarkdown(md: string): React.ReactNode {
  const lines = md.split('\n');
  const nodes: React.ReactNode[] = [];
  let key = 0;

  let inCode = false;
  let codeBuf: string[] = [];
  let codeLang = '';

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        nodes.push(
          <pre
            key={`code-${key++}`}
            className="overflow-x-auto rounded-md border border-forge-700/40 bg-forge-900/60 p-3 text-xs"
          >
            <code data-lang={codeLang}>{codeBuf.join('\n')}</code>
          </pre>,
        );
        codeBuf = [];
        codeLang = '';
        inCode = false;
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    if (line.startsWith('# ')) {
      nodes.push(
        <h1
          key={key++}
          className="text-xl font-semibold leading-tight text-forge-50"
        >
          {line.slice(2)}
        </h1>,
      );
    } else if (line.startsWith('## ')) {
      nodes.push(
        <h2
          key={key++}
          className="mt-4 text-base font-semibold text-forge-100"
        >
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith('### ')) {
      nodes.push(
        <h3 key={key++} className="mt-3 text-sm font-semibold text-forge-200">
          {line.slice(4)}
        </h3>,
      );
    } else if (line.startsWith('- ')) {
      nodes.push(
        <li key={key++} className="ml-4 list-disc text-sm text-forge-100">
          {renderInline(line.slice(2))}
        </li>,
      );
    } else if (line.trim() === '') {
      nodes.push(<div key={key++} className="h-2" />);
    } else {
      nodes.push(
        <p key={key++} className="text-sm text-forge-100">
          {renderInline(line)}
        </p>,
      );
    }
  }

  return nodes;
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  const codeRe = /`([^`]+)`/;
  while (remaining.length > 0) {
    const m = codeRe.exec(remaining);
    if (!m) {
      parts.push(remaining);
      break;
    }
    if (m.index > 0) parts.push(remaining.slice(0, m.index));
    parts.push(
      <code
        key={key++}
        className="rounded bg-forge-800/60 px-1 py-0.5 font-mono text-xs"
      >
        {m[1]}
      </code>,
    );
    remaining = remaining.slice(m.index + m[0].length);
  }
  return parts;
}

export interface PRDViewerProps {
  prd: PRD;
  className?: string;
}

const STATUS_TONE: Record<PRD['status'], string> = {
  draft: 'border-forge-500/40 bg-forge-500/10 text-forge-200',
  review: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  approved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
};

export function PRDViewer({ prd, className }: PRDViewerProps) {
  return (
    <article
      data-testid="prd-viewer"
      data-prd-id={prd.id}
      className={cn('card flex flex-col gap-3', className)}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-forge-700 bg-forge-800 text-forge-200">
            <FileText className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-base font-semibold leading-tight">
              {prd.title}
            </h3>
            <p className="font-mono text-xs text-forge-300">
              {prd.id} · {prd.owner} · updated{' '}
              {new Date(prd.updatedAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            STATUS_TONE[prd.status],
          )}
        >
          {prd.status}
        </span>
      </header>

      <div className="flex flex-col gap-1">{renderMarkdown(prd.markdown)}</div>
    </article>
  );
}

export interface PRDListProps {
  prds: ReadonlyArray<PRD>;
  selectedId?: string;
  onSelect?: (prd: PRD) => void;
}

export function PRDList({ prds, selectedId, onSelect }: PRDListProps) {
  if (prds.length === 0) {
    return (
      <div className="card text-sm text-forge-300" data-testid="prd-list-empty">
        No PRDs available.
      </div>
    );
  }
  return (
    <ul
      role="list"
      aria-label="PRDs"
      data-testid="prd-list"
      className="grid gap-3"
    >
      {prds.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            onClick={() => onSelect?.(p)}
            className={cn(
              'flex w-full items-center justify-between rounded-md border bg-forge-900/30 p-3 text-left transition-colors',
              selectedId === p.id
                ? 'border-forge-300'
                : 'border-forge-700/40 hover:border-forge-500',
            )}
            data-testid="prd-list-item"
            data-prd-id={p.id}
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium">{p.title}</span>
              <span className="font-mono text-[10px] text-forge-300">
                {p.id} · {p.owner}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                {p.status}
              </Badge>
              <span className="font-mono text-[10px] text-forge-300">
                {new Date(p.updatedAt).toLocaleDateString()}
              </span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
