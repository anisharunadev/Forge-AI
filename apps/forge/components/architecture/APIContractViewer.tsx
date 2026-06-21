'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { APIContract } from '@/lib/architecture/data';

const KIND_LABEL: Record<APIContract['kind'], string> = {
  openapi: 'OpenAPI 3.0',
  graphql: 'GraphQL SDL',
  grpc: 'Protocol Buffers',
  asyncapi: 'AsyncAPI 2.5',
};

function tokenize(src: string, kind: APIContract['kind']): React.ReactNode {
  if (kind === 'graphql' || kind === 'openapi' || kind === 'asyncapi') {
    const rules: Array<{ re: RegExp; cls: string }> = [
      { re: /^[A-Z][A-Za-z0-9_]*/, cls: 'text-cyan-300' },
      { re: /^[a-z][A-Za-z0-9_]*/, cls: 'text-sky-300' },
      { re: /^"(?:[^"\\]|\\.)*"/, cls: 'text-emerald-300' },
      { re: /^'(?:[^'\\]|\\.)*'/, cls: 'text-emerald-300' },
      { re: /^\d+(\.\d+)?/, cls: 'text-amber-300' },
      { re: /^#[^\n]*/, cls: 'text-forge-400 italic' },
    ];
    return colorize(src, rules);
  }
  // proto
  const protoRules: Array<{ re: RegExp; cls: string }> = [
    { re: /^(?:syntax|package|service|rpc|message|enum|repeated|optional|returns|stream|import)\b/, cls: 'text-violet-300' },
    { re: /^\d+/, cls: 'text-amber-300' },
    { re: /^"(?:[^"\\]|\\.)*"/, cls: 'text-emerald-300' },
    { re: /^[A-Z][A-Za-z0-9_]*/, cls: 'text-cyan-300' },
    { re: /^[a-z][A-Za-z0-9_]*/, cls: 'text-sky-300' },
    { re: /^\/\/[^\n]*/, cls: 'text-forge-400 italic' },
  ];
  return colorize(src, protoRules);
}

function colorize(
  src: string,
  rules: Array<{ re: RegExp; cls: string }>,
): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let remaining = src;
  let key = 0;
  while (remaining.length > 0) {
    let matched = false;
    for (const rule of rules) {
      const m = rule.re.exec(remaining);
      if (m && m.index === 0) {
        nodes.push(
          <span key={key++} className={rule.cls}>
            {m[0]}
          </span>,
        );
        remaining = remaining.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      nodes.push(remaining[0]);
      remaining = remaining.slice(1);
    }
  }
  return nodes;
}

export interface APIContractViewerProps {
  contract: APIContract;
  className?: string;
}

export function APIContractViewer({ contract, className }: APIContractViewerProps) {
  return (
    <article
      data-testid="api-contract-viewer"
      data-contract-id={contract.id}
      className={cn('card flex flex-col gap-3', className)}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold leading-tight">
            {contract.title}
          </h3>
          <p className="font-mono text-xs text-forge-300">
            {contract.service} · v{contract.version} · updated{' '}
            {new Date(contract.updatedAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant="outline">{KIND_LABEL[contract.kind]}</Badge>
          <span className="font-mono text-[10px] uppercase tracking-wide text-forge-300">
            {contract.status}
          </span>
        </div>
      </header>
      <pre
        data-testid="contract-source"
        className="max-h-96 overflow-auto rounded-md border border-forge-700/40 bg-forge-950/70 p-3 text-xs leading-relaxed"
      >
        <code>{tokenize(contract.source, contract.kind)}</code>
      </pre>
    </article>
  );
}
