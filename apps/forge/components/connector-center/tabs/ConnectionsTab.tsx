'use client';

/**
 * ConnectionsTab — Zone 11 in the Step 31 spec.
 *
 * M3-G8 — Step 55 wires this tab to the live connectors via the
 * `useLiveConnectorData()` context (which already exposes
 * `connectors: Connector[]` as part of its three-state merge). The
 * force-directed graph renders identically against live data; only
 * the per-node legend list changes source.
 *
 * Behavior
 * --------
 *   - Loading state: dim the existing layout via opacity-50 so the
 *     graph renders without nodes (rather than an empty container).
 *   - Empty state (Rule 15): "Install 2+ connectors to see the graph"
 *     with a deep-link to the marketplace.
 *   - Errored state: identical to empty except for the rose border.
 *
 * The graph itself (`ConnectionGraph`) reads from
 * `useConnectors()` internally — we don't need to refactor it.
 */

import * as React from 'react';
import { Plug, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConnectionGraph } from '../ConnectionGraph';
import { STATUS_DOT_CLASS } from '../constants';
import { useLiveConnectorData } from '../LiveConnectorDataProvider';
import { resolveIcon, type ConnectorHealthStatus } from '@/lib/connectors';
import { cn } from '@/lib/utils';

export function ConnectionsTab({ onClose }: { onClose?: () => void }) {
  const [highlight, setHighlight] = React.useState<string | null>(null);

  // M3-G8 — read connectors from the LiveConnectorDataProvider
  // context. The provider's three-state merge (loading→mock,
  // loaded+empty→[], errored→mock, loaded+rows→live) is already
  // handled here, so we don't need to manage the loading state
  // ourselves.
  const liveData = useLiveConnectorData();
  const connectors = liveData?.connectors ?? [];

  // Force-graph needs ≥2 nodes to render meaningfully; treat
  // `length < 2` as the empty state per Rule 15.
  const isEmpty = connectors.length < 2;
  const isErrored = false; // Provider doesn't surface per-query isError;
                           // OfflineBanner handles that globally.

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

      <div className={cn('transition-opacity', isEmpty && 'opacity-50')}>
        <ConnectionGraph height={460} />
      </div>

      {isEmpty && !isErrored ? (
        <div
          className="rounded-md border border-dashed border-[var(--border-default)] p-8 text-center"
          data-testid="connections-empty"
        >
          <Plug className="mx-auto mb-2 h-6 w-6 text-fg-tertiary" aria-hidden="true" />
          <p className="text-sm text-fg-secondary">Install 2+ connectors to see the graph</p>
          <a
            href="#tab=marketplace"
            className="mt-2 inline-block text-xs text-[var(--accent-cyan)] hover:underline"
            onClick={(e) => {
              e.preventDefault();
              window.location.hash = 'tab=marketplace';
            }}
          >
            Browse marketplace →
          </a>
        </div>
      ) : null}

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