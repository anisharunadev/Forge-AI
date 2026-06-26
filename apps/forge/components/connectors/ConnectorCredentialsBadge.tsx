'use client';

/**
 * ConnectorCredentialsBadge — inline "Connect X to use this" pill.
 *
 * When an action requires a connector that isn't connected, this badge
 * renders a tappable pill that opens the connector center or invokes
 * the install flow. Use anywhere a connector reference might appear.
 */

import * as React from 'react';
import { Plus, Plug } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { resolveIcon } from '@/lib/connectors';

export interface ConnectorCredentialsBadgeProps {
  readonly connectorId: string;
  readonly displayName: string;
  readonly variant?: 'inline' | 'block';
  readonly onConnect?: () => void;
  readonly className?: string;
}

export function ConnectorCredentialsBadge({
  connectorId,
  displayName,
  variant = 'inline',
  onConnect,
  className,
}: ConnectorCredentialsBadgeProps) {
  const Icon = resolveIcon(connectorId);

  if (variant === 'block') {
    return (
      <div
        className={cn(
          'flex items-center justify-between gap-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-3 py-2',
          className,
        )}
        data-testid="connector-credentials-badge"
        data-connector-id={connectorId}
      >
        <div className="flex items-center gap-2 text-sm">
          <Icon className="h-4 w-4 text-fg-tertiary" aria-hidden="true" />
          <span className="text-fg-secondary">
            Connect <span className="font-medium text-fg-primary">{displayName}</span> to use this
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={onConnect}>
          <Plus className="h-3 w-3" aria-hidden="true" />
          Connect now
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onConnect}
      data-testid="connector-credentials-badge"
      data-connector-id={connectorId}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-0.5 text-xs text-fg-secondary transition-colors hover:border-[var(--accent-cyan)] hover:text-fg-primary cursor-pointer',
        className,
      )}
      aria-label={`Connect ${displayName} to use this`}
    >
      <Plug className="h-3 w-3" aria-hidden="true" />
      <span>Connect {displayName}</span>
    </button>
  );
}