'use client';

/**
 * ConnectorSpotlight — embeddable demo of all four cross-cutting
 * connector components. Used by Ideation / Run detail / Workflow
 * editor to illustrate the cross-cutting provider wiring.
 */

import * as React from 'react';
import { Plug, WandSparkles } from 'lucide-react';

import { ConnectorActionButton } from './ConnectorActionButton';
import { ConnectorCredentialsBadge } from './ConnectorCredentialsBadge';
import { ConnectorHealthIndicator } from './ConnectorHealthIndicator';
import { ConnectorPicker } from './ConnectorPicker';
import { listConnected } from '@/lib/connectors';
import { cn } from '@/lib/utils';

export interface ConnectorSpotlightProps {
  readonly title?: string;
  readonly description?: string;
  readonly className?: string;
}

export function ConnectorSpotlight({
  title = 'Connect a source',
  description = 'Pick a connector to pull issues, tickets or signals into this workspace.',
  className,
}: ConnectorSpotlightProps) {
  // Pick the first installed connector for the demo so the badges show real data.
  const first = listConnected()[0];
  return (
    <div
      className={cn(
        'rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4',
        className,
      )}
      data-testid="connector-spotlight"
    >
      <header className="mb-3 flex items-center gap-2">
        <Plug className="h-4 w-4 text-[var(--accent-cyan)]" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-fg-primary">{title}</h3>
      </header>
      <p className="mb-3 text-xs text-fg-tertiary">{description}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-wider text-fg-tertiary">
            ConnectorPicker
          </span>
          <ConnectorPicker capability="pull_issues" placeholder="Search issue sources…" />
        </div>
        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-wider text-fg-tertiary">
            ConnectorHealthIndicator
          </span>
          {first ? (
            <div className="flex items-center gap-2">
              <ConnectorHealthIndicator
                connectorId={first.id}
                status={first.status}
                showLabel
              />
              <span className="text-[11px] text-fg-tertiary">
                · {first.displayName}
              </span>
            </div>
          ) : null}
        </div>
        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-wider text-fg-tertiary">
            ConnectorActionButton
          </span>
          <ConnectorActionButton
            entityLabel="this idea"
            actions={[
              { id: 'send-to-slack', label: 'Send to Slack', capability: 'send_message' },
              { id: 'create-jira', label: 'Create Jira ticket', capability: 'create_ticket' },
            ]}
            variant="inline"
          />
        </div>
        <div className="space-y-2">
          <span className="text-[10px] uppercase tracking-wider text-fg-tertiary">
            ConnectorCredentialsBadge
          </span>
          <ConnectorCredentialsBadge
            connectorId="__missing__"
            displayName="Linear"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3 text-[11px] text-fg-tertiary">
        <span className="inline-flex items-center gap-1">
          <WandSparkles className="h-3 w-3" aria-hidden="true" />
          Powered by the cross-cutting Connector Provider
        </span>
        <a href="/connector-center" className="hover:text-fg-secondary">
          Manage connectors →
        </a>
      </div>
    </div>
  );
}