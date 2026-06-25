'use client';

/**
 * MCPServerCard — display card for a single LiteLLM MCP server
 * entry. Read-only — the LiteLLM admin UI is the surface for
 * managing MCP server config (per OQ-34).
 *
 * Mirrors `components/connector-center/ConnectorCard.tsx` so the
 * visual language matches the existing Connectors Center.
 */

import * as React from 'react';
import { PlugZap, Globe, Terminal, Tag } from 'lucide-react';

import { StatusPill } from '@/components/shell';
import { cn } from '@/lib/utils';

import type { MCPServerEntry } from '@/lib/litellm/data';

export interface MCPServerCardProps {
  readonly server: MCPServerEntry;
  readonly className?: string;
}

function statusTone(s: string): React.ComponentProps<typeof StatusPill>['tone'] {
  switch (s) {
    case 'active':
    case 'healthy':
    case 'ok':
      return 'success';
    case 'stale':
    case 'degraded':
      return 'warn';
    case 'failed':
    case 'down':
    case 'unreachable':
      return 'danger';
    default:
      return 'idle';
  }
}

function transportIcon(transport: string): React.ReactNode {
  switch (transport.toLowerCase()) {
    case 'stdio':
      return <Terminal className="h-4 w-4" aria-hidden="true" />;
    case 'http':
    case 'https':
    case 'sse':
      return <Globe className="h-4 w-4" aria-hidden="true" />;
    default:
      return <PlugZap className="h-4 w-4" aria-hidden="true" />;
  }
}

export function MCPServerCard({ server, className }: MCPServerCardProps) {
  const s = server;
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground',
        className,
      )}
      data-testid="mcp-server-card"
      data-mcp-server-id={s.id}
      data-mcp-server-status={s.status}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted text-foreground"
          >
            {transportIcon(s.transport)}
          </span>
          <div>
            <h3 className="text-base font-semibold leading-tight">
              {s.name}
            </h3>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {s.transport}
            </p>
          </div>
        </div>
        <StatusPill
          tone={statusTone(s.status)}
          label={s.status}
          size="sm"
        />
      </header>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs">
        {s.command ? (
          <>
            <dt className="inline-flex items-center gap-1 text-muted-foreground">
              <Terminal className="h-3 w-3" aria-hidden="true" />
              Command
            </dt>
            <dd className="truncate font-mono text-foreground">
              {s.command}
            </dd>
          </>
        ) : null}
        {s.url ? (
          <>
            <dt className="inline-flex items-center gap-1 text-muted-foreground">
              <Globe className="h-3 w-3" aria-hidden="true" />
              URL
            </dt>
            <dd className="truncate font-mono text-foreground">{s.url}</dd>
          </>
        ) : null}
        <dt className="inline-flex items-center gap-1 text-muted-foreground">
          <Tag className="h-3 w-3" aria-hidden="true" />
          Scopes
        </dt>
        <dd className="font-mono text-foreground">{s.scopes.length}</dd>
      </dl>

      <footer className="flex items-center justify-between border-t border-border pt-2 text-[10px]">
        <span className="font-mono text-muted-foreground">{s.id}</span>
        <span className="text-muted-foreground">read-only</span>
      </footer>
    </article>
  );
}
