'use client';

/**
 * ConnectionsTab — Zone 11 in the Step 31 spec.
 *
 * Full-bleed force-directed graph of all integrations. Clicking a node
 * jumps to its connector detail (via the existing `?tab=connected&id=…`
 * query convention).
 */

import * as React from 'react';
import { Plug, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConnectionGraph } from '../ConnectionGraph';
import { ConnectorHealthIndicator } from '@/components/connectors/ConnectorHealthIndicator';
import { STATUS_DOT_CLASS } from '../constants';
import { listConnected, resolveIcon, type ConnectorHealthStatus } from '@/lib/connectors';
import { cn } from '@/lib/utils';

export function ConnectionsTab({ onClose }: { onClose?: () => void }) {
  const [highlight, setHighlight] = React.useState<string | null>(null);
  const connectors = listConnected();

  return (
    <div className="flex flex-col gap-4" data-testid="connector-connections-tab">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-fg-primary">Connection graph</h2>
          <p className="text-xs text-fg-tertiary">
            Forge is at the center. Spokes are connectors. Hover a node for details.
          </p>
        </div>
        {onClose ? (
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Close
          </Button>
        ) : null}
      </div>

      <ConnectionGraph height={460} />

      {/* Legend + selected node */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
          <h3 className="mb-2 text-sm font-semibold text-fg-primary">Nodes</h3>
          <ul className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-3 xl:grid-cols-4">
            {connectors.map((c) => {
              const Icon = resolveIcon(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(c.id)}
                    onMouseLeave={() => setHighlight(null)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1.5 text-left transition-colors',
                      highlight === c.id && 'border-[var(--accent-cyan)] bg-[var(--accent-cyan)]/5',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 text-fg-tertiary" aria-hidden="true" />
                    <span className="flex-1 truncate text-fg-primary">{c.displayName}</span>
                    <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT_CLASS[c.status])} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
          <h3 className="mb-2 text-sm font-semibold text-fg-primary">Legend</h3>
          <ul className="space-y-1 text-xs text-fg-secondary">
            {(['healthy', 'syncing', 'stale', 'failed', 'quarantined', 'paused'] as ConnectorHealthStatus[]).map((s) => (
              <li key={s} className="flex items-center gap-2">
                <span className={cn('h-2 w-2 rounded-full', STATUS_DOT_CLASS[s])} aria-hidden="true" />
                <span className="capitalize">{s}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 inline-flex items-center gap-1 text-[11px] text-fg-tertiary">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Edge weight ≈ usage in workflows
          </p>
        </div>
      </div>
    </div>
  );
}